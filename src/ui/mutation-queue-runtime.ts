import { LoomTableClientError, type MutationResult } from '../client/loomtable-client';
import {
  MutationQueueScheduler,
  type DurableMutationQueuePort,
  type DurableMutationQueueTransport,
  type MutationQueueRecordSnapshot,
  type MutationQueueSchedulerOptions,
} from './mutation-queue-scheduler';
import {
  MutationQueueStore,
  type MutationQueueSettingsV2,
  type MutationQueueStorePersistence,
} from '../settings/mutation-queue-settings';

export interface MutationQueueRuntimeOptions {
  readonly load: () => unknown;
  readonly save: (value: MutationQueueSettingsV2) => Promise<void>;
  readonly transport: DurableMutationQueueTransport;
  readonly isOnline?: () => boolean;
  readonly isAuthReady?: () => boolean;
  readonly onApplied?: MutationQueueSchedulerOptions['onApplied'];
}

export class MutationQueueRuntime {
  readonly #options: MutationQueueRuntimeOptions;
  #scheduler: MutationQueueScheduler | null = null;
  #recoveryError: unknown = null;
  #online: boolean;
  #authReady: boolean;

  constructor(options: MutationQueueRuntimeOptions) {
    this.#options = options;
    this.#online = options.isOnline?.() ?? defaultOnline();
    this.#authReady = options.isAuthReady?.() ?? false;
  }

  get scheduler(): MutationQueueScheduler | null {
    return this.#scheduler;
  }

  get recoveryError(): unknown {
    return this.#recoveryError;
  }

  async start(): Promise<MutationQueueScheduler | null> {
    if (this.#scheduler !== null) return this.#scheduler;
    if (this.#recoveryError !== null) return null;

    const persistence: MutationQueueStorePersistence = {
      load: async () => this.#options.load(),
      save: this.#options.save,
    };
    let store: MutationQueueStore;
    try {
      store = await MutationQueueStore.hydrate(persistence);
    } catch (error) {
      // Corrupt or unknown-version queue storage must be preserved: do not
      // normalize it into an empty queue and do not overwrite it. The runtime
      // reports the failure and stays paused.
      this.#recoveryError = error;
      return null;
    }
    const scheduler = new MutationQueueScheduler({
      store,
      transport: this.#options.transport,
      ...(this.#options.onApplied === undefined ? {} : { onApplied: this.#options.onApplied }),
    });
    this.#scheduler = scheduler;

    try {
      await scheduler.start();
      await scheduler.setOnline(this.#online);
      await scheduler.setAuthReady(this.#authReady);
    } catch (error) {
      this.#scheduler = null;
      throw error;
    }
    return scheduler;
  }

  async setOnline(online: boolean): Promise<void> {
    this.#online = online;
    await this.#scheduler?.setOnline(online);
  }

  async setAuthReady(authReady: boolean): Promise<void> {
    this.#authReady = authReady;
    await this.#scheduler?.setAuthReady(authReady);
  }

  stop(): void {
    this.#scheduler?.stop();
  }
}

export class UnavailableMutationQueuePort implements DurableMutationQueuePort {
  readonly #reason: unknown;

  constructor(reason: unknown) {
    this.#reason = reason;
  }

  enqueue(
    tableId: string,
    request: Parameters<DurableMutationQueuePort['enqueue']>[1],
  ): Promise<MutationResult> {
    void tableId;
    void request;
    return Promise.reject(this.#error());
  }

  subscribe(): () => void {
    return () => undefined;
  }

  getRecordSnapshot(recordId: string): MutationQueueRecordSnapshot {
    void recordId;
    return { state: 'idle', pending: 0 };
  }

  getOperationSnapshot(clientMutationId: string): MutationQueueRecordSnapshot {
    void clientMutationId;
    return { state: 'idle', pending: 0 };
  }

  retryOperation(clientMutationId: string): Promise<void> {
    void clientMutationId;
    return Promise.reject(this.#error());
  }

  resolveConflict(recordId: string, action: 'adopt-server' | 'overwrite'): Promise<void> {
    void recordId;
    void action;
    return Promise.reject(this.#error());
  }

  discardAllForRecord(recordId: string): Promise<void> {
    void recordId;
    return Promise.reject(this.#error());
  }

  discardOperation(clientMutationId: string): Promise<void> {
    void clientMutationId;
    return Promise.reject(this.#error());
  }

  #error(): LoomTableClientError {
    const detail =
      this.#reason instanceof Error && this.#reason.message.length > 0
        ? this.#reason.message
        : 'unknown storage failure';
    return new LoomTableClientError('server', {
      message:
        'The durable mutation queue could not be recovered; pending edits were preserved ' +
        'and new mutations are paused (' +
        detail +
        ').',
    });
  }
}

function defaultOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}
