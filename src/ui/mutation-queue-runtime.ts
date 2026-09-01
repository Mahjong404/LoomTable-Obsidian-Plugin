import {
  MutationQueueScheduler,
  type DurableMutationQueueTransport,
  type MutationQueueSchedulerOptions,
} from './mutation-queue-scheduler';
import {
  MutationQueueStore,
  type MutationQueueSettingsV1,
  type MutationQueueStorePersistence,
} from '../settings/mutation-queue-settings';

export interface MutationQueueRuntimeOptions {
  readonly load: () => unknown;
  readonly save: (value: MutationQueueSettingsV1) => Promise<void>;
  readonly transport: DurableMutationQueueTransport;
  readonly isOnline?: () => boolean;
  readonly isAuthReady?: () => boolean;
  readonly onApplied?: MutationQueueSchedulerOptions['onApplied'];
}

export class MutationQueueRuntime {
  readonly #options: MutationQueueRuntimeOptions;
  #scheduler: MutationQueueScheduler | null = null;
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

  async start(): Promise<MutationQueueScheduler> {
    if (this.#scheduler !== null) return this.#scheduler;

    const persistence: MutationQueueStorePersistence = {
      load: async () => this.#options.load(),
      save: this.#options.save,
    };
    const store = await MutationQueueStore.hydrate(persistence);
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

function defaultOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}
