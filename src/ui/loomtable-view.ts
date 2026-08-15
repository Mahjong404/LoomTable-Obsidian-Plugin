import { ItemView, type WorkspaceLeaf } from 'obsidian';

import type { LoomTableClient, LoomTableRecord, View } from '../client/loomtable-client';
import type { Translator } from '../i18n';
import type { TileCredentialReader } from '../maps/providers/tile-provider-schema';
import type { TileProviderRegistry } from '../maps/providers/tile-provider-registry';
import type { MapRenderer } from '../maps/renderer/map-renderer';
import type { ConnectionProfile } from '../settings/connection-profile';
import type { PluginSettings } from '../settings/plugin-settings';
import { GridViewController, type GridState } from './grid-view-controller';
import { ReadonlyGridRenderer } from './readonly-grid-renderer';
import { MapViewController, type MapViewportSource } from '../views/map/map-view-controller';
import { MapView, type MapViewNavigation } from '../views/map/map-view';

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
}

export class LoomTableView extends ItemView {
  #gridUnsubscribe: (() => void) | null = null;
  #gridController: GridViewController | null = null;
  #mapView: MapView | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly getSettings: () => PluginSettings,
    private readonly getTranslator: () => Translator,
    private readonly createClient: LoomTableClientFactory,
    private readonly mapContext: LoomTableMapContext,
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
      this.contentEl.createEl('h2', { text: this.getTranslator()('view.title') });
      this.contentEl.createEl('p', {
        cls: 'loom-status',
        text: this.getTranslator()('view.configure'),
      });
      return;
    }

    this.disposeAll();
    this.renderGrid(
      profile,
      new GridViewController(this.createClient(profile), {
        onNonGridViewSelected: (view, state) => this.showMap(profile, view, state),
      }),
    );
  }

  private renderGrid(profile: ConnectionProfile, controller: GridViewController): void {
    this.#mapView?.destroy();
    this.#mapView = null;
    this.#gridUnsubscribe?.();
    this.#gridUnsubscribe = null;
    this.contentEl.empty();
    this.contentEl.addClass('loom-root');

    const renderer = new ReadonlyGridRenderer(this.contentEl, this.getTranslator(), {
      onRefresh: () => controller.refresh(),
      onWorkspaceChange: (workspaceId) => controller.selectWorkspace(workspaceId),
      onBaseChange: (baseId) => controller.selectBase(baseId),
      onTableChange: (tableId) => controller.selectTable(tableId),
      onViewChange: (viewId) => controller.selectView(viewId),
      onLoadMore: () => controller.loadNextPage(),
      onRecordOpen: (record) => this.showRecordDetail(record),
      onCellEdit: (recordId, fieldId, value) => controller.editCell(recordId, fieldId, value),
      onConflictAction: (recordId, action) => controller.resolveConflict(recordId, action),
    });
    this.#gridController = controller;
    this.#gridUnsubscribe = controller.subscribe((state) => renderer.render(state));
    if (controller.state.status === 'idle') void controller.load();
  }

  private showMap(profile: ConnectionProfile, view: View, navigationState: GridState): void {
    if (view.type !== 'map') return;
    this.#gridUnsubscribe?.();
    this.#gridUnsubscribe = null;
    this.#mapView?.destroy();
    const client = this.createClient(profile);
    const instance = this.mapContext.createRenderer();
    const controller = new MapViewController(client, view, navigationState.fields, {
      renderer: instance.renderer,
      registry: this.mapContext.registry,
      credentials: this.mapContext.credentials,
      provider: providerForView(this.getSettings(), view.id),
      viewport: instance.viewport,
      isOffline: () => typeof navigator !== 'undefined' && navigator.onLine === false,
    });
    const navigation = this.mapNavigation(profile, navigationState, view);
    const provider = providerForView(this.getSettings(), view.id);
    this.#mapView = new MapView(this.contentEl, controller, {
      navigation,
      onClusterNextPage: () => controller.loadNextClusterPage(),
      providers: this.mapContext.registry.list(),
      selectedProvider: provider,
      onProviderChange: async (nextProvider) => {
        controller.setProvider(nextProvider);
        this.getSettings().mapPresentation.perViewProvider[view.id] = nextProvider;
        await this.mapContext.saveSettings();
      },
    });
    this.#mapView.mount();
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
      selectedWorkspaceId: state.selectedWorkspaceId,
      selectedBaseId: state.selectedBaseId,
      selectedTableId: state.selectedTableId,
      selectedViewId: view.id,
      onWorkspaceChange: async (workspaceId) => {
        await controller.selectWorkspace(workspaceId);
        this.showMapForCurrentSelection(profile, controller);
      },
      onBaseChange: async (baseId) => {
        await controller.selectBase(baseId);
        this.showMapForCurrentSelection(profile, controller);
      },
      onTableChange: async (tableId) => {
        await controller.selectTable(tableId);
        this.showMapForCurrentSelection(profile, controller);
      },
      onViewChange: async (viewId) => {
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

  private showRecordDetail(record: LoomTableRecord): void {
    const detail = this.contentEl.createDiv({ cls: 'loom-record-detail' });
    const header = detail.createDiv({ cls: 'loom-record-detail-header' });
    header.createEl('strong', { text: this.getTranslator()('grid.openDetails') });
    const close = header.createEl('button', {
      cls: 'loom-button',
      text: this.getTranslator()('common.close'),
    });
    close.setAttr('aria-label', this.getTranslator()('common.close'));
    close.addEventListener('click', () => detail.remove());
    detail.createEl('p', { text: `Record ${record.id}` });
    detail.createEl('pre', { text: JSON.stringify(record.values, null, 2) });
  }

  private disposeAll(): void {
    this.#mapView?.destroy();
    this.#mapView = null;
    this.#gridUnsubscribe?.();
    this.#gridUnsubscribe = null;
    this.#gridController?.dispose();
    this.#gridController = null;
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

