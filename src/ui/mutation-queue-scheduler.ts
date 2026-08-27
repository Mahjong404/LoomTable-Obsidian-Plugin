import {
  LoomTableClientError,
  type LoomTableClientErrorKind,
  type MutationRequest,
  type MutationResult,
  type ConflictDetails,
} from '../client/loomtable-client';
import {
  MutationQueueStore,
  type MutationQueueEntryState,
  type MutationQueueSettingsV1,
  type PersistedMutationQueueEntry,
  type PersistedMutationQueueError,
} from '../settings/mutation-queue-settings';

export const MUTATION_QUEUE_RETRY_BASE_DELAY_MS = 250;
export const MUTATION_QUEUE_MAX_BACKOFF_MS = 24 * 60 * 60 * 1_000;

type TimerHandle = number;

export interface DurableMutationQueueTransport {
  readonly mutate: (tableId: string, request: MutationRequest) => Promise<MutationResult>;
}

export interface MutationQueueSchedulerOptions {
  readonly store: MutationQueueStore;
  readonly transport: DurableMutationQueueTransport;
  readonly now?: () => number;
  readonly random?: () => number;
  readonly onApplied?: (entry: PersistedMutationQueueEntry, result: MutationResult) => void;
  readonly setTimer?: (callback: () => void, delayMs: number) => TimerHandle;
  readonly clearTimer?: (timer: TimerHandle) => void;
}

export class MutationQueueScheduler {
  readonly #store: MutationQueueStore;
  readonly #transport: DurableMutationQueueTransport;
  readonly #now: () => number;
  readonly #random: () => number;
  readonly #onApplied:
    ((entry: PersistedMutationQueueEntry, result: MutationResult) => void) | undefined;
  readonly #setTimer: (callback: () => void, delayMs: number) => TimerHandle;
  readonly #clearTimer: (timer: TimerHandle) => void;
  readonly #inFlight = new Set<string>();

  #state: MutationQueueSettingsV1;
  #online = false;
  #authReady = false;
  #started = false;
  #timer: TimerHandle | undefined;
  #writeChain = Promise.resolve();
  #drainRequested = false;
  #drainPromise: Promise<void> | null = null;

  constructor(options: MutationQueueSchedulerOptions) {
    this.#store = options.store;
    this.#transport = options.transport;
    this.#now = options.now ?? Date.now;
    this.#random = options.random ?? Math.random;
    this.#onApplied = options.onApplied;
    this.#setTimer =
      options.setTimer ?? ((callback, delayMs) => window.setTimeout(callback, delayMs));
    this.#clearTimer = options.clearTimer ?? ((timer) => window.clearTimeout(timer));
    this.#state = this.#store.getSnapshot();
  }

  getSnapshot(): MutationQueueSettingsV1 {
    return this.#state;
  }

  get online(): boolean {
    return this.#online;
  }

  get authReady(): boolean {
    return this.#authReady;
  }

