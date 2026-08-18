import {
  LoomTableClientError,
  type Field,
  type LoomTableClient,
  type LoomTableClientErrorDetails,
  type LoomTableRecord,
  type MapViewport,
  type MapQueryResult,
  type View,
} from '../../client/loomtable-client';
import type {
  TileCredentialReader,
  TileProviderRef,
} from '../../maps/providers/tile-provider-schema';
import { TileProviderRegistry } from '../../maps/providers/tile-provider-registry';
import type { MapCamera, MapRenderer, MapRendererError } from '../../maps/renderer/map-renderer';
import {
  DEFAULT_MAP_CAMERA,
  initialMapViewState,
  type MapDataStatus,
  type MapViewState,
} from './map-view-model';

export interface MapViewportSource {
  getViewport(): MapViewport;
  getPixelSize(): { readonly width: number; readonly height: number };
}

export interface MapViewControllerOptions {
  readonly renderer: MapRenderer;
  readonly registry: TileProviderRegistry;
  readonly credentials: TileCredentialReader;
  readonly provider: TileProviderRef;
  readonly viewport: MapViewportSource;
  readonly debounceMs?: number;
  readonly isOffline?: () => boolean;
  readonly onRecordSelected?: (record: LoomTableRecord) => void;
  readonly onClusterRecords?: (records: readonly LoomTableRecord[]) => void;
}

export type MapViewStateListener = (state: MapViewState) => void;

export class MapViewController {
  readonly #client: LoomTableClient;
  readonly #fields: readonly Field[];
  readonly #options: MapViewControllerOptions;
  readonly #listeners = new Set<MapViewStateListener>();
  readonly #debounceMs: number;
  #state: MapViewState;
  #view: View;
  #providerRef: TileProviderRef;
  #providerMaxZoom = 19;
  #timer: number | null = null;
  #querySequence = 0;
  #destroyed = false;
  #mounted = false;

  constructor(
    client: LoomTableClient,
    view: View,
    fields: readonly Field[],
    options: MapViewControllerOptions,
  ) {
    this.#client = client;
    this.#fields = fields;
    this.#options = options;
    this.#debounceMs = options.debounceMs ?? 150;
    this.#view = view;
    this.#providerRef = options.provider;
    this.#state = initialMapViewState(view, fields, defaultCamera(view));
  }

  get state(): MapViewState {
    return this.#state;
  }

  subscribe(listener: MapViewStateListener): () => void {
    this.#listeners.add(listener);
    listener(this.#state);
    return () => this.#listeners.delete(listener);
  }

  mount(container: HTMLElement): void {
    if (this.#destroyed || this.#mounted) return;
    this.#mounted = true;
    this.#options.renderer.mount(container, {
      cameraChanged: (camera) => this.onCameraChanged(camera),
      pointSelected: (recordId) => void this.openRecord(recordId),
      clusterSelected: (clusterId) => void this.openCluster(clusterId),
      tileLoading: ({ providerId }) => this.onTileLoading(providerId),
      tileReady: ({ providerId }) => this.onTileReady(providerId),
      tileError: (error) => this.onTileError(error),
      rendererSizeChanged: (size) => this.onRendererSizeChanged(size),
    });
  }

