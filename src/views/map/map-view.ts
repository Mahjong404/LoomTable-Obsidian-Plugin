import type {
  Field,
  FilterNode,
  JsonValue,
  LocationValue,
  LoomTableRecord,
  MutationValue,
} from '../../client/loomtable-client';
import { createTranslator, type Translator } from '../../i18n';
import type { MessageKey } from '../../i18n/messages';
import type {
  TileProviderRef,
  TileProviderError,
  TileProviderSummary,
} from '../../maps/providers/tile-provider-schema';
import type { LocationEditIntent } from '../../ui/field-value-editor';
import type { AttachmentAddHandler, AttachmentDetachHandler } from '../../ui/attachment-upload';
import {
  createRenderedFieldValueElement,
  defaultFieldRendererRegistry,
  type RenderedAttachment,
  type RenderedFieldValue,
} from '../../ui/field-renderer-registry';
import { createRecordDetail, type RecordConflictView } from '../../ui/record-detail';
import { FilterBuilder } from '../../ui/filter-builder';
import { createRecordCreateForm, type RecordCreateForm } from '../../ui/record-create-form';
import type { LocationPreviewHandle } from '../../ui/location-preview';
import { renderSaveStatus } from '../../ui/save-status';
import type { MapViewController } from './map-view-controller';
import type { MapViewState } from './map-view-model';

import { ensureButtonLabels, labelContainer } from '../../ui/a11y';
export interface MapViewOptions {
  readonly translate?: Translator;
  readonly onClusterNextPage?: () => void | Promise<void>;
  readonly onClusterRetry?: () => void | Promise<void>;
  readonly onTileRetry?: () => void | Promise<void>;
  readonly onLocationEdit?: (
    recordId: string,
    fieldId: string,
    intent: LocationEditIntent,
    record?: LoomTableRecord,
  ) => void | LoomTableRecord | Promise<void | LoomTableRecord>;
  readonly onOpenLocationInMap?: (
    recordId: string,
    fieldId: string,
    location: LocationValue,
  ) => void | Promise<void>;
  readonly canOpenLocationInMap?: (fieldId: string) => boolean;
  readonly locationPreview?: LocationPreviewHandle;
  readonly onApplyFilter?: (
    viewId: string,
    filter: FilterNode | undefined,
  ) => void | Promise<unknown>;
  readonly onFieldEdit?: (
    recordId: string,
    fieldId: string,
    value: JsonValue,
    record: LoomTableRecord,
    options?: { readonly unset?: boolean },
  ) => LoomTableRecord | Promise<LoomTableRecord>;
  readonly onAttachmentDownload?: (
    recordId: string,
    fieldId: string,
    attachment: RenderedAttachment,
  ) => void | Promise<void>;
  readonly canAttachmentDownload?: (attachment: RenderedAttachment) => boolean;
  readonly onAttachmentOpen?: (
    recordId: string,
    fieldId: string,
    attachment: RenderedAttachment,
  ) => void | Promise<void>;
  readonly onAttachmentPreview?: (
    recordId: string,
    fieldId: string,
    attachment: RenderedAttachment,
  ) => void | Promise<void>;
  readonly onAttachmentAdd?: AttachmentAddHandler;
  readonly onAttachmentAddRetry?: AttachmentAddHandler;
  readonly onAttachmentDetach?: AttachmentDetachHandler;
  readonly attachmentThumbnail?: (attachment: RenderedAttachment) => string | undefined;
  readonly getConflict?: (recordId: string) => RecordConflictView | undefined;
  readonly onConflictAction?: (
    recordId: string,
    action: 'use-server' | 'overwrite' | 'discard-all',
  ) => void | Promise<void>;
  readonly providers?: readonly TileProviderSummary[];
  readonly selectedProvider?: TileProviderRef;
  readonly onProviderChange?: (provider: TileProviderRef) => void | Promise<void>;
  readonly onOpenSettings?: () => void | Promise<void>;
  readonly onCreateRecord?: (
    values: Readonly<Record<string, MutationValue>>,
  ) => Promise<LoomTableRecord>;
  readonly onDeleteRecord?: (recordId: string, record: LoomTableRecord) => void | Promise<void>;
  readonly confirmDiscard?: (message: string) => boolean;
}

