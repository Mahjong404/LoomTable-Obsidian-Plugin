import type { ConnectionProfile } from '../settings/connection-profile';
import type { CredentialStore } from './credential-store';

export class ProfileCredentialStore {
  constructor(
    private readonly sessionStore: CredentialStore,
    private readonly persistentStore: CredentialStore,
  ) {}

  get(profile: ConnectionProfile): string | null {
    const sessionToken = this.sessionStore.get(profile.id);
    if (sessionToken !== null) return sessionToken;
    if (!profile.rememberToken || profile.tokenSecretId === null) return null;

    const rememberedToken = this.persistentStore.get(profile.tokenSecretId);
    return rememberedToken === null || rememberedToken.trim() === '' ? null : rememberedToken;
  }

  getSession(profile: ConnectionProfile): string | null {
    return this.sessionStore.get(profile.id);
  }

  setSession(profile: ConnectionProfile, token: string): void {
    this.sessionStore.set(profile.id, token);
  }

  rememberSessionToken(profile: ConnectionProfile): boolean {
    if (!profile.rememberToken || profile.tokenSecretId === null) return false;
    const sessionToken = this.sessionStore.get(profile.id);
    if (sessionToken === null || sessionToken.trim() === '') return false;

    this.persistentStore.set(profile.tokenSecretId, sessionToken);
    return true;
  }

  delete(profile: ConnectionProfile): void {
    this.sessionStore.delete(profile.id);
  }
}
