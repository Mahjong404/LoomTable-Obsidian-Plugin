import { describe, expect, it } from 'vitest';

import {
  SessionCredentialStore,
  type CredentialStore,
} from '../../src/credentials/credential-store';
import { ProfileCredentialStore } from '../../src/credentials/profile-credential-store';
import type { ConnectionProfile } from '../../src/settings/connection-profile';

class MemoryCredentialStore implements CredentialStore {
  readonly values = new Map<string, string>();

  get(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  set(key: string, token: string): void {
    this.values.set(key, token);
  }

  delete(key: string): void {
    this.values.delete(key);
  }
}

const profile: ConnectionProfile = {
  id: 'profile-00112233445566778899aabbccddeeff' as ConnectionProfile['id'],
  name: 'Local',
  serverOrigin: 'http://localhost:3000',
  rememberToken: false,
  tokenSecretId: null,
};

describe('profile credential policy', () => {
  it('keeps tokens session-only by default', () => {
    const persistent = new MemoryCredentialStore();
    const store = new ProfileCredentialStore(new SessionCredentialStore(), persistent);

    store.setSession(profile, 'secret');

    expect(store.get(profile)).toBe('secret');
    expect(persistent.get(profile.id)).toBeNull();
  });

  it('reads a user-owned SecretStorage entry through its saved binding', () => {
    const persistent = new MemoryCredentialStore();
    const store = new ProfileCredentialStore(new SessionCredentialStore(), persistent);
    const remembered = { ...profile, rememberToken: true, tokenSecretId: 'remote-token' };

    persistent.set('remote-token', 'secret');

    expect(store.get(remembered)).toBe('secret');
  });

  it('prefers a session token over a remembered secret', () => {
    const persistent = new MemoryCredentialStore();
    const store = new ProfileCredentialStore(new SessionCredentialStore(), persistent);
    const remembered = { ...profile, rememberToken: true, tokenSecretId: 'remote-token' };
    persistent.set('remote-token', 'remembered');

    store.setSession(remembered, 'session');

    expect(store.get(remembered)).toBe('session');
  });
});
