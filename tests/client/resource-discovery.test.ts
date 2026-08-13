import { describe, expect, it, vi } from 'vitest';

import { HttpLoomTableClient } from '../../src/client/http-loomtable-client';
import type { HttpTransport, HttpTransportResponse } from '../../src/client/http-transport';

describe('HttpLoomTableClient resource discovery', () => {
  it('lists workspaces through the authenticated client seam', async () => {
    const workspace = {
      id: 'ws_01',
      name: 'Personal',
      revision: 1,
      createdAt: '2026-08-14T00:00:00Z',
      updatedAt: '2026-08-14T00:00:00Z',
    };
    const transport = queuedTransport([jsonResponse(200, { items: [workspace] })]);

    await expect(createClient(transport).listWorkspaces()).resolves.toEqual([workspace]);
    expect(transport).toHaveBeenCalledWith({
      url: 'https://loom.example/v1/workspaces',
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: 'Bearer token' },
    });
  });

  it('passes parent resource identifiers and lifecycle scopes as query parameters', async () => {
    const transport = queuedTransport([
      jsonResponse(200, { items: [] }),
      jsonResponse(200, { items: [] }),
    ]);
    const client = createClient(transport);

    await client.listBases('workspace_01');
    await client.listTables('base_01', { lifecycle: 'all' });

    expect(transport).toHaveBeenNthCalledWith(1, {
      url: 'https://loom.example/v1/bases?workspaceId=workspace_01',
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: 'Bearer token' },
    });
    expect(transport).toHaveBeenNthCalledWith(2, {
      url: 'https://loom.example/v1/tables?baseId=base_01&lifecycle=all',
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: 'Bearer token' },
    });
  });

  it('encodes table identifiers and decodes Field and View unions', async () => {
    const field = {
      id: 'field_01',
      tableId: 'table/01',
      name: 'Name',
      position: 0,
      schemaVersion: 1,
      revision: 1,
      type: 'text',
      config: {},
    };
    const view = {
      id: 'view_01',
      tableId: 'table/01',
      name: 'Grid',
      type: 'grid',
      config: {
        projection: ['field_01'],
        columnOrder: ['field_01'],
        columnWidths: { field_01: 180 },
        frozenFieldIds: [],
        rowHeight: 'standard',
        sort: [],
      },
      revision: 1,
      createdAt: '2026-08-14T00:00:00Z',
      updatedAt: '2026-08-14T00:00:00Z',
    };
    const transport = queuedTransport([
      jsonResponse(200, { items: [field] }),
      jsonResponse(200, { items: [view] }),
    ]);
    const client = createClient(transport);

    await expect(client.listFields('table/01', { lifecycle: 'deleted' })).resolves.toEqual([field]);
    await expect(client.listViews('table/01')).resolves.toEqual([view]);

    expect(transport).toHaveBeenNthCalledWith(1, {
      url: 'https://loom.example/v1/tables/table%2F01/fields?lifecycle=deleted',
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: 'Bearer token' },
    });
    expect(transport).toHaveBeenNthCalledWith(2, {
      url: 'https://loom.example/v1/tables/table%2F01/views',
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: 'Bearer token' },
    });
  });

  it('rejects malformed resource lists at the transport boundary', async () => {
    const transport = queuedTransport([
      jsonResponse(200, {
        items: [{ id: 'ws_01', name: 'Missing timestamps' }],
      }),
    ]);

    await expect(createClient(transport).listWorkspaces()).rejects.toMatchObject({
      kind: 'invalid-response',
      message: 'The LoomTable Server returned an invalid workspace.',
    });
  });

  it('requires a token before making a resource request', async () => {
    const transport = queuedTransport([]);

    await expect(createClient(transport, null).listWorkspaces()).rejects.toMatchObject({
      kind: 'authentication',
      message: 'A LoomTable Server Token is required for this operation.',
    });
    expect(transport).not.toHaveBeenCalled();
  });

  it('preserves not-found errors for callers to handle as navigation state', async () => {
    const transport = queuedTransport([
      jsonResponse(404, {
        error: {
          code: 'NOT_FOUND',
          message: 'Base not found.',
          requestId: 'req_404',
        },
      }),
    ]);

    await expect(createClient(transport).listTables('base_01')).rejects.toMatchObject({
      kind: 'not-found',
      details: { httpStatus: 404, code: 'NOT_FOUND', requestId: 'req_404' },
    });
  });
});

function createClient(
  transport: HttpTransport,
  token: string | null = 'token',
): HttpLoomTableClient {
  return new HttpLoomTableClient(
    {
      serverOrigin: 'https://loom.example',
      pluginVersion: '0.1.0',
      accessToken: () => token,
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
