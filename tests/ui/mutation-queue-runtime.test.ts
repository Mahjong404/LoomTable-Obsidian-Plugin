import { describe, expect, it, vi } from 'vitest';

import {
  type LoomTableRecord,
  type MutationRequest,
  type MutationResult,
  type UpdateRecordCommand,
} from '../../src/client/loomtable-client';
import {
  MutationQueueStore,
  type MutationQueueSettingsV1,
} from '../../src/settings/mutation-queue-settings';
import { MutationQueueRuntime } from '../../src/ui/mutation-queue-runtime';
import { type DurableMutationQueueTransport } from '../../src/ui/mutation-queue-scheduler';

const MUTATION_ID = 'mut_0123456789ABCDEFGHJKMNPQRS';

describe('MutationQueueRuntime', () => {
  it('hydrates sending entries, recovers them before scheduling, and gates transport on online state', async () => {
    let persisted: unknown = {
      schemaVersion: 1,
      entries: [entry({ state: 'sending' })],
    };
    const saves: MutationQueueSettingsV1[] = [];
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

    const scheduler = await runtime.start();

    expect(scheduler.getSnapshot().entries[0]?.state).toBe('queued');
    expect(saves.at(-1)?.entries[0]?.state).toBe('queued');
    expect(transport.mutate).not.toHaveBeenCalled();

    await runtime.setOnline(true);

    expect(transport.mutate).toHaveBeenCalledTimes(1);
    expect(persisted).toMatchObject({ schemaVersion: 1, entries: [] });
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

    const scheduler = await runtime.start();

    await expect(scheduler.enqueue('table_01', request())).rejects.toMatchObject({
      kind: 'authentication',
    });
    expect(scheduler.getSnapshot().entries).toHaveLength(0);
    expect(saveCount).toBe(1);
    expect(transport.mutate).not.toHaveBeenCalled();
    runtime.stop();
  });

  it('persists a complete request before sending and preserves the returned Record for applied and unchanged results', async () => {
    const saves: MutationQueueSettingsV1[] = [];
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

    const scheduler = await runtime.start();
    const result = await scheduler.enqueue('table_01', request());

    expect(result.results[0]?.status).toBe('unchanged');
    expect(result.results[0]?.record).toEqual(returnedRecord);
    expect(transport.mutate).toHaveBeenCalledWith('table_01', request());
    expect(saves.some((value) => value.entries[0]?.request === request())).toBe(false);
    expect(saves.some((value) => value.entries[0]?.clientMutationId === MUTATION_ID)).toBe(true);
    expect(scheduler.getSnapshot().entries).toHaveLength(0);
    runtime.stop();
  });

  it('reuses the exact persisted request after a stopped sending attempt', async () => {
    let persisted: unknown = {
      schemaVersion: 1,
      entries: [entry({ state: 'sending' })],
    };
    let releaseFirst: (() => void) | undefined;
    const firstTransport: DurableMutationQueueTransport = {
      mutate: vi.fn(
        () =>
          new Promise<MutationResult>((resolve) => {
            releaseFirst = () => resolve(successResult(MUTATION_ID, record(2, 'first')));
          }),
      ),
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
    const firstScheduler = await firstRuntime.start();
    const firstReady = firstRuntime.setAuthReady(true);
    await vi.waitFor(() => expect(firstTransport.mutate).toHaveBeenCalledTimes(1));
    const firstRequest = firstTransport.mutate.mock.calls[0]?.[1];
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
});

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
}): MutationQueueSettingsV1['entries'][number] {
  const queuedRequest = request();
  return {
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
