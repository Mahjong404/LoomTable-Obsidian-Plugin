import { describe, expect, it } from 'vitest';

import type { SecretStorage } from 'obsidian';

import { ObsidianSecretCredentialStore } from '../../src/credentials/credential-store';

describe('Obsidian SecretStorage adapter', () => {
  it('maps SecretStorage read failures to a missing credential', () => {
    const storage = {
      getSecret: (): never => {
        throw new Error('SecretStorage unavailable');
      },
    } as unknown as SecretStorage;

    expect(new ObsidianSecretCredentialStore(storage).get('server-token')).toBeNull();
  });

  it('lets write failures reach the persistence transaction', () => {
    const storage = {
      setSecret: (): never => {
        throw new Error('SecretStorage unavailable');
      },
    } as unknown as SecretStorage;

    expect(() => new ObsidianSecretCredentialStore(storage).set('server-token', 'session')).toThrow(
      'SecretStorage unavailable',
    );
  });
});

