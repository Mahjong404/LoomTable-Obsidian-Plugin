import { describe, expect, it, vi } from 'vitest';

import { HttpLoomTableClient } from '../../src/client/http-loomtable-client';
import type { HttpTransport, HttpTransportResponse } from '../../src/client/http-transport';

describe('HttpLoomTableClient changes contract', () => {
  it('pulls a table-scoped cursor page with the published query parameters', async () => {
    const transport = queuedTransport([
      jsonResponse(200, {
        items: [
          {
            id: 'change_01',
            kind: 'recordUpdated',
            tableId: 'table/01',
            recordId: 'record_01',
            revision: 4,
            occurredAt: '2026-08-18T00:00:00Z',
          },
          {
            id: 'change_02',
            kind: 'viewChanged',
            tableId: 'table/01',
            objectId: 'view_01',
            revision: 5,
            actorId: 'actor_01',
            occurredAt: '2026-08-18T00:01:00Z',
          },
        ],
        nextCursor: 'change_02',
        hasMore: true,
      }),
    ]);

    await expect(
      createClient(transport).pullChanges('table/01', {
        cursor: 'change_00',
        limit: 50,
      }),
    ).resolves.toEqual({
      items: [
        {
          id: 'change_01',
          kind: 'recordUpdated',
          tableId: 'table/01',
          recordId: 'record_01',
          revision: 4,
          occurredAt: '2026-08-18T00:00:00Z',
        },
        {
          id: 'change_02',
          kind: 'viewChanged',
          tableId: 'table/01',
          objectId: 'view_01',
          revision: 5,
          actorId: 'actor_01',
          occurredAt: '2026-08-18T00:01:00Z',
        },
      ],
      nextCursor: 'change_02',
      hasMore: true,
    });

    expect(transport).toHaveBeenCalledWith({
      url: 'https://loom.example/v1/tables/table%2F01/changes?cursor=change_00&limit=50',
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer token',
      },
    });
  });

  it('uses the bounded default limit when starting at the current tail', async () => {
    const transport = queuedTransport([
      jsonResponse(200, {
        items: [],
        nextCursor: 'change_tail',
        hasMore: false,
      }),
    ]);

    await expect(createClient(transport).pullChanges('table_01')).resolves.toEqual({
      items: [],
      nextCursor: 'change_tail',
      hasMore: false,
    });

    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://loom.example/v1/tables/table_01/changes?limit=100',
        method: 'GET',
      }),
    );
  });

  it('maps an expired Change Cursor to a retry-from-current-state error', async () => {
    const transport = queuedTransport([
      jsonResponse(410, {
        error: {
          code: 'CURSOR_EXPIRED',
          message: 'Change Cursor expired.',
          requestId: 'req_cursor',
        },
      }),
    ]);

    await expect(
      createClient(transport).pullChanges('table_01', { cursor: 'expired' }),
    ).rejects.toMatchObject({
      kind: 'cursor-expired',
      details: { code: 'CURSOR_EXPIRED', httpStatus: 410 },
    });
  });

  it('rejects a malformed Change Page', async () => {
    const transport = queuedTransport([
      jsonResponse(200, {
        items: [],
        hasMore: true,
      }),
    ]);

    await expect(createClient(transport).pullChanges('table_01')).rejects.toMatchObject({
      kind: 'invalid-response',
      message: 'The LoomTable Server returned an invalid change page.',
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
