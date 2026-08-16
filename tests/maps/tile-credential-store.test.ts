import { describe, expect, it } from 'vitest';

import type { CredentialStore } from '../../src/credentials/credential-store';
import { TileCredentialStore } from '../../src/maps/credentials/tile-credential-store';

describe('TileCredentialStore', () => {
  it('keeps session credentials separate from persisted Secret IDs', () => {
    const persistent = new MemoryCredentialStore({ secret_01: 'remembered-token' });
    const store = new TileCredentialStore(persistent, () => ({ binding_01: 'secret_01' }));

    expect(store.get('binding_01')).toBe('remembered-token');
    store.setSession('binding_01', 'session-token');
    expect(store.get('binding_01')).toBe('session-token');
    store.deleteSession('binding_01');
    expect(store.get('binding_01')).toBe('remembered-token');
    store.clearSession();
    expect(persistent.setCalls).toHaveLength(0);
  });

  it('does not expose empty or missing Secret references as credentials', () => {
    const store = new TileCredentialStore(new MemoryCredentialStore({ secret_01: '' }), () => ({
      missing: 'unknown',
      empty: '',
    }));

    expect(store.get('missing')).toBeNull();
    expect(store.get('empty')).toBeNull();
  });
});

class MemoryCredentialStore implements CredentialStore {
  readonly setCalls: string[] = [];

  constructor(private readonly values: Record<string, string>) {}

  get(key: string): string | null {
    return this.values[key] ?? null;
  }

  set(key: string, token: string): void {
    this.setCalls.push(key);
    this.values[key] = token;
  }

  delete(key: string): void {
    delete this.values[key];
  }
}
