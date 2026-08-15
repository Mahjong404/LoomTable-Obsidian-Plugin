MethodException: 
Line |
   2 |  … t.ts' -Raw; $c = $c.Replace([char]13 + [char]10, [char]10).Replace([c …
     |                ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
     | Cannot convert argument "oldChar", with value: "
", for "Replace" to type "System.Char": "Cannot convert value "
" to type "System.Char". Error: "String must be exactly one character long.""
import { describe, expect, it, vi } from 'vitest';

import { HttpLoomTableClient } from '../../src/client/http-loomtable-client';
import type { HttpTransport, HttpTransportResponse } from '../../src/client/http-transport';

describe('HttpLoomTableClient Map contract', () => {
  it('submits the viewport contract and decodes point/cluster representation', async () => {
    const transport = queuedTransport([
      jsonResponse(200, {
        features: [
          {
            kind: 'point',
            recordId: 'record_01',
            position: { lat: 31.2, lng: 121.5 },
            primaryFieldText: 'Shanghai',
          },
          {
            kind: 'cluster',
            clusterId: 'cluster_01',
            position: { lat: 30, lng: 120 },
            bounds: { boxes: [{ west: 119, south: 29, east: 121, north: 31 }] },
            pointCount: 2,
            expansionZoom: 12,
            recordsQueryToken: 'opaque-cluster-token',
          },
        ],
        viewportRenderableRecordCount: 3,
        viewRevision: 4,
        changeCursor: 'change_01',
      }),
    ]);
    const client = createClient(transport);

    await expect(
      client.queryMap('view/01', {
        viewport: { boxes: [{ west: 119, south: 29, east: 122, north: 32 }] },
        zoom: 8,
        pixelWidth: 900,
        pixelHeight: 500,
      }),
    ).resolves.toMatchObject({
      viewportRenderableRecordCount: 3,
      features: [{ kind: 'point' }, { kind: 'cluster', pointCount: 2 }],
    });
    expect(transport).toHaveBeenCalledWith({
      url: 'https://loom.example/v1/views/view%2F01/map/query',
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        viewport: { boxes: [{ west: 119, south: 29, east: 122, north: 32 }] },
        zoom: 8,
        pixelWidth: 900,
        pixelHeight: 500,
      }),
    });
  });

  it('preserves two-box antimeridian summary bounds and validates global counts', async () => {
    const transport = queuedTransport([
      jsonResponse(200, {
        summary: {
          matchedRecordCount: 5,
          renderableRecordCount: 3,
          unlocatedRecordCount: 1,
          unrenderableRecordCount: 1,
          dataBounds: {
            boxes: [
              { west: 170, south: -10, east: 180, north: 10 },
              { west: -180, south: -8, east: -170, north: 8 },
            ],
          },
        },
        viewRevision: 4,
        changeCursor: 'change_02',
      }),
    ]);

    const result = await createClient(transport).summarizeMap('view_01');
    expect(result.summary.matchedRecordCount).toBe(5);
    expect(result.summary.dataBounds?.boxes).toContainEqual({
      west: -180,
      south: -8,
      east: -170,
      north: 8,
    });
  });

  it('uses the bounded default limit for terminal cluster Record paging', async () => {
    const transport = queuedTransport([jsonResponse(200, queryResultBody())]);

    await createClient(transport).queryMapClusterRecords('view_01', {
      clusterToken: 'cluster-token',
    });

    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://loom.example/v1/views/view_01/map/cluster-records/query',
        body: JSON.stringify({ clusterToken: 'cluster-token', limit: 100 }),
      }),
    );
  });

  it('rejects a Map response that does not represent its declared viewport count', async () => {
    const transport = queuedTransport([
      jsonResponse(200, {
        features: [
          {
            kind: 'point',
            recordId: 'record_01',
            position: { lat: 0, lng: 0 },
            primaryFieldText: 'Record',
          },
        ],
        viewportRenderableRecordCount: 2,
        viewRevision: 1,
        changeCursor: 'change_01',
      }),
    ]);

    await expect(
      createClient(transport).queryMap('view_01', {
        viewport: { boxes: [{ west: -1, south: -1, east: 1, north: 1 }] },
        zoom: 2,
        pixelWidth: 100,
        pixelHeight: 100,
      }),
    ).rejects.toMatchObject({ kind: 'invalid-response' });
  });

  it('keeps VIEW_CONFIGURATION_REQUIRED details for Map repair UI', async () => {
    const transport = queuedTransport([
      jsonResponse(422, {
        error: {
          code: 'VIEW_CONFIGURATION_REQUIRED',
          message: 'The Location Field is unavailable.',
          requestId: 'req_map_01',
          details: { viewId: 'view_01', brokenFieldIds: ['field_location'] },
        },
      }),
    ]);

    await expect(createClient(transport).summarizeMap('view_01')).rejects.toMatchObject({
      kind: 'validation',
      details: {
        code: 'VIEW_CONFIGURATION_REQUIRED',
        apiDetails: { viewId: 'view_01', brokenFieldIds: ['field_location'] },
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

function queryResultBody(): Record<string, unknown> {
  return {
    items: [
      {
        id: 'record_01',
        tableId: 'table_01',
        revision: 1,
        values: { name: 'Record' },
        createdAt: '2026-08-15T00:00:00Z',
        updatedAt: '2026-08-15T00:00:00Z',
      },
    ],
    hasMore: false,
    changeCursor: 'change_03',
    totalCount: 1,
  };
}

