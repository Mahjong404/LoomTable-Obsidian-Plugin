import { describe, expect, it, vi } from 'vitest';

import {
  LoomTableClientError,
  type ConflictDetails,
  type MutationRequest,
  type MutationResult,
  type UpdateRecordCommand,
} from '../../src/client/loomtable-client';
import {
  MutationQueueScheduler,
  type DurableMutationQueueTransport,
} from '../../src/ui/mutation-queue-scheduler';
import {
  MutationQueueStore,
  type MutationQueueEntryState,
  type MutationQueueSettingsV1,
  type PersistedMutationQueueEntry,
  type PersistedMutationQueueError,
} from '../../src/settings/mutation-queue-settings';

const MUTATION_IDS = [
  'mut_0123456789ABCDEFGHJKMNPQRS',
  'mut_0123456789ABCDEFGHJKMNPQRT',
  'mut_0123456789ABCDEFGHJKMNPQRV',
  'mut_0123456789ABCDEFGHJKMNPQRW',
  'mut_0123456789ABCDEFGHJKMNPQRX',
  'mut_0123456789ABCDEFGHJKMNPQRY',
  'mut_0123456789ABCDEFGHJKMNPQRZ',
  'mut_0123456789ABCDEFGHJKMNPQ2S',
] as const;

describe('MutationQueueScheduler', () => {
  it('recovers a persisted sending entry as queued before any scheduling', async () => {
    const saves: MutationQueueSettingsV1[] = [];
    const store = new MutationQueueStore(
      { schemaVersion: 1, entries: [] },
      {
        async load() {
          return { schemaVersion: 1, entries: [] };
        },
        async save(value) {
          saves.push(value);
        },
      },
    );
    await store.replace({
      schemaVersion: 1,
      entries: [entry({ state: 'sending' })],
    });

    const transport = fakeTransport();
    const scheduler = new MutationQueueScheduler({ store, transport });

    await scheduler.start();

    expect(scheduler.getSnapshot().entries[0]).toMatchObject({
      state: 'queued',
      clientMutationId: MUTATION_IDS[0],
    });
    expect(saves.at(-1)?.entries[0]?.state).toBe('queued');
    expect(transport.mutate).not.toHaveBeenCalled();
    scheduler.stop();
  });

  it('does not send queued mutations until both online and auth-ready', async () => {
    const transport = fakeTransport();
    const { scheduler } = createScheduler([entry()], transport);

    await scheduler.start();
    await scheduler.drain();
    expect(transport.mutate).not.toHaveBeenCalled();

    await scheduler.setAuthReady(true);
    await scheduler.drain();
    expect(transport.mutate).not.toHaveBeenCalled();

    scheduler.stop();
  });

  it('requeues an unknown network result with the same request and ID, then retries durably', async () => {
    let now = 0;
    const originalRequest = entry().request;
    const transport = fakeTransport();
    transport.mutate
      .mockRejectedValueOnce(new LoomTableClientError('network', { message: 'unavailable' }))
      .mockResolvedValueOnce(result(MUTATION_IDS[0], 'record_01', 2));
    const { scheduler } = createScheduler([entry()], transport, () => now);

    await startReady(scheduler);

    expect(transport.mutate).toHaveBeenCalledTimes(1);
    expect(scheduler.getSnapshot().entries[0]).toMatchObject({
      state: 'queued',
      attemptCount: 1,
    });
    expect(scheduler.getSnapshot().entries[0]?.nextAttemptAt).toBe(new Date(250).toISOString());

    now = 250;
    await scheduler.drain();

    expect(transport.mutate).toHaveBeenCalledTimes(2);
    expect(transport.mutate.mock.calls[0]?.[1]).toEqual(originalRequest);
    expect(transport.mutate.mock.calls[1]?.[1]).toEqual(originalRequest);
    expect(transport.mutate.mock.calls[0]?.[1].clientMutationId).toBe(
      transport.mutate.mock.calls[1]?.[1].clientMutationId,
    );
    expect(scheduler.getSnapshot().entries).toHaveLength(0);
    scheduler.stop();
  });

  it('uses Retry-After as a lower bound for durable exponential backoff', async () => {
    let now = 0;
    const transport = fakeTransport();
    transport.mutate
      .mockRejectedValueOnce(
        new LoomTableClientError('server', {
          message: 'Rate limited.',
          code: 'RATE_LIMITED',
          httpStatus: 429,
          retryAfterMs: 5_000,
        }),
      )
      .mockResolvedValueOnce(result(MUTATION_IDS[0], 'record_01', 2));
    const { scheduler } = createScheduler([entry()], transport, () => now);

    await startReady(scheduler);

    expect(scheduler.getSnapshot().entries[0]?.nextAttemptAt).toBe(new Date(5_000).toISOString());
    now = 4_999;
    await scheduler.drain();
    expect(transport.mutate).toHaveBeenCalledTimes(1);

    now = 5_000;
    await scheduler.drain();
    expect(transport.mutate).toHaveBeenCalledTimes(2);
    scheduler.stop();
  });

  it('keeps one Record FIFO while allowing different Records to run in parallel', async () => {
    const calls: MutationRequest[] = [];
    const releases = new Map<string, () => void>();
    const transport: DurableMutationQueueTransport = {
      mutate: vi.fn(async (_tableId: string, request: MutationRequest): Promise<MutationResult> => {
        calls.push(request);
        const command = request.commands[0];
        if (command?.kind !== 'updateRecord') throw new Error('Unexpected command.');
        if (command.recordId === 'record_01' && command.set?.field_a === 'one') {
          return new Promise((resolve) => {
            releases.set('record_01-one', () =>
              resolve(result(request.clientMutationId, 'record_01', 2)),
            );
          });
        }
        if (command.recordId === 'record_02') {
          return new Promise((resolve) => {
            releases.set('record_02-two', () =>
              resolve(result(request.clientMutationId, 'record_02', 2)),
            );
          });
        }
        return result(request.clientMutationId, command.recordId, 2);
      }),
    };
    const { scheduler } = createScheduler(
      [
        entry({ recordId: 'record_01', value: 'one', id: MUTATION_IDS[0] }),
        entry({ recordId: 'record_01', value: 'two', id: MUTATION_IDS[1] }),
        entry({ recordId: 'record_02', value: 'two', id: MUTATION_IDS[2] }),
      ],
      transport,
    );

    await scheduler.setOnline(true);
    await scheduler.setAuthReady(true);
    const started = scheduler.start();
    await vi.waitFor(() => expect(transport.mutate).toHaveBeenCalledTimes(2));

    expect(calls.map((request) => request.commands[0]?.recordId)).toEqual([
      'record_01',
      'record_02',
    ]);
    releases.get('record_01-one')?.();
    releases.get('record_02-two')?.();
    await started;

    expect(calls.map((request) => request.commands[0]?.recordId)).toEqual([
      'record_01',
      'record_02',
      'record_01',
    ]);
    expect(calls[0]?.commands[0]).toMatchObject({
      expectedRevision: 1,
      set: { field_a: 'one' },
    });
    expect(calls[2]?.commands[0]).toMatchObject({
      expectedRevision: 1,
      set: { field_a: 'two' },
    });
    scheduler.stop();
  });

  it('pauses on 401 and resumes the unchanged request after auth recovery', async () => {
    const transport = fakeTransport();
    transport.mutate
      .mockRejectedValueOnce(
        new LoomTableClientError('authentication', {
          message: 'Authentication required.',
          httpStatus: 401,
        }),
      )
      .mockResolvedValueOnce(result(MUTATION_IDS[0], 'record_01', 2));
    const { scheduler } = createScheduler([entry()], transport);

    await startReady(scheduler);

    expect(scheduler.getSnapshot().entries[0]).toMatchObject({
      state: 'auth-paused',
      attemptCount: 1,
      lastError: { httpStatus: 401 },
    });
    expect(transport.mutate).toHaveBeenCalledTimes(1);

    await scheduler.setAuthReady(true);

    expect(transport.mutate).toHaveBeenCalledTimes(2);
    expect(transport.mutate.mock.calls[1]?.[1]).toEqual(transport.mutate.mock.calls[0]?.[1]);
    expect(scheduler.getSnapshot().entries).toHaveLength(0);
    scheduler.stop();
  });

  it('stores a full CONFLICT and never retries it automatically', async () => {
    const conflict: ConflictDetails = {
      clientMutationId: MUTATION_IDS[0],
      failedCommandIndex: 0,
      conflicts: [
        {
          recordId: 'record_01',
          expectedRevision: 1,
          currentRevision: 2,
          currentValues: { field_a: 'server' },
          submittedSet: { field_a: 'local' },
          submittedUnsetFieldIds: ['field_b'],
        },
      ],
    };
    const transport = fakeTransport();
    transport.mutate.mockRejectedValueOnce(
      new LoomTableClientError(
        'conflict',
        { message: 'Conflict.', code: 'CONFLICT', httpStatus: 409 },
        undefined,
        conflict,
      ),
    );
    const { scheduler } = createScheduler([entry()], transport);

    await startReady(scheduler);

    expect(scheduler.getSnapshot().entries[0]).toMatchObject({
      state: 'conflict',
      conflict,
      lastError: { code: 'CONFLICT', httpStatus: 409 },
    });
    await scheduler.drain();
    expect(transport.mutate).toHaveBeenCalledTimes(1);
    scheduler.stop();
  });

  it('keeps IDEMPOTENCY_KEY_REUSED separate as a terminal safety error', async () => {
    const transport = fakeTransport();
    transport.mutate.mockRejectedValueOnce(
      new LoomTableClientError('conflict', {
        message: 'The mutation ID was already used with another body.',
        code: 'IDEMPOTENCY_KEY_REUSED',
        httpStatus: 409,
      }),
    );
    const { scheduler } = createScheduler([entry()], transport);

    await startReady(scheduler);

    expect(scheduler.getSnapshot().entries[0]).toMatchObject({
      state: 'terminal',
      lastError: {
        code: 'IDEMPOTENCY_KEY_REUSED',
        httpStatus: 409,
      },
    });
    await scheduler.drain();
    expect(transport.mutate).toHaveBeenCalledTimes(1);
    scheduler.stop();
  });

  it.each([
    [403, 'forbidden'],
    [404, 'not-found'],
    [413, 'server'],
    [415, 'server'],
    [422, 'validation'],
    [410, 'cursor-expired'],
    [501, 'capability'],
  ] as const)('does not retry deterministic HTTP %s errors', async (status, kind) => {
    const transport = fakeTransport();
    transport.mutate.mockRejectedValueOnce(
      new LoomTableClientError(kind, {
        message: 'Deterministic failure.',
        httpStatus: status,
      }),
    );
    const { scheduler } = createScheduler([entry()], transport);

    await startReady(scheduler);

    expect(scheduler.getSnapshot().entries[0]?.state).toBe('terminal');
    await scheduler.drain();
    expect(transport.mutate).toHaveBeenCalledTimes(1);
    scheduler.stop();
  });

  it('requeues a retryable 5xx once per durable attempt without an inner queue retry loop', async () => {
    let now = 0;
    const transport = fakeTransport();
    transport.mutate
      .mockRejectedValueOnce(
        new LoomTableClientError('server', {
          message: 'Temporary failure.',
          httpStatus: 500,
        }),
      )
      .mockResolvedValueOnce(result(MUTATION_IDS[0], 'record_01', 2));
    const { scheduler } = createScheduler([entry()], transport, () => now);

    await startReady(scheduler);
    expect(transport.mutate).toHaveBeenCalledTimes(1);
    expect(scheduler.getSnapshot().entries[0]?.state).toBe('queued');

    now = 250;
    await scheduler.drain();
    expect(transport.mutate).toHaveBeenCalledTimes(2);
    scheduler.stop();
  });
});

