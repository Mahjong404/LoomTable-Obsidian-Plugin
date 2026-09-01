import { ItemView, type WorkspaceLeaf } from "obsidian";

import type {
  LoomTableClient,
  LoomTableRecord,
  View,
} from "../client/loomtable-client";
import type { Translator } from "../i18n";
import type { TileCredentialReader } from "../maps/providers/tile-provider-schema";
import type { TileProviderRegistry } from "../maps/providers/tile-provider-registry";
import type { MapRenderer } from "../maps/renderer/map-renderer";
import type { ConnectionProfile } from "../settings/connection-profile";
import type { PluginSettings } from "../settings/plugin-settings";
import type { DurableMutationQueuePort } from "./mutation-queue-scheduler";
import {
  subscribeMutationInvalidation,
  type MutationInvalidationBus,
} from "./mutation-invalidation";
import { GridViewController, type GridState } from "./grid-view-controller";
import { ReadonlyGridRenderer } from "./readonly-grid-renderer";
import {
  MapViewController,
  type MapViewportSource,
} from "../views/map/map-view-controller";
import { MapView, type MapViewNavigation } from "../views/map/map-view";
import { createAttachmentDownloadCallback } from "./attachment-download";
import {
  createAttachmentAddCallback,
  createAttachmentDetachCallback,
} from "./attachment-upload";
import {
  createAttachmentOpenCallback,
  createAttachmentPreviewCallback,
  createBrowserAttachmentPreviewHost,
  createObsidianAttachmentOpenHost,
} from "./attachment-host";
import { createRecordDetail } from "./record-detail";

export const LOOMTABLE_VIEW_TYPE = "loomtable-main";

