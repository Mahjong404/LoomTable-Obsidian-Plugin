export type ConnectionProfileId = string & { readonly __connectionProfileId: unique symbol };

export interface ConnectionProfile {
  readonly id: ConnectionProfileId;
  name: string;
  serverOrigin: string;
  rememberToken: boolean;
  tokenSecretId: string | null;
}

export type ConnectionProfileDraft = Omit<ConnectionProfile, 'id'>;

const PROFILE_ID_PATTERN = /^profile-[0-9a-f]{32}$/u;

export function createConnectionProfileId(
  randomUUID: () => string = () => crypto.randomUUID(),
): ConnectionProfileId {
  return `profile-${randomUUID().replaceAll('-', '').toLowerCase()}` as ConnectionProfileId;
}

export function isConnectionProfileId(value: unknown): value is ConnectionProfileId {
  return typeof value === 'string' && PROFILE_ID_PATTERN.test(value);
}

export function normalizeServerOrigin(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error('Server origin is required.');
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error('Server origin must be an absolute HTTP(S) URL.');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Server origin must use HTTP or HTTPS.');
  }
  if (url.username !== '' || url.password !== '') {
    throw new Error('Server origin must not contain credentials.');
  }
  if (url.search !== '' || url.hash !== '') {
    throw new Error('Server origin must not contain a query string or fragment.');
  }
  if (url.pathname !== '/') {
    throw new Error('Server origin must not contain a path.');
  }
  if (url.protocol === 'http:' && !isLoopbackHost(url.hostname)) {
    throw new Error('Non-loopback server origins must use HTTPS.');
  }

  return url.toString().replace(/\/$/u, '');
}

function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/gu, '');
  return (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized === '::1' ||
    /^127(?:\.\d{1,3}){3}$/u.test(normalized)
  );
}
