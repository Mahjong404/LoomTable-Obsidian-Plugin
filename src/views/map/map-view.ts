import type {
  Base,
  LocationValue,
  LoomTableRecord,
  Table,
  View,
  Workspace,
} from '../../client/loomtable-client';
import { createTranslator, type Translator } from '../../i18n';
import type {
  TileProviderRef,
  TileProviderSummary,
} from '../../maps/providers/tile-provider-schema';
import type { LocationEditIntent } from '../../ui/field-value-editor';
import { createRecordDetail, type RecordConflictView } from '../../ui/record-detail';
import { renderSaveStatus } from '../../ui/save-status';
import type { MapViewController } from './map-view-controller';
import type { MapViewState } from './map-view-model';

export interface MapViewNavigation {
  readonly workspaces: readonly Workspace[];
  readonly bases: readonly Base[];
  readonly tables: readonly Table[];
  readonly views: readonly View[];
  readonly selectedWorkspaceId: string | null;
  readonly selectedBaseId: string | null;
  readonly selectedTableId: string | null;
  readonly selectedViewId: string | null;
  readonly onWorkspaceChange: (workspaceId: string) => void | Promise<void>;
  readonly onBaseChange: (baseId: string) => void | Promise<void>;
  readonly onTableChange: (tableId: string) => void | Promise<void>;
  readonly onViewChange: (viewId: string) => void | Promise<void>;
}
export interface MapViewOptions {
  readonly translate?: Translator;
  readonly navigation?: MapViewNavigation;
  readonly onClusterNextPage?: () => void | Promise<void>;
  readonly onLocationEdit?: (
    recordId: string,
    fieldId: string,
    intent: LocationEditIntent,
    record?: LoomTableRecord,
  ) => void | Promise<void>;
  readonly onOpenLocationInMap?: (
    recordId: string,
    fieldId: string,
    location: LocationValue,
  ) => void | Promise<void>;
  readonly getConflict?: (recordId: string) => RecordConflictView | undefined;
  readonly onConflictAction?: (
    recordId: string,
    action: 'use-server' | 'overwrite',
  ) => void | Promise<void>;
  readonly providers?: readonly TileProviderSummary[];
  readonly selectedProvider?: TileProviderRef;
  readonly onProviderChange?: (provider: TileProviderRef) => void | Promise<void>;
}

export class MapView {
  readonly #container: HTMLElement;
  readonly #controller: MapViewController;
  #unsubscribe: (() => void) | null = null;
  #status: HTMLElement | null = null;
  #saveStatus: HTMLElement | null = null;
  #tileStatus: HTMLElement | null = null;
  #details: HTMLElement | null = null;
  #refreshButton: HTMLButtonElement | null = null;
  #fitAllButton: HTMLButtonElement | null = null;
  #saveCameraButton: HTMLButtonElement | null = null;

  constructor(
    container: HTMLElement,
    controller: MapViewController,
    private readonly options: MapViewOptions = {},
  ) {
    this.#container = container;
    this.#controller = controller;
  }

