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

describe('HttpLoomTableClient history contract', () => {
  it('pulls a filtered history page with field diffs', async () => {
    const transport = queuedTransport([
      jsonResponse(200, {
        items: [
          {
            id: 'ch_01',
            kind: 'recordUpdated',
            tableId: 'table_01',
            recordId: 'record_01',
            revision: 4,
            actorId: 'actor_01',
            occurredAt: '2026-09-20T10:00:00Z',
            primaryFieldText: 'Alpha',
            fields: [{ fieldId: 'field_name', before: 'A', after: 'Alpha' }],
          },
          {
            id: 'ch_02',
            kind: 'recordMoved',
            tableId: 'table_01',
            recordId: 'record_02',
            revision: 7,
            occurredAt: '2026-09-20T09:00:00Z',
          },
        ],
        nextCursor: 'hist_02',
        hasMore: true,
        changeCursor: 'change_02',
      }),
    ]);

    await expect(
      createClient(transport).pullHistory('table_01', {
        kind: 'recordUpdated',
        recordId: 'record_01',
        limit: 25,
      }),
    ).resolves.toEqual({
      items: [
        {
          id: 'ch_01',
          kind: 'recordUpdated',
          tableId: 'table_01',
          recordId: 'record_01',
          revision: 4,
          actorId: 'actor_01',
          occurredAt: '2026-09-20T10:00:00Z',
          primaryFieldText: 'Alpha',
          fields: [{ fieldId: 'field_name', before: 'A', after: 'Alpha' }],
        },
        {
          id: 'ch_02',
          kind: 'recordMoved',
          tableId: 'table_01',
          recordId: 'record_02',
          revision: 7,
          occurredAt: '2026-09-20T09:00:00Z',
        },
      ],
      nextCursor: 'hist_02',
      hasMore: true,
      changeCursor: 'change_02',
    });

    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://loom.example/v1/tables/table_01/history?recordId=record_01&kind=recordUpdated&limit=25',
        method: 'GET',
      }),
    );
  });

  it('maps an expired history cursor to the cursor-expired error', async () => {
    const transport = queuedTransport([
      jsonResponse(410, {
        error: {
          code: 'CURSOR_EXPIRED',
          message: 'History cursor expired.',
          requestId: 'req_hist',
        },
      }),
    ]);

    await expect(
      createClient(transport).pullHistory('table_01', { cursor: 'expired' }),
    ).rejects.toMatchObject({
      kind: 'cursor-expired',
      details: { code: 'CURSOR_EXPIRED', httpStatus: 410 },
    });
  });
});

describe('HttpLoomTableClient field conversion contract', () => {
  it('previews a conversion and returns modes with stats', async () => {
    const transport = queuedTransport([
      jsonResponse(200, {
        supported: true,
        totalRecords: 12,
        previewToken: 'tok_1',
        modes: [
          {
            id: 'strict',
            label: 'Strict',
            stats: { ok: 10, lossy: 1, lost: 1, empty: 0 },
          },
          {
            id: 'options',
            label: 'Create options',
            disabled: true,
            reason: 'Too many distinct values.',
            stats: { ok: 0, lossy: 0, lost: 0, empty: 0, distinctValues: 600, newOptions: 600 },
          },
        ],
      }),
    ]);

    await expect(
      createClient(transport).previewFieldConversion('field_01', 'select'),
    ).resolves.toEqual({
      supported: true,
      totalRecords: 12,
      previewToken: 'tok_1',
      modes: [
        { id: 'strict', label: 'Strict', stats: { ok: 10, lossy: 1, lost: 1, empty: 0 } },
        {
          id: 'options',
          label: 'Create options',
          disabled: true,
          reason: 'Too many distinct values.',
          stats: { ok: 0, lossy: 0, lost: 0, empty: 0, distinctValues: 600, newOptions: 600 },
        },
      ],
    });

    expect(transport).toHaveBeenCalledWith({
      url: 'https://loom.example/v1/fields/field_01/convert-preview',
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ type: 'select' }),
    });
  });

  it('converts a Field with mode, revision, and preview token', async () => {
    const transport = queuedTransport([
      jsonResponse(200, {
        field: {
          id: 'field_01',
          tableId: 'table_01',
          name: 'Name',
          position: 0,
          schemaVersion: 2,
          revision: 2,
          type: 'select',
          config: { options: [], deletedOptions: [] },
        },
        stats: { ok: 10, lossy: 1, lost: 1, empty: 0 },
      }),
    ]);

    await expect(
      createClient(transport).convertField('field_01', {
        type: 'select',
        mode: 'strict',
        expectedRevision: 1,
        previewToken: 'tok_1',
      }),
    ).resolves.toMatchObject({
      field: { id: 'field_01', type: 'select', revision: 2 },
      stats: { ok: 10, lossy: 1, lost: 1, empty: 0 },
    });

    expect(transport).toHaveBeenCalledWith({
      url: 'https://loom.example/v1/fields/field_01/convert',
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'select',
        mode: 'strict',
        expectedRevision: 1,
        previewToken: 'tok_1',
      }),
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