export type LoomTableClientFactory = (
  profile: ConnectionProfile,
) => LoomTableClient;

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

  constructor(
    leaf: WorkspaceLeaf,
    private readonly getSettings: () => PluginSettings,
    private readonly getTranslator: () => Translator,
    private readonly createClient: LoomTableClientFactory,
    private readonly mapContext: LoomTableMapContext,
    private readonly mutationQueue: DurableMutationQueuePort | null = null,
    private readonly invalidations: MutationInvalidationBus | null = null,
  ) {
    super(leaf);
  }

  override getViewType(): string {
    return LOOMTABLE_VIEW_TYPE;
  }

  override getDisplayText(): string {
    return this.getTranslator()("view.title");
  }

  override getIcon(): string {
    return "table-2";
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
      this.contentEl.addClass("loom-root");
      this.contentEl.createEl("h2", {
        text: this.getTranslator()("view.title"),
      });
      this.contentEl.createEl("p", {
        cls: "loom-status",
        text: this.getTranslator()("view.configure"),
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
        ...(this.mutationQueue === null
          ? {}
          : { mutationQueue: this.mutationQueue }),
        onNonGridViewSelected: (view, state) =>
          this.showMap(profile, view, state),
      }),
    );
  }

  private renderGrid(
    profile: ConnectionProfile,
    controller: GridViewController,
  ): void {
    if (!this.prepareForNavigation()) return;
    this.#mapView?.destroy();
    this.#mapView = null;
    this.#gridUnsubscribe?.();
    this.#gridUnsubscribe = null;
    this.#invalidationUnsubscribe?.();
    this.#invalidationUnsubscribe = null;
    this.contentEl.empty();
    this.contentEl.addClass("loom-root");
    const gridHost = document.createElement("div");
    gridHost.className = "loom-grid-host";
    const detailHost = document.createElement("div");
    detailHost.className = "loom-detail-host";
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
      onLoadMore: () => controller.loadNextPage(),
      onRecordOpen: (record) =>
        void this.showRecordDetail(record, profile, controller),
      onCellEdit: (recordId, fieldId, value) =>
        controller.editCell(recordId, fieldId, value),
      onConflictAction: (recordId, action) =>
        controller.resolveConflict(recordId, action),
      confirmDiscardAll: () =>
        window.confirm(this.getTranslator()("grid.discardAllConfirm")),
      onRetryEdit: (recordId) => controller.retryEdit(recordId),
      ...(this.mapContext.openSettings === undefined
        ? {}
        : { onOpenSettings: this.mapContext.openSettings }),
    });
    this.#gridController = controller;
    this.#gridUnsubscribe = controller.subscribe((state) =>
      renderer.render(state),
    );
    if (this.invalidations !== null) {
      this.#invalidationUnsubscribe = this.invalidations.subscribe((event) => {
        if (controller.state.selectedTableId === event.tableId)
          void controller.refresh();
      });
    }
    if (controller.state.status === "idle") void controller.load();
  }

  private showMap(
    profile: ConnectionProfile,
    view: View,
    navigationState: GridState,
    focusRecordId?: string,
  ): void {
    if (view.type !== "map") return;
    if (!this.prepareForNavigation()) return;
    this.#gridUnsubscribe?.();
    this.#gridUnsubscribe = null;
    this.#invalidationUnsubscribe?.();
    this.#invalidationUnsubscribe = null;
    this.#mapView?.destroy();
    this.#gridHost = null;
    this.#detailHost = null;
    const client = this.createClient(profile);
    let mapView: MapView | null = null;
    const instance = this.mapContext.createRenderer();
    const controller = new MapViewController(
      client,
      view,
      navigationState.fields,
      {
        renderer: instance.renderer,
        registry: this.mapContext.registry,
        credentials: this.mapContext.credentials,
        provider: providerForView(this.getSettings(), view.id),
        viewport: instance.viewport,
        isOffline: () =>
          typeof navigator !== "undefined" && navigator.onLine === false,
        beforeRecordSelected: () => mapView?.confirmDiscardIfNeeded() ?? true,
      },
    );
    const navigation = this.mapNavigation(profile, navigationState, view);
    const provider = providerForView(this.getSettings(), view.id);
    const attachmentAdd =
      this.#gridController === null
        ? undefined
        : createAttachmentAddCallback(client, {
            getAttachment: client.getAttachment.bind(client),
            getRecord: client.getRecord.bind(client),
            isOffline: () =>
              typeof navigator !== "undefined" && navigator.onLine === false,
            updateRecord: async (
              recordId,
              fieldId,
              references,
              sourceRecord,
              mutation,
            ) => {
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
            isOffline: () =>
              typeof navigator !== "undefined" && navigator.onLine === false,
            updateRecord: async (
              recordId,
              fieldId,
              references,
              sourceRecord,
              mutation,
            ) => {
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
    mapView = new MapView(this.contentEl, controller, {
      translate: this.getTranslator(),
      navigation,
      onClusterNextPage: () => controller.loadNextClusterPage(),
      onClusterRetry: () => controller.retryCluster(),
      onTileRetry: () => controller.retryTiles(),
      onLocationEdit: (recordId, fieldId, intent, record) =>
        this.#gridController?.editLocation(recordId, fieldId, intent, record),
      getConflict: (recordId) => this.#gridController?.getConflict(recordId),
      onConflictAction: (recordId, action) =>
        this.#gridController?.resolveConflict(recordId, action),
      onOpenLocationInMap: (recordId, fieldId) =>
        this.openLocationInMap(profile, navigationState, recordId, fieldId),
      canOpenLocationInMap: (fieldId) =>
        navigationState.views.some(
          (candidate) =>
            candidate.type === "map" &&
            candidate.config.locationFieldId === fieldId,
        ),
      onAttachmentDownload: createAttachmentDownloadCallback(client),
      onAttachmentOpen: createAttachmentOpenCallback(
        createObsidianAttachmentOpenHost(this.app),
      ),
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
      ...(attachmentDetach === undefined
        ? {}
        : { onAttachmentDetach: attachmentDetach }),
      providers: this.mapContext.registry.list(),
      selectedProvider: provider,
      onProviderChange: async (nextProvider) => {
        controller.setProvider(nextProvider);
        this.getSettings().mapPresentation.perViewProvider[view.id] =
          nextProvider;
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
    if (focusRecordId !== undefined) void controller.openRecord(focusRecordId);
  }

  private mapNavigation(
    profile: ConnectionProfile,
    state: GridState,
    view: Extract<View, { type: "map" }>,
  ): MapViewNavigation {
    const controller = this.#gridController;
    if (controller === null) throw new Error("Grid navigation is unavailable.");
    return {
      workspaces: state.workspaces,
      bases: state.bases,
      tables: state.tables,
      views: state.views,
      selectedWorkspaceId: state.selectedWorkspaceId,
      selectedBaseId: state.selectedBaseId,
      selectedTableId: state.selectedTableId,
      selectedViewId: view.id,
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
        const selected = controller.state.views.find(
          (candidate) => candidate.id === viewId,
        );
        if (selected?.type === "map") {
          await controller.selectView(viewId);
        } else if (selected?.type === "grid") {
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
    const mapView = controller.state.views.find((view) => view.type === "map");
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
      typeof document !== "undefined" &&
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const detailRecord = await controller.getRecordForDetail(record);
    const detailHost = this.#detailHost;
    const client = this.#gridClient;
    if (detailHost === null || !detailHost.isConnected || client === null)
      return;
    const attachmentAdd = createAttachmentAddCallback(client, {
      getAttachment: client.getAttachment.bind(client),
      getRecord: client.getRecord.bind(client),
      isOffline: () =>
        typeof navigator !== "undefined" && navigator.onLine === false,
      updateRecord: async (
        recordId,
        fieldId,
        references,
        sourceRecord,
        mutation,
      ) => {
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
        return controller.state.records.find(
          (candidate) => candidate.id === recordId,
        );
      },
    });
    const attachmentDetach = createAttachmentDetachCallback({
      isOffline: () =>
        typeof navigator !== "undefined" && navigator.onLine === false,
      updateRecord: async (
        recordId,
        fieldId,
        references,
        sourceRecord,
        mutation,
      ) => {
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
        return controller.state.records.find(
          (candidate) => candidate.id === recordId,
        );
      },
    });
    let detail: HTMLElement;
    detail = createRecordDetail(detailRecord, {
      translate: this.getTranslator(),
      fields: controller.state.fields,
      offline: typeof navigator !== "undefined" && navigator.onLine === false,
      returnFocus: invokingElement,
      focusFallback: () =>
        this.#gridHost?.querySelector<HTMLElement>(".loom-grid-shell") ?? null,
      confirmDiscard: (message) => window.confirm(message),
      callbacks: {
        onClose: () => detail.remove(),
        onLocationEdit: (recordId, fieldId, intent, recordValue) =>
          controller.editLocation(recordId, fieldId, intent, recordValue),
        getConflict: (recordId) => controller.getConflict(recordId),
        onConflictAction: (recordId, action) =>
          controller.resolveConflict(recordId, action),
        onOpenLocationInMap: (recordId, fieldId) =>
          this.openLocationInMap(profile, controller.state, recordId, fieldId),
        canOpenLocationInMap: (fieldId) =>
          controller.state.views.some(
            (candidate) =>
              candidate.type === "map" &&
              candidate.config.locationFieldId === fieldId,
          ),
        onAttachmentDownload: createAttachmentDownloadCallback(client),
        onAttachmentOpen: createAttachmentOpenCallback(
          createObsidianAttachmentOpenHost(this.app),
        ),
        onAttachmentPreview: createAttachmentPreviewCallback(client, {
          translate: this.getTranslator(),
          host: createBrowserAttachmentPreviewHost(document),
        }),
        onAttachmentAdd: attachmentAdd,
        ...(attachmentAdd.retry === undefined
          ? {}
          : { onAttachmentAddRetry: attachmentAdd.retry }),
        onAttachmentDetach: attachmentDetach,
      },
    });
    detailHost.append(detail);
    detail.focus();
  }

  private prepareForNavigation(): boolean {
    if (!this.confirmDiscardOpenDetail()) return false;
    this.#detailHost?.replaceChildren();
    return true;
  }

  private confirmDiscardOpenDetail(): boolean {
    const draft = this.#detailHost?.querySelector(
      '.loom-location-editor[data-dirty="true"]',
    );
    if (draft === null || draft === undefined) {
      return true;
    }
    const message = this.getTranslator()("record.location.discardConfirm");
    try {
      return typeof window !== "undefined" &&
        typeof window.confirm === "function"
        ? window.confirm(message)
        : false;
    } catch {
      return false;
    }
  }

  private openLocationInMap(
    profile: ConnectionProfile,
    state: GridState,
    recordId: string,
    fieldId: string,
  ): void {
    const controller = this.#gridController;
    if (controller === null) return;
    const mapView = state.views.find(
      (candidate) =>
        candidate.type === "map" &&
        candidate.config.locationFieldId === fieldId,
    );
    if (mapView?.type === "map")
      this.showMap(profile, mapView, controller.state, recordId);
  }

  private disposeAll(): void {
    this.#mapView?.destroy();
    this.#mapView = null;
    this.#gridUnsubscribe?.();
    this.#gridUnsubscribe = null;
    this.#invalidationUnsubscribe?.();
    this.#invalidationUnsubscribe = null;
    this.#gridController?.dispose();
    this.#gridController = null;
    this.#gridClient = null;
    this.#gridHost = null;
    this.#detailHost = null;
  }
}

function providerForView(settings: PluginSettings, viewId: string) {
  return (
    settings.mapPresentation.perViewProvider[viewId] ??
    settings.mapPresentation.defaultProvider
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
