import { ItemView, TFile, type WorkspaceLeaf } from 'obsidian';

import type {
  FilterNode,
  JsonValue,
  LoomTableClient,
  LoomTableRecord,
  MutationValue,
  View,
} from '../client/loomtable-client';
import type { Translator } from '../i18n';
import type { TileCredentialReader } from '../maps/providers/tile-provider-schema';
import type { TileProviderRegistry } from '../maps/providers/tile-provider-registry';
import type { MapRenderer } from '../maps/renderer/map-renderer';
import type { ConnectionProfile } from '../settings/connection-profile';
import type { PluginSettings } from '../settings/plugin-settings';
import { ViewCreateIntentStore } from '../settings/view-intents';
import type { DurableMutationQueuePort } from './mutation-queue-scheduler';
import {
  subscribeMutationInvalidation,
  type MutationInvalidationBus,
} from './mutation-invalidation';
import { GridViewController, type GridState } from './grid-view-controller';
import { describeSaveStatus } from './save-status';
import { ReadonlyGridRenderer } from './readonly-grid-renderer';
import { MapViewController, type MapViewportSource } from '../views/map/map-view-controller';
import { MapView, type MapViewNavigation } from '../views/map/map-view';
import type { ViewUpdatePatch } from './view-write-coordinator';
import {
  createAttachmentDownloadCallback,
  createBrowserAttachmentDownloadHost,
  isAttachmentDownloadable,
} from './attachment-download';
import { createAttachmentAddCallback, createAttachmentDetachCallback } from './attachment-upload';
import {
  createAttachmentOpenCallback,
  createAttachmentPreviewCallback,
  createBrowserAttachmentPreviewHost,
  createObsidianAttachmentDownloadHost,
  createObsidianAttachmentOpenHost,
} from './attachment-host';
import { createRecordDetail } from './record-detail';
import {
  LocationPreviewController,
  type LocationPreviewHandle,
  type LocationPreviewRequest,
} from './location-preview';
import { chooseMapViewTarget } from './map-view-picker';

export const LOOMTABLE_VIEW_TYPE = 'loomtable-main';

export type LoomTableClientFactory = (profile: ConnectionProfile) => LoomTableClient;

export interface MapRendererInstance {
  readonly renderer: MapRenderer;
  readonly viewport: MapViewportSource;
}

export interface LoomTableMapContext {
  readonly registry: TileProviderRegistry;
  readonly credentials: TileCredentialReader;
  readonly saveSettings: () => Promise<void>;
  readonly createRenderer: () => MapRendererInstance;
  readonly openSettings?: () => void | Promise<void>;
}

