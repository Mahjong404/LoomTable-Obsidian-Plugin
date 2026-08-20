export { normalizeServerOrigin } from '../client/server-origin';

export const DEFAULT_SERVER_ORIGIN = 'http://127.0.0.1:31201';

export type ConnectionProfileId = string & { readonly __connectionProfileId: unique symbol };

export interface ConnectionProfile {
  readonly id: ConnectionProfileId;
  name: string;
  serverOrigin: string;
  rememberToken: boolean;
  tokenSecretId: string | null;
}

export type ConnectionProfileDraft = Omit<
  ConnectionProfile,
  'id' | 'rememberToken' | 'tokenSecretId'
> & {
  rememberToken?: boolean;
  tokenSecretId?: string | null;
};

const PROFILE_ID_PATTERN = /^profile-[0-9a-f]{32}$/u;

export function createConnectionProfileId(
  randomUUID: () => string = () => crypto.randomUUID(),
): ConnectionProfileId {
  return `profile-${randomUUID().replaceAll('-', '').toLowerCase()}` as ConnectionProfileId;
}

export function createConnectionProfileSecretId(profileId: ConnectionProfileId): string {
  return `loomtable:${profileId}:server-token`;
}

export function isConnectionProfileId(value: unknown): value is ConnectionProfileId {
  return typeof value === 'string' && PROFILE_ID_PATTERN.test(value);
}

