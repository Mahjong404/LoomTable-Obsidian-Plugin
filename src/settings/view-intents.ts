import type { CreateViewRequest, GridViewConfig, MapViewConfig } from '../client/loomtable-client';
import type { PendingViewCreateIntent, PendingViewCreateStore } from '../ui/view-write-coordinator';

export interface PersistedViewCreateIntent extends PendingViewCreateIntent {
  readonly profileId: string;
  readonly serverOrigin: string;
}

export interface ViewIntentsSettingsV1 {
  readonly schemaVersion: 1;
  readonly intents: PersistedViewCreateIntent[];
}

export const DEFAULT_VIEW_INTENTS: ViewIntentsSettingsV1 = {
  schemaVersion: 1,
  intents: [],
};

export function normalizeViewIntents(value: unknown): ViewIntentsSettingsV1 {
  if (!isRecord(value) || !Array.isArray(value.intents)) {
    return structuredClone(DEFAULT_VIEW_INTENTS);
  }
  const intents: PersistedViewCreateIntent[] = [];
  const seen = new Set<string>();
  for (const item of value.intents) {
    const intent = parseIntent(item);
    if (intent === null || seen.has(intent.intentId)) continue;
    seen.add(intent.intentId);
    intents.push(intent);
  }
  return { schemaVersion: 1, intents };
}

export interface ViewIntentScope {
  readonly profileId: string;
  readonly serverOrigin: string;
}

export interface ViewIntentPersistence {
  load(): ViewIntentsSettingsV1;
  save(data: ViewIntentsSettingsV1): void | Promise<void>;
}

export class ViewCreateIntentStore implements PendingViewCreateStore {
  readonly #scope: ViewIntentScope;
  readonly #persistence: ViewIntentPersistence;

  constructor(scope: ViewIntentScope, persistence: ViewIntentPersistence) {
    this.#scope = scope;
    this.#persistence = persistence;
  }

  list(): readonly PendingViewCreateIntent[] {
    return this.#persistence
      .load()
      .intents.filter((intent) => this.#inScope(intent))
      .map((intent) => ({
        intentId: intent.intentId,
        tableId: intent.tableId,
        request: intent.request,
        createdAt: intent.createdAt,
      }));
  }

  async put(intent: PendingViewCreateIntent): Promise<void> {
    const data = this.#persistence.load();
    const scoped: PersistedViewCreateIntent = { ...intent, ...this.#scope };
    const intents = data.intents.filter((item) => item.intentId !== intent.intentId);
    intents.push(scoped);
    await this.#persistence.save({ schemaVersion: 1, intents });
  }

  async remove(intentId: string): Promise<void> {
    const data = this.#persistence.load();
    const intents = data.intents.filter(
      (item) => !(item.intentId === intentId && this.#inScope(item)),
    );
    if (intents.length === data.intents.length) return;
    await this.#persistence.save({ schemaVersion: 1, intents });
  }

  #inScope(intent: PersistedViewCreateIntent): boolean {
    return (
      intent.profileId === this.#scope.profileId && intent.serverOrigin === this.#scope.serverOrigin
    );
  }
}

function parseIntent(value: unknown): PersistedViewCreateIntent | null {
  if (
    !isRecord(value) ||
    typeof value.intentId !== 'string' ||
    value.intentId.trim() === '' ||
    typeof value.profileId !== 'string' ||
    value.profileId.trim() === '' ||
    typeof value.serverOrigin !== 'string' ||
    value.serverOrigin.trim() === '' ||
    typeof value.tableId !== 'string' ||
    value.tableId.trim() === '' ||
    typeof value.createdAt !== 'string'
  ) {
    return null;
  }
  const request = parseRequest(value.request);
  if (request === null) return null;
  return {
    intentId: value.intentId,
    profileId: value.profileId,
    serverOrigin: value.serverOrigin,
    tableId: value.tableId,
    request,
    createdAt: value.createdAt,
  };
}

function parseRequest(value: unknown): CreateViewRequest | null {
  if (!isRecord(value) || typeof value.name !== 'string' || !isRecord(value.config)) {
    return null;
  }
  if (value.type === 'grid') {
    return {
      name: value.name,
      type: 'grid',
      config: value.config as unknown as GridViewConfig,
    };
  }
  if (value.type === 'map' && typeof value.config.locationFieldId === 'string') {
    return {
      name: value.name,
      type: 'map',
      config: value.config as unknown as MapViewConfig,
    };
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
