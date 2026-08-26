import { describe, expect, it, vi } from 'vitest';

import {
  LoomTableClientError,
  type Field,
  type LoomTableClient,
  type LoomTableRecord,
  type MapQueryResult,
  type MapSummaryResult,
  type View,
} from '../../src/client/loomtable-client';
import { TileProviderRegistry } from '../../src/maps/providers/tile-provider-registry';
import type { TileCredentialReader } from '../../src/maps/providers/tile-provider-schema';
import type {
  MapCamera,
  MapRenderer,
  MapRendererEventListener,
  MapRendererError,
} from '../../src/maps/renderer/map-renderer';
import { MapViewController } from '../../src/views/map/map-view-controller';

describe('MapViewController', () => {
  it('enters configuration-required without silently choosing another Location Field', async () => {
    const summarizeMap = vi.fn();
    const client = createClient({ summarizeMap });
    const view = createMapView('field_missing');
    const controller = createController(client, view, [createField('field_other')]);

    await controller.load();

    expect(controller.state.dataStatus).toBe('configuration-required');
    expect(controller.state.error).toMatchObject({
      code: 'VIEW_CONFIGURATION_REQUIRED',
      apiDetails: { viewId: 'view_map', brokenFieldIds: ['field_missing'] },
    });
    expect(summarizeMap).not.toHaveBeenCalled();
  });

  it('keeps the tile configuration state independent from Map data state', async () => {
    const client = createClient();
    const renderer = new FakeRenderer();
    const controller = createController(
      client,
      createMapView('field_location'),
      [createField('field_location')],
      { renderer, provider: { kind: 'built-in', id: 'tianditu-vector' } },
    );

    await controller.load();

    expect(controller.state.tileStatus).toBe('configuration-required');
    expect(controller.state.dataStatus).toBe('ready');
    expect(controller.state.tileError).toMatchObject({
      kind: 'configuration-required',
      credentialSlotId: 'tianditu-token',
    });
    expect(controller.state.tileError).toMatchObject({ providerId: 'tianditu-vector' });
    expect(renderer.tilePlans[0]?.layers).toEqual([]);
  });

  it('keeps the tile plan ready state separate from first-batch loading', async () => {
    const renderer = new FakeRenderer();
    const controller = createController(
      createClient(),
      createMapView('field_location'),
      [createField('field_location')],
      { renderer },
    );
    controller.mount(document.createElement('div'));

    await controller.load();

    expect(controller.state.tilePlanStatus).toBe('ready');
    expect(controller.state.tileStatus).toBe('loading');
    renderer.emitTileReady('osm-standard');
    expect(controller.state.tileStatus).toBe('ready');
  });

  it('surfaces tile errors and zero-sized renderer diagnostics without claiming ready', async () => {
    const renderer = new FakeRenderer();
    const controller = createController(
      createClient(),
      createMapView('field_location'),
      [createField('field_location')],
      { renderer },
    );
    controller.mount(document.createElement('div'));
    await controller.load();

    renderer.emitTileError({ kind: 'tile', message: 'CSP blocked tiles' });
    expect(controller.state.tileStatus).toBe('error');
    expect(controller.state.tileError?.message).toBe('CSP blocked tiles');
    renderer.emitSize({ width: 0, height: 0 });
    expect(controller.state.tileError?.message).toContain('zero size');
  });

  it('does not send Map data requests while the client is offline', async () => {
    const summarizeMap = vi.fn();
    const client = createClient({ summarizeMap });
    const controller = createController(
      client,
      createMapView('field_location'),
      [createField('field_location')],
      { isOffline: () => true },
    );

    await controller.load();

    expect(controller.state.dataStatus).toBe('offline');
    expect(summarizeMap).not.toHaveBeenCalled();
  });

  it('discards a late viewport response after a newer request starts', async () => {
    const first = deferred<MapQueryResult>();
    const second = deferred<MapQueryResult>();
    const client = createClient({
      queryMap: vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise),
    });
    const renderer = new FakeRenderer();
    const controller = createController(
      client,
      createMapView('field_location'),
      [createField('field_location')],
      { renderer },
    );

    const firstRequest = controller.refreshCurrentViewport();
    const secondRequest = controller.refreshCurrentViewport();
    first.resolve(queryResult('record_old', 1));
    second.resolve(queryResult('record_new', 1));
    await Promise.all([firstRequest, secondRequest]);

    expect(controller.state.features).toEqual(queryResult('record_new', 1).features);
    expect(renderer.features).toEqual(queryResult('record_new', 1).features);
  });

  it('debounces camera changes and queries with the latest camera', async () => {
    vi.useFakeTimers();
    try {
      const queryMap = vi.fn().mockResolvedValue(queryResult('record_01', 1));
      const client = createClient({ queryMap });
      const renderer = new FakeRenderer();
      const controller = createController(
        client,
        createMapView('field_location'),
        [createField('field_location')],
        { renderer, debounceMs: 50 },
      );
      controller.mount(document.createElement('div'));

      renderer.emitCamera({ center: { lat: 10, lng: 20 }, zoom: 5 });
      renderer.emitCamera({ center: { lat: 11, lng: 21 }, zoom: 6 });
      await vi.advanceTimersByTimeAsync(49);
      expect(queryMap).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);

      expect(queryMap).toHaveBeenCalledTimes(1);
      expect(queryMap).toHaveBeenCalledWith('view_map', expect.objectContaining({ zoom: 6 }));
    } finally {
      vi.useRealTimers();
    }
  });

  it('opens a Point by Record ID and pages a terminal Cluster token', async () => {
    const record = createRecord('record_01');
    const onRecordSelected = vi.fn();
    const onClusterRecords = vi.fn();
    const getRecord = vi.fn().mockResolvedValue(record);
    const queryMapClusterRecords = vi.fn().mockResolvedValue({
      items: [record],
      hasMore: false,
      changeCursor: 'change_cluster',
    });
    const client = createClient({
      getRecord,
      queryMap: vi.fn().mockResolvedValue(queryResult('record_01', 1)),
      queryMapClusterRecords,
    });
    const renderer = new FakeRenderer();
    const controller = createController(
      client,
      createMapView('field_location'),
      [createField('field_location')],
      { renderer, onRecordSelected, onClusterRecords },
    );
    await controller.refreshCurrentViewport();

    await controller.openRecord('record_01');
    expect(getRecord).toHaveBeenCalledWith('record_01');
    expect(onRecordSelected).toHaveBeenCalledWith(record);

    await controller.openCluster('cluster_01');
    expect(queryMapClusterRecords).toHaveBeenCalledWith('view_map', {
      clusterToken: 'cluster_token',
    });
    expect(onClusterRecords).toHaveBeenCalledWith([record]);
  });

  it('stores the latest Map cursor and revalidates before an explicit refresh', async () => {
    const summarizeMap = vi.fn().mockResolvedValue(summaryResult());
    const pullChanges = vi.fn().mockResolvedValue({
      items: [
        {
          id: 'change_02',
          kind: 'recordUpdated',
          tableId: 'table_01',
          recordId: 'record_01',
          revision: 2,
          occurredAt: '2026-08-18T00:00:00Z',
        },
      ],
      nextCursor: 'change_02',
      hasMore: false,
    });
    const queryMap = vi.fn().mockResolvedValue(queryResult('record_new', 1));
    const client = createClient({ summarizeMap, pullChanges, queryMap });
    const controller = createController(client, createMapView('field_location'), [
      createField('field_location'),
    ]);

    await controller.load();
    expect(controller.state.changeCursor).toBe('change_query');
    expect(controller.state.viewRevision).toBe(1);
    pullChanges.mockClear();
    queryMap.mockClear();

    await controller.refreshCurrentViewport();

    expect(pullChanges).toHaveBeenCalledWith('table_01', { cursor: 'change_query' });
    expect(queryMap).toHaveBeenCalledTimes(1);
    expect(summarizeMap).toHaveBeenCalledTimes(2);
    expect(controller.state.changeCursor).toBe('change_query');
    expect(controller.state.viewRevision).toBe(1);
  });

  it('refreshes Summary after a record change invalidates Map statistics', async () => {
    const initialSummary: MapSummaryResult = {
      ...summaryResult('change_initial'),
      summary: {
        ...summaryResult('change_initial').summary,
        matchedRecordCount: 3,
        renderableRecordCount: 1,
        unlocatedRecordCount: 2,
      },
    };
    const refreshedSummary: MapSummaryResult = {
      ...summaryResult('change_after_mutation'),
      summary: {
        ...summaryResult('change_after_mutation').summary,
        matchedRecordCount: 3,
        renderableRecordCount: 2,
        unlocatedRecordCount: 1,
      },
    };
    const summarizeMap = vi
      .fn()
      .mockResolvedValueOnce(initialSummary)
      .mockResolvedValueOnce(refreshedSummary);
    const pullChanges = vi.fn().mockResolvedValue({
      items: [
        {
          id: 'change_after_mutation',
          kind: 'recordUpdated',
          tableId: 'table_01',
          recordId: 'record_01',
          revision: 2,
          occurredAt: '2026-08-18T00:00:00Z',
        },
      ],
      nextCursor: 'change_after_mutation',
      hasMore: false,
    });
    const initialQuery = { ...queryResult('record_old', 1), changeCursor: 'change_initial' };
    const refreshedQuery = {
      ...queryResult('record_new', 1),
      changeCursor: 'change_after_mutation',
    };
    const queryMap = vi
      .fn()
      .mockResolvedValueOnce(initialQuery)
      .mockResolvedValueOnce(refreshedQuery);
    const controller = createController(
      createClient({ summarizeMap, pullChanges, queryMap }),
      createMapView('field_location'),
      [createField('field_location')],
    );

    await controller.load();
    await controller.refreshCurrentViewport();

    expect(summarizeMap).toHaveBeenCalledTimes(2);
    expect(queryMap).toHaveBeenCalledTimes(2);
    expect(pullChanges).toHaveBeenCalledWith('table_01', { cursor: 'change_initial' });
    expect(controller.state.summary).toMatchObject({
      matchedRecordCount: 3,
      renderableRecordCount: 2,
      unlocatedRecordCount: 1,
    });
  });

  it('does not rebuild Summary for an unrelated schema change', async () => {
    const summarizeMap = vi.fn().mockResolvedValue(summaryResult('change_summary'));
    const pullChanges = vi.fn().mockResolvedValue({
      items: [
        {
          id: 'change_schema',
          kind: 'schemaChanged',
          tableId: 'table_01',
          revision: 2,
          occurredAt: '2026-08-18T00:00:00Z',
        },
      ],
      nextCursor: 'change_schema',
      hasMore: false,
    });
    const queryMap = vi.fn().mockResolvedValue(queryResult('record_new', 1));
    const controller = createController(
      createClient({ summarizeMap, pullChanges, queryMap }),
      createMapView('field_location'),
      [createField('field_location')],
    );

    await controller.load();
    await controller.refreshCurrentViewport();

    expect(summarizeMap).toHaveBeenCalledTimes(1);
    expect(queryMap).toHaveBeenCalledTimes(2);
  });

  it('keeps Summary and Query calls separate for load, camera movement, refresh, and fit-all', async () => {
    vi.useFakeTimers();
    try {
      const summarizeMap = vi.fn().mockResolvedValue(summaryResult());
      const queryMap = vi.fn().mockResolvedValue(queryResult('record_01', 1));
      const pullChanges = vi.fn().mockResolvedValue({
        items: [],
        nextCursor: 'change_tail',
        hasMore: false,
      });
      const renderer = new FakeRenderer();
      const controller = createController(
        createClient({ summarizeMap, queryMap, pullChanges }),
        createMapView('field_location'),
        [createField('field_location')],
        { renderer, debounceMs: 25 },
      );
      controller.mount(document.createElement('div'));

      await controller.load();
      expect(summarizeMap).toHaveBeenCalledTimes(1);
      expect(queryMap).toHaveBeenCalledTimes(1);

      renderer.emitCamera({ center: { lat: 10, lng: 20 }, zoom: 6 });
      await vi.advanceTimersByTimeAsync(25);
      expect(summarizeMap).toHaveBeenCalledTimes(1);
      expect(queryMap).toHaveBeenCalledTimes(2);

      await controller.refreshCurrentViewport();
      expect(pullChanges).toHaveBeenCalledWith('table_01', { cursor: 'change_query' });
      expect(summarizeMap).toHaveBeenCalledTimes(1);
      expect(queryMap).toHaveBeenCalledTimes(3);

      await controller.fitAll();
      expect(summarizeMap).toHaveBeenCalledTimes(2);
      expect(queryMap).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('refreshes Summary when the current saved Map View changes', async () => {
    const summarizeMap = vi
      .fn()
      .mockResolvedValueOnce(summaryResult('change_summary'))
      .mockResolvedValueOnce(summaryResult('change_view'));
    const pullChanges = vi.fn().mockResolvedValue({
      items: [
        {
          id: 'change_view',
          kind: 'viewChanged',
          tableId: 'table_01',
          objectId: 'view_map',
          revision: 2,
          occurredAt: '2026-08-18T00:00:00Z',
        },
      ],
      nextCursor: 'change_view',
      hasMore: false,
    });
    const queryMap = vi.fn().mockResolvedValue(queryResult('record_new', 1));
    const controller = createController(
      createClient({ summarizeMap, pullChanges, queryMap }),
      createMapView('field_location'),
      [createField('field_location')],
    );

    await controller.load();
    await controller.refreshCurrentViewport();

    expect(summarizeMap).toHaveBeenCalledTimes(2);
    expect(queryMap).toHaveBeenCalledTimes(2);
    expect(controller.state.changeCursor).toBe('change_query');
  });

  it('rebuilds the Map baseline after the table Change Cursor expires', async () => {
    const summarizeMap = vi
      .fn()
      .mockResolvedValueOnce(summaryResult('change_summary'))
      .mockResolvedValueOnce(summaryResult('change_rebased'));
    const pullChanges = vi.fn().mockRejectedValue(
      new LoomTableClientError('cursor-expired', {
        code: 'CURSOR_EXPIRED',
        httpStatus: 410,
        message: 'Change Cursor expired.',
      }),
    );
    const queryMap = vi
      .fn()
      .mockResolvedValueOnce(queryResult('record_old', 1))
      .mockResolvedValueOnce(queryResult('record_rebased', 1));
    const controller = createController(
      createClient({ summarizeMap, pullChanges, queryMap }),
      createMapView('field_location'),
      [createField('field_location')],
    );

    await controller.load();
    await controller.refreshCurrentViewport();

    expect(summarizeMap).toHaveBeenCalledTimes(2);
    expect(queryMap).toHaveBeenCalledTimes(2);
    expect(controller.state.features).toEqual(queryResult('record_rebased', 1).features);
  });

  it('surfaces the published brokenFieldIds when the Server rejects Map configuration', async () => {
    const summarizeMap = vi.fn().mockRejectedValue(
      new LoomTableClientError('validation', {
        code: 'VIEW_CONFIGURATION_REQUIRED',
        message: 'The Map View requires a Location Field.',
        apiDetails: { viewId: 'view_map', brokenFieldIds: ['field_location'] },
      }),
    );
    const controller = createController(
      createClient({ summarizeMap }),
      createMapView('field_location'),
      [createField('field_location')],
    );

    await controller.load();

    expect(controller.state.dataStatus).toBe('configuration-required');
    expect(controller.state.error).toMatchObject({
      code: 'VIEW_CONFIGURATION_REQUIRED',
      apiDetails: { brokenFieldIds: ['field_location'] },
    });
  });

  it('requeries the viewport after a cluster snapshot expires', async () => {
    const pullChanges = vi.fn().mockResolvedValue({
      items: [],
      nextCursor: 'change_query',
      hasMore: false,
    });
    const queryMap = vi
      .fn()
      .mockResolvedValueOnce(queryResult('record_01', 1))
      .mockResolvedValueOnce(queryResult('record_refreshed', 1));
    const queryMapClusterRecords = vi.fn().mockRejectedValue(
      new LoomTableClientError('cursor-expired', {
        code: 'QUERY_SNAPSHOT_EXPIRED',
        httpStatus: 410,
        message: 'Cluster snapshot expired.',
      }),
    );
    const controller = createController(
      createClient({ pullChanges, queryMap, queryMapClusterRecords }),
      createMapView('field_location'),
      [createField('field_location')],
    );

    await controller.refreshCurrentViewport();
    await controller.openCluster('cluster_01');

    expect(queryMapClusterRecords).toHaveBeenCalledTimes(1);
    expect(pullChanges).toHaveBeenCalledWith('table_01', { cursor: 'change_query' });
    expect(queryMap).toHaveBeenCalledTimes(2);
    expect(controller.state.features).toEqual(queryResult('record_refreshed', 1).features);
  });

  it('does not issue Map reads while offline after an online result exists', async () => {
    let offline = false;
    const summarizeMap = vi.fn().mockResolvedValue(summaryResult());
    const pullChanges = vi.fn().mockResolvedValue({
      items: [],
      nextCursor: 'change_query',
      hasMore: false,
    });
    const queryMap = vi.fn().mockResolvedValue(queryResult('record_01', 1));
    const queryMapClusterRecords = vi.fn();
    const getRecord = vi.fn();
    const controller = createController(
      createClient({
        summarizeMap,
        pullChanges,
        queryMap,
        queryMapClusterRecords,
        getRecord,
      }),
      createMapView('field_location'),
      [createField('field_location')],
      { isOffline: () => offline },
    );

    await controller.refreshCurrentViewport();
    offline = true;
    await controller.refreshCurrentViewport();
    await controller.fitAll();
    await controller.openRecord('record_01');
    await controller.openCluster('cluster_01');

    expect(pullChanges).toHaveBeenCalledTimes(0);
    expect(queryMap).toHaveBeenCalledTimes(1);
    expect(summarizeMap).toHaveBeenCalledTimes(0);
    expect(getRecord).not.toHaveBeenCalled();
    expect(queryMapClusterRecords).not.toHaveBeenCalled();
    expect(controller.state.dataStatus).toBe('offline');
  });

  it('discards a query result whose View revision is no longer current', async () => {
    const queryMap = vi.fn().mockResolvedValue(queryResult('record_stale', 2));
    const controller = createController(
      createClient({ queryMap }),
      createMapView('field_location', 1),
      [createField('field_location')],
    );

    await controller.refreshCurrentViewport();

    expect(controller.state.features).toEqual([]);
    expect(controller.state.viewRevision).toBeNull();
  });

  it('saves only an explicit camera action through the View revision contract', async () => {
    const updated = createMapView('field_location', 2);
    const updateView = vi.fn().mockResolvedValue(updated);
    const client = createClient({ updateView });
    const renderer = new FakeRenderer();
    const controller = createController(
      client,
      createMapView('field_location'),
      [createField('field_location')],
      { renderer },
    );
    controller.mount(document.createElement('div'));
    renderer.emitCamera({ center: { lat: 35, lng: 139 }, zoom: 9 });

    await controller.saveDefaultCamera();

    expect(updateView).toHaveBeenCalledTimes(1);
    expect(updateView.mock.calls[0]?.[0]).toBe('view_map');
    expect(updateView.mock.calls[0]?.[1]).toMatchObject({
      type: 'map',
      expectedRevision: 1,
    });
    expect(JSON.stringify(updateView.mock.calls[0]?.[1])).toContain('"lat":35');
    expect(controller.state.view.revision).toBe(2);
    expect(controller.state.saveStatus).toBe('saved');
  });

  it('does not save the camera while offline and exposes read-only status', async () => {
    const updateView = vi.fn();
    const controller = createController(
      createClient({ updateView }),
      createMapView('field_location'),
      [createField('field_location')],
      { isOffline: () => true },
    );

    await controller.saveDefaultCamera();

    expect(updateView).not.toHaveBeenCalled();
    expect(controller.state.saveStatus).toBe('offline-readonly');
  });

  it.each([
    ['authentication', 'authentication'],
    ['forbidden', 'forbidden'],
    ['network', 'network'],
    ['server', 'server-error'],
  ] as const)('maps %s data errors to %s', async (kind, expectedStatus) => {
    const summarizeMap = vi
      .fn()
      .mockRejectedValue(new LoomTableClientError(kind, { message: kind }));
    const client = createClient({ summarizeMap });
    const controller = createController(client, createMapView('field_location'), [
      createField('field_location'),
    ]);

    await controller.load();

    expect(controller.state.dataStatus).toBe(expectedStatus);
    expect(controller.state.error?.message).toBe(kind);
  });
});

function createController(
  client: LoomTableClient,
  view: View,
  fields: readonly Field[],
  options: Partial<ConstructorParameters<typeof MapViewController>[3]> = {},
): MapViewController {
  return new MapViewController(client, view, fields, {
    renderer: options.renderer ?? new FakeRenderer(),
    registry: new TileProviderRegistry(),
    credentials: emptyCredentials,
    provider: options.provider ?? { kind: 'built-in', id: 'osm-standard' },
    viewport: options.viewport ?? {
      getViewport: () => ({ boxes: [{ west: -10, south: -10, east: 10, north: 10 }] }),
      getPixelSize: () => ({ width: 800, height: 600 }),
    },
    ...(options.debounceMs === undefined ? {} : { debounceMs: options.debounceMs }),
    ...(options.isOffline === undefined ? {} : { isOffline: options.isOffline }),
    ...(options.onRecordSelected === undefined
      ? {}
      : { onRecordSelected: options.onRecordSelected }),
    ...(options.onClusterRecords === undefined
      ? {}
      : { onClusterRecords: options.onClusterRecords }),
  });
}
function summaryResult(changeCursor = 'change_summary', viewRevision = 1): MapSummaryResult {
  return {
    summary: {
      matchedRecordCount: 1,
      renderableRecordCount: 1,
      unlocatedRecordCount: 0,
      unrenderableRecordCount: 0,
      dataBounds: { boxes: [{ west: 0, south: 0, east: 1, north: 1 }] },
    },
    viewRevision,
    changeCursor,
  };
}

function createClient(
  overrides: Partial<Record<keyof LoomTableClient, unknown>> = {},
): LoomTableClient {
  const summary = summaryResult();
  return {
    getMeta: vi.fn(),
    checkConnection: vi.fn(),
    listWorkspaces: vi.fn(),
    listBases: vi.fn(),
    listTables: vi.fn(),
    listFields: vi.fn(),
    listViews: vi.fn(),
    query: vi.fn(),
    pullChanges: vi.fn().mockResolvedValue({
      items: [],
      nextCursor: 'change_tail',
      hasMore: false,
    }),
    mutate: vi.fn(),
    getRecord: vi.fn().mockResolvedValue(createRecord('record_01')),
    queryMap: vi.fn().mockResolvedValue(queryResult('record_01', 1)),
    summarizeMap: vi.fn().mockResolvedValue(summary),
    queryMapClusterRecords: vi
      .fn()
      .mockResolvedValue({ items: [], hasMore: false, changeCursor: '' }),
    updateView: vi.fn().mockResolvedValue(createMapView('field_location')),
    initializeAttachment: vi.fn(),
    getAttachment: vi.fn(),
    deleteAttachment: vi.fn(),
    uploadAttachmentContent: vi.fn(),
    downloadAttachmentContent: vi.fn(),
    ...overrides,
  } as LoomTableClient;
}

const emptyCredentials: TileCredentialReader = { get: () => null };

class FakeRenderer implements MapRenderer {
  listener: MapRendererEventListener = {};
  camera: MapCamera = { center: { lat: 0, lng: 0 }, zoom: 2 };
  features: MapQueryResult['features'] = [];
  tilePlans: Parameters<MapRenderer['setTilePlan']>[0][] = [];
  fitBoundsCalls: Parameters<MapRenderer['fitBounds']>[0][] = [];

  mount(_container: HTMLElement, listener: MapRendererEventListener): void {
    this.listener = listener;
  }

  setTilePlan(plan: Parameters<MapRenderer['setTilePlan']>[0]): void {
    this.tilePlans.push(plan);
  }

  setCamera(camera: MapCamera): void {
    this.camera = camera;
  }

  fitBounds(bounds: Parameters<MapRenderer['fitBounds']>[0]): void {
    this.fitBoundsCalls.push(bounds);
  }

  setFeatures(features: MapQueryResult['features']): void {
    this.features = features;
  }

  invalidateSize(): void {}

  destroy(): void {}

  emitCamera(camera: MapCamera): void {
    this.camera = camera;
    this.listener.cameraChanged?.(camera);
  }

  emitTileReady(providerId: string): void {
    this.listener.tileReady?.({ providerId });
  }

  emitTileError(error: MapRendererError): void {
    this.listener.tileError?.(error);
  }

  emitSize(size: { readonly width: number; readonly height: number }): void {
    this.listener.rendererSizeChanged?.(size);
  }
}

function createField(id: string): Field {
  return {
    id,
    tableId: 'table_01',
    name: 'Location',
    position: 0,
    schemaVersion: 1,
    revision: 1,
    type: 'location',
    config: {},
  };
}

function createMapView(locationFieldId: string, revision = 1): Extract<View, { type: 'map' }> {
  return {
    id: 'view_map',
    tableId: 'table_01',
    name: 'Map',
    type: 'map',
    config: { locationFieldId },
    revision,
    createdAt: '2026-08-15T00:00:00Z',
    updatedAt: '2026-08-15T00:00:00Z',
  };
}

function createRecord(id: string): LoomTableRecord {
  return {
    id,
    tableId: 'table_01',
    revision: 1,
    values: { location: { lat: 1, lng: 2 } },
    createdAt: '2026-08-15T00:00:00Z',
    updatedAt: '2026-08-15T00:00:00Z',
  };
}

function queryResult(recordId: string, revision: number): MapQueryResult {
  return {
    features: [
      {
        kind: 'point',
        recordId,
        position: { lat: 1, lng: 2 },
        primaryFieldText: recordId,
      },
      {
        kind: 'cluster',
        clusterId: 'cluster_01',
        position: { lat: 3, lng: 4 },
        bounds: { boxes: [{ west: 2, south: 2, east: 5, north: 5 }] },
        pointCount: 1,
        recordsQueryToken: 'cluster_token',
      },
    ],
    viewportRenderableRecordCount: 2,
    viewRevision: revision,
    changeCursor: 'change_query',
  };
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolvePromise!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

