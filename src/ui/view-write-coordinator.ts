import {
  LoomTableClientError,
  type CreateViewRequest,
  type GridViewConfig,
  type LoomTableClient,
  type LoomTableClientErrorDetails,
  type LoomTableClientErrorKind,
  type MapViewConfig,
  type UpdateViewRequest,
  type View,
} from '../client/loomtable-client';
import { createMutationId } from './mutation-queue';

export type ViewWriteClient = Pick<
  LoomTableClient,
  'getView' | 'createView' | 'updateView' | 'deleteView' | 'restoreView'
>;

export interface PendingViewCreateIntent {
  readonly intentId: string;
  readonly tableId: string;
  readonly request: CreateViewRequest;
  readonly createdAt: string;
}

export interface PendingViewCreateStore {
  list(): readonly PendingViewCreateIntent[];
  put(intent: PendingViewCreateIntent): void | Promise<void>;
  remove(intentId: string): void | Promise<void>;
}

export interface ViewCreateInput {
  readonly type: 'grid' | 'map';
  readonly name: string;
  readonly locationFieldId?: string;
}

export type ViewCreateOutcome =
  | { readonly status: 'created'; readonly view: View }
  | {
      readonly status: 'unresolved';
      readonly kind: LoomTableClientErrorKind;
      readonly intent: PendingViewCreateIntent;
      readonly error: LoomTableClientErrorDetails;
    }
  | {
      readonly status: 'failed';
      readonly kind: LoomTableClientErrorKind;
      readonly error: LoomTableClientErrorDetails;
    };

export type ViewCopyOutcome =
  ViewCreateOutcome | { readonly status: 'repair-required'; readonly view: View };

export interface ViewWriteIssue {
  readonly kind: 'conflict' | 'unresolved' | 'permission' | 'error';
  readonly message: string;
  readonly latestView?: View;
}

export type ViewIssueAction = 'retry' | 'dismiss' | 'adopt-latest' | 're-edit';

export type ViewWriteOutcome =
  | { readonly status: 'saved'; readonly view: View }
  | { readonly status: 'deleted' }
  | { readonly status: 'conflict'; readonly latestView: View | null }
  | {
      readonly status: 'unresolved';
      readonly kind: LoomTableClientErrorKind;
      readonly error: LoomTableClientErrorDetails;
    }
  | {
      readonly status: 'failed';
      readonly kind: LoomTableClientErrorKind;
      readonly error: LoomTableClientErrorDetails;
    };

export interface ViewUpdatePatch {
  readonly name?: string;
  readonly config?: GridViewConfig | MapViewConfig;
}

export interface ViewWriteCoordinatorOptions {
  readonly intents?: PendingViewCreateStore;
  readonly mutationIdFactory?: () => string;
  readonly now?: () => string;
}

export class ViewWriteCoordinator {
  readonly #client: ViewWriteClient;
  readonly #intents: PendingViewCreateStore | null;
  readonly #mutationIdFactory: () => string;
  readonly #now: () => string;
  readonly #inFlightCreates = new Map<string, Promise<ViewCreateOutcome>>();
  readonly #inFlightWrites = new Map<string, Promise<unknown>>();

