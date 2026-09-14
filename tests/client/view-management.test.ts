import { describe, expect, it, vi } from 'vitest';

import { HttpLoomTableClient } from '../../src/client/http-loomtable-client';
import type { HttpTransport, HttpTransportResponse } from '../../src/client/http-transport';
import type { GridViewConfig } from '../../src/client/loomtable-client';

const GRID_CONFIG: GridViewConfig = {
  projection: ['field_name'],
  columnOrder: ['field_name'],
  columnWidths: { field_name: 200 },
  frozenFieldIds: ['field_name'],
  rowHeight: 'standard',
  filter: {
    kind: 'rule',
    fieldId: 'field_name',
    operator: 'contains',
    value: 'a',
  },
  sort: [{ fieldId: 'field_name', direction: 'asc', nulls: 'last' }],
};

const INITIAL_GRID_CONFIG: GridViewConfig = {
  projection: ['field_name'],
  columnOrder: ['field_name'],
  columnWidths: {},
  frozenFieldIds: [],
  rowHeight: 'standard',
  sort: [],
};

const GRID_VIEW = {
  id: 'view_grid',
  tableId: 'table_01',
  name: 'Board',
  type: 'grid',
  config: GRID_CONFIG,
  revision: 2,
  createdAt: '2026-08-14T00:00:00Z',
  updatedAt: '2026-08-14T01:00:00Z',
};

