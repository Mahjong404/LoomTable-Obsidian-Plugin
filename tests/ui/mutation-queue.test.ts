import { describe, expect, it, vi } from 'vitest';

import {
  LoomTableClientError,
  type MutationResult,
  type UpdateRecordCommand,
} from '../../src/client/loomtable-client';
import { MutationQueue, type MutationQueueJob } from '../../src/ui/mutation-queue';

describe('MutationQueue', () => {
  it('serializes mutations for one Record and uses each returned revision', async () => {
    const calls: Array<{ id: string; command: UpdateRecordCommand }> = [];
    const client = {
      mutate: vi.fn(async (_tableId: string, request: MutationRequestLike) => {
        const command = request.commands[0];
        calls.push({ id: request.clientMutationId, command });
        return result(request.clientMutationId, command.expectedRevision + 1);
      }),
    };
    const queue = new MutationQueue(client, { idFactory: idFactory() });

    await Promise.all([
      queue.enqueue(job('record_01', 'field_a', 'one')),
      queue.enqueue(job('record_01', 'field_a', 'two')),
    ]);

    expect(calls.map((call) => call.command.expectedRevision)).toEqual([1, 2]);
    expect(calls[0]?.id).not.toBe(calls[1]?.id);
  });

  it('generates a Server-compatible typed mutation ID by default', async () => {
    const client = {
      mutate: vi.fn(async (_tableId: string, request: MutationRequestLike) =>
        result(request.clientMutationId, 2),
      ),
    };
    const queue = new MutationQueue(client);

    await queue.enqueue(job('record_01', 'field_a', 'one'));

    expect(client.mutate.mock.calls[0]?.[1].clientMutationId).toMatch(
      /^mut_[0-9A-HJKMNP-TV-Z]{26}$/,,
    );
  });

  it('runs different Record queues in parallel', async () => {
    const gates = new Map<string, () => void>();
    const started = new Set<string>();
    const client = {
      mutate: vi.fn(
        (_tableId: string, request: MutationRequestLike) =>
          new Promise<MutationResult>((resolve) => {
            const recordId = request.commands[0].recordId;
            started.add(recordId);
            gates.set(recordId, () => resolve(result(request.clientMutationId, 2, recordId)));
          }),
      ),
    };
    const queue = new MutationQueue(client, { idFactory: idFactory() });
    const first = queue.enqueue(job('record_01', 'field_a', 'one'));
    const second = queue.enqueue(job('record_02', 'field_a', 'two'));
    await Promise.resolve();
    await Promise.resolve();

    expect(started).toEqual(new Set(['record_01', 'record_02']));
    gates.get('record_01')?.();
    gates.get('record_02')?.();
    await Promise.all([first, second]);
  });

  it('retries a network failure with the same idempotency mutation ID', async () => {
    const client = {
      mutate: vi.fn<(tableId: string, request: MutationRequestLike) => Promise<MutationResult>>(),
    };
    client.mutate
      .mockRejectedValueOnce(new LoomTableClientError('network', { message: 'offline' }))
      .mockImplementationOnce(async (_tableId, request) => result(request.clientMutationId, 2));
    const queue = new MutationQueue(client, { idFactory: idFactory(), maxNetworkAttempts: 2 });

    await queue.enqueue(job('record_01', 'field_a', 'one'));

    expect(client.mutate).toHaveBeenCalledTimes(2);
    expect(client.mutate.mock.calls[0]?.[1].clientMutationId).toBe(
      client.mutate.mock.calls[1]?.[1].clientMutationId,
    );
  });

  it('pauses one Record on conflict and retries with the current revision after overwrite', async () => {
    const calls: MutationRequestLike[] = [];
    const conflict = new LoomTableClientError(
      'conflict',
      { message: 'Conflict', code: 'CONFLICT' },
      undefined,
      {
        clientMutationId: 'mutation_01',
        failedCommandIndex: 0,
        conflicts: [
          {
            recordId: 'record_01',
            expectedRevision: 1,
            currentRevision: 2,
            currentValues: { field_a: 'server' },
            submittedSet: { field_a: 'local' },
          },
        ],
      },
    );
    const client = {
      mutate: vi.fn(async (_tableId: string, request: MutationRequestLike) => {
        calls.push(request);
        if (calls.length === 1) throw conflict;
        return result(request.clientMutationId, 3);
      }),
    };
    const queue = new MutationQueue(client, { idFactory: idFactory() });
    const first = queue.enqueue(job('record_01', 'field_a', 'local'));
    await expect(first).rejects.toMatchObject({ kind: 'conflict' });
    const second = queue.enqueue(job('record_01', 'field_a', 'later'));
    expect(queue.getSnapshot('record_01').state).toBe('conflict');

    queue.resolveConflict('record_01', 'retry', 2);
    await expect(second).resolves.toBeDefined();
    expect(calls[1]?.commands[0].expectedRevision).toBe(2);
    expect(calls[1]?.clientMutationId).not.toBe(calls[0]?.clientMutationId);
  });
});

interface MutationRequestLike {
  readonly clientMutationId: string;
  readonly commands: readonly [UpdateRecordCommand];
}

function idFactory(): () => string {
  let index = 0;
  return () => `mutation_test_${++index}`;
}

function job(recordId: string, fieldId: string, value: string): MutationQueueJob {
  return {
    tableId: 'table_01',
    recordId,
    initialRevision: 1,
    buildCommand: (expectedRevision) => ({
      kind: 'updateRecord',
      recordId,
      expectedRevision,
      set: { [fieldId]: value },
    }),
  };
}

function result(
  clientMutationId: string,
  revision: number,
  recordId = 'record_01',
): MutationResult {
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
          createdAt: '2026-08-15T00:00:00Z',
          updatedAt: '2026-08-15T00:00:00Z',
        },
      },
    ],
    changeCursor: 'change_02',
  };
}
