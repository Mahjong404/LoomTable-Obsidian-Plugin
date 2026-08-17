import { describe, expect, it } from 'vitest';

import {
  migrateTiandituCredentialBindings,
  normalizePluginSettings,
} from '../../src/settings/plugin-settings';

describe('map credential binding migration', () => {
  it('collapses legacy per-layer Secret Storage references to one shared binding', () => {
    const migrated = migrateTiandituCredentialBindings({
      'built-in:tianditu-vector:tianditu-token': 'secret-vector',
      'built-in:tianditu-imagery:tianditu-token': 'secret-imagery',
      'built-in:tianditu-terrain:tianditu-token': 'secret-terrain',
      'custom:local:key': 'secret-custom',
    });

    expect(migrated).toEqual({
      'built-in:tianditu:tianditu-token': 'secret-vector',
      'custom:local:key': 'secret-custom',
    });
    expect(JSON.stringify(migrated)).not.toContain('secret-vector-value');
  });

  it('keeps the shared binding and never stores a plaintext credential', () => {
    const settings = normalizePluginSettings({
      mapPresentation: {
        credentialBindings: {
          'built-in:tianditu:tianditu-token': 'secret-id',
        },
      },
    });

    expect(settings.mapPresentation.credentialBindings).toEqual({
      'built-in:tianditu:tianditu-token': 'secret-id',
    });
  });
});

