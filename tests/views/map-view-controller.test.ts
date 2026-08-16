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

function createClient(
  overrides: Partial<Record<keyof LoomTableClient, unknown>> = {},
): LoomTableClient {
  const summary: MapSummaryResult = {
    summary: {
      matchedRecordCount: 1,
      renderableRecordCount: 1,
      unlocatedRecordCount: 0,
      unrenderableRecordCount: 0,
      dataBounds: { boxes: [{ west: 0, south: 0, east: 1, north: 1 }] },
    },
    viewRevision: 1,
    changeCursor: 'change_summary',
  };
  return {
    getMeta: vi.fn(),
    checkConnection: vi.fn(),
    listWorkspaces: vi.fn(),
    listBases: vi.fn(),
    listTables: vi.fn(),
    listFields: vi.fn(),
    listViews: vi.fn(),
    query: vi.fn(),
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