  constructor(client: ViewWriteClient, options: ViewWriteCoordinatorOptions = {}) {
    this.#client = client;
    this.#intents = options.intents ?? null;
    this.#mutationIdFactory = options.mutationIdFactory ?? createMutationId;
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  listPendingCreates(tableId?: string): readonly PendingViewCreateIntent[] {
    const intents = this.#intents?.list() ?? [];
    return tableId === undefined ? intents : intents.filter((intent) => intent.tableId === tableId);
  }

  async createView(tableId: string, request: CreateViewRequest): Promise<ViewCreateOutcome> {
    return this.#sendCreate({
      intentId: this.#mutationIdFactory(),
      tableId,
      request,
      createdAt: this.#now(),
    });
  }

  async copyView(source: View, name: string): Promise<ViewCreateOutcome> {
    const request: CreateViewRequest =
      source.type === 'grid'
        ? {
            type: 'grid',
            name,
            config: structuredClone(source.config),
          }
        : {
            type: 'map',
            name,
            config: structuredClone(source.config),
          };
    return this.createView(source.tableId, request);
  }

  async retryCreateIntent(intentId: string): Promise<ViewCreateOutcome | null> {
    const intent = this.#intents?.list().find((item) => item.intentId === intentId);
    if (intent === undefined) return null;
    return this.#sendCreate(intent);
  }

  async dismissCreateIntent(intentId: string): Promise<void> {
    await this.#intents?.remove(intentId);
  }

  async updateView(view: View, patch: ViewUpdatePatch): Promise<ViewWriteOutcome> {
    return this.#serialize(view.id, async () => {
      const config = patch.config ?? view.config;
      const request: UpdateViewRequest =
        view.type === 'grid'
          ? {
              type: 'grid',
              config: config as GridViewConfig,
              expectedRevision: view.revision,
              ...(patch.name === undefined ? {} : { name: patch.name }),
            }
          : {
              type: 'map',
              config: config as MapViewConfig,
              expectedRevision: view.revision,
              ...(patch.name === undefined ? {} : { name: patch.name }),
            };
      try {
        const updated = await this.#client.updateView(view.id, request);
        return { status: 'saved', view: updated };
      } catch (error) {
        const failure = asClientError(error);
        if (failure.kind === 'conflict' || failure.kind === 'not-found') {
          const latest = await this.#readBack(view.id);
          if (latest !== null && viewMatchesRequest(latest, request)) {
            return { status: 'saved', view: latest };
          }
          return { status: 'conflict', latestView: latest };
        }
        if (failure.kind === 'network' || failure.kind === 'timeout') {
          const latest = await this.#readBack(view.id);
          if (latest === null) {
            return { status: 'unresolved', kind: failure.kind, error: failure.details };
          }
          if (viewMatchesRequest(latest, request)) {
            return { status: 'saved', view: latest };
          }
          if (latest.revision === view.revision) {
            return { status: 'unresolved', kind: failure.kind, error: failure.details };
          }
          return { status: 'conflict', latestView: latest };
        }
        return { status: 'failed', kind: failure.kind, error: failure.details };
      }
    });
  }

  async deleteView(view: View): Promise<ViewWriteOutcome> {
    return this.#serialize(view.id, async () => {
      try {
        await this.#client.deleteView(view.id, view.revision);
        return { status: 'deleted' };
      } catch (error) {
        const failure = asClientError(error);
        if (failure.kind === 'not-found') {
          return { status: 'deleted' };
        }
        if (failure.kind === 'conflict') {
          const latest = await this.#readBack(view.id);
          if (latest !== null && latest.deletedAt !== undefined) {
            return { status: 'deleted' };
          }
          return { status: 'conflict', latestView: latest };
        }
        if (failure.kind === 'network' || failure.kind === 'timeout') {
          const latest = await this.#readBack(view.id);
          if (latest !== null && latest.deletedAt !== undefined) return { status: 'deleted' };
          return { status: 'unresolved', kind: failure.kind, error: failure.details };
        }
        return { status: 'failed', kind: failure.kind, error: failure.details };
      }
    });
  }

  async restoreView(view: View): Promise<ViewWriteOutcome> {
    return this.#serialize(view.id, async () => {
      try {
        const restored = await this.#client.restoreView(view.id, view.revision);
        return { status: 'saved', view: restored };
      } catch (error) {
        const failure = asClientError(error);
        if (failure.kind === 'conflict' || failure.kind === 'not-found') {
          const latest = await this.#readBack(view.id);
          if (latest !== null && latest.deletedAt === undefined) {
            return { status: 'saved', view: latest };
          }
          return { status: 'conflict', latestView: latest };
        }
        if (failure.kind === 'network' || failure.kind === 'timeout') {
          const latest = await this.#readBack(view.id);
          if (latest !== null && latest.deletedAt === undefined) {
            return { status: 'saved', view: latest };
          }
          return { status: 'unresolved', kind: failure.kind, error: failure.details };
        }
        return { status: 'failed', kind: failure.kind, error: failure.details };
      }
    });
  }

  async #sendCreate(intent: PendingViewCreateIntent): Promise<ViewCreateOutcome> {
    const existing = this.#inFlightCreates.get(intent.intentId);
    if (existing !== undefined) return existing;
    const task = (async (): Promise<ViewCreateOutcome> => {
      try {
        const view = await this.#client.createView(intent.tableId, intent.request, intent.intentId);
        await this.#intents?.remove(intent.intentId);
        return { status: 'created', view };
      } catch (error) {
        const failure = asClientError(error);
        if (failure.kind === 'network' || failure.kind === 'timeout') {
          await this.#intents?.put(intent);
          return { status: 'unresolved', kind: failure.kind, intent, error: failure.details };
        }
        return { status: 'failed', kind: failure.kind, error: failure.details };
      }
    })();
    this.#inFlightCreates.set(intent.intentId, task);
    try {
      return await task;
    } finally {
      this.#inFlightCreates.delete(intent.intentId);
    }
  }

  async #readBack(viewId: string): Promise<View | null> {
    try {
      return await this.#client.getView(viewId);
    } catch {
      return null;
    }
  }

  #serialize<T>(viewId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.#inFlightWrites.get(viewId) ?? Promise.resolve();
    const next = previous.then(task, task);
    const tail = next.then(
      () => undefined,
      () => undefined,
    );
    this.#inFlightWrites.set(viewId, tail);
    void tail.then(() => {
      if (this.#inFlightWrites.get(viewId) === tail) this.#inFlightWrites.delete(viewId);
    });
    return next;
  }
}

function viewMatchesRequest(view: View, request: UpdateViewRequest): boolean {
  if (view.type !== request.type) return false;
  if (request.name !== undefined && view.name !== request.name) return false;
  return jsonEquals(view.config, request.config);
}

function jsonEquals(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== 'object' || left === null || typeof right !== 'object' || right === null) {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => jsonEquals(item, right[index]))
    );
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  const rightKeys = Object.keys(rightRecord);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(rightRecord, key) &&
        jsonEquals(leftRecord[key], rightRecord[key]),
    )
  );
}

function asClientError(error: unknown): LoomTableClientError {
  if (error instanceof LoomTableClientError) return error;
  return new LoomTableClientError('server', {
    message: 'The LoomTable Server returned an unexpected View error.',
  });
}
