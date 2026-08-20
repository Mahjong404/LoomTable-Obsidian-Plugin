import {
  createConnectionProfileId,
  createConnectionProfileSecretId,
  isConnectionProfileId,
  normalizeServerOrigin,
  type ConnectionProfile,
  type ConnectionProfileDraft,
  type ConnectionProfileId,
} from './connection-profile';
import {
  TIANDITU_CREDENTIAL_BINDING_KEY,
  TIANDITU_CREDENTIAL_SLOT_ID,
  TIANDITU_PROVIDER_IDS,
  type CustomTileProviderProfileV1,
  type TileAttribution,
  type TileCredentialSlot,
  type TileProviderRef,
} from '../maps/providers/tile-provider-schema';

export const PLUGIN_SETTINGS_SCHEMA_VERSION = 2 as const;
export const SUPPORTED_LOCALES = ['en', 'zh-CN'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
export const LOCALE_PREFERENCES = ['auto', ...SUPPORTED_LOCALES] as const;
export type LocalePreference = (typeof LOCALE_PREFERENCES)[number];

export interface MapPresentationSettingsV1 {
  readonly schemaVersion: 1;
  defaultProvider: TileProviderRef;
  perViewProvider: Record<string, TileProviderRef>;
  customProfiles: CustomTileProviderProfileV1[];
  credentialBindings: Record<string, string>;
}
export interface PluginSettings {
  readonly schemaVersion: typeof PLUGIN_SETTINGS_SCHEMA_VERSION;
  locale: LocalePreference;
  connectionProfiles: ConnectionProfile[];
  defaultConnectionProfileId: ConnectionProfileId | null;
  mapPresentation: MapPresentationSettingsV1;
}

export const DEFAULT_PLUGIN_SETTINGS: PluginSettings = {
  schemaVersion: PLUGIN_SETTINGS_SCHEMA_VERSION,
  locale: 'auto',
  connectionProfiles: [],
  defaultConnectionProfileId: null,
  mapPresentation: {
    schemaVersion: 1,
    defaultProvider: { kind: 'built-in', id: 'osm-standard' },
    perViewProvider: {},
    customProfiles: [],
    credentialBindings: {},
  },
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
    locale: isLocalePreference(value.locale) ? value.locale : DEFAULT_PLUGIN_SETTINGS.locale,
    connectionProfiles: profiles,
    defaultConnectionProfileId,
    mapPresentation: parseMapPresentation(value.mapPresentation),
  };
}

export function addConnectionProfile(
  settings: PluginSettings,
  draft: ConnectionProfileDraft,
  createId: () => ConnectionProfileId = createConnectionProfileId,
): ConnectionProfile {
  const id = createId();
  const rememberToken = draft.rememberToken ?? true;
  const tokenSecretId = rememberToken
    ? (normalizeSecretId(draft.tokenSecretId) ?? createConnectionProfileSecretId(id))
    : null;
  const profile: ConnectionProfile = {
    ...draft,
    id,
    name: draft.name.trim(),
    serverOrigin: normalizeServerOrigin(draft.serverOrigin),
    rememberToken,
    tokenSecretId,
  };
  settings.connectionProfiles.push(profile);
  settings.defaultConnectionProfileId ??= profile.id;
  return profile;
}

