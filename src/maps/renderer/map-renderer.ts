import type { MapCoordinate, MapFeature, MapViewport } from '../../client/loomtable-client';
import type { ResolvedTileLayer, ResolvedTilePlan } from '../providers/tile-provider-schema';

export interface MapCamera {
  readonly center: MapCoordinate;
  readonly zoom: number;
}

export interface MapRendererError {
  readonly kind: 'tile' | 'renderer';
  readonly message: string;
}

export interface MapRendererEventListener {
  readonly cameraChanged?: (camera: MapCamera) => void;
  readonly pointSelected?: (recordId: string) => void;
  readonly clusterSelected?: (clusterId: string) => void;
  readonly tileError?: (error: MapRendererError) => void;
}

export interface MapRenderer {
  mount(container: HTMLElement, listener: MapRendererEventListener): void;
  setTilePlan(plan: ResolvedTilePlan): void;
  setCamera(camera: MapCamera): void;
  fitBounds(bounds: MapViewport): void;
  setFeatures(features: readonly MapFeature[]): void;
  invalidateSize(): void;
  destroy(): void;
}

export interface RendererLayerHandle {
  add(): void;
  remove(): void;
}

export interface RendererFeatureHandle {
  setPosition(position: MapCoordinate): void;
  setLabel(label: string): void;
  remove(): void;
}

export interface RendererMapHandle {
  onCameraChanged(listener: () => void): void;
  offCameraChanged(listener: () => void): void;
  getCamera(): MapCamera;
  setCamera(camera: MapCamera): void;
  fitBounds(bounds: MapViewport): void;
  invalidateSize(): void;
  remove(): void;
  getViewport?(): MapViewport;
  getPixelSize?(): { readonly width: number; readonly height: number };
}

export interface MapRendererAdapter {
  createMap(container: HTMLElement): RendererMapHandle;
  createTileLayer(
    map: RendererMapHandle,
    layer: ResolvedTileLayer,
    attribution: string,
    onError: (message: string) => void,
  ): RendererLayerHandle;
  createPointFeature(
    map: RendererMapHandle,
    position: MapCoordinate,
    label: string,
    onClick: () => void,
  ): RendererFeatureHandle;
  createClusterFeature(
    map: RendererMapHandle,
    position: MapCoordinate,
    label: string,
    onClick: () => void,
  ): RendererFeatureHandle;
}

export class MapRendererLifecycleError extends Error {}

export class LeafletMapRenderer implements MapRenderer {
  readonly #adapter: MapRendererAdapter;
  #map: RendererMapHandle | null = null;
  #listener: MapRendererEventListener | null = null;
  #cameraChangedHandler: (() => void) | null = null;
  #tileLayers: RendererLayerHandle[] = [];
  #features = new Map<string, RendererFeatureHandle>();
  #featureKinds = new Map<string, MapFeature['kind']>();
  #pendingTilePlan: ResolvedTilePlan | null = null;
  #pendingCamera: MapCamera | null = null;
  #pendingFeatures: readonly MapFeature[] = [];
  #destroyed = false;

  constructor(adapter: MapRendererAdapter) {
    this.#adapter = adapter;
  }