describe('HttpLoomTableClient View management', () => {
  it('gets a single View including soft-deleted tombstones', async () => {
    const transport = queuedTransport([
      jsonResponse(200, { ...GRID_VIEW, deletedAt: '2026-08-15T00:00:00Z' }),
    ]);
    const client = createClient(transport);

    const view = await client.getView('view_grid');

    expect(transport).toHaveBeenCalledWith({
      url: 'https://loom.example/v1/views/view_grid',
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: 'Bearer token' },
    });
    expect(view).toMatchObject({
      id: 'view_grid',
      type: 'grid',
      revision: 2,
      deletedAt: '2026-08-15T00:00:00Z',
      config: { rowHeight: 'standard' },
    });
  });

  it('creates a Grid View with the idempotency header and typed config body', async () => {
    const transport = queuedTransport([jsonResponse(201, GRID_VIEW)]);
    const client = createClient(transport);

    const view = await client.createView(
      'table_01',
      { name: 'Board', type: 'grid', config: INITIAL_GRID_CONFIG },
      'mut_01JFH2N7X0G0G0G0G0G0G0G0G0',
    );

    expect(transport).toHaveBeenCalledWith({
      url: 'https://loom.example/v1/tables/table_01/views',
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer token',
        'Content-Type': 'application/json',
        'Idempotency-Key': 'mut_01JFH2N7X0G0G0G0G0G0G0G0G0',
      },
      body: JSON.stringify({
        name: 'Board',
        type: 'grid',
        config: INITIAL_GRID_CONFIG,
      }),
    });
    expect(view).toMatchObject({ id: 'view_grid', type: 'grid', revision: 2 });
  });

  it('creates a Map View with the Location Field configuration', async () => {
    const transport = queuedTransport([
      jsonResponse(201, {
        ...GRID_VIEW,
        id: 'view_map',
        type: 'map',
        config: { locationFieldId: 'field_location' },
      }),
    ]);
    const client = createClient(transport);

    const view = await client.createView(
      'table_01',
      { name: 'Map', type: 'map', config: { locationFieldId: 'field_location' } },
      'mut_01JFH2N7X0G0G0G0G0G0G0G0G0',
    );

    expect(transport).toHaveBeenCalledWith({
      url: 'https://loom.example/v1/tables/table_01/views',
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer token',
        'Content-Type': 'application/json',
        'Idempotency-Key': 'mut_01JFH2N7X0G0G0G0G0G0G0G0G0',
      },
      body: JSON.stringify({
        name: 'Map',
        type: 'map',
        config: { locationFieldId: 'field_location' },
      }),
    });
    expect(view).toMatchObject({
      id: 'view_map',
      type: 'map',
      config: { locationFieldId: 'field_location' },
    });
  });

  it('normalizes and validates the View name before sending a request', async () => {
    const transport = queuedTransport([jsonResponse(201, GRID_VIEW)]);
    const client = createClient(transport);

    await client.createView(
      'table_01',
      { name: '  Cafe\u0301 Board  ', type: 'grid', config: INITIAL_GRID_CONFIG },
      'mut_01JFH2N7X0G0G0G0G0G0G0G0G0',
    );
    const rawBody = transport.mock.calls[0]?.[0].body;
    const firstBody = JSON.parse(typeof rawBody === 'string' ? rawBody : '{}') as {
      name: string;
    };
    expect(firstBody.name).toBe('Café Board');

    for (const name of ['', '   ', 'bad\u0007name', 'x'.repeat(201)]) {
      await expect(
        client.createView(
          'table_01',
          { name, type: 'grid', config: INITIAL_GRID_CONFIG },
          'mut_01JFH2N7X0G0G0G0G0G0G0G0G0',
        ),
      ).rejects.toMatchObject({ kind: 'validation' });
    }
    await expect(
      client.createView(
        '',
        { name: 'Board', type: 'grid', config: INITIAL_GRID_CONFIG },
        'mut_01JFH2N7X0G0G0G0G0G0G0G0G0',
      ),
    ).rejects.toMatchObject({ kind: 'validation' });
    await expect(
      client.createView(
        'table_01',
        { name: 'Board', type: 'grid', config: INITIAL_GRID_CONFIG },
        '   ',
      ),
    ).rejects.toMatchObject({ kind: 'validation' });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('maps idempotency-key reuse to a distinguishable conflict', async () => {
    const transport = queuedTransport([
      jsonResponse(409, {
        error: {
          code: 'IDEMPOTENCY_KEY_REUSED',
          message: 'The key was already used with another request.',
          requestId: 'req_reuse',
        },
      }),
    ]);
    const client = createClient(transport);

    await expect(
      client.createView(
        'table_01',
        { name: 'Board', type: 'grid', config: INITIAL_GRID_CONFIG },
        'mut_01JFH2N7X0G0G0G0G0G0G0G0G0',
      ),
    ).rejects.toMatchObject({
      kind: 'conflict',
      details: { code: 'IDEMPOTENCY_KEY_REUSED', httpStatus: 409 },
    });
  });

  it('deletes a View without decoding the empty 204 body', async () => {
    const transport = queuedTransport([{ status: 204, headers: {}, body: '' }]);
    const client = createClient(transport);

    await expect(client.deleteView('view_grid', 2)).resolves.toBeUndefined();

    expect(transport).toHaveBeenCalledWith({
      url: 'https://loom.example/v1/views/view_grid?expectedRevision=2',
      method: 'DELETE',
      headers: { Accept: 'application/json', Authorization: 'Bearer token' },
    });
  });

  it('validates the View id and expected revision before deleting', async () => {
    const transport = queuedTransport([]);
    const client = createClient(transport);

    await expect(client.deleteView('', 1)).rejects.toMatchObject({ kind: 'validation' });
    await expect(client.deleteView('view_grid', 0)).rejects.toMatchObject({
      kind: 'validation',
    });
    await expect(client.deleteView('view_grid', 1.5)).rejects.toMatchObject({
      kind: 'validation',
    });
    expect(transport).not.toHaveBeenCalled();
  });

  it('restores a View with the expected revision body', async () => {
    const transport = queuedTransport([jsonResponse(200, GRID_VIEW)]);
    const client = createClient(transport);

    const view = await client.restoreView('view_grid', 3);

    expect(transport).toHaveBeenCalledWith({
      url: 'https://loom.example/v1/views/view_grid/restore',
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ expectedRevision: 3 }),
    });
    expect(view).toMatchObject({ id: 'view_grid', revision: 2 });
  });

  it('normalizes a rename while keeping a full config replacement body', async () => {
    const transport = queuedTransport([jsonResponse(200, GRID_VIEW)]);
    const client = createClient(transport);

    await client.updateView('view_grid', {
      type: 'grid',
      expectedRevision: 2,
      name: '  Renamed  ',
      config: GRID_CONFIG,
    });

    expect(transport).toHaveBeenCalledWith({
      url: 'https://loom.example/v1/views/view_grid',
      method: 'PATCH',
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'grid',
        expectedRevision: 2,
        name: 'Renamed',
        config: GRID_CONFIG,
      }),
    });
  });

  it('rejects malformed View payloads instead of decoding partial data', async () => {
    const transport = queuedTransport([jsonResponse(200, { id: 'view_grid' })]);
    const client = createClient(transport);

    await expect(client.getView('view_grid')).rejects.toMatchObject({
      kind: 'invalid-response',
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