export class LoomTableView extends ItemView {
  #gridUnsubscribe: (() => void) | null = null;
  #invalidationUnsubscribe: (() => void) | null = null;
  #gridController: GridViewController | null = null;
  #mapView: MapView | null = null;
  #gridHost: HTMLElement | null = null;
  #detailHost: HTMLElement | null = null;
  #gridClient: LoomTableClient | null = null;
  #gridRenderer: ReadonlyGridRenderer | null = null;
  #locationPreview: LocationPreviewController | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly getSettings: () => PluginSettings,
    private readonly getTranslator: () => Translator,
    private readonly createClient: LoomTableClientFactory,
    private readonly mapContext: LoomTableMapContext,
    private readonly mutationQueue: DurableMutationQueuePort | null = null,
    private readonly invalidations: MutationInvalidationBus | null = null,
    private readonly statusSink: ((text: string | null) => void) | null = null,
  ) {
    super(leaf);
  }

  override getViewType(): string {
    return LOOMTABLE_VIEW_TYPE;
  }

  override getDisplayText(): string {
    return this.getTranslator()('view.title');
  }

  override getIcon(): string {
    return 'table-2';
  }

  override async onOpen(): Promise<void> {
    this.render();
  }

  override async onClose(): Promise<void> {
    this.disposeAll();
  }

  render(): void {
    const settings = this.getSettings();
    const profile = defaultProfile(settings);
    if (profile === null) {
      this.disposeAll();
      this.contentEl.empty();
      this.contentEl.addClass('loom-root');
      this.contentEl.createEl('h2', {
        text: this.getTranslator()('view.title'),
      });
      this.contentEl.createEl('p', {
        cls: 'loom-status',
        text: this.getTranslator()('view.configure'),
      });
      return;
    }

    this.disposeAll();
    const client = this.createClient(profile);
    this.#gridClient = client;
    this.renderGrid(
      profile,
      new GridViewController(client, {
        translate: this.getTranslator(),
        ...(this.mutationQueue === null ? {} : { mutationQueue: this.mutationQueue }),
        viewIntents: this.createViewIntentStore(profile),
        onNonGridViewSelected: (view, state) => this.showMap(profile, view, state),
      }),
    );
  }

  private createViewIntentStore(profile: ConnectionProfile): ViewCreateIntentStore {
    return new ViewCreateIntentStore(
      { profileId: profile.id, serverOrigin: profile.serverOrigin },
      {
        load: () => this.getSettings().viewIntents,
        save: async (data) => {
          this.getSettings().viewIntents = data;
          await this.mapContext.saveSettings();
        },
      },
    );
  }

  private renderGrid(profile: ConnectionProfile, controller: GridViewController): void {
    if (!this.prepareForNavigation()) return;
    this.#mapView?.destroy();
    this.#mapView = null;
    this.#gridUnsubscribe?.();
    this.#gridUnsubscribe = null;
    this.#invalidationUnsubscribe?.();
    this.#invalidationUnsubscribe = null;
    this.contentEl.empty();
    this.contentEl.addClass('loom-root');
    const gridHost = document.createElement('div');
    gridHost.className = 'loom-grid-host';
    const detailHost = document.createElement('div');
    detailHost.className = 'loom-detail-host';
    detailHost.addEventListener('pointerdown', (event) => {
      if (event.target !== detailHost || !detailHost.classList.contains('is-modal')) return;
      detailHost
        .querySelector<HTMLElement>('.loom-record-detail')
        ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    this.contentEl.append(gridHost, detailHost);
    this.#gridHost = gridHost;
    this.#detailHost = detailHost;

    const renderer = new ReadonlyGridRenderer(gridHost, this.getTranslator(), {
      onRefresh: () => controller.refresh(),
      onWorkspaceChange: async (workspaceId) => {
        if (!this.prepareForNavigation()) return;
        await controller.selectWorkspace(workspaceId);
      },
      onBaseChange: async (baseId) => {
        if (!this.prepareForNavigation()) return;
        await controller.selectBase(baseId);
      },
      onTableChange: async (tableId) => {
        if (!this.prepareForNavigation()) return;
        await controller.selectTable(tableId);
      },
      onViewChange: async (viewId) => {
        if (!this.prepareForNavigation()) return;
        await controller.selectView(viewId);
      },
      onCreateView: (input) => controller.createView(input),
      onRetryViewIntent: async (intentId) => {
        await controller.retryViewIntent(intentId);
      },
      onDismissViewIntent: (intentId) => controller.dismissViewIntent(intentId),
      onManageViews: () => controller.openManageViews(),
      onCloseManageViews: () => controller.closeManageViews(),
      onRenameView: (viewId, name) => controller.renameView(viewId, name),
      onCopyView: (viewId, name) => controller.copyView(viewId, name),
      onDeleteView: (viewId) => controller.deleteView(viewId),
      onRestoreView: (viewId) => controller.restoreView(viewId),
      onSetDefaultView: (viewId) => controller.setDefaultView(viewId),
      onRepairView: (viewId, repair) => controller.repairView(viewId, repair),
      onResolveViewIssue: (viewId, action) => {
        if (action === 'adopt-latest' || action === 're-edit') {
          return controller.resolveViewConflict(viewId, action);
        }
        if (action === 'retry') return controller.retryViewWrite(viewId);
        return controller.dismissViewWriteIssue(viewId);
      },
      onSearch: (term) => controller.setSearch(term),
      onApplyFilter: (viewId, filter) => controller.applyViewFilter(viewId, filter),
      onQueryFieldValues: (fieldId, request) => controller.queryFieldValues(fieldId, request),
      onSetFieldAggregation: (fieldId, fn) => controller.setFieldAggregation(fieldId, fn),
      onApplySort: (viewId, sort) => controller.applyViewSort(viewId, sort),
      onApplyManualSort: (viewId, enabled) => controller.applyViewManualSort(viewId, enabled),
      onMoveRecord: (recordId, anchors) => controller.moveRecord(recordId, anchors),
      onApplyDisplay: (viewId, patch) => controller.applyViewDisplay(viewId, patch),
      onFieldSave: (input, context) =>
        context.mode === 'edit'
          ? controller.updateField(context.fieldId, {
              name: input.name,
              ...(input.options === undefined ? {} : { options: input.options }),
              ...(input.maxCount === undefined ? {} : { maxCount: input.maxCount }),
              ...(input.description === undefined ? {} : { description: input.description }),
              ...(input.format === undefined ? {} : { format: input.format }),
            })
          : controller.createField(
              input,
              context.anchorFieldId === undefined
                ? null
                : { fieldId: context.anchorFieldId, side: context.side ?? 'right' },
            ),
      onFieldDelete: (fieldId) => controller.deleteField(fieldId),
      ...(controller.supportsRecordCreate
        ? {
            onCreateRecord: (values: Readonly<Record<string, MutationValue>>) =>
              controller.createRecord(values),
            onRetryRecordCreate: (operationId: string) => controller.retryRecordCreate(operationId),
            onDiscardRecordCreate: (operationId: string) =>
              controller.discardRecordCreate(operationId),
            onDismissRecordCreate: (operationId: string) =>
              controller.dismissRecordCreate(operationId),
          }
        : {}),
      ...(controller.supportsRecordLifecycle
        ? {
            onDeleteRecord: async (recordId: string) => {
              await controller.deleteRecord(recordId);
            },
            onDuplicateRecord: async (recordId: string) => {
              await controller.duplicateRecord(recordId);
            },
            onInsertRecordBelow: async (recordId: string) => {
              await controller.insertRecordBelow(recordId);
            },
            onUndoDelete: async () => {
              await controller.undoDelete();
            },
            onDismissDeleteNotice: () => controller.dismissDeleteNotice(),
            onLoadDeletedRecords: () => controller.loadDeletedRecords(),
            onLoadMoreDeletedRecords: () => controller.loadMoreDeletedRecords(),
            onLoadServerHistory: (kind) =>
              controller.loadServerHistory(kind === undefined ? {} : { kind }),
            onLoadMoreServerHistory: (kind) => controller.loadMoreServerHistory(kind),
            onConversionPreview: (fieldId, type) =>
              controller.previewFieldConversion(fieldId, type),
            onConvertField: (fieldId, request) => controller.convertField(fieldId, request),
            onRestoreRecord: async (recordId: string) => {
              await controller.restoreRecord(recordId);
            },
          }
        : {}),
      onLoadMore: () => controller.loadNextPage(),
      onRecordOpen: (record) => void this.showRecordDetail(record, profile, controller),
      onCellEdit: (recordId, fieldId, value) => {
        void controller.editCell(recordId, fieldId, value);
      },
      onUndo: () => controller.undo(),
      onRedo: () => controller.redo(),
      onUndoTo: (index) => controller.undoUntil(index),
      attachmentThumbnail: this.attachmentThumbnail,
      onConflictAction: (recordId, action) => controller.resolveConflict(recordId, action),
      confirmDiscardAll: () => window.confirm(this.getTranslator()('grid.discardAllConfirm')),
      onRetryEdit: (recordId) => controller.retryEdit(recordId),
      ...(this.mapContext.openSettings === undefined
        ? {}
        : { onOpenSettings: this.mapContext.openSettings }),
    });
    this.#gridController = controller;
    this.#gridRenderer = renderer;
    this.#gridUnsubscribe = controller.subscribe((state) => {
      renderer.render(state);
      this.#publishStatusBar(state);
    });
    if (this.invalidations !== null) {
      this.#invalidationUnsubscribe = this.invalidations.subscribe((event) => {
        if (controller.state.selectedTableId === event.tableId) {
          controller.applyExternalMutation(event.record, event.changeCursor);
        }
      });
    }
    if (controller.state.status === 'idle') void controller.load();
  }

  private showMap(
    profile: ConnectionProfile,
    view: View,
    navigationState: GridState,
    focusRecordId?: string,
  ): void {
    if (view.type !== 'map') return;
    if (!this.prepareForNavigation()) return;
    this.#gridUnsubscribe?.();
    this.#gridUnsubscribe = null;
    this.#invalidationUnsubscribe?.();
    this.#invalidationUnsubscribe = null;
    this.#mapView?.destroy();
    this.#gridRenderer = null;
    this.#gridHost = null;
    this.#detailHost = null;
    const client = this.createClient(profile);
    let mapView: MapView | null = null;
    const instance = this.mapContext.createRenderer();
    const primaryFieldId = navigationState.tables.find(
      (table) => table.id === view.tableId,
    )?.primaryFieldId;
    const controller = new MapViewController(client, view, navigationState.fields, {
      renderer: instance.renderer,
      registry: this.mapContext.registry,
      credentials: this.mapContext.credentials,
      provider: providerForView(this.getSettings(), view.id),
      viewport: instance.viewport,
      isOffline: () => typeof navigator !== 'undefined' && navigator.onLine === false,
      beforeRecordSelected: () => mapView?.confirmDiscardIfNeeded() ?? true,
      ...(primaryFieldId === undefined ? {} : { primaryFieldId }),
      ...(this.#gridController === null
        ? {}
        : {
            saveViewConfig: (viewId: string, patch: ViewUpdatePatch) =>
              this.#gridController!.updateView(viewId, patch),
          }),
    });
    const navigation = this.mapNavigation(profile, navigationState, view);
    const provider = providerForView(this.getSettings(), view.id);
    const attachmentAdd =
      this.#gridController === null
        ? undefined
        : createAttachmentAddCallback(client, {
            getAttachment: client.getAttachment.bind(client),
            getRecord: client.getRecord.bind(client),
            isOffline: () => typeof navigator !== 'undefined' && navigator.onLine === false,
            updateRecord: async (recordId, fieldId, references, sourceRecord, mutation) => {
              await this.#gridController!.editCell(
                recordId,
                fieldId,
                references,
                {
                  attachmentReferences: references,
                  clientMutationId: mutation.clientMutationId,
                },
                sourceRecord,
              );
              return this.#gridController!.state.records.find(
                (candidate) => candidate.id === recordId,
              );
            },
          });
    const attachmentDetach =
      this.#gridController === null
        ? undefined
        : createAttachmentDetachCallback({
            isOffline: () => typeof navigator !== 'undefined' && navigator.onLine === false,
            updateRecord: async (recordId, fieldId, references, sourceRecord, mutation) => {
              await this.#gridController!.editCell(
                recordId,
                fieldId,
                references,
                {
                  attachmentReferences: references,
                  clientMutationId: mutation.clientMutationId,
                },
                sourceRecord,
              );
              return this.#gridController!.state.records.find(
                (candidate) => candidate.id === recordId,
              );
            },
          });
    const attachmentDownload = this.createAttachmentDownloadHandler(client);
    mapView = new MapView(this.contentEl, controller, {
      translate: this.getTranslator(),
      navigation,
      onClusterNextPage: () => controller.loadNextClusterPage(),
      onClusterRetry: () => controller.retryCluster(),
      onTileRetry: () => controller.retryTiles(),
      onLocationEdit: (recordId, fieldId, intent, record) =>
        this.#gridController?.editLocation(recordId, fieldId, intent, record),
      ...(this.#gridController === null
        ? {}
        : {
            onFieldEdit: async (
              recordId: string,
              fieldId: string,
              value: JsonValue,
              record: LoomTableRecord,
              options?: { readonly unset?: boolean },
            ) =>
              this.#gridController!.editCell(
                recordId,
                fieldId,
                value,
                { unset: options?.unset ?? false },
                record,
              ),
          }),
      getConflict: (recordId) => this.#gridController?.getConflict(recordId),
      onConflictAction: (recordId, action) =>
        this.#gridController?.resolveConflict(recordId, action),
      onOpenLocationInMap: (recordId, fieldId) =>
        this.openLocationInMap(profile, navigationState, recordId, fieldId),
      canOpenLocationInMap: (fieldId) =>
        navigationState.views.some(
          (candidate) =>
            candidate.type === 'map' &&
            candidate.deletedAt === undefined &&
            candidate.config.locationFieldId === fieldId,
        ),
      ...(this.#gridController === null
        ? {}
        : {
            onApplyFilter: async (viewId: string, filter: FilterNode | undefined) => {
              const outcome = await this.#gridController!.applyViewFilter(viewId, filter);
              if (outcome.status === 'saved') await controller.applyViewUpdate(outcome.view);
              return outcome;
            },
          }),
      locationPreview: this.locationPreviewHandle(),
      ...(this.#gridController?.supportsRecordCreate === true
        ? {
            onCreateRecord: (values: Readonly<Record<string, MutationValue>>) =>
              this.#gridController!.createRecord(values),
          }
        : {}),
      ...(this.#gridController?.supportsRecordLifecycle === true
        ? {
            onDeleteRecord: async (recordId: string) => {
              await this.#gridController!.deleteRecord(recordId);
            },
            onDuplicateRecord: async (recordId: string) => {
              await this.#gridController!.duplicateRecord(recordId);
            },
            onInsertRecordBelow: async (recordId: string) => {
              await this.#gridController!.insertRecordBelow(recordId);
            },
          }
        : {}),
      onAttachmentDownload: attachmentDownload,
      canAttachmentDownload: isAttachmentDownloadable,
      onAttachmentOpen: createAttachmentOpenCallback(createObsidianAttachmentOpenHost(this.app)),
      onAttachmentPreview: createAttachmentPreviewCallback(client, {
        translate: this.getTranslator(),
        host: createBrowserAttachmentPreviewHost(document),
      }),
      ...(attachmentAdd === undefined
        ? {}
        : {
            onAttachmentAdd: attachmentAdd,
            ...(attachmentAdd.retry === undefined
              ? {}
              : { onAttachmentAddRetry: attachmentAdd.retry }),
          }),
      ...(attachmentDetach === undefined ? {} : { onAttachmentDetach: attachmentDetach }),
      attachmentThumbnail: this.attachmentThumbnail,
      providers: this.mapContext.registry.list(),
      selectedProvider: provider,
      onProviderChange: async (nextProvider) => {
        controller.setProvider(nextProvider);
        this.getSettings().mapPresentation.perViewProvider[view.id] = nextProvider;
        await this.mapContext.saveSettings();
      },
      ...(this.mapContext.openSettings === undefined
        ? {}
        : { onOpenSettings: this.mapContext.openSettings }),
      confirmDiscard: (message) => window.confirm(message),
    });
    this.#mapView = mapView;
    if (this.invalidations !== null) {
      this.#invalidationUnsubscribe = subscribeMutationInvalidation(
        this.invalidations,
        view.tableId,
        controller,
      );
    }
    this.#mapView.mount();
    const gridController = this.#gridController;
    if (gridController !== null) {
      this.#gridUnsubscribe = gridController.subscribe((state) => {
        const stillActive = state.views.some(
          (candidate) => candidate.id === view.id && candidate.deletedAt === undefined,
        );
        if (!stillActive) {
          const next = state.views.find(
            (candidate) =>
              candidate.id === state.selectedViewId && candidate.deletedAt === undefined,
          );
          if (next?.type === 'map') this.showMap(profile, next, state);
          else this.renderGrid(profile, gridController);
          return;
        }
        mapView.updateNavigation(this.mapNavigation(profile, state, view));
      });
    }
    if (focusRecordId !== undefined) void controller.openRecord(focusRecordId);
  }

  private mapNavigation(
    profile: ConnectionProfile,
    state: GridState,
    view: Extract<View, { type: 'map' }>,
  ): MapViewNavigation {
    const controller = this.#gridController;
    if (controller === null) throw new Error('Grid navigation is unavailable.');
    return {
      workspaces: state.workspaces,
      bases: state.bases,
      tables: state.tables,
      views: state.views,
      fields: state.fields,
      pendingViewIntents: state.pendingViewIntents.filter(
        (intent) => intent.tableId === state.selectedTableId,
      ),
      deletedViews: state.deletedViews,
      deletedViewsStatus: state.deletedViewsStatus,
      viewWritePending: state.viewWritePending,
      viewWriteIssues: state.viewWriteIssues,
      selectedWorkspaceId: state.selectedWorkspaceId,
      selectedBaseId: state.selectedBaseId,
      selectedTableId: state.selectedTableId,
      selectedViewId: view.id,
      onCreateView: async (input) => {
        const outcome = await controller.createView(input);
        if (outcome.status === 'created' && outcome.view.type === 'grid') {
          this.renderGrid(profile, controller);
        }
        return outcome;
      },
      onRetryViewIntent: async (intentId) => {
        const outcome = await controller.retryViewIntent(intentId);
        if (outcome?.status === 'created' && outcome.view.type === 'grid') {
          this.renderGrid(profile, controller);
        }
      },
      onDismissViewIntent: (intentId) => controller.dismissViewIntent(intentId),
      onManageViews: () => controller.openManageViews(),
      onCloseManageViews: () => controller.closeManageViews(),
      onRenameView: (viewId, name) => controller.renameView(viewId, name),
      onCopyView: (viewId, name) => controller.copyView(viewId, name),
      onDeleteView: (viewId) => controller.deleteView(viewId),
      onRestoreView: (viewId) => controller.restoreView(viewId),
      onSetDefaultView: (viewId) => controller.setDefaultView(viewId),
      onRepairView: (viewId, repair) => controller.repairView(viewId, repair),
      onResolveViewIssue: (viewId, action) => {
        if (action === 'adopt-latest' || action === 're-edit') {
          return controller.resolveViewConflict(viewId, action);
        }
        if (action === 'retry') return controller.retryViewWrite(viewId);
        return controller.dismissViewWriteIssue(viewId);
      },
      onWorkspaceChange: async (workspaceId) => {
        if (!this.prepareForNavigation()) return;
        await controller.selectWorkspace(workspaceId);
        this.showMapForCurrentSelection(profile, controller);
      },
      onBaseChange: async (baseId) => {
        if (!this.prepareForNavigation()) return;
        await controller.selectBase(baseId);
        this.showMapForCurrentSelection(profile, controller);
      },
      onTableChange: async (tableId) => {
        if (!this.prepareForNavigation()) return;
        await controller.selectTable(tableId);
        this.showMapForCurrentSelection(profile, controller);
      },
      onViewChange: async (viewId) => {
        if (!this.prepareForNavigation()) return;
        const selected = controller.state.views.find((candidate) => candidate.id === viewId);
        if (selected?.type === 'map') {
          await controller.selectView(viewId);
        } else if (selected?.type === 'grid') {
          await controller.selectView(viewId);
          this.renderGrid(profile, controller);
        }
      },
    };
  }

  private showMapForCurrentSelection(
    profile: ConnectionProfile,
    controller: GridViewController,
  ): void {
    const mapView = controller.state.views.find((view) => view.type === 'map');
    if (mapView === undefined) {
      this.renderGrid(profile, controller);
      return;
    }
    this.showMap(profile, mapView, controller.state);
  }

  private async showRecordDetail(
    record: LoomTableRecord,
    profile: ConnectionProfile,
    controller: GridViewController,
  ): Promise<void> {
    if (!this.prepareForNavigation()) return;
    const invokingElement =
      typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const detailRecord = await controller.getRecordForDetail(record);
    const detailHost = this.#detailHost;
    const client = this.#gridClient;
    if (detailHost === null || !detailHost.isConnected || client === null) return;
    const attachmentAdd = createAttachmentAddCallback(client, {
      getAttachment: client.getAttachment.bind(client),
      getRecord: client.getRecord.bind(client),
      isOffline: () => typeof navigator !== 'undefined' && navigator.onLine === false,
      updateRecord: async (recordId, fieldId, references, sourceRecord, mutation) => {
        await controller.editCell(
          recordId,
          fieldId,
          references,
          {
            attachmentReferences: references,
            clientMutationId: mutation.clientMutationId,
          },
          sourceRecord,
        );
        return controller.state.records.find((candidate) => candidate.id === recordId);
      },
    });
    const attachmentDetach = createAttachmentDetachCallback({
      isOffline: () => typeof navigator !== 'undefined' && navigator.onLine === false,
      updateRecord: async (recordId, fieldId, references, sourceRecord, mutation) => {
        await controller.editCell(
          recordId,
          fieldId,
          references,
          {
            attachmentReferences: references,
            clientMutationId: mutation.clientMutationId,
          },
          sourceRecord,
        );
        return controller.state.records.find((candidate) => candidate.id === recordId);
      },
    });
    const attachmentDownload = this.createAttachmentDownloadHandler(client);
    const detailTable = controller.state.tables.find(
      (candidate) => candidate.id === controller.state.selectedTableId,
    );
    let detail: HTMLElement;
    detail = createRecordDetail(detailRecord, {
      translate: this.getTranslator(),
      fields: controller.state.fields,
      ...(detailTable?.primaryFieldId === undefined
        ? {}
        : { primaryFieldId: detailTable.primaryFieldId }),
      navigation: {
        canNavigate: (recordId, direction) => controller.canNavigateRecord(recordId, direction),
        onNavigate: async (recordId, direction) => {
          const target = await controller.navigateRecord(recordId, direction);
          return target === null ? null : controller.getRecordForDetail(target);
        },
      },
      offline: typeof navigator !== 'undefined' && navigator.onLine === false,
      returnFocus: invokingElement,
      focusFallback: () => this.#gridHost?.querySelector<HTMLElement>('.loom-grid-shell') ?? null,
      confirmDiscard: (message) => window.confirm(message),
      callbacks: {
        onClose: () => {
          detailHost.classList.remove('is-modal');
          detailHost.replaceChildren();
        },
        onFieldEdit: async (recordId, fieldId, value, sourceRecord, options) =>
          controller.editCell(
            recordId,
            fieldId,
            value,
            { unset: options?.unset ?? false },
            sourceRecord,
          ),
        onLocationEdit: (recordId, fieldId, intent, recordValue) =>
          controller.editLocation(recordId, fieldId, intent, recordValue),
        getConflict: (recordId) => controller.getConflict(recordId),
        onConflictAction: (recordId, action) => controller.resolveConflict(recordId, action),
        ...(controller.supportsRecordLifecycle
          ? {
              onDeleteRecord: async (recordId: string) => {
                await controller.deleteRecord(recordId);
              },
              onDuplicateRecord: async (recordId: string) => {
                await controller.duplicateRecord(recordId);
              },
              onInsertRecordBelow: async (recordId: string) => {
                await controller.insertRecordBelow(recordId);
              },
            }
          : {}),
        onOpenLocationInMap: (recordId, fieldId) =>
          this.openLocationInMap(profile, controller.state, recordId, fieldId),
        canOpenLocationInMap: (fieldId) =>
          controller.state.views.some(
            (candidate) =>
              candidate.type === 'map' &&
              candidate.deletedAt === undefined &&
              candidate.config.locationFieldId === fieldId,
          ),
        onAttachmentDownload: attachmentDownload,
        canAttachmentDownload: isAttachmentDownloadable,
        onAttachmentOpen: createAttachmentOpenCallback(createObsidianAttachmentOpenHost(this.app)),
        onAttachmentPreview: createAttachmentPreviewCallback(client, {
          translate: this.getTranslator(),
          host: createBrowserAttachmentPreviewHost(document),
        }),
        onAttachmentAdd: attachmentAdd,
        ...(attachmentAdd.retry === undefined ? {} : { onAttachmentAddRetry: attachmentAdd.retry }),
        onAttachmentDetach: attachmentDetach,
        attachmentThumbnail: this.attachmentThumbnail,
      },
      locationPreview: this.locationPreviewHandle(),
    });
    detailHost.append(detail);
    detail.focus();
  }

  private attachmentThumbnail = (attachment: {
    readonly state: string;
    readonly source?: string;
    readonly vaultPath?: string;
    readonly mimeType?: string;
  }): string | undefined => {
    if (
      attachment.state !== 'ready' ||
      attachment.source !== 'vault' ||
      attachment.vaultPath === undefined ||
      !(attachment.mimeType?.startsWith('image/') ?? false)
    ) {
      return undefined;
    }
    const file = this.app.vault.getAbstractFileByPath(attachment.vaultPath);
    return file instanceof TFile ? this.app.vault.getResourcePath(file) : undefined;
  };

  private createAttachmentDownloadHandler(client: LoomTableClient) {
    const host = createBrowserAttachmentDownloadHost(document);
    return createAttachmentDownloadCallback(client, {
      host,
      vaultHost: createObsidianAttachmentDownloadHost(this.app, host),
      isOffline: () => typeof navigator !== 'undefined' && navigator.onLine === false,
    });
  }

  private prepareForNavigation(): boolean {
    if (!this.confirmDiscardOpenDetail()) return false;
    this.#locationPreview?.close();
    this.#detailHost?.replaceChildren();
    return true;
  }

  private confirmDiscardOpenDetail(): boolean {
    const draft = this.#detailHost?.querySelector<HTMLElement>(
      '.loom-location-editor[data-dirty="true"], .loom-record-field-editor[data-dirty="true"]',
    );
    if (draft === null || draft === undefined) {
      return true;
    }
    const message = this.getTranslator()(
      draft.classList.contains('loom-record-field-editor')
        ? 'record.field.discardConfirm'
        : 'record.location.discardConfirm',
    );
    try {
      return typeof window !== 'undefined' && typeof window.confirm === 'function'
        ? window.confirm(message)
        : false;
    } catch {
      return false;
    }
  }

  private locationPreviewHandle(): LocationPreviewHandle {
    this.#locationPreview ??= new LocationPreviewController({
      translate: this.getTranslator(),
      host: () => this.contentEl,
      resolveProvider: (request) => {
        const controller = this.#gridController;
        const settings = this.getSettings();
        const match = controller?.state.views.find(
          (candidate) =>
            candidate.type === 'map' &&
            candidate.deletedAt === undefined &&
            candidate.config.locationFieldId === request.fieldId,
        );
        const ref =
          match === undefined
            ? settings.mapPresentation.defaultProvider
            : providerForView(settings, match.id);
        return this.mapContext.registry.resolve(ref, this.mapContext.credentials);
      },
      createRenderer: () => this.mapContext.createRenderer().renderer,
      isOffline: () => typeof navigator !== 'undefined' && navigator.onLine === false,
      onOpenInMap: (request: LocationPreviewRequest) => {
        const controller = this.#gridController;
        const profile = defaultProfile(this.getSettings());
        if (controller === null || profile === null) return;
        this.openLocationInMap(profile, controller.state, request.recordId, request.fieldId);
      },
      ...(this.mapContext.openSettings === undefined
        ? {}
        : { onOpenSettings: this.mapContext.openSettings }),
    });
    return this.#locationPreview;
  }

  private openLocationInMap(
    profile: ConnectionProfile,
    state: GridState,
    recordId: string,
    fieldId: string,
  ): void {
    const controller = this.#gridController;
    if (controller === null) return;
    const matches = state.views.filter(
      (candidate) =>
        candidate.type === 'map' &&
        candidate.deletedAt === undefined &&
        candidate.config.locationFieldId === fieldId,
    );
    if (matches.length === 1 && matches[0]?.type === 'map') {
      this.showMap(profile, matches[0], controller.state, recordId);
      return;
    }
    const host = this.#detailHost ?? this.contentEl;
    void chooseMapViewTarget(host, matches, this.getTranslator()).then((choice) => {
      if (choice.kind === 'cancel') return;
      if (choice.kind === 'create') {
        this.openMapViewCreateForm(fieldId);
        return;
      }
      const target = matches.find((candidate) => candidate.id === choice.viewId);
      if (target?.type === 'map' && this.#gridController !== null) {
        this.showMap(profile, target, this.#gridController.state, recordId);
      }
    });
  }

  private openMapViewCreateForm(fieldId: string): void {
    if (this.#mapView !== null) {
      this.#mapView.openViewCreateForm({ type: 'map', locationFieldId: fieldId });
      return;
    }
    this.#gridRenderer?.openViewCreateForm({ type: 'map', locationFieldId: fieldId });
  }

  private disposeAll(): void {
    this.#locationPreview?.dispose();
    this.#locationPreview = null;
    this.#mapView?.destroy();
    this.#mapView = null;
    this.#gridRenderer = null;
    this.#gridUnsubscribe?.();
    this.#gridUnsubscribe = null;
    this.#invalidationUnsubscribe?.();
    this.#invalidationUnsubscribe = null;
    this.#gridController?.dispose();
    this.#gridController = null;
    this.#gridClient = null;
    this.#gridHost = null;
    this.#detailHost = null;
    this.statusSink?.(null);
  }

  #publishStatusBar(state: GridState): void {
    if (this.statusSink === null) return;
    const translate = this.getTranslator();
    const loaded = String(state.records.length);
    const total = state.totalCount;
    const unfiltered = state.unfilteredTotal;
    const rows =
      total !== null && unfiltered !== null && unfiltered > total
        ? `${total}/${unfiltered} ${translate('grid.rows')}`
        : total !== null && total > state.records.length
          ? `${loaded}/${total} ${translate('grid.rows')}`
          : `${loaded} ${translate('grid.rows')}`;
    this.statusSink(`${rows} · ${describeSaveStatus(state.saveStatus, translate)}`);
  }
}

function providerForView(settings: PluginSettings, viewId: string) {
  return (
    settings.mapPresentation.perViewProvider[viewId] ?? settings.mapPresentation.defaultProvider
  );
}

function defaultProfile(settings: PluginSettings): ConnectionProfile | null {
  const defaultId = settings.defaultConnectionProfileId;
  return (
    settings.connectionProfiles.find((profile) => profile.id === defaultId) ??
    settings.connectionProfiles[0] ??
    null
  );
}
