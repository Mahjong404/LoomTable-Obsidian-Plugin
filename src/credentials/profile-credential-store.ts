import type { ConnectionProfile } from '../settings/connection-profile';
import type { CredentialStore } from './credential-store';

export class ProfileCredentialStore {
  constructor(
    private readonly sessionStore: CredentialStore,
    private readonly persistentStore: CredentialStore,
  ) {}

  get(profile: ConnectionProfile): string | null {
    return (
      this.sessionStore.get(profile.id) ??
      (profile.tokenSecretId === null ? null : this.persistentStore.get(profile.tokenSecretId))
    );
  }

  getSession(profile: ConnectionProfile): string | null {
    return this.sessionStore.get(profile.id);
  }

  setSession(profile: ConnectionProfile, token: string): void {
    this.sessionStore.set(profile.id, token);
  }

  delete(profile: ConnectionProfile): void {
    this.sessionStore.delete(profile.id);
  }
}
