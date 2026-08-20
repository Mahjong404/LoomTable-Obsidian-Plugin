import type { SecretStorage } from 'obsidian';

import type { ConnectionProfileId } from '../settings/connection-profile';

export interface CredentialStore {
  get(key: string): string | null;
  set(key: string, token: string): void;
  delete(key: string): void;
}

export class SessionCredentialStore implements CredentialStore {
  readonly #tokens = new Map<ConnectionProfileId, string>();

  get(profileId: ConnectionProfileId): string | null {
    return this.#tokens.get(profileId) ?? null;
  }

  set(profileId: ConnectionProfileId, token: string): void {
    const trimmed = token.trim();
    if (trimmed === '') {
      this.delete(profileId);
      return;
    }
    this.#tokens.set(profileId, trimmed);
  }

  delete(profileId: ConnectionProfileId): void {
    this.#tokens.delete(profileId);
  }
}

export class ObsidianSecretCredentialStore implements CredentialStore {
  constructor(private readonly storage: SecretStorage) {}

  get(secretId: string): string | null {
    if (secretId === '') return null;
    try {
      return this.storage.getSecret(secretId);
    } catch {
      return null;
    }
  }

  set(secretId: string, token: string): void {
    if (secretId !== '') this.storage.setSecret(secretId, token.trim());
  }

  delete(_secretId: string): void {
    // Shared SecretStorage entries are user-owned; removing a profile only removes its binding.
    void _secretId;
  }
}

