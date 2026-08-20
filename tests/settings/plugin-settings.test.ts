import { describe, expect, it } from 'vitest';

import {
  migrateTiandituCredentialBindings,
  normalizePluginSettings,
  setConnectionProfileRemembered,
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

  it('preserves the remembered Secret ID through a settings reload', () => {
    const persisted = {
      connectionProfiles: [
        {
          id: 'profile-00112233445566778899aabbccddeeff',
          name: 'Remote',
          serverOrigin: 'https://loom.example',
          rememberToken: true,
          tokenSecretId: 'server-token',
        },
      ],
    };

    const afterUpgrade = normalizePluginSettings(persisted);
    const reloaded = normalizePluginSettings(afterUpgrade);

    expect(reloaded.connectionProfiles[0]).toMatchObject({
      id: 'profile-00112233445566778899aabbccddeeff',
      tokenSecretId: 'server-token',
      rememberToken: true,
    });
  });

  it('detaches the Secret ID when remembering is turned off', () => {
    const settings = normalizePluginSettings({
      connectionProfiles: [
        {
          id: 'profile-00112233445566778899aabbccddeeff',
          name: 'Remote',
          serverOrigin: 'https://loom.example',
          rememberToken: true,
          tokenSecretId: 'server-token',
        },
      ],
    });
    const profile = settings.connectionProfiles[0];
    if (profile === undefined) throw new Error('Expected a connection profile.');

    setConnectionProfileRemembered(profile, false);

    expect(profile).toMatchObject({
      rememberToken: false,
      tokenSecretId: null,
    });
  });

  it('does not enable remembering without a Secret ID', () => {
    const settings = normalizePluginSettings({
      connectionProfiles: [
        {
          id: 'profile-00112233445566778899aabbccddeeff',
          name: 'Remote',
          serverOrigin: 'https://loom.example',
          rememberToken: false,
          tokenSecretId: null,
        },
      ],
    });
    const profile = settings.connectionProfiles[0];
    if (profile === undefined) throw new Error('Expected a connection profile.');

    setConnectionProfileRemembered(profile, true);

    expect(profile).toMatchObject({
      rememberToken: false,
      tokenSecretId: null,
    });
  });
});

