import { getLanguage, Plugin } from 'obsidian';

import { HttpLoomTableClient } from './client/http-loomtable-client';
import { LoomTableClientError, type ConnectionCheckResult } from './client/loomtable-client';
import { obsidianHttpTransport } from './client/obsidian-http-transport';
import {
  ObsidianSecretCredentialStore,
  SessionCredentialStore,
} from './credentials/credential-store';
import { ProfileCredentialStore } from './credentials/profile-credential-store';
import { createTranslator } from './i18n';
import { TileCredentialStore } from './maps/credentials/tile-credential-store';
import { TileProviderRegistry } from './maps/providers/tile-provider-registry';
import { LeafletMapAdapter } from './maps/renderer/leaflet-map-renderer';
import { LeafletMapRenderer } from './maps/renderer/map-renderer';
import { normalizePluginSettings, type PluginSettings } from './settings/plugin-settings';
import type { ConnectionProfile } from './settings/connection-profile';
import { LoomTableSettingTab } from './settings/settings-tab';
import { LOOMTABLE_VIEW_TYPE, LoomTableView, type MapRendererInstance } from './ui/loomtable-view';
import { MutationInvalidationBus } from './ui/mutation-invalidation';
import { MutationQueueRuntime } from './ui/mutation-queue-runtime';

export default class LoomTablePlugin extends Plugin {
  override settings: PluginSettings = normalizePluginSettings(null);
  private credentials!: ProfileCredentialStore;
  private tileCredentials!: TileCredentialStore;
  private tileProviders!: TileProviderRegistry;
  private mutationQueueRuntime: MutationQueueRuntime | null = null;
  private readonly mutationInvalidations = new MutationInvalidationBus();

  override async onload(): Promise<void> {
    this.settings = normalizePluginSettings(await this.loadData());
    this.credentials = new ProfileCredentialStore(
      new SessionCredentialStore(),
      new ObsidianSecretCredentialStore(this.app.secretStorage),
    );
    this.tileCredentials = new TileCredentialStore(
      new ObsidianSecretCredentialStore(this.app.secretStorage),
      () => this.settings.mapPresentation.credentialBindings,
    );
    this.tileProviders = new TileProviderRegistry({
      customProfiles: () => this.settings.mapPresentation.customProfiles,
    });

    const mutationQueueRuntime = new MutationQueueRuntime({
      load: () => this.settings.mutationQueue,
      save: async (value) => {
        this.settings.mutationQueue = value;
        await this.saveData(this.settings);
      },
      transport: {
        mutate: (tableId, request) => {
          const profile = defaultProfile(this.settings);
          if (profile === null || this.credentials.get(profile) === null) {
            return Promise.reject(
              new LoomTableClientError('authentication', {
                message: 'Authentication is required before this mutation can be sent.',
                httpStatus: 401,
              }),
            );
          }
          return this.createClient(profile).mutate(tableId, request);
        },
      },
      isOnline: () => isBrowserOnline(),
      isAuthReady: () => this.hasAuthReadyProfile(),
      onApplied: (entry, result) => {
        const record = result.results.find(
          (item) =>
            item.index === 0 &&
            item.record.id === entry.recordId &&
            item.record.tableId === entry.tableId,
        )?.record;
        if (record !== undefined) {
          this.mutationInvalidations.publish({
            tableId: entry.tableId,
            recordId: entry.recordId,
            record,
            changeCursor: result.changeCursor,
          });
        }
      },
    });
    this.mutationQueueRuntime = mutationQueueRuntime;
    const mutationScheduler = await mutationQueueRuntime.start();
    if (typeof window !== 'undefined') {
      this.registerDomEvent(window, 'online', () => {
        void this.mutationQueueRuntime?.setOnline(true);
      });
      this.registerDomEvent(window, 'offline', () => {
        void this.mutationQueueRuntime?.setOnline(false);
      });
    }

    this.registerView(
      LOOMTABLE_VIEW_TYPE,
      (leaf) =>
        new LoomTableView(
          leaf,
          () => this.settings,
          () => createTranslator(this.settings.locale, getLanguage),
          (profile) => this.createClient(profile),
          {
            registry: this.tileProviders,
            credentials: this.tileCredentials,
            saveSettings: () => this.saveSettings(),
            createRenderer: (): MapRendererInstance => {
              const renderer = new LeafletMapRenderer(new LeafletMapAdapter());
              return {
                renderer,
                viewport: {
                  getViewport: () => renderer.getViewport(),
                  getPixelSize: () => renderer.getPixelSize(),
                },
              };
            },
          },
          mutationScheduler,
          this.mutationInvalidations,
        ),
    );

    const openView = async (): Promise<void> => this.activateView();
    this.addRibbonIcon(
      'table-2',
      createTranslator(this.settings.locale, getLanguage)('command.open'),
      openView,
    );
    this.addCommand({
      id: 'open',
      name: createTranslator(this.settings.locale, getLanguage)('command.open'),
      callback: openView,
    });
    this.addSettingTab(
      new LoomTableSettingTab(this.app, this, this.credentials, this.tileCredentials),
    );
  }

  async saveSettings(): Promise<void> {
    this.settings = normalizePluginSettings(this.settings);
    await this.saveData(this.settings);
    await this.mutationQueueRuntime?.setAuthReady(this.hasAuthReadyProfile());
  }

  override onunload(): void {
    this.mutationQueueRuntime?.stop();
  }

  async checkConnection(profile: ConnectionProfile): Promise<ConnectionCheckResult> {
    return this.createClient(profile).checkConnection();
  }

  private createClient(profile: ConnectionProfile): HttpLoomTableClient {
    return new HttpLoomTableClient(
      {
        serverOrigin: profile.serverOrigin,
        pluginVersion: this.manifest.version,
        accessToken: () => this.credentials.get(profile),
      },
      obsidianHttpTransport,
    );
  }

  refreshViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(LOOMTABLE_VIEW_TYPE)) {
      if (leaf.view instanceof LoomTableView) {
        leaf.view.render();
      }
    }
  }

  private hasAuthReadyProfile(): boolean {
    const profile = defaultProfile(this.settings);
    return profile !== null && this.credentials.get(profile) !== null;
  }

  private async activateView(): Promise<void> {
    let leaf = this.app.workspace.getLeavesOfType(LOOMTABLE_VIEW_TYPE)[0];
    leaf ??= this.app.workspace.getLeaf('tab');
    await leaf.setViewState({ type: LOOMTABLE_VIEW_TYPE, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }
}

function defaultProfile(settings: PluginSettings): ConnectionProfile | null {
  const defaultId = settings.defaultConnectionProfileId;
  return (
    settings.connectionProfiles.find((profile) => profile.id === defaultId) ??
    settings.connectionProfiles[0] ??
    null
  );
}

function isBrowserOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}
