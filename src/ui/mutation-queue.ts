import {
  LoomTableClientError,
  type MutationResult,
  type UpdateRecordCommand,
} from '../client/loomtable-client';

export interface MutationQueueClient {
  mutate(
    tableId: string,
    request: {
      readonly clientMutationId: string;
      readonly commands: readonly [UpdateRecordCommand];
    },
  ): Promise<MutationResult>;
}

export interface MutationQueueJob {
  readonly tableId: string;
  readonly recordId: string;
  readonly initialRevision: number;
  readonly buildCommand: (expectedRevision: number) => UpdateRecordCommand;
}

export type MutationQueueState = 'idle' | 'queued' | 'saving' | 'conflict' | 'error';

export interface MutationQueueSnapshot {
  readonly state: MutationQueueState;
  readonly pending: number;
  readonly mutationId?: string;
  readonly error?: LoomTableClientError;
}

export interface MutationQueueConflict {
  readonly recordId: string;
  readonly job: MutationQueueJob;
  readonly error: LoomTableClientError;
}

export type MutationQueueListener = (recordId: string, snapshot: MutationQueueSnapshot) => void;

interface PendingJob {
  readonly job: MutationQueueJob;
  readonly resolve: (result: MutationResult) => void;
  readonly reject: (error: unknown) => void;
}

type InternalConflict = MutationQueueConflict;

interface RecordQueue {
  readonly recordId: string;
  readonly jobs: PendingJob[];
  revision: number;
  processing: boolean;
  blocked: InternalConflict | undefined;
  error: LoomTableClientError | undefined;
  failed: PendingJob | undefined;
  mutationId: string | undefined;
}

export interface MutationQueueOptions {
  readonly idFactory?: () => string;
  readonly maxNetworkAttempts?: number;
  readonly onApplied?: (recordId: string, result: MutationResult) => void;
}

export class MutationQueue {
  readonly #client: MutationQueueClient;
  readonly #idFactory: () => string;
  readonly #maxNetworkAttempts: number;
  readonly #onApplied: ((recordId: string, result: MutationResult) => void) | undefined;
  readonly #queues = new Map<string, RecordQueue>();
  readonly #listeners = new Set<MutationQueueListener>();

  constructor(client: MutationQueueClient, options: MutationQueueOptions = {}) {
    this.#client = client;
    this.#idFactory = options.idFactory ?? createMutationId;
    this.#maxNetworkAttempts = Math.max(1, Math.min(3, options.maxNetworkAttempts ?? 2));
    this.#onApplied = options.onApplied;
  }

  subscribe(listener: MutationQueueListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  getSnapshot(recordId: string): MutationQueueSnapshot {
    const queue = this.#queues.get(recordId);
    return queue === undefined ? { state: 'idle', pending: 0 } : snapshotFor(queue);
  }

  getConflict(recordId: string): MutationQueueConflict | undefined {
    return this.#queues.get(recordId)?.blocked;
  }

  enqueue(job: MutationQueueJob): Promise<MutationResult> {
    if (!Number.isInteger(job.initialRevision) || job.initialRevision < 1) {
      return Promise.reject(
        new LoomTableClientError('validation', {
          message: 'A positive Record revision is required before editing a Cell.',
        }),
      );
    }
    const queue = this.#queues.get(job.recordId) ?? this.#createQueue(job);
    return new Promise<MutationResult>((resolve, reject) => {
      queue.jobs.push({ job, resolve, reject });
      queue.error = undefined;
      queue.failed = undefined;
      this.#publish(queue);
      void this.#process(queue);
    });
  }

  resolveConflict(recordId: string, action: 'discard' | 'retry', currentRevision: number): void {
    const queue = this.#queues.get(recordId);
    if (queue?.blocked === undefined) return;
    queue.revision = currentRevision;
    if (action === 'retry') {
      queue.jobs.unshift({
        job: queue.blocked.job,
        resolve: () => undefined,
        reject: () => undefined,
      });
    }
    queue.blocked = undefined;
    queue.error = undefined;
    this.#publish(queue);
    void this.#process(queue);
  }

  discardPending(recordId: string): void {
    const queue = this.#queues.get(recordId);
    if (queue === undefined) return;
    for (const pending of queue.jobs.splice(0)) pending.reject(new MutationQueueDiscardedError());
    queue.blocked = undefined;
    queue.error = undefined;
    queue.failed = undefined;
    this.#publish(queue);
  }

  retryError(recordId: string): void {
    const queue = this.#queues.get(recordId);
    if (queue?.error === undefined || queue.failed === undefined || queue.processing) return;
    queue.jobs.unshift(queue.failed);
    queue.failed = undefined;
    queue.error = undefined;
    this.#publish(queue);
    void this.#process(queue);
  }

  #createQueue(job: MutationQueueJob): RecordQueue {
    const queue: RecordQueue = {
      recordId: job.recordId,
      jobs: [],
      revision: job.initialRevision,
      processing: false,
      blocked: undefined,
      error: undefined,
      failed: undefined,
      mutationId: undefined,
    };
    this.#queues.set(job.recordId, queue);
    return queue;
  }

