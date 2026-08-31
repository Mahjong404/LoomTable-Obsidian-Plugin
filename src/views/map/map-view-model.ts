import type {
  Field,
  LoomTableClientErrorDetails,
  LoomTableRecord,
  MapFeature,
  MapQuerySummary,
  View,
} from '../../client/loomtable-client';
import type { MapCamera } from '../../maps/renderer/map-renderer';
import type { TileProviderError } from '../../maps/providers/tile-provider-schema';
import type { ViewSaveStatus } from '../../ui/save-status';

export type MapDataStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'empty'
  | 'configuration-required'
  | 'offline'
  | 'authentication'
  | 'forbidden'
  | 'network'
  | 'server-error';

export type MapTileStatus = 'idle' | 'loading' | 'ready' | 'configuration-required' | 'error';
export type MapTilePlanStatus = 'idle' | 'ready' | 'configuration-required' | 'error';
export type MapClusterStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error';

export interface MapViewState {
  readonly dataStatus: MapDataStatus;
  readonly tileStatus: MapTileStatus;
  readonly tilePlanStatus: MapTilePlanStatus;
  readonly view: View;
  readonly fields: readonly Field[];
  readonly locationFieldId: string | null;
  readonly camera: MapCamera;
  readonly features: readonly MapFeature[];
  readonly viewportRenderableRecordCount: number;
  readonly summary: MapQuerySummary | null;
  readonly changeCursor: string | null;
  readonly viewRevision: number | null;
  readonly selectedRecord: LoomTableRecord | null;
  readonly clusterStatus: MapClusterStatus;
  readonly clusterRecords: readonly LoomTableRecord[];
  readonly clusterToken: string | null;
  readonly clusterCursor: string | null;
  readonly clusterError: LoomTableClientErrorDetails | null;
  readonly error: LoomTableClientErrorDetails | null;
  readonly tileError: TileProviderError | LoomTableClientErrorDetails | null;
  readonly saveStatus: ViewSaveStatus;
}

export const DEFAULT_MAP_CAMERA: MapCamera = {
  center: { lat: 0, lng: 0 },
  zoom: 2,
};

export function initialMapViewState(
  view: View,
  fields: readonly Field[] = [],
  camera: MapCamera = DEFAULT_MAP_CAMERA,
): MapViewState {
  return {
    dataStatus: 'idle',
    tileStatus: 'idle',
    tilePlanStatus: 'idle',
    view,
    fields,
    locationFieldId: view.type === 'map' ? view.config.locationFieldId : null,
    camera,
    features: [],
    viewportRenderableRecordCount: 0,
    summary: null,
    changeCursor: null,
    viewRevision: null,
    selectedRecord: null,
    clusterStatus: 'idle',
    clusterRecords: [],
    clusterToken: null,
    clusterCursor: null,
    clusterError: null,
    error: null,
    tileError: null,
    saveStatus: 'saved',
  };
}