  async load(): Promise<void> {
    if (this.#destroyed) return;
    const configurationError = this.validateConfiguration();
    if (configurationError !== null) {
      this.publish({ dataStatus: 'configuration-required', error: configurationError });
      return;
    }

    const provider = this.#options.registry.resolve(this.#providerRef, this.#options.credentials);
    if (!provider.ok) {
      this.clearTilePlan(provider.error.providerId);
      this.publish({
        tilePlanStatus: 'configuration-required',
        tileStatus: 'configuration-required',
        tileError: provider.error,
      });
    } else {
      this.#providerMaxZoom = provider.plan.maxZoom;
      this.publish({ tilePlanStatus: 'ready', tileStatus: 'loading', tileError: null });
      this.#options.renderer.setTilePlan(provider.plan);
    }
    this.#options.renderer.setCamera(this.#state.camera);
    if (this.#options.isOffline?.() === true) {
      this.publish({ dataStatus: 'offline', error: null });
      return;
    }
    this.publish({ dataStatus: 'loading', error: null });

    try {
      const summary = await this.#client.summarizeMap(this.#view.id);
      if (summary.viewRevision !== this.#view.revision) return;
      this.publish({ summary: summary.summary, changeCursor: summary.changeCursor });
      if (!hasSavedCamera(this.#view) && summary.summary.dataBounds !== undefined) {
        this.#options.renderer.fitBounds(summary.summary.dataBounds);
      }
      await this.refreshCurrentViewport();
    } catch (error) {
      this.handleDataError(error);
    }
  }

  async refreshCurrentViewport(): Promise<void> {
    if (this.#destroyed) return;
    const sequence = ++this.#querySequence;
    await this.queryViewport(sequence);
  }

  async fitAll(): Promise<void> {
    if (this.#destroyed) return;
    try {
      const result = await this.#client.summarizeMap(this.#view.id);
      if (result.viewRevision !== this.#view.revision) return;
      this.publish({ summary: result.summary, changeCursor: result.changeCursor });
      if (result.summary.dataBounds === undefined) {
        this.#options.renderer.setCamera(DEFAULT_MAP_CAMERA);
      } else {
        this.#options.renderer.fitBounds(result.summary.dataBounds);
      }
    } catch (error) {
      this.handleDataError(error);
    }
  }

  async saveDefaultCamera(): Promise<void> {
    if (this.#view.type !== 'map') return;
    try {
      const view = await this.#client.updateView(this.#view.id, {
        type: 'map',
        config: {
          ...this.#view.config,
          center: this.#state.camera.center,
          zoom: this.#state.camera.zoom,
        },
        expectedRevision: this.#view.revision,
      });
      this.#view = view;
      this.publish({ view });
    } catch (error) {
      this.handleDataError(error);
    }
  }

  async openRecord(recordId: string): Promise<void> {
    try {
      const record = await this.#client.getRecord(recordId);
      this.publish({ selectedRecord: record });
      this.#options.onRecordSelected?.(record);
    } catch (error) {
      this.handleDataError(error);
    }
  }

  async openCluster(clusterId: string): Promise<void> {
    const cluster = this.#state.features.find(
      (feature) => feature.kind === 'cluster' && feature.clusterId === clusterId,
    );
    if (cluster === undefined || cluster.kind !== 'cluster') return;
    if (cluster.expansionZoom !== undefined && cluster.expansionZoom <= this.#providerMaxZoom) {
      this.#options.renderer.fitBounds(cluster.bounds);
      return;
    }
    await this.loadClusterPage(cluster.recordsQueryToken, undefined);
  }

  async loadNextClusterPage(): Promise<void> {
    if (this.#state.clusterToken === null || this.#state.clusterCursor === null) return;
    await this.loadClusterPage(this.#state.clusterToken, this.#state.clusterCursor);
  }

  setProvider(provider: TileProviderRef): void {
    this.#providerRef = provider;
    const resolved = this.#options.registry.resolve(provider, this.#options.credentials);
    if (!resolved.ok) {
      this.clearTilePlan(resolved.error.providerId);
      this.publish({
        tilePlanStatus: 'configuration-required',
        tileStatus: 'configuration-required',
        tileError: resolved.error,
      });
      return;
    }
    this.#providerMaxZoom = resolved.plan.maxZoom;
    this.publish({ tilePlanStatus: 'ready', tileStatus: 'loading', tileError: null });
    this.#options.renderer.setTilePlan(resolved.plan);
  }

  dispose(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#querySequence += 1;
    if (this.#timer !== null) window.clearTimeout(this.#timer);
    this.#timer = null;
    this.#options.renderer.destroy();
    this.#listeners.clear();
  }

  private onCameraChanged(camera: MapCamera): void {
    if (this.#destroyed) return;
    this.publish({ camera });
    this.#querySequence += 1;
    const sequence = this.#querySequence;
    if (this.#timer !== null) window.clearTimeout(this.#timer);
    this.#timer = window.setTimeout(() => {
      this.#timer = null;
      void this.queryViewport(sequence);
    }, this.#debounceMs);
  }

  private async queryViewport(sequence: number): Promise<void> {
    if (this.#destroyed || sequence !== this.#querySequence) return;
    if (this.#options.isOffline?.() === true) {
      this.publish({ dataStatus: 'offline' });
      return;
    }
    const size = this.#options.viewport.getPixelSize();
    const viewport = this.#options.viewport.getViewport();
    this.publish({ dataStatus: 'loading', error: null });
    try {
      const result = await this.#client.queryMap(this.#view.id, {
        viewport,
        zoom: this.#state.camera.zoom,
        pixelWidth: Math.max(1, Math.round(size.width)),
        pixelHeight: Math.max(1, Math.round(size.height)),
      });
      if (this.#destroyed || sequence !== this.#querySequence) return;
      if (result.viewRevision !== this.#view.revision) return;
      this.applyQueryResult(result);
    } catch (error) {
      if (this.#destroyed || sequence !== this.#querySequence) return;
      this.handleDataError(error);
    }
  }

  private async loadClusterPage(token: string, cursor: string | undefined): Promise<void> {
    try {
      const result = await this.#client.queryMapClusterRecords(this.#view.id, {
        clusterToken: token,
        ...(cursor === undefined ? {} : { cursor }),
      });
      this.publish({
        clusterRecords: result.items,
        clusterToken: token,
        clusterCursor: result.nextCursor ?? null,
        changeCursor: result.changeCursor,
      });
      this.#options.onClusterRecords?.(result.items);
    } catch (error) {
      const clientError = asClientError(error);
      if (clientError.kind === 'cursor-expired') {
        this.publish({ clusterRecords: [], clusterToken: null, clusterCursor: null });
        await this.refreshCurrentViewport();
        return;
      }
      this.handleDataError(error);
    }
  }

  private applyQueryResult(result: MapQueryResult): void {
    const features = result.features.map((feature) =>
      feature.kind === 'point' && feature.primaryFieldText.trim() === ''
        ? { ...feature, primaryFieldText: feature.recordId }
        : feature,
    );
    this.#options.renderer.setFeatures(features);
    this.publish({
      dataStatus: result.viewportRenderableRecordCount === 0 ? 'empty' : 'ready',
      features,
      viewportRenderableRecordCount: result.viewportRenderableRecordCount,
      changeCursor: result.changeCursor,
      error: null,
    });
  }

  private onTileError(error: MapRendererError): void {
    this.publish({
      tilePlanStatus: error.kind === 'renderer' ? 'error' : 'ready',
      tileStatus: 'error',
      tileError: {
        kind: 'tile-error',
        providerId:
          this.#providerRef.kind === 'custom' ? this.#providerRef.profileId : this.#providerRef.id,
        message: error.message,
      },
    });
  }

  private onTileLoading(providerId: string): void {
    this.publish({
      tilePlanStatus: 'ready',
      tileStatus: 'loading',
      tileError: null,
    });
    void providerId;
  }

  private onTileReady(providerId: string): void {
    this.publish({
      tilePlanStatus: 'ready',
      tileStatus: 'ready',
      tileError: null,
    });
    void providerId;
  }

  private onRendererSizeChanged(size: { readonly width: number; readonly height: number }): void {
    if (size.width > 0 && size.height > 0) return;
    this.publish({
      tilePlanStatus: 'ready',
      tileStatus: 'error',
      tileError: {
        kind: 'tile-error',
        providerId:
          this.#providerRef.kind === 'custom' ? this.#providerRef.profileId : this.#providerRef.id,
        message:
          'The Map container has zero size, so tiles cannot be rendered. Check the view layout.',
      },
    });
  }

  private clearTilePlan(providerId: string): void {
    this.#options.renderer.setTilePlan({
      providerId,
      displayName: 'Unconfigured tile provider',
      protocol: 'xyz',
      crs: 'EPSG:3857',
      layers: [],
      minZoom: 0,
      maxZoom: 0,
      attribution: [],
    });
  }

  private validateConfiguration(): LoomTableClientErrorDetails | null {
    const view = this.#view;
    if (view.type !== 'map') {
      return {
        message: 'The selected View is not a Map View.',
        code: 'VIEW_CONFIGURATION_REQUIRED',
      };
    }
    const locationFieldId = view.config.locationFieldId;
    const locationField = this.#fields.find((field) => field.id === locationFieldId);
    if (
      locationField?.type !== 'location' ||
      locationField.tableId !== view.tableId ||
      locationField.deletedAt !== undefined
    ) {
      return {
        message: 'The Map View requires an available Location Field.',
        code: 'VIEW_CONFIGURATION_REQUIRED',
        apiDetails: { viewId: view.id, brokenFieldIds: [locationFieldId] },
      };
    }
    return null;
  }

  private handleDataError(error: unknown): void {
    const clientError = asClientError(error);
    this.publish({ dataStatus: dataStatusForError(clientError), error: clientError.details });
  }

  private publish(patch: Partial<MapViewState> & { readonly view?: View }): void {
    if (this.#destroyed) return;
    if (patch.view !== undefined) this.#view = patch.view;
    this.#state = { ...this.#state, ...patch, view: this.#view };
    for (const listener of this.#listeners) listener(this.#state);
  }
}

function defaultCamera(view: View): MapCamera {
  if (view.type !== 'map' || view.config.center === undefined || view.config.zoom === undefined) {
    return DEFAULT_MAP_CAMERA;
  }
  return { center: view.config.center, zoom: view.config.zoom };
}

function hasSavedCamera(view: View): boolean {
  return view.type === 'map' && view.config.center !== undefined && view.config.zoom !== undefined;
}

function asClientError(error: unknown): LoomTableClientError {
  return error instanceof LoomTableClientError
    ? error
    : new LoomTableClientError(
        'server',
        { message: 'The Map request failed unexpectedly.' },
        { cause: error },
      );
}

function dataStatusForError(error: LoomTableClientError): MapDataStatus {
  if (error.kind === 'authentication') return 'authentication';
  if (error.kind === 'forbidden') return 'forbidden';
  if (error.kind === 'network' || error.kind === 'timeout') return 'network';
  if (error.details.code === 'VIEW_CONFIGURATION_REQUIRED') return 'configuration-required';
  return 'server-error';
}