  async #process(queue: RecordQueue): Promise<void> {
    if (queue.processing || queue.blocked !== undefined) return;
    const pending = queue.jobs.shift();
    if (pending === undefined) {
      this.#publish(queue);
      return;
    }

    queue.processing = true;
    queue.error = undefined;
    const clientMutationId = this.#idFactory();
    queue.mutationId = clientMutationId;
    const command = pending.job.buildCommand(queue.revision);
    const request = { clientMutationId, commands: [command] as const };
    this.#publish(queue);

    try {
      const result = await this.#mutateWithRetry(pending.job.tableId, request);
      const record = result.results.find((item) => item.index === 0)?.record;
      if (record !== undefined) queue.revision = record.revision;
      this.#onApplied?.(queue.recordId, result);
      pending.resolve(result);
    } catch (error) {
      const clientError = asClientError(error);
      if (clientError.kind === 'conflict' && clientError.conflict !== undefined) {
        queue.blocked = {
          recordId: queue.recordId,
          job: pending.job,
          error: clientError,
        };
        pending.reject(clientError);
        queue.processing = false;
        this.#publish(queue);
        return;
      }
      queue.error = clientError;
      queue.failed = pending;
      pending.reject(clientError);
    } finally {
      queue.processing = false;
      if (queue.blocked === undefined) {
        queue.mutationId = undefined;
        this.#publish(queue);
        if (queue.jobs.length > 0) void this.#process(queue);
      }
    }
  }

  async #mutateWithRetry(
    tableId: string,
    request: {
      readonly clientMutationId: string;
      readonly commands: readonly [UpdateRecordCommand];
    },
  ): Promise<MutationResult> {
    let attempt = 0;
    while (true) {
      try {
        return await this.#client.mutate(tableId, request);
      } catch (error) {
        const clientError = asClientError(error);
        attempt += 1;
        if (
          (clientError.kind !== 'network' && clientError.kind !== 'timeout') ||
          attempt >= this.#maxNetworkAttempts
        ) {
          throw clientError;
        }
      }
    }
  }

  #publish(queue: RecordQueue): void {
    const snapshot = snapshotFor(queue);
    for (const listener of this.#listeners) listener(queue.recordId, snapshot);
    if (
      !queue.processing &&
      queue.blocked === undefined &&
      queue.jobs.length === 0 &&
      queue.error === undefined
    ) {
      this.#queues.delete(queue.recordId);
    }
  }
}

class MutationQueueDiscardedError extends Error {
  constructor() {
    super('The pending Record edit was discarded.');
    this.name = 'MutationQueueDiscardedError';
  }
}

function snapshotFor(queue: RecordQueue): MutationQueueSnapshot {
  if (queue.blocked !== undefined) {
    return {
      state: 'conflict',
      pending: queue.jobs.length + 1,
      ...(queue.mutationId === undefined ? {} : { mutationId: queue.mutationId }),
    };
  }
  if (queue.processing) {
    return {
      state: 'saving',
      pending: queue.jobs.length + 1,
      ...(queue.mutationId === undefined ? {} : { mutationId: queue.mutationId }),
    };
  }
  if (queue.jobs.length > 0) return { state: 'queued', pending: queue.jobs.length };
  if (queue.error !== undefined) return { state: 'error', pending: 0, error: queue.error };
  return { state: 'idle', pending: 0 };
}

function asClientError(error: unknown): LoomTableClientError {
  if (error instanceof LoomTableClientError) return error;
  return new LoomTableClientError('server', {
    message: 'The LoomTable Server returned an unexpected mutation error.',
  });
}

const ULID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
let mutationSequence = 0;

function createMutationId(): string {
  mutationSequence += 1;
  const random = new Uint8Array(10);
  const cryptoObject = typeof window === 'undefined' ? undefined : window.crypto;
  if (cryptoObject?.getRandomValues !== undefined) {
    cryptoObject.getRandomValues(random);
  } else {
    let value = (Date.now() + mutationSequence) >>> 0;
    for (let index = 0; index < random.length; index += 1) {
      value = (value * 1_664_525 + 1_013_904_223) >>> 0;
      random[index] = value >>> 24;
    }
  }
  return `mut_${encodeUlidTimestamp(Date.now())}${encodeUlidRandom(random)}`;
}

function encodeUlidTimestamp(timestamp: number): string {
  let value = timestamp;
  let encoded = '';
  for (let index = 0; index < 10; index += 1) {
    encoded = ULID_ALPHABET[value % 32] + encoded;
    value = Math.floor(value / 32);
  }
  return encoded;
}

function encodeUlidRandom(random: Uint8Array): string {
  let buffer = 0;
  let bits = 0;
  let encoded = '';
  for (const byte of random) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      encoded += ULID_ALPHABET[(buffer >>> bits) & 31];
    }
  }
  return encoded;
}