  mount(): void {
    if (this.#unsubscribe !== null) return;
    const root = document.createElement('section');
    root.className = 'loom-map-shell';
    const toolbar = document.createElement('div');
    toolbar.className = 'loom-map-toolbar';
    const navigation =
      this.options.navigation === undefined ? null : renderNavigation(this.options.navigation);
    const provider =
      this.options.providers === undefined || this.options.selectedProvider === undefined
        ? null
        : renderProviderSelect(
            this.options.providers,
            this.options.selectedProvider,
            this.options.onProviderChange,
          );
    const refresh = button('Refresh', () => void this.#controller.refreshCurrentViewport());
    const fitAll = button('Fit all', () => void this.#controller.fitAll());
    const saveCamera = button(
      'Save current camera',
      () => void this.#controller.saveDefaultCamera(),
    );
    toolbar.append(refresh, fitAll, saveCamera);
    if (provider !== null) toolbar.append(provider);
    const status = document.createElement('p');
    status.className = 'loom-status loom-map-status';
    const saveStatus = document.createElement('span');
    saveStatus.className = 'loom-save-status';
    saveStatus.setAttribute('aria-live', 'polite');
    const tileStatus = document.createElement('p');
    tileStatus.className = 'loom-status loom-map-tile-status';
    const mapContainer = document.createElement('div');
    mapContainer.className = 'loom-map-container';
    mapContainer.setAttribute('role', 'application');
    const details = document.createElement('div');
    details.className = 'loom-map-details';
    root.append(
      ...(navigation === null ? [] : [navigation]),
      toolbar,
      saveStatus,
      status,
      tileStatus,
      mapContainer,
      details,
    );
    this.#container.replaceChildren(root);
    this.#status = status;
    this.#saveStatus = saveStatus;
    this.#tileStatus = tileStatus;
    this.#details = details;
    this.#refreshButton = refresh;
    this.#fitAllButton = fitAll;
    this.#saveCameraButton = saveCamera;
    this.#unsubscribe = this.#controller.subscribe((state) => this.renderState(state));
    this.#controller.mount(mapContainer);
    void this.#controller.load();
  }

  destroy(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    this.#controller.dispose();
    this.#status = null;
    this.#saveStatus = null;
    this.#tileStatus = null;
    this.#details = null;
    this.#refreshButton = null;
    this.#fitAllButton = null;
    this.#saveCameraButton = null;
    this.#container.replaceChildren();
  }

  renderState(state: MapViewState): void {
    if (this.#status === null || this.#tileStatus === null || this.#saveStatus === null) return;
    const offline = state.dataStatus === 'offline';
    this.#refreshButton?.toggleAttribute('disabled', offline);
    this.#fitAllButton?.toggleAttribute('disabled', offline);
    this.#saveCameraButton?.toggleAttribute('disabled', offline);
    renderSaveStatus(
      this.#saveStatus,
      state.saveStatus,
      this.options.translate ?? createTranslator('en'),
    );
    this.#status.dataset.status = state.dataStatus;
    this.#status.textContent = describeDataState(
      state,
      this.options.translate ?? createTranslator('en'),
    );
    this.#tileStatus.dataset.status = state.tileStatus;
    this.#tileStatus.textContent = describeTileState(state);
    this.#renderDetails(state);
  }

  #renderDetails(state: MapViewState): void {
    if (this.#details === null) return;
    this.#details.replaceChildren();
    if (state.selectedRecord !== null) {
      const record = document.createElement('section');
      record.className = 'loom-map-record-detail';
      const callbacks = {
        ...(this.options.onLocationEdit === undefined
          ? {}
          : {
              onLocationEdit: async (
                recordId: string,
                fieldId: string,
                intent: LocationEditIntent,
                recordValue?: LoomTableRecord,
              ) => {
                await this.options.onLocationEdit?.(recordId, fieldId, intent, recordValue);
                await this.#controller.openRecord(recordId);
              },
            }),
        ...(this.options.onOpenLocationInMap === undefined
          ? {}
          : { onOpenLocationInMap: this.options.onOpenLocationInMap }),
        ...(this.options.getConflict === undefined
          ? {}
          : { getConflict: this.options.getConflict }),
        ...(this.options.onConflictAction === undefined
          ? {}
          : {
              onConflictAction: async (recordId: string, action: 'use-server' | 'overwrite') => {
                await this.options.onConflictAction?.(recordId, action);
                await this.#controller.openRecord(recordId);
              },
            }),
      };
      record.append(
        createRecordDetail(state.selectedRecord, {
          translate: this.options.translate ?? createTranslator('en'),
          fields: state.fields,
          offline: state.dataStatus === 'offline',
          callbacks,
        }),
      );
      this.#details.append(record);
    }
    if (state.clusterRecords.length > 0 || state.clusterCursor !== null) {
      const cluster = document.createElement('section');
      cluster.className = 'loom-map-cluster-records';
      const title = document.createElement('strong');
      title.textContent = 'Cluster records';
      const records = document.createElement('pre');
      records.textContent = JSON.stringify(state.clusterRecords, null, 2);
      cluster.append(title, records);
      if (state.clusterCursor !== null) {
        cluster.append(
          button(
            'Load more cluster records',
            () => void this.options.onClusterNextPage?.(),
            state.dataStatus === 'offline',
          ),
        );
      }
      this.#details.append(cluster);
    }
  }
}

function renderNavigation(navigation: MapViewNavigation): HTMLElement {
  const root = document.createElement('div');
  root.className = 'loom-map-navigation';
  root.append(
    renderSelect(
      'Workspace',
      navigation.workspaces,
      navigation.selectedWorkspaceId,
      navigation.onWorkspaceChange,
    ),
    renderSelect('Base', navigation.bases, navigation.selectedBaseId, navigation.onBaseChange),
    renderSelect('Table', navigation.tables, navigation.selectedTableId, navigation.onTableChange),
    renderSelect('View', navigation.views, navigation.selectedViewId, navigation.onViewChange),
  );
  return root;
}

function renderSelect<T extends { id: string; name: string }>(
  labelText: string,
  resources: readonly T[],
  selectedId: string | null,
  onChange: (id: string) => void | Promise<void>,
): HTMLElement {
  const label = document.createElement('label');
  label.className = 'loom-map-select';
  label.append(document.createTextNode(labelText));
  const select = document.createElement('select');
  select.setAttribute('aria-label', labelText);
  for (const resource of resources) {
    const option = document.createElement('option');
    option.value = resource.id;
    option.textContent = resource.name;
    option.selected = resource.id === selectedId;
    select.append(option);
  }
  select.disabled = resources.length === 0;
  select.addEventListener('change', () => void onChange(select.value));
  label.append(select);
  return label;
}

function renderProviderSelect(
  providers: readonly TileProviderSummary[],
  selected: TileProviderRef,
  onChange: ((provider: TileProviderRef) => void | Promise<void>) | undefined,
): HTMLElement {
  const label = document.createElement('label');
  label.className = 'loom-map-select';
  label.append(document.createTextNode('Tiles'));
  const select = document.createElement('select');
  select.setAttribute('aria-label', 'Tile provider');
  for (const provider of providers) {
    const option = document.createElement('option');
    option.value = providerKey(provider.ref);
    option.textContent = provider.displayName;
    option.selected = providerKey(provider.ref) === providerKey(selected);
    select.append(option);
  }
  select.disabled = providers.length === 0;
  select.addEventListener('change', () => {
    const provider = providers.find((candidate) => providerKey(candidate.ref) === select.value);
    if (provider !== undefined) void onChange?.(provider.ref);
  });
  label.append(select);
  return label;
}

function providerKey(provider: TileProviderRef): string {
  return provider.kind === 'built-in' ? `built-in:${provider.id}` : `custom:${provider.profileId}`;
}

function button(label: string, onClick: () => void, disabled = false): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = 'loom-button';
  element.textContent = label;
  element.disabled = disabled;
  element.addEventListener('click', onClick);
  return element;
}

function describeDataState(state: MapViewState, translate: Translator): string {
  if (state.error !== null) return state.error.message;
  if (state.dataStatus === 'loading') return 'Loading Map data…';
  if (state.dataStatus === 'empty') return 'No renderable Records match this Map View.';
  if (state.dataStatus === 'configuration-required') return 'Map View configuration is required.';
  if (state.dataStatus === 'offline') return 'Offline. Cached Map data is read-only.';
  if (state.dataStatus === 'authentication') return 'Authentication is required to load this Map.';
  if (state.dataStatus === 'forbidden') return 'This Token cannot access the selected Map.';
  if (state.dataStatus === 'network') return 'Map data could not be reached. Retry when online.';
  if (state.dataStatus === 'server-error') return 'The Server returned an error for this Map.';
  if (state.summary !== null) {
    return [
      `${state.summary.matchedRecordCount} ${translate('map.summary.matched')}`,
      `${state.summary.renderableRecordCount} ${translate('map.summary.renderable')}`,
      `${state.summary.unlocatedRecordCount} ${translate('map.summary.unlocated')}`,
      `${state.summary.unrenderableRecordCount} ${translate('map.summary.unrenderable')}`,
    ].join(' · ');
  }
  return `${state.viewportRenderableRecordCount} ${translate('map.summary.renderable')}`;
}

function describeTileState(state: MapViewState): string {
  if (state.tileError !== null) return state.tileError.message;
  if (state.tileStatus === 'configuration-required')
    return 'Tile provider configuration is required.';
  if (state.tileStatus === 'error') return 'Tile provider error. Retry or choose another provider.';
  if (state.tileStatus === 'loading') return 'Loading tiles…';
  if (state.tileStatus === 'ready') return 'Tiles ready.';
  return '';
}