  mount(container: HTMLElement, listener: MapRendererEventListener): void {
    if (this.#map !== null || this.#destroyed) {
      throw new MapRendererLifecycleError('A Map Renderer can only be mounted once.');
    }
    this.#listener = listener;
    this.#map = this.#adapter.createMap(container);
    this.#cameraChangedHandler = (): void => {
      const camera = this.#map?.getCamera();
      if (camera !== undefined) this.#listener?.cameraChanged?.(camera);
    };
    this.#map.onCameraChanged(this.#cameraChangedHandler);
    if (this.#pendingTilePlan !== null) {
      const plan = this.#pendingTilePlan;
      this.#pendingTilePlan = null;
      this.setTilePlan(plan);
    }
    if (this.#pendingCamera !== null) {
      const camera = this.#pendingCamera;
      this.#pendingCamera = null;
      this.setCamera(camera);
    }
    if (this.#pendingFeatures.length > 0) {
      const features = this.#pendingFeatures;
      this.#pendingFeatures = [];
      this.setFeatures(features);
    }
  }

  setTilePlan(plan: ResolvedTilePlan): void {
    if (this.#map === null) {
      this.#pendingTilePlan = plan;
      return;
    }
    const nextLayers: RendererLayerHandle[] = [];
    try {
      for (const layer of plan.layers) {
        nextLayers.push(
          this.#adapter.createTileLayer(
            this.#map,
            layer,
            plan.attribution.map((item) => item.label).join(' · '),
            (message) => this.#listener?.tileError?.({ kind: 'tile', message }),
          ),
        );
      }
    } catch (error) {
      for (const layer of nextLayers) layer.remove();
      this.#listener?.tileError?.({
        kind: 'renderer',
        message: error instanceof Error ? error.message : 'Tile layers could not be created.',
      });
      return;
    }
    const previousLayers = this.#tileLayers;
    for (const layer of previousLayers) layer.remove();
    try {
      for (const layer of nextLayers) layer.add();
      this.#tileLayers = nextLayers;
    } catch (error) {
      for (const layer of nextLayers) layer.remove();
      for (const layer of previousLayers) layer.add();
      this.#listener?.tileError?.({
        kind: 'renderer',
        message: error instanceof Error ? error.message : 'Tile layers could not be activated.',
      });
    }
  }

  setCamera(camera: MapCamera): void {
    if (this.#map === null) {
      this.#pendingCamera = camera;
      return;
    }
    this.#map.setCamera(camera);
  }

  fitBounds(bounds: MapViewport): void {
    if (this.#map === null) return;
    this.#map.fitBounds(bounds);
  }

  getViewport(): MapViewport {
    return (
      this.#map?.getViewport?.() ?? {
        boxes: [{ west: -180, south: -85.0511287798066, east: 180, north: 85.0511287798066 }],
      }
    );
  }

  getPixelSize(): { readonly width: number; readonly height: number } {
    return this.#map?.getPixelSize?.() ?? { width: 1, height: 1 };
  }

  setFeatures(features: readonly MapFeature[]): void {
    if (this.#map === null) {
      this.#pendingFeatures = features;
      return;
    }
    const nextKeys = new Set<string>();
    for (const feature of features) {
      const key = featureKey(feature);
      nextKeys.add(key);
      const existing = this.#features.get(key);
      if (existing !== undefined && this.#featureKinds.get(key) === feature.kind) {
        existing.setPosition(feature.position);
        existing.setLabel(
          feature.kind === 'point' ? feature.primaryFieldText : String(feature.pointCount),
        );
        continue;
      }
      existing?.remove();
      const handle =
        feature.kind === 'point'
          ? this.#adapter.createPointFeature(
              this.#map,
              feature.position,
              feature.primaryFieldText,
              () => this.#listener?.pointSelected?.(feature.recordId),
            )
          : this.#adapter.createClusterFeature(
              this.#map,
              feature.position,
              String(feature.pointCount),
              () => this.#listener?.clusterSelected?.(feature.clusterId),
            );
      this.#features.set(key, handle);
      this.#featureKinds.set(key, feature.kind);
    }
    for (const [key, handle] of this.#features) {
      if (!nextKeys.has(key)) {
        handle.remove();
        this.#features.delete(key);
        this.#featureKinds.delete(key);
      }
    }
  }

  invalidateSize(): void {
    this.#map?.invalidateSize();
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    if (this.#map !== null && this.#cameraChangedHandler !== null) {
      this.#map.offCameraChanged(this.#cameraChangedHandler);
    }
    for (const layer of this.#tileLayers) layer.remove();
    for (const feature of this.#features.values()) feature.remove();
    this.#tileLayers = [];
    this.#features.clear();
    this.#featureKinds.clear();
    this.#map?.remove();
    this.#map = null;
    this.#listener = null;
    this.#cameraChangedHandler = null;
  }
}

function featureKey(feature: MapFeature): string {
  return feature.kind === 'point' ? `point:${feature.recordId}` : `cluster:${feature.clusterId}`;
}
