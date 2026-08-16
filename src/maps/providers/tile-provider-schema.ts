export const TILE_PROVIDER_SCHEMA_VERSION = 1 as const;

export type BuiltInTileProviderId =
  'osm-standard' | 'tianditu-vector' | 'tianditu-imagery' | 'tianditu-terrain';

export type TileProviderRef =
  | { readonly kind: 'built-in'; readonly id: BuiltInTileProviderId }
  | { readonly kind: 'custom'; readonly profileId: string };

export type TileProtocol = 'xyz' | 'wmts-template';
export type TileLayerRole = 'base' | 'labels';

export interface TileAttribution {
  readonly label: string;
  readonly url?: string;
  readonly licenseUrl?: string;
}

export interface TileCredentialSlot {
  readonly id: string;
  readonly displayName: string;
  readonly required: boolean;
}

export interface TileLayerTemplate {
  readonly id: string;
  readonly role: TileLayerRole;
  readonly urlTemplate: string;
  readonly subdomains?: readonly string[];
  readonly tileSize?: number;
}

export interface TileProviderDefinition {
  readonly schemaVersion: typeof TILE_PROVIDER_SCHEMA_VERSION;
  readonly id: string;
  readonly displayName: string;
  readonly protocol: TileProtocol;
  readonly crs: string;
  readonly layers: readonly TileLayerTemplate[];
  readonly minZoom: number;
  readonly maxZoom: number;
  readonly attribution: readonly TileAttribution[];
  readonly usagePolicyUrl?: string;
  readonly allowedOrigins: readonly string[];
  readonly credentialSlots?: readonly TileCredentialSlot[];
  readonly offlinePolicy: 'forbidden' | 'provider-defined';
}

export interface CustomTileProviderProfileV1 {
  readonly schemaVersion: typeof TILE_PROVIDER_SCHEMA_VERSION;
  readonly id: string;
  readonly name: string;
  readonly urlTemplate: string;
  readonly subdomains?: readonly string[];
  readonly minZoom: number;
  readonly maxZoom: number;
  readonly tileSize: 256 | 512;
  readonly attribution: readonly TileAttribution[];
  readonly credentialSlots?: readonly TileCredentialSlot[];
}

export interface TileProviderSummary {
  readonly ref: TileProviderRef;
  readonly displayName: string;
  readonly credentialRequired: boolean;
}

export interface ResolvedTileLayer {
  readonly id: string;
  readonly role: TileLayerRole;
  readonly urlTemplate: string;
  readonly subdomains?: readonly string[];
  readonly tileSize?: number;
}

export interface ResolvedTilePlan {
  readonly providerId: string;
  readonly displayName: string;
  readonly protocol: TileProtocol;
  readonly crs: 'EPSG:3857';
  readonly layers: readonly ResolvedTileLayer[];
  readonly minZoom: number;
  readonly maxZoom: number;
  readonly attribution: readonly TileAttribution[];
  readonly usagePolicyUrl?: string;
}

export interface TileCredentialReader {
  get(bindingKey: string): string | null;
}

export type TileProviderErrorKind =
  | 'configuration-required'
  | 'invalid-profile'
  | 'invalid-origin'
  | 'invalid-template'
  | 'unsupported-crs'
  | 'tile-error';

export interface TileProviderError {
  readonly kind: TileProviderErrorKind;
  readonly providerId: string;
  readonly message: string;
  readonly credentialSlotId?: string;
}

export type TileProviderResolution =
  | { readonly ok: true; readonly plan: ResolvedTilePlan }
  | { readonly ok: false; readonly error: TileProviderError };

const PLACEHOLDER_PATTERN = /\{([^{}]+)\}/gu;
const COORDINATE_PLACEHOLDERS = new Set(['x', 'y', 'z', 's']);
const SENSITIVE_QUERY_KEYS = new Set(['token', 'access_token', 'apikey', 'api_key', 'key', 'tk']);

export function credentialBindingKey(ref: TileProviderRef, slotId: string): string {
  return ref.kind === 'built-in'
    ? `built-in:${ref.id}:${slotId}`
    : `custom:${ref.profileId}:${slotId}`;
}

