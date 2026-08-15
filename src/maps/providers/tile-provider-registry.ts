MethodException: 
Line |
   2 |  … y.ts' -Raw; $c = $c.Replace([char]13 + [char]10, [char]10).Replace([c …
     |                ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
     | Cannot convert argument "oldChar", with value: "
", for "Replace" to type "System.Char": "Cannot convert value "
" to type "System.Char". Error: "String must be exactly one character long.""
import { BUILT_IN_TILE_PROVIDERS } from './presets';
import {
  credentialBindingKey,
  redactTileText,
  validateCustomTileProviderProfile,
  validateProviderDefinition,
  type CustomTileProviderProfileV1,
  type BuiltInTileProviderId,
  type ResolvedTileLayer,
  type ResolvedTilePlan,
  type TileCredentialReader,
  type TileProviderDefinition,
  type TileProviderError,
  type TileProviderRef,
  type TileProviderResolution,
  type TileProviderSummary,
  deriveTileTemplateOrigins,
} from './tile-provider-schema';

export interface TileProviderRegistryOptions {
  readonly builtIns?: readonly TileProviderDefinition[];
  readonly customProfiles?: () => readonly CustomTileProviderProfileV1[];
}

export class TileProviderRegistry {
  readonly #builtIns: readonly TileProviderDefinition[];
  readonly #customProfiles: () => readonly CustomTileProviderProfileV1[];

  constructor(options: TileProviderRegistryOptions = {}) {
    this.#builtIns = options.builtIns ?? BUILT_IN_TILE_PROVIDERS;
    this.#customProfiles = options.customProfiles ?? (() => []);
  }

  list(): readonly TileProviderSummary[] {
    const builtInSummaries = this.#builtIns.map((definition) => ({
      ref: { kind: 'built-in' as const, id: definition.id as BuiltInTileProviderId },
      displayName: definition.displayName,
      credentialRequired: definition.credentialSlots?.some((slot) => slot.required) ?? false,
    }));
    const customSummaries = this.#customProfiles().map((profile) => ({
      ref: { kind: 'custom', profileId: profile.id } as const,
      displayName: profile.name,
      credentialRequired: profile.credentialSlots?.some((slot) => slot.required) ?? false,
    }));
    return [...builtInSummaries, ...customSummaries];
  }

  resolve(ref: TileProviderRef, credentials: TileCredentialReader): TileProviderResolution {
    const selected = this.#findDefinition(ref);
    if ('error' in selected) return { ok: false, error: selected.error };
    const validationError = validateProviderDefinition(selected.definition);
    if (validationError !== null) return { ok: false, error: validationError };

    const slots = selected.definition.credentialSlots ?? [];
    const credentialsBySlot = new Map<string, string>();
    for (const slot of slots) {
      const value = credentials.get(credentialBindingKey(ref, slot.id));
      if (slot.required && (value === null || value.trim() === '')) {
        return {
          ok: false,
          error: {
            kind: 'configuration-required',
            providerId: selected.definition.id,
            credentialSlotId: slot.id,
            message: `${selected.definition.displayName} requires a configured credential.`,
          },
        };
      }
      if (value !== null && value.trim() !== '') credentialsBySlot.set(slot.id, value.trim());
    }

    const layers: ResolvedTileLayer[] = [];
    for (const layer of selected.definition.layers) {
      const urlTemplate = expandTemplate(layer.urlTemplate, credentialsBySlot);
      if (urlTemplate === null) {
        return {
          ok: false,
          error: {
            kind: 'configuration-required',
            providerId: selected.definition.id,
            message: 'A tile credential required by the provider is unavailable.',
          },
        };
      }
      layers.push({
        id: layer.id,
        role: layer.role,
        urlTemplate,
        ...(layer.subdomains === undefined ? {} : { subdomains: layer.subdomains }),
        ...(layer.tileSize === undefined ? {} : { tileSize: layer.tileSize }),
      });
    }
    return {
      ok: true,
      plan: {
        providerId: selected.definition.id,
        displayName: selected.definition.displayName,
        protocol: selected.definition.protocol,
        crs: 'EPSG:3857',
        layers,
        minZoom: selected.definition.minZoom,
        maxZoom: selected.definition.maxZoom,
        attribution: selected.definition.attribution,
        ...(selected.definition.usagePolicyUrl === undefined
          ? {}
          : { usagePolicyUrl: selected.definition.usagePolicyUrl }),
      },
    };
  }

  #findDefinition(
    ref: TileProviderRef,
  ): { readonly definition: TileProviderDefinition } | { readonly error: TileProviderError } {
    if (ref.kind === 'built-in') {
      const definition = this.#builtIns.find((candidate) => candidate.id === ref.id);
      return definition === undefined
        ? {
            error: {
              kind: 'invalid-profile',
              providerId: ref.id,
              message: 'The built-in tile provider is unavailable.',
            },
          }
        : { definition };
    }

    const profile = this.#customProfiles().find((candidate) => candidate.id === ref.profileId);
    if (profile === undefined) {
      return {
        error: {
          kind: 'configuration-required',
          providerId: ref.profileId,
          message: 'The selected custom tile provider profile is unavailable.',
        },
      };
    }
    const validationError = validateCustomTileProviderProfile(profile);
    if (validationError !== null) return { error: validationError };
    const origins = deriveTileTemplateOrigins(profile.urlTemplate, profile.subdomains);
    if (origins === null || origins.length === 0) {
      return {
        error: {
          kind: 'invalid-origin',
          providerId: profile.id,
          message: 'The custom tile provider origin is invalid.',
        },
      };
    }
    return {
      definition: {
        schemaVersion: 1,
        id: profile.id,
        displayName: profile.name,
        protocol: 'xyz',
        crs: 'EPSG:3857',
        layers: [
          {
            id: profile.id,
            role: 'base',
            urlTemplate: profile.urlTemplate,
            ...(profile.subdomains === undefined ? {} : { subdomains: profile.subdomains }),
            tileSize: profile.tileSize,
          },
        ],
        minZoom: profile.minZoom,
        maxZoom: profile.maxZoom,
        attribution: profile.attribution,
        allowedOrigins: [...origins],
        ...(profile.credentialSlots === undefined
          ? {}
          : { credentialSlots: profile.credentialSlots }),
        offlinePolicy: 'provider-defined',
      },
    };
  }
}

export function summarizeResolvedTilePlan(
  plan: ResolvedTilePlan,
): Readonly<Record<string, unknown>> {
  return {
    providerId: plan.providerId,
    displayName: plan.displayName,
    protocol: plan.protocol,
    crs: plan.crs,
    layerIds: plan.layers.map((layer) => layer.id),
    attributionLabels: plan.attribution.map((item) => item.label),
  };
}

export function redactTileProviderError(error: TileProviderError): TileProviderError {
  return { ...error, message: redactTileText(error.message) };
}

function expandTemplate(template: string, credentials: ReadonlyMap<string, string>): string | null {
  let missing = false;
  const expanded = template.replace(/\{credential:([^{}]+)\}/gu, (_match, slotId: string) => {
    const value = credentials.get(slotId);
    if (value === undefined) {
      missing = true;
      return '[missing-credential]';
    }
    return encodeURIComponent(value);
  });
  return missing ? null : expanded;
}