export function setConnectionProfileRemembered(
  profile: ConnectionProfile,
  remember: boolean,
): void {
  if (!remember) {
    profile.rememberToken = false;
    profile.tokenSecretId = null;
    return;
  }
  profile.tokenSecretId ??= createConnectionProfileSecretId(profile.id);
  profile.rememberToken = true;
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
    const rememberToken = typeof value.rememberToken === 'boolean' ? value.rememberToken : true;
    const tokenSecretId = rememberToken
      ? (normalizeSecretId(value.tokenSecretId) ?? createConnectionProfileSecretId(value.id))
      : null;
    return [
      {
        id: value.id,
        name: value.name.trim() || 'LoomTable Server',
        serverOrigin: normalizeServerOrigin(value.serverOrigin),
        rememberToken,
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

export function resolveLocale(preference: LocalePreference, language: string): SupportedLocale {
  if (preference !== 'auto') return preference;
  const normalized = language.trim().toLowerCase().replace('_', '-');
  return normalized === 'zh' || normalized.startsWith('zh-') ? 'zh-CN' : 'en';
}

function isLocalePreference(value: unknown): value is LocalePreference {
  return LOCALE_PREFERENCES.some((locale) => locale === value);
}

function parseMapPresentation(value: unknown): MapPresentationSettingsV1 {
  if (!isRecord(value)) return structuredClone(DEFAULT_PLUGIN_SETTINGS.mapPresentation);
  const defaultProvider = parseProviderRef(value.defaultProvider) ?? {
    kind: 'built-in' as const,
    id: 'osm-standard' as const,
  };
  const perViewProvider: Record<string, TileProviderRef> = {};
  if (isRecord(value.perViewProvider)) {
    for (const [viewId, candidate] of Object.entries(value.perViewProvider)) {
      const provider = parseProviderRef(candidate);
      if (provider !== null && viewId.trim() !== '') perViewProvider[viewId] = provider;
    }
  }
  const customProfiles = Array.isArray(value.customProfiles)
    ? value.customProfiles.flatMap(parseCustomProfile)
    : [];
  const rawCredentialBindings: Record<string, string> = {};
  if (isRecord(value.credentialBindings)) {
    for (const [bindingKey, secretId] of Object.entries(value.credentialBindings)) {
      if (typeof secretId === 'string' && bindingKey.trim() !== '' && secretId.trim() !== '') {
        rawCredentialBindings[bindingKey] = secretId.trim();
      }
    }
  }
  return {
    schemaVersion: 1,
    defaultProvider,
    perViewProvider,
    customProfiles,
    credentialBindings: migrateTiandituCredentialBindings(rawCredentialBindings),
  };
}

export function migrateTiandituCredentialBindings(
  bindings: Readonly<Record<string, string>>,
): Record<string, string> {
  const migrated: Record<string, string> = {};
  const legacyKeys = new Set(
    TIANDITU_PROVIDER_IDS.map(
      (providerId) => `built-in:${providerId}:${TIANDITU_CREDENTIAL_SLOT_ID}`,
    ),
  );
  const sharedSecretId = bindings[TIANDITU_CREDENTIAL_BINDING_KEY]?.trim();
  if (sharedSecretId !== undefined && sharedSecretId !== '') {
    migrated[TIANDITU_CREDENTIAL_BINDING_KEY] = sharedSecretId;
  } else {
    for (const providerId of TIANDITU_PROVIDER_IDS) {
      const legacyKey = `built-in:${providerId}:${TIANDITU_CREDENTIAL_SLOT_ID}`;
      const legacySecretId = bindings[legacyKey]?.trim();
      if (legacySecretId !== undefined && legacySecretId !== '') {
        migrated[TIANDITU_CREDENTIAL_BINDING_KEY] = legacySecretId;
        break;
      }
    }
  }
  for (const [bindingKey, secretId] of Object.entries(bindings)) {
    if (bindingKey === TIANDITU_CREDENTIAL_BINDING_KEY || legacyKeys.has(bindingKey)) continue;
    migrated[bindingKey] = secretId;
  }
  return migrated;
}

function parseProviderRef(value: unknown): TileProviderRef | null {
  if (!isRecord(value) || typeof value.kind !== 'string') return null;
  if (
    value.kind === 'built-in' &&
    (value.id === 'osm-standard' ||
      value.id === 'tianditu-vector' ||
      value.id === 'tianditu-imagery' ||
      value.id === 'tianditu-terrain')
  ) {
    return { kind: 'built-in', id: value.id };
  }
  if (value.kind === 'custom' && typeof value.profileId === 'string' && value.profileId !== '') {
    return { kind: 'custom', profileId: value.profileId };
  }
  return null;
}

function parseCustomProfile(value: unknown): CustomTileProviderProfileV1[] {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    typeof value.urlTemplate !== 'string' ||
    typeof value.minZoom !== 'number' ||
    !Number.isInteger(value.minZoom) ||
    typeof value.maxZoom !== 'number' ||
    !Number.isInteger(value.maxZoom) ||
    (value.tileSize !== 256 && value.tileSize !== 512) ||
    !Array.isArray(value.attribution)
  ) {
    return [];
  }
  const attribution = value.attribution.flatMap(parseAttribution);
  const credentialSlots = Array.isArray(value.credentialSlots)
    ? value.credentialSlots.flatMap(parseCredentialSlot)
    : [];
  if (attribution.length !== value.attribution.length) return [];
  return [
    {
      schemaVersion: 1,
      id: value.id,
      name: value.name,
      urlTemplate: value.urlTemplate,
      ...(Array.isArray(value.subdomains)
        ? {
            subdomains: value.subdomains.filter((item): item is string => typeof item === 'string'),
          }
        : {}),
      minZoom: value.minZoom,
      maxZoom: value.maxZoom,
      tileSize: value.tileSize,
      attribution,
      ...(credentialSlots.length === 0 ? {} : { credentialSlots }),
    },
  ];
}

function parseAttribution(value: unknown): TileAttribution[] {
  if (!isRecord(value) || typeof value.label !== 'string') return [];
  return [
    {
      label: value.label,
      ...(typeof value.url === 'string' ? { url: value.url } : {}),
      ...(typeof value.licenseUrl === 'string' ? { licenseUrl: value.licenseUrl } : {}),
    },
  ];
}

function parseCredentialSlot(value: unknown): TileCredentialSlot[] {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.displayName !== 'string' ||
    typeof value.required !== 'boolean'
  ) {
    return [];
  }
  return [{ id: value.id, displayName: value.displayName, required: value.required }];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

