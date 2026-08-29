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
  readonly canOpenLocationInMap?: (fieldId: string) => boolean;
  readonly getConflict?: (recordId: string) => RecordConflictView | undefined;
  readonly onConflictAction?: (
    recordId: string,
    action: 'use-server' | 'overwrite' | 'discard-all',
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
  #selectedRecordId: string | null = null;
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
    const translate = this.options.translate ?? createTranslator('en');
    const root = document.createElement('section');
    root.className = 'loom-map-shell';
    root.setAttribute('role', 'region');
    root.setAttribute('aria-label', translate('map.region'));
    const toolbar = document.createElement('div');
    toolbar.className = 'loom-map-toolbar';
    toolbar.setAttribute('role', 'toolbar');
    toolbar.setAttribute('aria-label', translate('map.region'));
    const navigation =
      this.options.navigation === undefined
        ? null
        : renderNavigation(this.options.navigation, translate);
    const provider =
      this.options.providers === undefined || this.options.selectedProvider === undefined
        ? null
        : renderProviderSelect(
            this.options.providers,
            this.options.selectedProvider,
            this.options.onProviderChange,
            translate,
          );
    const refresh = button(
      translate('map.refresh'),
      () => void this.#controller.refreshCurrentViewport(),
    );
    const fitAll = button(translate('map.fitAll'), () => void this.#controller.fitAll());
    const saveCamera = button(
      translate('map.saveCamera'),
      () => void this.#controller.saveDefaultCamera(),
    );
    toolbar.append(refresh, fitAll, saveCamera);
    if (provider !== null) toolbar.append(provider);
    const status = document.createElement('div');
    status.className = 'loom-status loom-map-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.setAttribute('aria-atomic', 'true');
    const saveStatus = document.createElement('span');
    saveStatus.className = 'loom-save-status';
    saveStatus.setAttribute('aria-live', 'polite');
    const tileStatus = document.createElement('div');
    tileStatus.className = 'loom-status loom-map-tile-status';
    tileStatus.setAttribute('role', 'status');
    tileStatus.setAttribute('aria-live', 'polite');
    tileStatus.setAttribute('aria-atomic', 'true');
    const mapContainer = document.createElement('div');
    mapContainer.className = 'loom-map-container';
    mapContainer.setAttribute('role', 'region');
    mapContainer.setAttribute('aria-label', translate('map.region'));
    const details = document.createElement('div');
    details.className = 'loom-map-details';
    details.setAttribute('role', 'region');
    details.setAttribute('aria-label', translate('record.details'));
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
    this.#selectedRecordId = null;
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
    const translate = this.options.translate ?? createTranslator('en');
    this.#status.dataset.status = state.dataStatus;
    this.#status.replaceChildren(
      document.createTextNode(describeDataState(state, translate)),
      ...(state.error === null
        ? []
        : [renderDiagnostic(translate('common.openDiagnostics'), errorDiagnostic(state.error))]),
    );
    this.#tileStatus.dataset.status = state.tileStatus;
    this.#tileStatus.replaceChildren(
      document.createTextNode(describeTileState(state, translate)),
      ...(state.tileError === null
        ? []
        : [
            renderDiagnostic(
              translate('common.openDiagnostics'),
              tileErrorDiagnostic(state.tileError),
            ),
          ]),
    );
    this.#renderDetails(state, translate);
  }

  #renderDetails(state: MapViewState, translate: Translator): void {
    if (this.#details === null) return;
    const selectedRecordChanged = this.#selectedRecordId !== state.selectedRecord?.id;
    this.#selectedRecordId = state.selectedRecord?.id ?? null;
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
        ...(this.options.canOpenLocationInMap === undefined
          ? {}
          : { canOpenLocationInMap: this.options.canOpenLocationInMap }),
        ...(this.options.getConflict === undefined
          ? {}
          : { getConflict: this.options.getConflict }),
        ...(this.options.onConflictAction === undefined
          ? {}
          : {
              onConflictAction: async (
                recordId: string,
                action: 'use-server' | 'overwrite' | 'discard-all',
              ) => {
                await this.options.onConflictAction?.(recordId, action);
                await this.#controller.openRecord(recordId);
              },
            }),
      };
      record.append(
        createRecordDetail(state.selectedRecord, {
          translate,
          fields: state.fields,
          offline: state.dataStatus === 'offline',
          confirmDiscard: (message) => window.confirm(message),
          callbacks,
        }),
      );
      this.#details.append(record);
      if (selectedRecordChanged) {
        record.querySelector<HTMLElement>('.loom-record-detail')?.focus();
      }
    }
    if (state.clusterRecords.length > 0 || state.clusterCursor !== null) {
      const cluster = document.createElement('section');
      cluster.className = 'loom-map-cluster-records';
      const title = document.createElement('strong');
      title.textContent = translate('map.clusterRecords');
      const records = document.createElement('pre');
      records.textContent = JSON.stringify(state.clusterRecords, null, 2);
      cluster.append(title, records);
      if (state.clusterCursor !== null) {
        cluster.append(
          button(
            translate('map.loadMoreClusterRecords'),
            () => void this.options.onClusterNextPage?.(),
            state.dataStatus === 'offline',
          ),
        );
      }
      this.#details.append(cluster);
    }
  }
}