function createScheduler(
  entries: readonly PersistedMutationQueueEntry[],
  transport: DurableMutationQueueTransport,
  now: () => number = () => 0,
): { scheduler: MutationQueueScheduler; store: MutationQueueStore } {
  const store = new MutationQueueStore({
    schemaVersion: 1,
    entries,
  });
  return {
    store,
    scheduler: new MutationQueueScheduler({
      store,
      transport,
      now,
      random: () => 0.5,
    }),
  };
}

async function startReady(scheduler: MutationQueueScheduler): Promise<void> {
  await scheduler.setOnline(true);
  await scheduler.setAuthReady(true);
  await scheduler.start();
}

function fakeTransport(): DurableMutationQueueTransport & {
  readonly mutate: ReturnType<typeof vi.fn>;
} {
  return {
    mutate: vi.fn(async (_tableId: string, request: MutationRequest) => {
      const command = request.commands[0];
      if (command?.kind !== 'updateRecord') throw new Error('Unexpected command.');
      return result(request.clientMutationId, command.recordId, command.expectedRevision + 1);
    }),
  };
}

function result(clientMutationId: string, recordId: string, revision: number): MutationResult {
  return {
    clientMutationId,
    results: [
      {
        index: 0,
        status: 'applied',
        record: {
          id: recordId,
          tableId: 'table_01',
          revision,
          values: {},
          createdAt: '2026-08-15T00:00:00.000Z',
          updatedAt: '2026-08-15T00:00:00.000Z',
        },
      },
    ],
    changeCursor: 'change_02',
  };
}