type MapAction =
  'refresh' | 'fitAll' | 'saveCamera' | 'settings' | 'tileRetry' | 'clusterRetry' | 'clusterNext';

interface MapActionButtonSpec {
  readonly action: MapAction;
  readonly labelKey: MessageKey;
  readonly pendingKey: MessageKey;
}

export class MapView {
  readonly #container: HTMLElement;
  readonly #controller: MapViewController;
  #unsubscribe: (() => void) | null = null;
  #status: HTMLElement | null = null;
  #saveStatus: HTMLElement | null = null;
  #tileStatus: HTMLElement | null = null;
  #tileActionButton: HTMLButtonElement | null = null;
  #details: HTMLElement | null = null;
  #selectedRecordId: string | null = null;
  #errorActionButton: HTMLButtonElement | null = null;
  #lastState: MapViewState | null = null;
  #destroyed = false;
  readonly #pendingActions = new Set<MapAction>();
  readonly #actionButtons = new Map<HTMLButtonElement, MapActionButtonSpec>();
  readonly #clusterActionButtons = new Set<HTMLButtonElement>();
  #focusedAction: MapAction | null = null;
  #filterOpen = false;
  #filterBuilder: FilterBuilder | null = null;
  #filterViewId: string | null = null;
  #filterHost: HTMLElement | null = null;
  #createOpen = false;
  #createForm: RecordCreateForm | null = null;
  #createHost: HTMLElement | null = null;
  #createToggle: HTMLButtonElement | null = null;

  constructor(
    container: HTMLElement,
    controller: MapViewController,
    private readonly options: MapViewOptions = {},
  ) {
    this.#container = container;
    this.#controller = controller;
  }

