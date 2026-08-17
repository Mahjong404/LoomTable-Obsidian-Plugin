import { describe, expect, it, vi } from 'vitest';

import type { MapCoordinate, MapFeature, MapViewport } from '../../src/client/loomtable-client';
import {
  LeafletMapRenderer,
  type MapRendererAdapter,
  type RendererFeatureHandle,
  type RendererLayerHandle,
  type RendererMapHandle,
} from '../../src/maps/renderer/map-renderer';
import type { MapCamera } from '../../src/maps/renderer/map-renderer';
import type {
  ResolvedTileLayer,
  ResolvedTilePlan,
} from '../../src/maps/providers/tile-provider-schema';

describe('LeafletMapRenderer seam', () => {
  it('mounts and destroys the map exactly once and forwards camera events', () => {
    const adapter = new FakeAdapter();
    const renderer = new LeafletMapRenderer(adapter);
    const cameraChanged = [] as MapCamera[];

    renderer.mount(document.createElement('div'), {
      cameraChanged: (camera) => cameraChanged.push(camera),
    });
    adapter.map.emitCamera({ center: { lat: 1, lng: 2 }, zoom: 5 });
    renderer.destroy();
    renderer.destroy();

    expect(adapter.createMapCalls).toBe(1);
    expect(adapter.map.removeCalls).toBe(1);
    expect(cameraChanged).toEqual([{ center: { lat: 1, lng: 2 }, zoom: 5 }]);
  });

  it('keeps the previous provider when a replacement cannot be created', () => {
    const adapter = new FakeAdapter();
    const renderer = new LeafletMapRenderer(adapter);
    renderer.mount(document.createElement('div'), {});
    renderer.setTilePlan(plan('osm-standard'));
    const previous = adapter.layers[0];
    adapter.failProvider = 'broken';

    renderer.setTilePlan(plan('broken'));

    expect(previous?.addCalls).toBe(1);
    expect(previous?.removeCalls).toBe(0);
    expect(adapter.layers).toHaveLength(1);
  });

  it('reports loading until every tile layer emits load, then reports ready', () => {
    const adapter = new FakeAdapter();
    const events: string[] = [];
    const renderer = new LeafletMapRenderer(adapter);
    renderer.mount(document.createElement('div'), {
      tileLoading: ({ providerId }) => events.push(`loading:${providerId}`),
      tileReady: ({ providerId }) => events.push(`ready:${providerId}`),
    });

    renderer.setTilePlan(planWithLayers('osm-standard', 2));

    expect(events).toEqual(['loading:osm-standard']);
    adapter.layers[0]?.emitLoad();
    expect(events).toEqual(['loading:osm-standard']);
    adapter.layers[1]?.emitLoad();
    expect(events).toEqual(['loading:osm-standard', 'ready:osm-standard']);
  });

  it('reports tile errors and ignores late loads from the failed batch', () => {
    const adapter = new FakeAdapter();
    const errors: string[] = [];
    const ready: string[] = [];
    const renderer = new LeafletMapRenderer(adapter);
    renderer.mount(document.createElement('div'), {
      tileError: (error) => errors.push(`${error.kind}:${error.message}`),
      tileReady: ({ providerId }) => ready.push(providerId),
    });

    renderer.setTilePlan(plan('osm-standard'));
    adapter.layers[0]?.emitError('network blocked');
    adapter.layers[0]?.emitLoad();

    expect(errors).toEqual(['tile:network blocked']);
    expect(ready).toEqual([]);
  });

  it('invalidates after mount and reports the post-layout pixel size', () => {
    vi.useFakeTimers();
    try {
      const adapter = new FakeAdapter();
      const sizes: { width: number; height: number }[] = [];
      const renderer = new LeafletMapRenderer(adapter);
      renderer.mount(document.createElement('div'), {
        rendererSizeChanged: (size) => sizes.push(size),
      });

      expect(adapter.map.invalidateCalls).toBe(1);
      vi.runAllTimers();
      expect(adapter.map.invalidateCalls).toBe(2);
      expect(sizes).toEqual([
        { width: 640, height: 480 },
        { width: 640, height: 480 },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reuses point and cluster renderer handles by their ephemeral response identity', () => {
    const adapter = new FakeAdapter();
    const events: string[] = [];
    const renderer = new LeafletMapRenderer(adapter);
    renderer.mount(document.createElement('div'), {
      pointSelected: (recordId) => events.push(`point:${recordId}`),
      clusterSelected: (clusterId) => events.push(`cluster:${clusterId}`),
    });

    const first = features();
    renderer.setFeatures(first);
    const pointHandle = adapter.features[0];
    const clusterHandle = adapter.features[1];
    const point = first[0];
    const cluster = first[1];
    if (point?.kind !== 'point' || cluster?.kind !== 'cluster') throw new Error('Invalid fixture.');
    renderer.setFeatures([
      { ...point, position: { lat: 3, lng: 4 }, primaryFieldText: 'Updated' },
      { ...cluster, pointCount: 4 },
    ]);

    expect(adapter.features).toHaveLength(2);
    expect(adapter.features[0]).toBe(pointHandle);
    expect(adapter.features[1]).toBe(clusterHandle);
    expect(pointHandle?.positions.at(-1)).toEqual({ lat: 3, lng: 4 });
    expect(clusterHandle?.labels.at(-1)).toBe('4');
    adapter.features[0]?.click();
    adapter.features[1]?.click();
    expect(events).toEqual(['point:record_01', 'cluster:cluster_01']);
  });

  it('passes single and antimeridian split bounds to the adapter without projection math', () => {
    const adapter = new FakeAdapter();
    const renderer = new LeafletMapRenderer(adapter);
    renderer.mount(document.createElement('div'), {});
    const bounds: MapViewport = {
      boxes: [
        { west: 170, south: -10, east: 180, north: 10 },
        { west: -180, south: -10, east: -170, north: 10 },
      ],
    };

    renderer.fitBounds(bounds);

    expect(adapter.map.fitBoundsCalls).toEqual([bounds]);
  });
});

class FakeAdapter implements MapRendererAdapter {
  readonly map = new FakeMap();
  readonly layers: FakeLayer[] = [];
  readonly features: FakeFeature[] = [];
  createMapCalls = 0;
  failProvider: string | null = null;

  createMap(_container: HTMLElement): RendererMapHandle {
    this.createMapCalls += 1;
    return this.map;
  }

  createTileLayer(
    _map: RendererMapHandle,
    layer: ResolvedTileLayer,
    _attribution: string,
    onLoad: () => void,
    onError: (message: string) => void,
  ): RendererLayerHandle {
    if (this.failProvider !== null && layer.id.startsWith(this.failProvider)) {
      throw new Error('provider failed');
    }
    const handle = new FakeLayer(layer.id, onLoad, onError);
    this.layers.push(handle);
    return handle;
  }

  createPointFeature(
    _map: RendererMapHandle,
    position: MapCoordinate,
    label: string,
    onClick: () => void,
  ): RendererFeatureHandle {
    const handle = new FakeFeature(position, label, onClick);
    this.features.push(handle);
    return handle;
  }

  createClusterFeature(
    _map: RendererMapHandle,
    position: MapCoordinate,
    label: string,
    onClick: () => void,
  ): RendererFeatureHandle {
    const handle = new FakeFeature(position, label, onClick);
    this.features.push(handle);
    return handle;
  }
}

class FakeMap implements RendererMapHandle {
  camera: MapCamera = { center: { lat: 0, lng: 0 }, zoom: 1 };
  removeCalls = 0;
  fitBoundsCalls: MapViewport[] = [];
  invalidateCalls = 0;
  #listeners = new Set<() => void>();

  onCameraChanged(listener: () => void): void {
    this.#listeners.add(listener);
  }

  offCameraChanged(listener: () => void): void {
    this.#listeners.delete(listener);
  }

  getCamera(): MapCamera {
    return this.camera;
  }

  setCamera(camera: MapCamera): void {
    this.camera = camera;
  }

  fitBounds(bounds: MapViewport): void {
    this.fitBoundsCalls.push(bounds);
  }

  invalidateSize(): void {
    this.invalidateCalls += 1;
  }

  getPixelSize(): { readonly width: number; readonly height: number } {
    return { width: 640, height: 480 };
  }

  remove(): void {
    this.removeCalls += 1;
  }

  emitCamera(camera: MapCamera): void {
    this.camera = camera;
    for (const listener of this.#listeners) listener();
  }
}

class FakeLayer implements RendererLayerHandle {
  addCalls = 0;
  removeCalls = 0;

  constructor(
    readonly id: string,
    private readonly onLoad: () => void,
    private readonly onError: (message: string) => void,
  ) {}

  add(): void {
    this.addCalls += 1;
  }

  remove(): void {
    this.removeCalls += 1;
  }

  emitLoad(): void {
    this.onLoad();
  }

  emitError(message: string): void {
    this.onError(message);
  }
}

class FakeFeature implements RendererFeatureHandle {
  readonly positions: MapCoordinate[] = [];
  readonly labels: string[] = [];
  removeCalls = 0;

  constructor(
    position: MapCoordinate,
    label: string,
    readonly click: () => void,
  ) {
    this.positions.push(position);
    this.labels.push(label);
  }

  setPosition(position: MapCoordinate): void {
    this.positions.push(position);
  }

  setLabel(label: string): void {
    this.labels.push(label);
  }

  remove(): void {
    this.removeCalls += 1;
  }
}

function plan(providerId: string): ResolvedTilePlan {
  return planWithLayers(providerId, 1);
}

function planWithLayers(providerId: string, layerCount: number): ResolvedTilePlan {
  return {
    providerId,
    displayName: providerId,
    protocol: 'xyz',
    crs: 'EPSG:3857',
    layers: Array.from({ length: layerCount }, (_, index) => ({
      id: `${providerId}-${index}`,
      role: 'base' as const,
      urlTemplate: 'https://tiles.example/{z}/{x}/{y}.png',
    })),
    minZoom: 0,
    maxZoom: 18,
    attribution: [{ label: 'Example' }],
  };
}

function features(): readonly MapFeature[] {
  return [
    {
      kind: 'point',
      recordId: 'record_01',
      position: { lat: 1, lng: 2 },
      primaryFieldText: 'Record',
    },
    {
      kind: 'cluster',
      clusterId: 'cluster_01',
      position: { lat: 2, lng: 3 },
      bounds: { boxes: [{ west: 1, south: 1, east: 3, north: 3 }] },
      pointCount: 2,
      recordsQueryToken: 'token',
    },
  ];
}