  async start(): Promise<void> {
    if (this.#started) return;
    this.#state = recoverSending(this.#store.getSnapshot());
    this.#started = true;
    try {
      await this.#persistState();
      await this.drain();
    } catch (error) {
      this.#started = false;
      this.#clearWakeTimer();
      throw error;
    }
  }

  stop(): void {
    this.#started = false;
    this.#drainRequested = false;
    this.#clearWakeTimer();
  }

  async setOnline(online: boolean): Promise<void> {
    this.#online = online;
    if (!online) {
      this.#clearWakeTimer();
      return;
    }
    await this.drain();
  }

  async setAuthReady(authReady: boolean): Promise<void> {
    this.#authReady = authReady;
    if (!authReady) {
      this.#clearWakeTimer();
      return;
    }

    if (this.#started) {
      const resumed = this.#state.entries.some((entry) => entry.state === 'auth-paused');
      if (resumed) {
        await this.#updateState((state) => ({
          ...state,
          entries: state.entries.map((entry) =>
            entry.state === 'auth-paused'
              ? clearFailure(entry, 'queued', this.#timestamp())
              : entry,
          ),
        }));
      }
      await this.drain();
    }
  }

  async drain(): Promise<void> {
    if (!this.#started) return;
    await this.#requestDrain();
  }

  #requestDrain(): Promise<void> {
    if (!this.#started) return Promise.resolve();
    this.#drainRequested = true;
    if (this.#drainPromise === null) {
      const drain = this.#runDrain();
      this.#drainPromise = drain.finally(() => {
        this.#drainPromise = null;
        if (this.#drainRequested && this.#started) void this.#requestDrain();
      });
    }
    return this.#drainPromise;
  }

  async #runDrain(): Promise<void> {
    while (this.#drainRequested) {
      this.#drainRequested = false;
      if (!this.#canSend()) {
        this.#clearWakeTimer();
        return;
      }

      const entries = this.#dueRecordHeads();
      if (entries.length === 0) {
        this.#armWakeTimer();
        return;
      }

      await Promise.all(entries.map((entry) => this.#send(entry)));
      if (this.#canSend()) this.#drainRequested = true;
    }
  }

  async #send(entry: PersistedMutationQueueEntry): Promise<void> {
    if (this.#inFlight.has(entry.recordId)) return;
    this.#inFlight.add(entry.recordId);

    try {
      const current = this.#state.entries.find(
        (candidate) => candidate.clientMutationId === entry.clientMutationId,
      );
      if (current === undefined || current.state !== 'queued') return;

      const sending = await this.#updateEntry(current.clientMutationId, (candidate) =>
        clearFailure(candidate, 'sending', this.#timestamp(), candidate.attemptCount + 1),
      );
      if (sending === undefined) return;

      if (!this.#started) return;
      if (!this.#canSend()) {
        await this.#updateEntry(sending.clientMutationId, (candidate) =>
          clearFailure(candidate, 'queued', this.#timestamp()),
        );
        return;
      }

      let result: MutationResult;
      try {
        result = await this.#transport.mutate(sending.tableId, sending.request);
      } catch (error) {
        if (this.#started) await this.#handleFailure(sending, error);
        return;
      }

      if (!this.#started) return;
      if (result.clientMutationId !== sending.clientMutationId) {
        await this.#handleFailure(
          sending,
          new LoomTableClientError('invalid-response', {
            message: 'The mutation response did not match the queued mutation ID.',
          }),
        );
        return;
      }

      const removed = await this.#applySuccess(sending, result);
      if (removed) {
        try {
          this.#onApplied?.(sending, result);
        } catch {
          // A successful mutation must not be requeued because a cache observer failed.
        }
      }
    } finally {
      this.#inFlight.delete(entry.recordId);
    }
  }

  async #handleFailure(entry: PersistedMutationQueueEntry, error: unknown): Promise<void> {
    const clientError = asClientError(error);
    const action = classifyMutationError(clientError);
    const updatedAt = this.#timestamp();

    if (action === 'requeue') {
      const delayMs = retryDelayMs(
        entry.attemptCount,
        clientError.details.retryAfterMs,
        this.#random,
      );
      await this.#updateEntry(entry.clientMutationId, (candidate) =>
        withFailure(
          candidate,
          'queued',
          clientError,
          updatedAt,
          new Date(this.#now() + delayMs).toISOString(),
        ),
      );
      return;
    }

    if (action === 'auth-paused') {
      this.#authReady = false;
      this.#clearWakeTimer();
      await this.#updateEntry(entry.clientMutationId, (candidate) =>
        withFailure(candidate, 'auth-paused', clientError, updatedAt),
      );
      return;
    }

    if (action === 'conflict' && clientError.conflict !== undefined) {
      await this.#updateEntry(entry.clientMutationId, (candidate) =>
        withFailure(candidate, 'conflict', clientError, updatedAt, undefined, clientError.conflict),
      );
      return;
    }

    await this.#updateEntry(entry.clientMutationId, (candidate) =>
      withFailure(candidate, 'terminal', clientError, updatedAt),
    );
  }

  async #updateEntry(
    clientMutationId: string,
    update: (entry: PersistedMutationQueueEntry) => PersistedMutationQueueEntry,
  ): Promise<PersistedMutationQueueEntry | undefined> {
    const current = this.#state.entries.find(
      (entry) => entry.clientMutationId === clientMutationId,
    );
    if (current === undefined) return undefined;
    const next = update(current);
    await this.#updateState((state) => ({
      ...state,
      entries: state.entries.map((entry) =>
        entry.clientMutationId === clientMutationId ? next : entry,
      ),
    }));
    return next;
  }

  async #applySuccess(
    entry: PersistedMutationQueueEntry,
    result: MutationResult,
  ): Promise<boolean> {
    if (
      !this.#state.entries.some(
        (candidate) => candidate.clientMutationId === entry.clientMutationId,
      )
    ) {
      return false;
    }

    const latestRevision = latestRecordRevision(entry, result);
    const updatedAt = latestRevision === undefined ? undefined : this.#timestamp();
    await this.#updateState((state) => {
      let entrySeen = false;
      const entries: PersistedMutationQueueEntry[] = [];

      for (const candidate of state.entries) {
        if (candidate.clientMutationId === entry.clientMutationId) {
          entrySeen = true;
          continue;
        }

        if (
          entrySeen &&
          latestRevision !== undefined &&
          candidate.recordId === entry.recordId &&
          candidate.state === 'queued'
        ) {
          entries.push(withExpectedRevision(candidate, latestRevision, updatedAt));
        } else {
          entries.push(candidate);
        }
      }

      return { ...state, entries };
    });
    return true;
  }

  async #updateState(
    update: (state: MutationQueueSettingsV1) => MutationQueueSettingsV1,
  ): Promise<void> {
    const next = update(this.#state);
    this.#state = next;
    await this.#persistState();
  }

  async #persistState(): Promise<void> {
    const snapshot = this.#state;
    const write = this.#writeChain.then(() => this.#store.replace(snapshot));
    this.#writeChain = write.then(
      () => undefined,
      () => undefined,
    );
    await write;
  }

  #dueRecordHeads(): PersistedMutationQueueEntry[] {
    const heads = new Map<string, PersistedMutationQueueEntry>();
    for (const entry of this.#state.entries) {
      if (!heads.has(entry.recordId)) heads.set(entry.recordId, entry);
    }

    const now = this.#now();
    return [...heads.values()].filter(
      (entry) =>
        entry.state === 'queued' &&
        !this.#inFlight.has(entry.recordId) &&
        (entry.nextAttemptAt === undefined || Date.parse(entry.nextAttemptAt) <= now),
    );
  }

  #armWakeTimer(): void {
    this.#clearWakeTimer();
    if (!this.#canSend()) return;

    const heads = new Map<string, PersistedMutationQueueEntry>();
    for (const entry of this.#state.entries) {
      if (!heads.has(entry.recordId)) heads.set(entry.recordId, entry);
    }

    const now = this.#now();
    const nextAttemptAt = [...heads.values()]
      .filter(
        (entry) =>
          entry.state === 'queued' &&
          !this.#inFlight.has(entry.recordId) &&
          entry.nextAttemptAt !== undefined,
      )
      .map((entry) => entry.nextAttemptAt)
      .filter((timestamp): timestamp is string => timestamp !== undefined)
      .map((timestamp) => Date.parse(timestamp))
      .filter((timestamp) => timestamp > now)
      .sort((left, right) => left - right)[0];

    if (nextAttemptAt === undefined) return;
    const delayMs = Math.min(Math.max(0, nextAttemptAt - now), 2_147_000_000);
    this.#timer = this.#setTimer(() => {
      this.#timer = undefined;
      void this.drain().catch(() => undefined);
    }, delayMs);
  }

  #clearWakeTimer(): void {
    if (this.#timer !== undefined) this.#clearTimer(this.#timer);
    this.#timer = undefined;
  }

  #canSend(): boolean {
    return this.#started && this.#online && this.#authReady;
  }

  #timestamp(): string {
    return new Date(this.#now()).toISOString();
  }
}

