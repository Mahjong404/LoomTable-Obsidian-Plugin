import {
  createConnectionProfileId,
  isConnectionProfileId,
  normalizeServerOrigin,
  type ConnectionProfile,
  type ConnectionProfileDraft,
  type ConnectionProfileId,
} from './connection-profile';

export const PLUGIN_SETTINGS_SCHEMA_VERSION = 1 as const;
export const SUPPORTED_LOCALES = ['en', 'zh-CN'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export interface PluginSettings {
  readonly schemaVersion: typeof PLUGIN_SETTINGS_SCHEMA_VERSION;
  locale: SupportedLocale;
  connectionProfiles: ConnectionProfile[];
  defaultConnectionProfileId: ConnectionProfileId | null;
}

export const DEFAULT_PLUGIN_SETTINGS: PluginSettings = {
  schemaVersion: PLUGIN_SETTINGS_SCHEMA_VERSION,
  locale: 'en',
  connectionProfiles: [],
  defaultConnectionProfileId: null,
};

export function normalizePluginSettings(value: unknown): PluginSettings {
  if (!isRecord(value)) {
    return structuredClone(DEFAULT_PLUGIN_SETTINGS);
  }

  const profiles = Array.isArray(value.connectionProfiles)
    ? value.connectionProfiles.flatMap(parseProfile)
    : [];
  const requestedDefault = value.defaultConnectionProfileId;
  const defaultConnectionProfileId = profiles.some((profile) => profile.id === requestedDefault)
    ? (requestedDefault as ConnectionProfileId)
    : (profiles[0]?.id ?? null);

  return {
    schemaVersion: PLUGIN_SETTINGS_SCHEMA_VERSION,
    locale: isSupportedLocale(value.locale) ? value.locale : DEFAULT_PLUGIN_SETTINGS.locale,
    connectionProfiles: profiles,
    defaultConnectionProfileId,
  };
}

export function addConnectionProfile(
  settings: PluginSettings,
  draft: ConnectionProfileDraft,
  createId: () => ConnectionProfileId = createConnectionProfileId,
): ConnectionProfile {
  const tokenSecretId = normalizeSecretId(draft.tokenSecretId);
  const profile: ConnectionProfile = {
    ...draft,
    id: createId(),
    name: draft.name.trim(),
    serverOrigin: normalizeServerOrigin(draft.serverOrigin),
    rememberToken: tokenSecretId !== null,
    tokenSecretId,
  };
  settings.connectionProfiles.push(profile);
  settings.defaultConnectionProfileId ??= profile.id;
  return profile;
}

export function removeConnectionProfile(
  settings: PluginSettings,
  profileId: ConnectionProfileId,
): void {
  settings.connectionProfiles = settings.connectionProfiles.filter(
    (profile) => profile.id !== profileId,
  );
  if (settings.defaultConnectionProfileId === profileId) {
    settings.defaultConnectionProfileId = settings.connectionProfiles[0]?.id ?? null;
  }
}

export function setDefaultConnectionProfile(
  settings: PluginSettings,
  profileId: ConnectionProfileId,
): void {
  if (!settings.connectionProfiles.some((profile) => profile.id === profileId)) {
    throw new Error(`Unknown connection profile: ${profileId}`);
  }
  settings.defaultConnectionProfileId = profileId;
}

function parseProfile(value: unknown): ConnectionProfile[] {
  if (
    !isRecord(value) ||
    !isConnectionProfileId(value.id) ||
    typeof value.name !== 'string' ||
    typeof value.serverOrigin !== 'string'
  ) {
    return [];
  }

  try {
    const tokenSecretId = normalizeSecretId(value.tokenSecretId);
    return [
      {
        id: value.id,
        name: value.name.trim() || 'LoomTable Server',
        serverOrigin: normalizeServerOrigin(value.serverOrigin),
        rememberToken: tokenSecretId !== null,
        tokenSecretId,
      },
    ];
  } catch {
    return [];
  }
}

function normalizeSecretId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function isSupportedLocale(value: unknown): value is SupportedLocale {
  return SUPPORTED_LOCALES.some((locale) => locale === value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