function renderNavigation(navigation: MapViewNavigation, translate: Translator): HTMLElement {
  const root = document.createElement('div');
  root.className = 'loom-map-navigation';
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', translate('grid.view'));
  root.append(
    renderSelect(
      translate('grid.workspace'),
      navigation.workspaces,
      navigation.selectedWorkspaceId,
      navigation.onWorkspaceChange,
    ),
    renderSelect(
      translate('grid.base'),
      navigation.bases,
      navigation.selectedBaseId,
      navigation.onBaseChange,
    ),
    renderSelect(
      translate('grid.table'),
      navigation.tables,
      navigation.selectedTableId,
      navigation.onTableChange,
    ),
    renderSelect(
      translate('grid.view'),
      navigation.views,
      navigation.selectedViewId,
      navigation.onViewChange,
    ),
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
  translate: Translator,
): HTMLElement {
  const label = document.createElement('label');
  label.className = 'loom-map-select';
  label.append(document.createTextNode(translate('map.provider')));
  const select = document.createElement('select');
  select.setAttribute('aria-label', translate('map.provider'));
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
  if (state.dataStatus === 'loading') return translate('map.status.loading');
  if (state.dataStatus === 'empty') return translate('map.status.empty');
  if (state.dataStatus === 'configuration-required') return translate('map.status.configuration');
  if (state.dataStatus === 'offline') return translate('map.status.offline');
  if (state.dataStatus === 'authentication') return translate('map.status.authentication');
  if (state.dataStatus === 'forbidden') return translate('map.status.forbidden');
  if (state.dataStatus === 'network') return translate('map.status.network');
  if (state.dataStatus === 'server-error' || state.error !== null) {
    return translate('map.status.server');
  }
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

function describeTileState(state: MapViewState, translate: Translator): string {
  if (state.tileStatus === 'configuration-required') {
    return translate('map.tiles.configuration');
  }
  if (state.tileStatus === 'error' || state.tileError !== null) {
    return translate('map.tiles.error');
  }
  if (state.tileStatus === 'loading') return translate('map.tiles.loading');
  if (state.tileStatus === 'ready') return translate('map.tiles.ready');
  return '';
}

function renderDiagnostic(label: string, details: string): HTMLElement {
  const wrapper = document.createElement('details');
  wrapper.className = 'loom-diagnostic';
  const summary = document.createElement('summary');
  summary.textContent = label;
  const pre = document.createElement('pre');
  pre.textContent = details;
  wrapper.append(summary, pre);
  return wrapper;
}

function errorDiagnostic(error: {
  readonly code?: string;
  readonly httpStatus?: number;
  readonly requestId?: string;
}): string {
  return JSON.stringify(
    {
      ...(error.code === undefined ? {} : { code: error.code }),
      ...(error.httpStatus === undefined ? {} : { httpStatus: error.httpStatus }),
      ...(error.requestId === undefined ? {} : { requestId: error.requestId }),
    },
    null,
    2,
  );
}

function tileErrorDiagnostic(error: {
  readonly kind?: string;
  readonly providerId?: string;
  readonly code?: string;
  readonly httpStatus?: number;
  readonly requestId?: string;
}): string {
  return JSON.stringify(
    {
      ...(error.kind === undefined ? {} : { kind: error.kind }),
      ...(error.providerId === undefined ? {} : { providerId: error.providerId }),
      ...(error.code === undefined ? {} : { code: error.code }),
      ...(error.httpStatus === undefined ? {} : { httpStatus: error.httpStatus }),
      ...(error.requestId === undefined ? {} : { requestId: error.requestId }),
    },
    null,
    2,
  );
}
