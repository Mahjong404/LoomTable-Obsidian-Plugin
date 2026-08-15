import { describe, expect, it, vi } from 'vitest';

import { HttpLoomTableClient } from '../../src/client/http-loomtable-client';
import type { HttpTransport, HttpTransportResponse } from '../../src/client/http-transport';

describe('HttpLoomTableClient record query', () => {
  it('posts the published Query/Filter/Sort/Cursor contract and decodes a page', async () => {
    const record = {
      id: 'record_01',
      tableId: 'table/01',
      revision: 3,
      values: { field_name: 'Alpha', field_done: true },
      createdAt: '2026-08-14T00:00:00Z',
      updatedAt: '2026-08-14T00:00:00Z',
    };
    const transport = queuedTransport([
      jsonResponse(200, {
        items: [record],
        nextCursor: 'opaque-next',
        hasMore: true,
        changeCursor: 'change_01',
        totalCount: 10,
      }),
    ]);
    const client = createClient(transport);

    await expect(
      client.query({
        tableId: 'table/01',
        viewId: 'view_01',
        cursor: 'opaque-current',
        limit: 50,
        projection: ['field_name', 'field_done'],
        filter: {
          kind: 'group',
          operator: 'and',
          children: [
            {
              kind: 'rule',
              fieldId: 'field_name',
              operator: 'contains',
              value: 'Al',
            },
          ],
        },
        sort: [{ fieldId: 'field_name', direction: 'asc', nulls: 'last' }],
      }),
    ).resolves.toEqual({
      items: [record],
      nextCursor: 'opaque-next',
      hasMore: true,
      changeCursor: 'change_01',
      totalCount: 10,
    });

    expect(transport).toHaveBeenCalledWith({
      url: 'https://loom.example/v1/tables/table%2F01/records/query',
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        limit: 50,
        viewId: 'view_01',
        cursor: 'opaque-current',
        projection: ['field_name', 'field_done'],
        filter: {
          kind: 'group',
          operator: 'and',
          children: [
            {
              kind: 'rule',
              fieldId: 'field_name',
              operator: 'contains',
              value: 'Al',
            },
          ],
        },
        sort: [{ fieldId: 'field_name', direction: 'asc', nulls: 'last' }],
      }),
    });
  });

  it('rejects a malformed page that violates cursor pagination invariants', async () => {
    const transport = queuedTransport([
      jsonResponse(200, {
        items: [],
        hasMore: true,
        changeCursor: 'change_01',
      }),
    ]);

    await expect(createClient(transport).query({ tableId: 'table_01' })).rejects.toMatchObject({
      kind: 'invalid-response',
      message: 'The LoomTable Server returned an invalid query result.',
    });
  });

  it('maps expired Query cursors to a retry-from-first-page error', async () => {
    const transport = queuedTransport([
      jsonResponse(410, {
        error: {
          code: 'QUERY_SNAPSHOT_EXPIRED',
          message: 'Cursor expired.',
          requestId: 'req_cursor',
        },
      }),
    ]);

    await expect(
      createClient(transport).query({ tableId: 'table_01', cursor: 'expired' }),
    ).rejects.toMatchObject({
      kind: 'cursor-expired',
      details: { code: 'QUERY_SNAPSHOT_EXPIRED', httpStatus: 410 },
    });
  });
});

describe('HttpLoomTableClient record mutations', () => {
  it('posts an idempotent update command and decodes the returned Record', async () => {
    const updated = {
      id: 'record_01',
      tableId: 'table_01',
      revision: 2,
      values: { field_name: 'Updated' },
      createdAt: '2026-08-14T00:00:00Z',
      updatedAt: '2026-08-15T00:00:00Z',
    };
    const transport = queuedTransport([
      jsonResponse(200, {
        clientMutationId: 'mutation_01',
        results: [{ index: 0, status: 'applied', record: updated }],
        changeCursor: 'change_02',
      }),
    ]);
    const client = createClient(transport);

    await expect(
      client.mutate('table_01', {
        clientMutationId: 'mutation_01',
        commands: [
          {
            kind: 'updateRecord',
            recordId: 'record_01',
            expectedRevision: 1,
            set: { field_name: 'Updated' },
          },
        ],
      }),
    ).resolves.toEqual({
      clientMutationId: 'mutation_01',
      results: [{ index: 0, status: 'applied', record: updated }],
      changeCursor: 'change_02',
    });

    expect(transport).toHaveBeenCalledWith({
      url: 'https://loom.example/v1/tables/table_01/records/mutate',
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        clientMutationId: 'mutation_01',
        commands: [
          {
            kind: 'updateRecord',
            recordId: 'record_01',
            expectedRevision: 1,
            set: { field_name: 'Updated' },
          },
        ],
      }),
    });
  });

  it('keeps IDEMPOTENCY_KEY_REUSED distinguishable from a revision Conflict', async () => {
    const transport = queuedTransport([
      jsonResponse(409, {
        error: {
          code: 'IDEMPOTENCY_KEY_REUSED',
          message: 'The mutation ID was reused for another request.',
          requestId: 'req_idempotency',
        },
      }),
    ]);

    await expect(
      createClient(transport).mutate('table_01', {
        clientMutationId: 'mutation_01',
        commands: [
          { kind: 'updateRecord', recordId: 'record_01', expectedRevision: 1, set: { field: 'x' } },
        ],
      }),
    ).rejects.toMatchObject({
      kind: 'conflict',
      conflict: undefined,
      details: { code: 'IDEMPOTENCY_KEY_REUSED', requestId: 'req_idempotency' },
    });
  });

  it('decodes the published ConflictResponse details', async () => {
    const transport = queuedTransport([
      jsonResponse(409, {
        error: {
          code: 'CONFLICT',
          message: 'Revision conflict.',
          requestId: 'req_conflict',
          clientMutationId: 'mutation_01',
          failedCommandIndex: 0,
          conflicts: [
            {
              recordId: 'record_01',
              expectedRevision: 1,
              currentRevision: 2,
              currentValues: { field_name: 'Server value' },
              submittedSet: { field_name: 'Local value' },
            },
          ],
        },
      }),
    ]);

    await expect(
      createClient(transport).mutate('table_01', {
        clientMutationId: 'mutation_01',
        commands: [
          {
            kind: 'updateRecord',
            recordId: 'record_01',
            expectedRevision: 1,
            set: { field_name: 'Local value' },
          },
        ],
      }),
    ).rejects.toMatchObject({
      kind: 'conflict',
      conflict: {
        clientMutationId: 'mutation_01',
        conflicts: [
          {
            currentRevision: 2,
            currentValues: { field_name: 'Server value' },
            submittedSet: { field_name: 'Local value' },
          },
        ],
      },
    });
  });
});

function createClient(transport: HttpTransport): HttpLoomTableClient {
  return new HttpLoomTableClient(
    {
      serverOrigin: 'https://loom.example',
      pluginVersion: '0.1.0',
      accessToken: () => 'token',
    },
    transport,
    { delay: () => Promise.resolve() },
  );
}

function queuedTransport(
  responses: Array<HttpTransportResponse | Promise<HttpTransportResponse>>,
): ReturnType<typeof vi.fn<HttpTransport>> {
  return vi.fn<HttpTransport>(async () => {
    const response = responses.shift();
    if (response === undefined) throw new Error('Unexpected HTTP request.');
    return response;
  });
}

function jsonResponse(status: number, body: unknown): HttpTransportResponse {
  return { status, headers: {}, body: JSON.stringify(body) };
}