  mount(): void {
    if (this.#unsubscribe !== null || this.#destroyed) return;
    const translate = this.options.translate ?? createTranslator('en');
    const root = document.createElement('section');
    root.className = 'loom-map-shell';
    root.setAttribute('role', 'region');
    labelContainer(root, translate('map.region'));
    const toolbar = document.createElement('div');
    toolbar.className = 'loom-map-toolbar';
    toolbar.setAttribute('role', 'toolbar');
    labelContainer(toolbar, translate('map.region'));
    const provider =
      this.options.providers === undefined || this.options.selectedProvider === undefined
        ? null
        : renderProviderSelect(
            this.options.providers,
            this.options.selectedProvider,
            this.options.onProviderChange,
            translate,
          );
    const refresh = this.#createActionButton('refresh', 'map.refresh', 'map.refreshing', () =>
      this.#controller.refreshCurrentViewport(),
    );
    const fitAll = this.#createActionButton('fitAll', 'map.fitAll', 'map.fittingAll', () =>
      this.#controller.fitAll(),
    );
    const saveCamera = this.#createActionButton(
      'saveCamera',
      'map.saveCamera',
      'map.savingCamera',
      () => this.#controller.saveDefaultCamera(),
    );
    const start = document.createElement('div');
    start.className = 'loom-toolbar-group loom-toolbar-start';
    const end = document.createElement('div');
    end.className = 'loom-toolbar-group loom-toolbar-end';
    if (this.options.onApplyFilter !== undefined) {
      const filterButton = document.createElement('button');
      filterButton.type = 'button';
      filterButton.className = 'loom-button loom-map-filter-toggle';
      filterButton.textContent = translate('filter.title');
      filterButton.setAttribute('aria-label', translate('filter.title'));
      filterButton.setAttribute('aria-expanded', 'false');
      filterButton.addEventListener('click', () => {
        this.#filterOpen = !this.#filterOpen;
        filterButton.setAttribute('aria-expanded', this.#filterOpen ? 'true' : 'false');
        if (this.#lastState !== null) this.#renderFilterPanel(this.#lastState, translate);
      });
      start.append(filterButton);
    }
    if (provider !== null) {
      if (start.childElementCount > 0) {
        const divider = document.createElement('span');
        divider.className = 'loom-toolbar-divider';
        divider.setAttribute('aria-hidden', 'true');
        start.append(divider);
      }
      start.append(provider);
    }
    end.append(fitAll, saveCamera);
    if (this.options.onCreateRecord !== undefined) {
      const createButton = document.createElement('button');
      createButton.type = 'button';
      createButton.className = 'loom-button loom-map-record-create';
      createButton.textContent = translate('record.create.add');
      createButton.setAttribute('aria-expanded', 'false');
      createButton.addEventListener('click', () => {
        this.#createOpen = !this.#createOpen;
        createButton.setAttribute('aria-expanded', this.#createOpen ? 'true' : 'false');
        if (this.#lastState !== null) this.#renderCreatePanel(this.#lastState, translate);
      });
      end.append(createButton);
      this.#createToggle = createButton;
    }
    end.append(refresh);
    toolbar.append(start, end);
    const filterHost = document.createElement('div');
    filterHost.className = 'loom-map-filter-host';
    this.#filterHost = filterHost;
    const createHost = document.createElement('div');
    createHost.className = 'loom-map-create-host';
    this.#createHost = createHost;
    const status = document.createElement('div');
    status.className = 'loom-status loom-map-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.setAttribute('aria-atomic', 'true');
    const saveStatus = document.createElement('span');
    saveStatus.className = 'loom-save-status';
    saveStatus.setAttribute('aria-live', 'polite');
    end.prepend(saveStatus);
    const tileStatus = document.createElement('div');
    tileStatus.className = 'loom-status loom-map-tile-status';
    tileStatus.setAttribute('role', 'status');
    tileStatus.setAttribute('aria-live', 'polite');
    tileStatus.setAttribute('aria-atomic', 'true');
    const mapContainer = document.createElement('div');
    mapContainer.className = 'loom-map-container';
    mapContainer.setAttribute('role', 'region');
    labelContainer(mapContainer, translate('map.region'));
    mapContainer.tabIndex = -1;
    const details = document.createElement('div');
    details.className = 'loom-map-details';
    details.setAttribute('role', 'region');
    labelContainer(details, translate('record.details'));
    root.append(toolbar, filterHost, createHost, status, tileStatus, mapContainer, details);
    ensureButtonLabels(root);
    this.#container.replaceChildren(root);
    this.#status = status;
    this.#saveStatus = saveStatus;
    this.#tileStatus = tileStatus;
    this.#details = details;
    this.#unsubscribe = this.#controller.subscribe((state) => this.renderState(state));
    this.#controller.mount(mapContainer);
    void this.#controller.load();
  }

  #renderFilterPanel(state: MapViewState, translate: Translator): void {
    const host = this.#filterHost;
    if (host === null) return;
    const onApplyFilter = this.options.onApplyFilter;
    if (!this.#filterOpen || onApplyFilter === undefined || state.view.type !== 'map') {
      host.replaceChildren();
      return;
    }
    const view = state.view;
    // The builder applies changes as they happen; key it by View so a saved
    // revision bump does not discard an in-flight draft.
    if (this.#filterBuilder === null || this.#filterViewId !== view.id) {
      this.#filterBuilder = new FilterBuilder(
        view.type === 'map' ? view.config.filter : undefined,
        {
          fields: state.fields.filter((field) => field.deletedAt === undefined),
          translate,
          onApply: (filter) => onApplyFilter(view.id, filter),
          onInvalidate: () => {
            if (this.#lastState !== null) this.#renderFilterPanel(this.#lastState, translate);
          },
        },
      );
      this.#filterViewId = view.id;
    }
    host.replaceChildren(this.#filterBuilder.render());
  }

  #renderCreatePanel(state: MapViewState, translate: Translator): void {
    const host = this.#createHost;
    if (host === null) return;
    const onCreateRecord = this.options.onCreateRecord;
    if (!this.#createOpen || onCreateRecord === undefined) {
      host.replaceChildren();
      return;
    }
    if (this.#createForm === null) {
      this.#createForm = createRecordCreateForm({
        fields: state.fields.filter((field) => field.deletedAt === undefined),
        translate,
        offline: state.dataStatus === 'offline',
        ...(this.options.confirmDiscard === undefined
          ? {}
          : { confirmDiscard: this.options.confirmDiscard }),
        onSubmit: async (values) => {
          this.#createForm?.setBusy(true);
          try {
            const record = await onCreateRecord(values);
            this.#createOpen = false;
            this.#createToggle?.setAttribute('aria-expanded', 'false');
            this.#createForm = null;
            if (this.#lastState !== null) {
              this.#renderCreatePanel(this.#lastState, translate);
            }
            void this.#controller.openRecord(record.id);
          } catch (error) {
            this.#createForm?.setBusy(false);
            this.#createForm?.showError(
              error instanceof Error ? error.message : translate('record.create.failed'),
            );
          }
        },
        onCancel: () => {
          this.#createOpen = false;
          this.#createToggle?.setAttribute('aria-expanded', 'false');
          this.#createForm = null;
          this.#renderCreatePanel(state, translate);
        },
      });
    }
    host.replaceChildren(this.#createForm.element);
  }

  destroy(): void {
    this.#destroyed = true;
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    this.#controller.dispose();
    this.#status = null;
    this.#saveStatus = null;
    this.#tileStatus = null;
    this.#tileActionButton = null;
    this.#details = null;
    this.#selectedRecordId = null;
    this.#errorActionButton = null;
    this.#lastState = null;
    this.#focusedAction = null;
    this.#filterBuilder = null;
    this.#filterHost = null;
    this.#filterOpen = false;
    this.#createForm = null;
    this.#createHost = null;
    this.#createToggle = null;
    this.#createOpen = false;
    this.#actionButtons.clear();
    this.#clusterActionButtons.clear();
    this.#container.replaceChildren();
  }

  renderState(state: MapViewState): void {
    if (this.#status === null || this.#tileStatus === null || this.#saveStatus === null) return;
    this.#lastState = state;
    renderSaveStatus(
      this.#saveStatus,
      state.saveStatus,
      this.options.translate ?? createTranslator('en'),
    );
    const translate = this.options.translate ?? createTranslator('en');
    this.#renderFilterPanel(state, translate);
    if (this.#errorActionButton !== null) this.#actionButtons.delete(this.#errorActionButton);
    if (this.#tileActionButton !== null) this.#actionButtons.delete(this.#tileActionButton);
    for (const element of this.#clusterActionButtons) this.#actionButtons.delete(element);
    this.#clusterActionButtons.clear();
    this.#errorActionButton = null;
    this.#tileActionButton = null;
    const dataAction = this.#renderDataAction();
    const tileAction = this.#renderTileAction();
    this.#status.dataset.status = state.dataStatus;
    this.#status.replaceChildren(
      document.createTextNode(describeDataState(state, translate)),
      ...(dataAction === null ? [] : [dataAction]),
      ...(state.error === null
        ? []
        : [renderDiagnostic(translate('common.openDiagnostics'), errorDiagnostic(state.error))]),
    );
    this.#tileStatus.dataset.status = state.tileStatus;
    const tileText = describeTileState(state, translate);
    this.#tileStatus.replaceChildren(
      document.createTextNode(tileText),
      ...(tileAction === null ? [] : [tileAction]),
      ...(state.tileError === null
        ? []
        : [
            renderDiagnostic(
              translate('common.openDiagnostics'),
              tileErrorDiagnostic(state.tileError),
            ),
          ]),
    );
    // Ready/quiet states stay announced through the live region but take no
    // layout space; loading, error and configuration-required remain visible.
    this.#tileStatus.classList.toggle(
      'loom-visually-hidden',
      tileAction === null &&
        state.tileError === null &&
        (state.tileStatus === 'ready' || tileText === ''),
    );
    this.#renderDetails(state, translate);
    this.#syncActionButtons(translate);
    this.#restoreFocusedAction();
  }

  confirmDiscardIfNeeded(): boolean {
    const draft = this.#details?.querySelector<HTMLElement>(
      '.loom-location-editor[data-dirty="true"], .loom-record-field-editor[data-dirty="true"]',
    );
    if (draft === null || draft === undefined) {
      return true;
    }
    const message = (this.options.translate ?? createTranslator('en'))(
      draft.classList.contains('loom-record-field-editor')
        ? 'record.field.discardConfirm'
        : 'record.location.discardConfirm',
    );
    if (this.options.confirmDiscard !== undefined) return this.options.confirmDiscard(message);
    if (typeof window === 'undefined' || typeof window.confirm !== 'function') return false;
    try {
      return window.confirm(message);
    } catch {
      return false;
    }
  }

  #createActionButton(
    action: MapAction,
    labelKey: MessageKey,
    pendingKey: MessageKey,
    operation: () => void | Promise<void>,
  ): HTMLButtonElement {
    const translate = this.options.translate ?? createTranslator('en');
    const element = button(translate(labelKey), () => {
      if (element.disabled) return;
      this.#focusedAction = action;
      element.focus();
      this.#runAction(action, operation);
    });
    element.setAttribute('aria-label', translate(labelKey));
    this.#actionButtons.set(element, { action, labelKey, pendingKey });
    return element;
  }

  #runAction(action: MapAction, operation: () => void | Promise<void>): void {
    if (this.#pendingActions.has(action)) return;
    this.#pendingActions.add(action);
    this.#syncActionButtons(this.options.translate ?? createTranslator('en'));
    void Promise.resolve()
      .then(operation)
      .catch(() => undefined)
      .finally(() => {
        this.#pendingActions.delete(action);
        if (this.#destroyed) return;
        this.#syncActionButtons(this.options.translate ?? createTranslator('en'));
        this.#restoreFocusedAction();
        this.#focusedAction = null;
      });
  }

  #syncActionButtons(translate: Translator): void {
    const offline = this.#lastState?.dataStatus === 'offline';
    for (const [element, spec] of this.#actionButtons) {
      const pending = this.#pendingActions.has(spec.action);
      const label = translate(pending ? spec.pendingKey : spec.labelKey);
      element.disabled = pending || (offline && spec.action !== 'settings');
      element.textContent = label;
      element.setAttribute('aria-label', label);
      if (pending) element.setAttribute('aria-busy', 'true');
      else element.removeAttribute('aria-busy');
    }
  }

  #restoreFocusedAction(): void {
    if (this.#focusedAction === null) return;
    for (const [element, spec] of this.#actionButtons) {
      if (spec.action === this.#focusedAction && !element.disabled) {
        element.focus();
        return;
      }
    }
  }

  #renderDataAction(): HTMLButtonElement | null {
    if (this.#lastState === null) return null;
    if (
      this.#lastState.dataStatus === 'authentication' ||
      this.#lastState.dataStatus === 'forbidden'
    ) {
      if (this.options.onOpenSettings === undefined) return null;
      const action = this.#createActionButton(
        'settings',
        'common.openSettings',
        'common.openingSettings',
        this.options.onOpenSettings,
      );
      this.#errorActionButton = action;
      return action;
    }
    if (this.#lastState.dataStatus === 'network' || this.#lastState.dataStatus === 'server-error') {
      const action = this.#createActionButton('refresh', 'map.retry', 'map.refreshing', () =>
        this.#controller.refreshCurrentViewport(),
      );
      this.#errorActionButton = action;
      return action;
    }
    return null;
  }

  #renderTileAction(): HTMLButtonElement | null {
    if (this.#lastState === null) return null;
    if (
      this.#lastState.tileStatus === 'configuration-required' &&
      this.options.onOpenSettings !== undefined
    ) {
      const action = this.#createActionButton(
        'settings',
        'common.openSettings',
        'common.openingSettings',
        this.options.onOpenSettings,
      );
      this.#tileActionButton = action;
      return action;
    }
    if (this.#lastState.tileStatus === 'error' && this.options.onTileRetry !== undefined) {
      const action = this.#createActionButton(
        'tileRetry',
        'map.retryTiles',
        'map.retryingTiles',
        this.options.onTileRetry,
      );
      this.#tileActionButton = action;
      return action;
    }
    return null;
  }

  #renderDetails(state: MapViewState, translate: Translator): void {
    if (this.#details === null) return;
    const selectedRecordChanged = this.#selectedRecordId !== state.selectedRecord?.id;
    const existingRecord = this.#details.querySelector<HTMLElement>('.loom-map-record-detail');
    const existingDraft = existingRecord?.querySelector<HTMLElement>(
      '.loom-location-editor[data-dirty="true"], .loom-record-field-editor[data-dirty="true"]',
    );
    if (
      existingDraft !== null &&
      existingDraft !== undefined &&
      selectedRecordChanged &&
      !this.confirmDiscardIfNeeded()
    ) {
      return;
    }
    const nextRecordVersion =
      state.selectedRecord === null ? null : recordVersion(state.selectedRecord);
    const preserveExistingRecord =
      state.selectedRecord !== null &&
      existingRecord !== null &&
      !selectedRecordChanged &&
      ((existingDraft !== null && existingDraft !== undefined) ||
        existingRecord.dataset.recordVersion === nextRecordVersion);

    this.#selectedRecordId = state.selectedRecord?.id ?? null;
    if (!preserveExistingRecord) this.#details.replaceChildren();
    if (state.selectedRecord !== null && !preserveExistingRecord) {
      const record = document.createElement('section');
      record.className = 'loom-map-record-detail';
      record.dataset.recordVersion = nextRecordVersion ?? '';
      const onFieldEdit = this.options.onFieldEdit;
      const callbacks = {
        onClose: () => {
          this.#details?.classList.remove('is-modal');
          this.#controller.closeRecord();
          this.#container.querySelector<HTMLElement>('.loom-map-container')?.focus();
        },
        ...(this.options.onLocationEdit === undefined
          ? {}
          : {
              onLocationEdit: async (
                recordId: string,
                fieldId: string,
                intent: LocationEditIntent,
                recordValue?: LoomTableRecord,
              ) => {
                const updatedRecord = await this.options.onLocationEdit?.(
                  recordId,
                  fieldId,
                  intent,
                  recordValue,
                );
                await this.#controller.openRecord(recordId);
                return updatedRecord;
              },
            }),
        ...(this.options.onOpenLocationInMap === undefined
          ? {}
          : { onOpenLocationInMap: this.options.onOpenLocationInMap }),
        ...(this.options.canOpenLocationInMap === undefined
          ? {}
          : { canOpenLocationInMap: this.options.canOpenLocationInMap }),
        ...(onFieldEdit === undefined
          ? {}
          : {
              onFieldEdit: async (
                recordId: string,
                fieldId: string,
                value: JsonValue,
                recordValue: LoomTableRecord,
                options?: { readonly unset?: boolean },
              ) => {
                const updated =
                  options === undefined
                    ? await onFieldEdit(recordId, fieldId, value, recordValue)
                    : await onFieldEdit(recordId, fieldId, value, recordValue, options);
                await this.#controller.openRecord(recordId);
                return updated;
              },
            }),
        ...(this.options.onAttachmentDownload === undefined
          ? {}
          : { onAttachmentDownload: this.options.onAttachmentDownload }),
        ...(this.options.canAttachmentDownload === undefined
          ? {}
          : { canAttachmentDownload: this.options.canAttachmentDownload }),
        ...(this.options.onAttachmentOpen === undefined
          ? {}
          : { onAttachmentOpen: this.options.onAttachmentOpen }),
        ...(this.options.onAttachmentPreview === undefined
          ? {}
          : { onAttachmentPreview: this.options.onAttachmentPreview }),
        ...(this.options.onAttachmentAdd === undefined
          ? {}
          : {
              onAttachmentAdd: async (
                recordId: string,
                fieldId: string,
                recordValue: LoomTableRecord,
                maxCount: number,
              ) => {
                const updated = await this.options.onAttachmentAdd?.(
                  recordId,
                  fieldId,
                  recordValue,
                  maxCount,
                );
                if (updated !== null) await this.#controller.openRecord(recordId);
                return updated;
              },
            }),
        ...(this.options.onAttachmentAddRetry === undefined
          ? {}
          : {
              onAttachmentAddRetry: async (
                recordId: string,
                fieldId: string,
                recordValue: LoomTableRecord,
                maxCount: number,
              ) => {
                const updated = await this.options.onAttachmentAddRetry?.(
                  recordId,
                  fieldId,
                  recordValue,
                  maxCount,
                );
                if (updated !== null) await this.#controller.openRecord(recordId);
                return updated;
              },
            }),
        ...(this.options.onAttachmentDetach === undefined
          ? {}
          : {
              onAttachmentDetach: async (
                recordId: string,
                fieldId: string,
                attachmentId: string,
                recordValue: LoomTableRecord,
              ) => {
                const updated = await this.options.onAttachmentDetach?.(
                  recordId,
                  fieldId,
                  attachmentId,
                  recordValue,
                );
                if (updated !== undefined) await this.#controller.openRecord(recordId);
                return updated;
              },
            }),
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
        ...(this.options.onDeleteRecord === undefined
          ? {}
          : { onDeleteRecord: this.options.onDeleteRecord }),
      };
      record.append(
        createRecordDetail(state.selectedRecord, {
          translate,
          fields: state.fields,
          ...(state.primaryFieldId === null ? {} : { primaryFieldId: state.primaryFieldId }),
          offline: state.dataStatus === 'offline',
          returnFocus: this.#container.querySelector<HTMLElement>('.loom-map-container'),
          confirmDiscard: (message) => window.confirm(message),
          callbacks,
          ...(this.options.locationPreview === undefined
            ? {}
            : { locationPreview: this.options.locationPreview }),
        }),
      );
      this.#details.append(record);
      if (selectedRecordChanged) {
        record.querySelector<HTMLElement>('.loom-record-detail')?.focus();
      }
    }
    this.#renderClusterDetails(state, translate);
  }

  #renderClusterDetails(state: MapViewState, translate: Translator): void {
    if (this.#details === null) return;
    this.#details.querySelector('.loom-map-cluster-records')?.remove();
    if (state.clusterStatus === 'idle') return;

    const cluster = document.createElement('section');
    cluster.className = 'loom-map-cluster-records';
    cluster.setAttribute('role', 'region');
    cluster.setAttribute('aria-live', 'polite');
    const title = document.createElement('h3');
    title.textContent = translate('map.clusterRecords');
    cluster.append(title);

    const status = document.createElement('p');
    status.className = 'loom-map-cluster-status';
    if (state.clusterStatus === 'loading') {
      status.textContent = translate('map.clusterLoading');
    } else if (state.clusterStatus === 'empty') {
      status.textContent = translate('map.clusterEmpty');
    } else if (state.clusterStatus === 'error') {
      status.textContent = translate('map.clusterError');
      if (state.clusterError !== null) {
        status.append(
          renderDiagnostic(
            translate('common.openDiagnostics'),
            errorDiagnostic(state.clusterError),
          ),
        );
      }
      if (this.options.onClusterRetry !== undefined) {
        const retry = this.#createActionButton(
          'clusterRetry',
          'map.retryCluster',
          'map.retryingCluster',
          this.options.onClusterRetry,
        );
        retry.classList.add('loom-map-cluster-retry');
        this.#clusterActionButtons.add(retry);
        status.append(retry);
      }
    }
    if (status.textContent !== '') cluster.append(status);

    if (state.clusterRecords.length > 0) {
      const records = document.createElement('ul');
      records.setAttribute('role', 'list');
      for (const record of state.clusterRecords) {
        const item = document.createElement('li');
        item.setAttribute('role', 'listitem');
        const rendered = clusterRecordLabel(record, state.fields, translate, state.primaryFieldId);
        const open = button(
          rendered.label,
          () => {
            void this.#controller.openRecord(record.id);
          },
          state.dataStatus === 'offline',
        );
        open.classList.add('loom-map-cluster-record');
        item.append(open);
        if (rendered.link !== undefined) {
          const link = createRenderedFieldValueElement(rendered.link);
          link.classList.add('loom-map-cluster-record-url');
          item.append(document.createTextNode(' — '), link);
        }
        records.append(item);
      }
      cluster.append(records);
    }

    if (state.clusterCursor !== null && this.options.onClusterNextPage !== undefined) {
      const next = this.#createActionButton(
        'clusterNext',
        'map.loadMoreClusterRecords',
        'map.loadingMoreClusterRecords',
        this.options.onClusterNextPage,
      );
      next.classList.add('loom-map-cluster-next');
      this.#clusterActionButtons.add(next);
      cluster.append(next);
    }

    const close = button(translate('map.closeCluster'), () => {
      this.#controller.closeCluster();
      this.#container.querySelector<HTMLElement>('.loom-map-container')?.focus();
    });
    close.classList.add('loom-map-cluster-close');
    cluster.append(close);
    this.#details.append(cluster);
  }
}