export function validateCustomTileProviderProfile(
  profile: CustomTileProviderProfileV1,
): TileProviderError | null {
  if (
    profile.schemaVersion !== TILE_PROVIDER_SCHEMA_VERSION ||
    profile.id.trim() === '' ||
    profile.name.trim() === '' ||
    !Number.isInteger(profile.minZoom) ||
    profile.minZoom < 0 ||
    !Number.isInteger(profile.maxZoom) ||
    profile.maxZoom < profile.minZoom ||
    (profile.tileSize !== 256 && profile.tileSize !== 512)
  ) {
    return invalidProfile(profile.id, 'Custom tile profile fields are invalid.');
  }
  if (!hasRequiredCoordinates(profile.urlTemplate)) {
    return invalidProfile(profile.id, 'Custom XYZ templates must contain {z}, {x}, and {y}.');
  }
  const templateError = validateTemplate(profile.urlTemplate, profile.credentialSlots ?? [], true);
  if (templateError !== null) return { ...templateError, providerId: profile.id };
  const attributionError = validateAttribution(profile.attribution);
  if (attributionError !== null) return invalidProfile(profile.id, attributionError);
  if (profile.subdomains?.some((subdomain) => !/^[a-z0-9.-]+$/iu.test(subdomain))) {
    return invalidProfile(profile.id, 'Custom tile subdomains are invalid.');
  }
  if (profile.urlTemplate.includes('{s}') && (profile.subdomains?.length ?? 0) === 0) {
    return invalidProfile(profile.id, 'Custom templates using {s} must declare subdomains.');
  }
  return null;
}

export function validateProviderDefinition(
  definition: TileProviderDefinition,
): TileProviderError | null {
  if (definition.schemaVersion !== TILE_PROVIDER_SCHEMA_VERSION || definition.id.trim() === '') {
    return invalidProfile(definition.id, 'Tile provider definition is invalid.');
  }
  if (definition.crs !== 'EPSG:3857') {
    return {
      kind: 'unsupported-crs',
      providerId: definition.id,
      message: 'Only EPSG:3857 is supported.',
    };
  }
  if (
    !Number.isInteger(definition.minZoom) ||
    !Number.isInteger(definition.maxZoom) ||
    definition.minZoom < 0 ||
    definition.maxZoom < definition.minZoom ||
    definition.layers.length === 0 ||
    definition.allowedOrigins.length === 0
  ) {
    return invalidProfile(definition.id, 'Tile provider zoom or layer settings are invalid.');
  }
  for (const layer of definition.layers) {
    if (layer.id.trim() === '' || (layer.role !== 'base' && layer.role !== 'labels')) {
      return invalidProfile(definition.id, 'Tile provider layer metadata is invalid.');
    }
    const templateError = validateTemplate(
      layer.urlTemplate,
      definition.credentialSlots ?? [],
      definition.protocol === 'xyz',
    );
    if (templateError !== null) return { ...templateError, providerId: definition.id };
    if (layer.subdomains?.some((subdomain) => !/^[a-z0-9.-]+$/iu.test(subdomain))) {
      return invalidProfile(definition.id, 'Tile layer subdomains are invalid.');
    }
    const templateOriginsResult = deriveTileTemplateOrigins(layer.urlTemplate, layer.subdomains);
    if (templateOriginsResult === null) {
      return {
        kind: 'invalid-origin',
        providerId: definition.id,
        message: 'Tile origin is invalid.',
      };
    }
    const allowedOrigins = new Set(
      definition.allowedOrigins.map((origin) => canonicalOrigin(origin)),
    );
    if (templateOriginsResult.some((origin) => !allowedOrigins.has(origin))) {
      return {
        kind: 'invalid-origin',
        providerId: definition.id,
        message: 'A tile template origin is not allowlisted.',
      };
    }
  }
  const attributionError = validateAttribution(definition.attribution);
  if (attributionError !== null) return invalidProfile(definition.id, attributionError);
  for (const origin of definition.allowedOrigins) {
    if (!isAllowedOrigin(origin)) {
      return {
        kind: 'invalid-origin',
        providerId: definition.id,
        message: 'Tile origin is invalid.',
      };
    }
  }
  return null;
}

