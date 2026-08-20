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

  it('persists an explicitly remembered session token across credential-store recreation', () => {
    const persistent = new MemoryCredentialStore();
    const store = new ProfileCredentialStore(new SessionCredentialStore(), persistent);
    const remembered = { ...profile, rememberToken: true, tokenSecretId: 'server-token' };

    store.setSession(remembered, 'session-secret');

    expect(store.rememberSessionToken(remembered)).toBe(true);

    const reloaded = new ProfileCredentialStore(new SessionCredentialStore(), persistent);
    expect(reloaded.get(remembered)).toBe('session-secret');
  });

  it('does not persist a session token when remembering is disabled', () => {
    const persistent = new MemoryCredentialStore();
    const store = new ProfileCredentialStore(new SessionCredentialStore(), persistent);

    store.setSession(profile, 'session-secret');

    expect(store.rememberSessionToken(profile)).toBe(false);
    expect(persistent.values).toEqual(new Map());
    expect(new ProfileCredentialStore(new SessionCredentialStore(), persistent).get(profile)).toBeNull();
  });

  it('does not read a SecretStorage binding after remembering is disabled', () => {
    const persistent = new MemoryCredentialStore();
    const store = new ProfileCredentialStore(new SessionCredentialStore(), persistent);
    const disabled = { ...profile, rememberToken: false, tokenSecretId: 'server-token' };
    persistent.set('server-token', 'remembered-secret');

    expect(store.get(disabled)).toBeNull();
  });

  it('clears the session on disconnect without deleting the user-owned SecretStorage value', () => {
    const persistent = new MemoryCredentialStore();
    const store = new ProfileCredentialStore(new SessionCredentialStore(), persistent);
    const remembered = { ...profile, rememberToken: true, tokenSecretId: 'server-token' };
    persistent.set('server-token', 'remembered-secret');
    store.setSession(remembered, 'session-secret');

    store.delete(remembered);

    expect(store.getSession(remembered)).toBeNull();
    expect(persistent.get('server-token')).toBe('remembered-secret');
    expect(store.get(remembered)).toBe('remembered-secret');
  });

  it('treats a missing SecretStorage reference as no credential', () => {
    const persistent = new MemoryCredentialStore();
    const store = new ProfileCredentialStore(new SessionCredentialStore(), persistent);
    const missing = { ...profile, rememberToken: true, tokenSecretId: 'missing-secret' };

    expect(store.get(missing)).toBeNull();
  });

});
