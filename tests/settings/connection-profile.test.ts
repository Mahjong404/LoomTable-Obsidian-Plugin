import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SERVER_ORIGIN,
  type ConnectionProfileId,
  createConnectionProfileId,
  createConnectionProfileSecretId,
  normalizeServerOrigin,
} from '../../src/settings/connection-profile';
import {
  addConnectionProfile,
  normalizePluginSettings,
  removeConnectionProfile,
} from '../../src/settings/plugin-settings';

describe('connection profiles', () => {
  it('normalizes an HTTPS server origin', () => {
    expect(normalizeServerOrigin(' https://example.com/ ')).toBe('https://example.com');
  });

  it.each([
    'postgres://localhost/db',
    'https://user:pass@example.com',
    'https://example.com?a=1',
    'https://example.com/loomtable',
    'http://example.com',
  ])('rejects unsafe origin %s', (origin) => {
    expect(() => normalizeServerOrigin(origin)).toThrow();
  });

  it('allows HTTP only for loopback origins', () => {
    expect(normalizeServerOrigin('http://localhost:3000/')).toBe('http://localhost:3000');
    expect(normalizeServerOrigin('http://127.0.0.1:3000')).toBe('http://127.0.0.1:3000');
    expect(normalizeServerOrigin('http://[::1]:3000')).toBe('http://[::1]:3000');
  });

  it('uses the Server native loopback address for new connections', () => {
    expect(DEFAULT_SERVER_ORIGIN).toBe('http://127.0.0.1:31201');
    expect(normalizeServerOrigin(DEFAULT_SERVER_ORIGIN)).toBe(DEFAULT_SERVER_ORIGIN);
  });

  it('creates a stable local profile id from a UUID', () => {
    expect(createConnectionProfileId(() => '00112233-4455-6677-8899-aabbccddeeff')).toBe(
      'profile-00112233445566778899aabbccddeeff',
    );
  });

  it('derives a SecretStorage id without using the Plugin version', () => {
    const profileId = 'profile-00112233445566778899aabbccddeeff' as ConnectionProfileId;

    expect(createConnectionProfileSecretId(profileId)).toBe(
      'loomtable:profile-00112233445566778899aabbccddeeff:server-token',
    );
  });

  it('defaults a new profile to a stable remembered Secret binding', () => {
    const settings = normalizePluginSettings(null);
    const profile = addConnectionProfile(
      settings,
      {
        name: 'Remote',
        serverOrigin: 'https://loom.example',
      },
      () => 'profile-00112233445566778899aabbccddeeff' as ConnectionProfileId,
    );

    expect(profile).toMatchObject({
      rememberToken: true,
      tokenSecretId: 'loomtable:profile-00112233445566778899aabbccddeeff:server-token',
    });
  });

  it('selects the first valid profile when a persisted default is invalid', () => {
    const settings = normalizePluginSettings({
      locale: 'zh-CN',
      defaultConnectionProfileId: 'profile-ffffffffffffffffffffffffffffffff',
      connectionProfiles: [
        {
          id: 'profile-00112233445566778899aabbccddeeff',
          name: 'Local',
          serverOrigin: 'http://localhost:3000/',
          rememberToken: false,
          tokenSecretId: null,
        },
      ],
    });

    expect(settings.defaultConnectionProfileId).toBe('profile-00112233445566778899aabbccddeeff');
    expect(settings.connectionProfiles[0]?.serverOrigin).toBe('http://localhost:3000');
  });

  it('maintains a valid default while adding and removing profiles', () => {
    const settings = normalizePluginSettings(null);
    const first = addConnectionProfile(
      settings,
      {
        name: 'Local',
        serverOrigin: 'http://localhost:3000',
        rememberToken: false,
        tokenSecretId: null,
      },
      () => 'profile-00112233445566778899aabbccddeeff' as ConnectionProfileId,
    );
    const second = addConnectionProfile(
      settings,
      {
        name: 'Remote',
        serverOrigin: 'https://loom.example',
        rememberToken: true,
        tokenSecretId: 'remote-token',
      },
      () => 'profile-ffeeddccbbaa99887766554433221100' as ConnectionProfileId,
    );

    expect(settings.defaultConnectionProfileId).toBe(first.id);
    removeConnectionProfile(settings, first.id);
    expect(settings.defaultConnectionProfileId).toBe(second.id);
  });
});
