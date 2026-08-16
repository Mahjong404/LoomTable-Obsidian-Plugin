import { describe, expect, it } from 'vitest';

import {
  TileProviderRegistry,
  summarizeResolvedTilePlan,
} from '../../src/maps/providers/tile-provider-registry';
import { BUILT_IN_TILE_PROVIDERS } from '../../src/maps/providers/presets';
import {
  credentialBindingKey,
  redactTileText,
  validateCustomTileProviderProfile,
  validateProviderDefinition,
  type CustomTileProviderProfileV1,
  type TileCredentialReader,
  type TileProviderRef,
} from '../../src/maps/providers/tile-provider-schema';

describe('TileProviderRegistry', () => {
  it('lists the four built-in presets and resolves OSM without credentials', () => {
    const registry = new TileProviderRegistry();
    const credentials = reader({});

    expect(registry.list().map((item) => item.ref)).toEqual([
      { kind: 'built-in', id: 'osm-standard' },
      { kind: 'built-in', id: 'tianditu-vector' },
      { kind: 'built-in', id: 'tianditu-imagery' },
      { kind: 'built-in', id: 'tianditu-terrain' },
    ]);
    const resolution = registry.resolve({ kind: 'built-in', id: 'osm-standard' }, credentials);

    expect(resolution).toMatchObject({
      ok: true,
      plan: {
        providerId: 'osm-standard',
        crs: 'EPSG:3857',
        layers: [{ urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png' }],
      },
    });
  });

  it('requires a Tianditu token and expands it only in the in-memory plan', () => {
    const registry = new TileProviderRegistry();
    const ref: TileProviderRef = { kind: 'built-in', id: 'tianditu-vector' };
    const binding = credentialBindingKey(ref, 'tianditu-token');

    expect(registry.resolve(ref, reader({}))).toMatchObject({
      ok: false,
      error: { kind: 'configuration-required', credentialSlotId: 'tianditu-token' },
    });

    const resolution = registry.resolve(ref, reader({ [binding]: 'secret-token' }));
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.plan.layers[0]?.urlTemplate).toContain('tk=secret-token');
    expect(JSON.stringify(summarizeResolvedTilePlan(resolution.plan))).not.toContain(
      'secret-token',
    );
  });

  it('accepts a loopback custom XYZ profile but rejects unsafe origins and literal keys', () => {
    const valid = customProfile({
      urlTemplate: 'http://localhost:8080/tiles/{z}/{x}/{y}.png',
    });
    expect(validateCustomTileProviderProfile(valid)).toBeNull();

    expect(
      validateCustomTileProviderProfile(
        customProfile({ urlTemplate: 'http://tiles.example/{z}/{x}/{y}.png' }),
      ),
    ).toMatchObject({ kind: 'invalid-origin' });
    expect(
      validateCustomTileProviderProfile(
        customProfile({ urlTemplate: 'https://tiles.example/{z}/{x}/{y}.png?token=literal' }),
      ),
    ).toMatchObject({ kind: 'invalid-template' });
  });

  it('requires credential placeholders for custom sensitive parameters and preserves attribution safety', () => {
    const profile = customProfile({
      credentialSlots: [{ id: 'key', displayName: 'API key', required: true }],
      urlTemplate: 'https://tiles.example/{z}/{x}/{y}.png?key={credential:key}',
    });
    expect(validateCustomTileProviderProfile(profile)).toBeNull();
    expect(
      validateCustomTileProviderProfile(customProfile({ attribution: [{ label: '<img>' }] })),
    ).toMatchObject({ kind: 'invalid-profile' });
  });

  it('rejects unsupported CRS and redacts credential-like diagnostics', () => {
    const definition = { ...BUILT_IN_TILE_PROVIDERS[0]!, crs: 'EPSG:4326' };
    expect(validateProviderDefinition(definition)).toMatchObject({ kind: 'unsupported-crs' });
    expect(redactTileText('request tk=secret-token access_token=other')).toBe(
      'request tk=[redacted] access_token=[redacted]',
    );
  });
});

function reader(values: Readonly<Record<string, string>>): TileCredentialReader {
  return { get: (bindingKey) => values[bindingKey] ?? null };
}

function customProfile(
  overrides: Partial<CustomTileProviderProfileV1> = {},
): CustomTileProviderProfileV1 {
  return {
    schemaVersion: 1,
    id: 'custom-local',
    name: 'Local tiles',
    urlTemplate: 'https://tiles.example/{z}/{x}/{y}.png',
    minZoom: 0,
    maxZoom: 18,
    tileSize: 256,
    attribution: [{ label: 'Example tiles', url: 'https://tiles.example/terms' }],
    ...overrides,
  };
}