function entry({
  id = MUTATION_IDS[0],
  recordId = 'record_01',
  value = 'local',
  state = 'queued',
  attemptCount = 0,
  nextAttemptAt,
  lastError,
  conflict,
}: {
  readonly id?: string;
  readonly recordId?: string;
  readonly value?: string;
  readonly state?: MutationQueueEntryState;
  readonly attemptCount?: number;
  readonly nextAttemptAt?: string;
  readonly lastError?: PersistedMutationQueueError;
  readonly conflict?: ConflictDetails;
} = {}): PersistedMutationQueueEntry {
  const request: {
    readonly clientMutationId: string;
    readonly commands: readonly [UpdateRecordCommand];
  } = {
    clientMutationId: id,
    commands: [
      {
        kind: 'updateRecord',
        recordId,
        expectedRevision: 1,
        set: { field_a: value },
      },
    ],
  };
  return {
    tableId: 'table_01',
    recordId,
    clientMutationId: id,
    request,
    expectedRevision: 1,
    state,
    attemptCount,
    ...(nextAttemptAt === undefined ? {} : { nextAttemptAt }),
    ...(lastError === undefined ? {} : { lastError }),
    ...(conflict === undefined ? {} : { conflict }),
    createdAt: '2026-08-15T00:00:00.000Z',
    updatedAt: '2026-08-15T00:00:00.000Z',
  };
}
