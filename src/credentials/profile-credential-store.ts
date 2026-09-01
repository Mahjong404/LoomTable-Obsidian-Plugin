import type { ConnectionProfile, ConnectionProfileId } from '../settings/connection-profile';
import type { CredentialStore } from './credential-store';

export class ProfileCredentialStore {
  readonly #disconnected = new Set<ConnectionProfileId>();

  constructor(
    private readonly sessionStore: CredentialStore,
    private readonly persistentStore: CredentialStore,
  ) {}

  get(profile: ConnectionProfile): string | null {
    if (this.#disconnected.has(profile.id)) return null;
    const sessionToken = this.sessionStore.get(profile.id);
    if (sessionToken !== null) return sessionToken;
    if (!profile.rememberToken || profile.tokenSecretId === null) return null;

    try {
      const rememberedToken = this.persistentStore.get(profile.tokenSecretId);
      return rememberedToken === null || rememberedToken.trim() === '' ? null : rememberedToken;
    } catch {
      return null;
    }
  }

  getSession(profile: ConnectionProfile): string | null {
    return this.sessionStore.get(profile.id);
  }

  setSession(profile: ConnectionProfile, token: string): void {
    if (token.trim() === '') {
      this.disconnect(profile);
      return;
    }
    this.#disconnected.delete(profile.id);
    this.sessionStore.set(profile.id, token);
  }

  rememberSessionToken(profile: ConnectionProfile): boolean {
    if (!profile.rememberToken || profile.tokenSecretId === null) return false;
    const sessionToken = this.sessionStore.get(profile.id);
    if (sessionToken === null || sessionToken.trim() === '') return false;

    try {
      this.persistentStore.set(profile.tokenSecretId, sessionToken);
      return true;
    } catch {
      return false;
    }
  }

  disconnect(profile: ConnectionProfile): void {
    this.sessionStore.delete(profile.id);
    this.#disconnected.add(profile.id);
  }

  delete(profile: ConnectionProfile): void {
    this.disconnect(profile);
  }
}