function clusterRecordLabel(
  record: LoomTableRecord,
  fields: readonly Field[],
  translate: Translator,
  primaryFieldId: string | null,
): { readonly label: HTMLElement; readonly link?: RenderedFieldValue } {
  const candidates =
    fields.length > 0
      ? fields.map((field) => ({ field, value: record.values[field.id] }))
      : Object.entries(record.values).map(([id, value], position) => ({
          field: fallbackTextField(record.tableId, id, position),
          value,
        }));
  const rendered = candidates.map(({ field, value }) => ({
    fieldId: field.id,
    value: defaultFieldRendererRegistry.render(field, value, { translate }),
  }));
  const nonEmpty = rendered.filter(
    ({ value }) =>
      (value.state === 'value' || value.state === 'located') &&
      (value.chips === undefined ? value.text !== '' : value.chips.length > 0),
  );
  const primary = nonEmpty.find(({ fieldId }) => fieldId === primaryFieldId);
  const label = document.createElement('span');
  label.className = 'loom-map-cluster-record-label';
  const title = document.createElement('span');
  title.className = 'loom-map-cluster-record-title';
  if (primary !== undefined) {
    title.append(createRenderedFieldValueElement(primary.value, { compactAttachments: true }));
  } else {
    title.textContent = record.id;
  }
  label.append(title);
  const meta = document.createElement('span');
  meta.className = 'loom-map-cluster-record-meta';
  meta.append(document.createTextNode(`${translate('map.clusterRecord')}: ${record.id}`));
  let link: RenderedFieldValue | undefined;
  const extras = nonEmpty.filter(({ fieldId }) => fieldId !== primary?.fieldId).slice(0, 3);
  for (const extra of extras) {
    if (extra.value.link !== undefined) {
      link ??= extra.value;
      continue;
    }
    meta.append(
      document.createTextNode(' · '),
      createRenderedFieldValueElement(extra.value, { compactAttachments: true }),
    );
  }
  if (extras.length > 0) label.append(document.createTextNode(' — '), meta);
  else label.append(meta);
  return link === undefined ? { label } : { label, link };
}

