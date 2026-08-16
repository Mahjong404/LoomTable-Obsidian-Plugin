import type { CredentialStore } from '../../credentials/credential-store';
import type { TileCredentialReader } from '../providers/tile-provider-schema';

export class TileCredentialStore implements TileCredentialReader {
  readonly #session = new Map<string, string>();

  constructor(
    private readonly persistentStore: CredentialStore,
    private readonly getBindings: () => Readonly<Record<string, string>>,
  ) {}

  get(bindingKey: string): string | null {
    const sessionValue = this.#session.get(bindingKey);
    if (sessionValue !== undefined) return sessionValue;
    try {
      return this.persistentValue(bindingKey);
    } catch {
      return null;
    }
  }

  setSession(bindingKey: string, value: string): void {
    const trimmed = value.trim();
    if (trimmed === '') {
      this.deleteSession(bindingKey);
      return;
    }
    this.#session.set(bindingKey, trimmed);
  }

  deleteSession(bindingKey: string): void {
    this.#session.delete(bindingKey);
  }

  clearSession(): void {
    this.#session.clear();
  }

  getSession(bindingKey: string): string | null {
    return this.#session.get(bindingKey) ?? null;
  }

  private persistentValue(bindingKey: string): string | null {
    const secretId = this.getBindings()[bindingKey]?.trim();
    return secretId === undefined || secretId === '' ? null : this.persistentStore.get(secretId);
  }
}

export function redactCredential(value: string): string {
  if (value.length <= 4) return '[redacted]';
  return `${value.slice(0, 2)}…${value.slice(-2)}`;
}
