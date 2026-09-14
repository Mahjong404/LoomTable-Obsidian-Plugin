import { describe, expect, it, vi } from 'vitest';

import {
  type LoomTableRecord,
  type MutationRequest,
  type MutationResult,
  type UpdateRecordCommand,
} from '../../src/client/loomtable-client';
import { type MutationQueueSettingsV2 } from '../../src/settings/mutation-queue-settings';
import {
  MutationQueueRuntime,
  UnavailableMutationQueuePort,
} from '../../src/ui/mutation-queue-runtime';
import { type DurableMutationQueueTransport } from '../../src/ui/mutation-queue-scheduler';

const MUTATION_ID = 'mut_0123456789ABCDEFGHJKMNPQRS';

describe('MutationQueueRuntime', () => {
  it('hydrates sending entries, recovers them before scheduling, and gates transport on online state', async () => {
    let persisted: unknown = {
      schemaVersion: 1,
      entries: [entry({ state: 'sending' })],
    };
    const saves: MutationQueueSettingsV2[] = [];
    const transport = fakeTransport();
    const runtime = new MutationQueueRuntime({
      load: async () => persisted,
      save: async (value) => {
        persisted = value;
        saves.push(value);
      },
      transport,
      isOnline: () => false,
      isAuthReady: () => true,
    });

    const scheduler = await requireScheduler(runtime);

    expect(scheduler.getSnapshot().entries[0]?.state).toBe('queued');
    expect(saves.at(-1)?.entries[0]?.state).toBe('queued');
    expect(transport.mutate).not.toHaveBeenCalled();

    await runtime.setOnline(true);

    expect(transport.mutate).toHaveBeenCalledTimes(1);
    expect(persisted).toMatchObject({ schemaVersion: 2, entries: [] });
    runtime.stop();
  });

  it('rejects new mutations before online/auth-ready gating without persisting an entry', async () => {
    let saveCount = 0;
    const transport = fakeTransport();
    const runtime = new MutationQueueRuntime({
      load: async () => ({ schemaVersion: 1, entries: [] }),
      save: async () => {
        saveCount += 1;
      },
      transport,
      isOnline: () => false,
      isAuthReady: () => false,
    });

    const scheduler = await requireScheduler(runtime);

    await expect(scheduler.enqueue('table_01', request())).rejects.toMatchObject({
      kind: 'validation',
    });
    await runtime.setOnline(true);
    await expect(scheduler.enqueue('table_01', request())).rejects.toMatchObject({
      kind: 'authentication',
    });
    expect(scheduler.getSnapshot().entries).toHaveLength(0);
    expect(saveCount).toBe(1);
    expect(transport.mutate).not.toHaveBeenCalled();
    runtime.stop();
  });

  it('persists a complete request before sending and preserves the returned Record for applied and unchanged results', async () => {
    const saves: MutationQueueSettingsV2[] = [];
    const returnedRecord = record(2, 'server value');
    const transport = fakeTransport({
      result: {
        clientMutationId: MUTATION_ID,
        results: [{ index: 0, status: 'unchanged', record: returnedRecord }],
        changeCursor: 'opaque-change-cursor',
      },
    });
    const runtime = new MutationQueueRuntime({
      load: async () => ({ schemaVersion: 1, entries: [] }),
      save: async (value) => {
        saves.push(value);
      },
      transport,
      isOnline: () => true,
      isAuthReady: () => true,
    });

    const scheduler = await requireScheduler(runtime);
    const result = await scheduler.enqueue('table_01', request());

    expect(result.results[0]?.status).toBe('unchanged');
    expect(result.results[0]?.record).toEqual(returnedRecord);
    expect(transport.mutate).toHaveBeenCalledWith('table_01', request());
    const queuedEntry = saves
      .flatMap((value) => value.entries)
      .find((entryValue) => entryValue.clientMutationId === MUTATION_ID);
    expect(queuedEntry).toBeDefined();
    expect(queuedEntry?.tableId).toBe('table_01');
    expect(queuedEntry?.recordId).toBe('record_01');
    expect(queuedEntry?.expectedRevision).toBe(1);
    expect(queuedEntry?.request).toEqual(request());
    expect(scheduler.getSnapshot().entries).toHaveLength(0);
    runtime.stop();
  });

  it('reuses the exact persisted request after a stopped sending attempt', async () => {
    let persisted: unknown = {
      schemaVersion: 1,
      entries: [entry({ state: 'sending' })],
    };
    let releaseFirst: (() => void) | undefined;
    let firstRequest: MutationRequest | undefined;
    const firstTransport: DurableMutationQueueTransport = {
      mutate: vi.fn(async (_tableId: string, requestValue: MutationRequest) => {
        firstRequest = requestValue;
        return new Promise<MutationResult>((resolve) => {
          releaseFirst = () => resolve(successResult(MUTATION_ID, record(2, 'first')));
        });
      }),
    };
    const firstRuntime = new MutationQueueRuntime({
      load: async () => persisted,
      save: async (value) => {
        persisted = value;
      },
      transport: firstTransport,
      isOnline: () => true,
      isAuthReady: () => false,
    });
    const firstScheduler = await requireScheduler(firstRuntime);
    const firstReady = firstRuntime.setAuthReady(true);
    await vi.waitFor(() => expect(firstRequest).toEqual(request()));
    firstRuntime.stop();
    releaseFirst?.();
    await firstReady;

    const secondTransport = fakeTransport();
    const secondRuntime = new MutationQueueRuntime({
      load: async () => persisted,
      save: async (value) => {
        persisted = value;
      },
      transport: secondTransport,
      isOnline: () => true,
      isAuthReady: () => true,
    });
    await secondRuntime.start();

    expect(secondTransport.mutate).toHaveBeenCalledWith('table_01', firstRequest);
    secondRuntime.stop();
    void firstScheduler;
  });

  it('preserves corrupt or unknown-version storage, reports recovery failure, and sends nothing', async () => {
    const stored = { schemaVersion: 99, entries: [] };
    const transport = fakeTransport();
    const runtime = new MutationQueueRuntime({
      load: async () => stored,
      save: async () => {
        throw new Error('must not overwrite corrupt storage');
      },
      transport,
      isOnline: () => true,
      isAuthReady: () => true,
    });

    const scheduler = await runtime.start();

    expect(scheduler).toBeNull();
    expect(runtime.recoveryError).toBeInstanceOf(Error);
    expect(String(runtime.recoveryError)).toMatch(/schema version/);
    expect(transport.mutate).not.toHaveBeenCalled();

    // Rejected enqueue from an unavailable port must carry the recovery failure.
    const port = new UnavailableMutationQueuePort(runtime.recoveryError);
    await expect(port.enqueue('table_01', request())).rejects.toBeInstanceOf(Error);
    expect(port.getRecordSnapshot('record_01')).toEqual({ state: 'idle', pending: 0 });
    expect(port.getOperationSnapshot(MUTATION_ID)).toEqual({ state: 'idle', pending: 0 });
    runtime.stop();
  });
});