type MutationFailureAction = 'requeue' | 'auth-paused' | 'conflict' | 'terminal';

function classifyMutationError(error: LoomTableClientError): MutationFailureAction {
  const { httpStatus, code } = error.details;
  if (httpStatus === 401 || error.kind === 'authentication') return 'auth-paused';
  if (httpStatus === 409 && code === 'CONFLICT' && error.conflict !== undefined) {
    return 'conflict';
  }
  if (httpStatus === 409 && code === 'IDEMPOTENCY_KEY_REUSED') return 'terminal';
  if (
    error.kind === 'network' ||
    error.kind === 'timeout' ||
    httpStatus === 408 ||
    httpStatus === 429 ||
    (httpStatus !== undefined &&
      httpStatus >= 500 &&
      httpStatus <= 599 &&
      httpStatus !== 501 &&
      code !== 'MIGRATION_REQUIRED')
  ) {
    return 'requeue';
  }
  return 'terminal';
}

function retryDelayMs(
  attemptCount: number,
  retryAfterMs: number | undefined,
  random: () => number,
): number {
  const exponent = Math.min(Math.max(attemptCount - 1, 0), 31);
  const exponential = MUTATION_QUEUE_RETRY_BASE_DELAY_MS * 2 ** exponent;
  const jitter = exponential * (0.75 + clampRandom(random()) * 0.5);
  const serverHint =
    typeof retryAfterMs === 'number' && Number.isFinite(retryAfterMs) && retryAfterMs >= 0
      ? retryAfterMs
      : 0;
  return Math.min(MUTATION_QUEUE_MAX_BACKOFF_MS, Math.max(jitter, serverHint));
}