export function redactTileText(value: string): string {
  return value.replace(/(tk|token|api[_-]?key|access[_-]?token)=([^&\s]+)/giu, '$1=[redacted]');
}

export function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '[::1]';
}

function hasRequiredCoordinates(template: string): boolean {
  return ['{z}', '{x}', '{y}'].every((placeholder) => template.includes(placeholder));
}

function validateTemplate(
  template: string,
  credentialSlots: readonly TileCredentialSlot[],
  requireXYZ: boolean,
): TileProviderError | null {
  if (template.trim() === '' || (requireXYZ && !hasRequiredCoordinates(template))) {
    return { kind: 'invalid-template', providerId: '', message: 'Tile URL template is invalid.' };
  }
  const slots = new Set(credentialSlots.map((slot) => slot.id));
  for (const match of template.matchAll(PLACEHOLDER_PATTERN)) {
    const placeholder = match[1];
    if (placeholder === undefined) return invalidTemplate();
    if (COORDINATE_PLACEHOLDERS.has(placeholder)) continue;
    if (
      placeholder.startsWith('credential:') &&
      slots.has(placeholder.slice('credential:'.length))
    ) {
      continue;
    }
    return invalidTemplate();
  }
  const replaced = template
    .replaceAll('{z}', '0')
    .replaceAll('{x}', '0')
    .replaceAll('{y}', '0')
    .replaceAll('{s}', 'a')
    .replace(PLACEHOLDER_PATTERN, 'placeholder');
  let url: URL;
  try {
    url = new URL(replaced);
  } catch {
    return invalidTemplate();
  }
  if (
    url.protocol !== 'https:' &&
    !(url.protocol === 'http:' && isLoopbackHostname(url.hostname))
  ) {
    return {
      kind: 'invalid-origin',
      providerId: '',
      message: 'Non-loopback tile origins must use HTTPS.',
    };
  }
  if (url.username !== '' || url.password !== '') return invalidTemplate();
  for (const [key, value] of url.searchParams) {
    if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase()) && value !== 'placeholder') {
      return invalidTemplate();
    }
  }
  return null;
}

function validateAttribution(attribution: readonly TileAttribution[]): string | null {
  if (attribution.length === 0) return 'Attribution must contain at least one source.';
  for (const item of attribution) {
    if (item.label.trim() === '' || /[<>]/u.test(item.label)) {
      return 'Attribution labels must be non-empty plain text.';
    }
    for (const link of [item.url, item.licenseUrl]) {
      if (link === undefined) continue;
      try {
        const url = new URL(link);
        if (url.protocol !== 'https:' && url.protocol !== 'http:')
          return 'Attribution URL is invalid.';
      } catch {
        return 'Attribution URL is invalid.';
      }
    }
  }
  return null;
}

function isAllowedOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return (
      (url.pathname === '' || url.pathname === '/') &&
      url.search === '' &&
      url.hash === '' &&
      url.username === '' &&
      url.password === '' &&
      (url.protocol === 'https:' || (url.protocol === 'http:' && isLoopbackHostname(url.hostname)))
    );
  } catch {
    return false;
  }
}

export function deriveTileTemplateOrigins(
  template: string,
  subdomains?: readonly string[],
): readonly string[] | null {
  if (template.includes('{s}') && (subdomains?.length ?? 0) === 0) return null;
  const candidates = template.includes('{s}') ? (subdomains ?? []) : [undefined];
  const origins = new Set<string>();
  for (const subdomain of candidates) {
    const replaced = template
      .replaceAll('{z}', '0')
      .replaceAll('{x}', '0')
      .replaceAll('{y}', '0')
      .replaceAll('{s}', subdomain ?? '')
      .replace(/\{credential:[^{}]+\}/gu, 'placeholder');
    try {
      origins.add(new URL(replaced).origin);
    } catch {
      return null;
    }
  }
  return [...origins];
}

function canonicalOrigin(origin: string): string {
  try {
    return new URL(origin).origin;
  } catch {
    return origin;
  }
}

function invalidProfile(providerId: string, message: string): TileProviderError {
  return { kind: 'invalid-profile', providerId, message };
}

function invalidTemplate(): TileProviderError {
  return { kind: 'invalid-template', providerId: '', message: 'Tile URL template is invalid.' };
}