async function requireScheduler(runtime: MutationQueueRuntime) {
  const scheduler = await runtime.start();
  if (scheduler === null) throw new Error('Expected a recovered mutation scheduler.');
  return scheduler;
}

function fakeTransport(
  options: {
    readonly result?: MutationResult;
  } = {},
): DurableMutationQueueTransport & {
  readonly mutate: ReturnType<typeof vi.fn<DurableMutationQueueTransport['mutate']>>;
} {
  return {
    mutate: vi.fn(async (_tableId: string, request: MutationRequest) => {
      return (
        options.result ??
        successResult(
          request.clientMutationId,
          record((request.commands[0] as UpdateRecordCommand).expectedRevision + 1, 'server value'),
        )
      );
    }),
  };
}

function request(): MutationRequest {
  return {
    clientMutationId: MUTATION_ID,
    commands: [
      {
        kind: 'updateRecord',
        recordId: 'record_01',
        expectedRevision: 1,
        set: { field_a: 'local' },
      },
    ],
  };
}

function successResult(clientMutationId: string, returnedRecord: LoomTableRecord): MutationResult {
  return {
    clientMutationId,
    results: [{ index: 0, status: 'applied', record: returnedRecord }],
    changeCursor: 'opaque-change-cursor',
  };
}

function record(revision: number, value: string): LoomTableRecord {
  return {
    id: 'record_01',
    tableId: 'table_01',
    revision,
    values: { field_a: value },
    createdAt: '2026-08-15T00:00:00.000Z',
    updatedAt: '2026-08-15T00:00:00.000Z',
  };
}

function entry(options: {
  readonly state: 'queued' | 'sending';
}): MutationQueueSettingsV2['entries'][number] {
  const queuedRequest = request();
  return {
    kind: 'updateRecord',
    tableId: 'table_01',
    recordId: 'record_01',
    clientMutationId: MUTATION_ID,
    request: {
      clientMutationId: queuedRequest.clientMutationId,
      commands: [queuedRequest.commands[0] as UpdateRecordCommand],
    },
    expectedRevision: 1,
    state: options.state,
    attemptCount: 0,
    createdAt: '2026-08-15T00:00:00.000Z',
    updatedAt: '2026-08-15T00:00:00.000Z',
  };
}