function latestRecordRevision(
  entry: PersistedMutationQueueEntry,
  result: MutationResult,
): number | undefined {
  const commandIndex = entry.request.commands.findIndex(
    (command) => command.kind === 'updateRecord' && command.recordId === entry.recordId,
  );
  if (commandIndex < 0) return undefined;

  const matchingResult = result.results.find(
    (commandResult) =>
      commandResult.index === commandIndex &&
      commandResult.record.id === entry.recordId &&
      commandResult.record.tableId === entry.tableId,
  );
  return matchingResult?.record.revision;
}

function withExpectedRevision(
  entry: PersistedMutationQueueEntry,
  expectedRevision: number,
  updatedAt: string | undefined,
): PersistedMutationQueueEntry {
  const [command] = entry.request.commands;
  if (command.kind !== 'updateRecord' || command.recordId !== entry.recordId) return entry;

  return {
    ...entry,
    expectedRevision,
    request: {
      ...entry.request,
      commands: [{ ...command, expectedRevision }],
    },
    ...(updatedAt === undefined ? {} : { updatedAt }),
  };
}

function recoverSending(state: MutationQueueSettingsV1): MutationQueueSettingsV1 {
  return {
    ...state,
    entries: state.entries.map((entry) =>
      entry.state === 'sending' ? clearFailure(entry, 'queued', entry.updatedAt) : entry,
    ),
  };
}

function clearFailure(
  entry: PersistedMutationQueueEntry,
  state: Extract<MutationQueueEntryState, 'queued' | 'sending'>,
  updatedAt: string,
  attemptCount = entry.attemptCount,
): PersistedMutationQueueEntry {
  return {
    tableId: entry.tableId,
    recordId: entry.recordId,
    clientMutationId: entry.clientMutationId,
    request: entry.request,
    expectedRevision: entry.expectedRevision,
    state,
    attemptCount,
    createdAt: entry.createdAt,
    updatedAt,
  };
}

function withFailure(
  entry: PersistedMutationQueueEntry,
  state: Extract<MutationQueueEntryState, 'auth-paused' | 'terminal' | 'queued' | 'conflict'>,
  error: LoomTableClientError,
  updatedAt: string,
  nextAttemptAt?: string,
  conflict?: ConflictDetails,
): PersistedMutationQueueEntry {
  const persistedError = toPersistedError(error);
  return {
    tableId: entry.tableId,
    recordId: entry.recordId,
    clientMutationId: entry.clientMutationId,
    request: entry.request,
    expectedRevision: entry.expectedRevision,
    state,
    attemptCount: entry.attemptCount,
    ...(nextAttemptAt === undefined ? {} : { nextAttemptAt }),
    lastError: persistedError,
    ...(conflict === undefined ? {} : { conflict }),
    createdAt: entry.createdAt,
    updatedAt,
  };
}

function toPersistedError(error: LoomTableClientError): PersistedMutationQueueError {
  const details = error.details;
  return {
    kind: error.kind,
    message: safeErrorMessage(error.kind),
    ...(details.code === undefined ? {} : { code: details.code.slice(0, 128) }),
    ...(details.httpStatus === undefined ? {} : { httpStatus: details.httpStatus }),
    ...(details.requestId === undefined ? {} : { requestId: details.requestId.slice(0, 256) }),
  };
}

function safeErrorMessage(kind: LoomTableClientErrorKind): string {
  switch (kind) {
    case 'authentication':
      return 'Authentication is required before this mutation can be sent.';
    case 'capability':
      return 'The Server does not support this mutation.';
    case 'conflict':
      return 'The Record changed on the Server before this mutation was applied.';
    case 'cursor-expired':
      return 'The queued mutation is no longer valid for the current Server state.';
    case 'forbidden':
      return 'The Server denied this mutation.';
    case 'invalid-response':
      return 'The Server returned an invalid mutation response.';
    case 'network':
      return 'The Server could not be reached.';
    case 'not-found':
      return 'The Record or Table was not found.';
    case 'server':
      return 'The Server returned a mutation error.';
    case 'timeout':
      return 'The Server did not respond in time.';
    case 'validation':
      return 'The Server rejected this mutation.';
  }
}

function asClientError(error: unknown): LoomTableClientError {
  if (error instanceof LoomTableClientError) return error;
  return new LoomTableClientError('server', {
    message: 'The LoomTable Server returned an unexpected mutation error.',
  });
}

function clampRandom(value: number): number {
  return Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : 0.5;
}