function fallbackTextField(tableId: string, id: string, position: number): Field {
  return {
    id,
    tableId,
    name: id,
    position,
    schemaVersion: 1,
    revision: 1,
    type: 'text',
    config: {},
  };
}

function recordVersion(record: LoomTableRecord): string {
  return [record.id, record.revision, record.updatedAt].join(':');
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

function button(
  label: string | HTMLElement,
  onClick: () => void,
  disabled = false,
): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = 'loom-button';
  if (typeof label === 'string') element.textContent = label;
  else element.append(label);
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
  if (state.tileError !== null && isTileProviderError(state.tileError)) {
    const messageKeys: Record<TileProviderError['kind'], MessageKey> = {
      'configuration-required': 'map.providerError.configurationRequired',
      'invalid-profile': 'map.providerError.invalidProfile',
      'invalid-origin': 'map.providerError.invalidOrigin',
      'invalid-template': 'map.providerError.invalidTemplate',
      'unsupported-crs': 'map.providerError.unsupportedCrs',
      'tile-error': 'map.providerError.tileError',
    };
    return translate(messageKeys[state.tileError.kind]);
  }
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

function isTileProviderError(error: MapViewState['tileError']): error is TileProviderError {
  return (
    error !== null &&
    'kind' in error &&
    typeof error.kind === 'string' &&
    [
      'configuration-required',
      'invalid-profile',
      'invalid-origin',
      'invalid-template',
      'unsupported-crs',
      'tile-error',
    ].includes(error.kind)
  );
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
