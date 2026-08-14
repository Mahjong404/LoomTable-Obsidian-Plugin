import { Plugin } from 'obsidian';

import { HttpLoomTableClient } from './client/http-loomtable-client';
import type { ConnectionCheckResult } from './client/loomtable-client';
import { obsidianHttpTransport } from './client/obsidian-http-transport';
import {
  ObsidianSecretCredentialStore,
  SessionCredentialStore,
} from './credentials/credential-store';
import { ProfileCredentialStore } from './credentials/profile-credential-store';
import { createTranslator } from './i18n';
import { normalizePluginSettings, type PluginSettings } from './settings/plugin-settings';
import type { ConnectionProfile } from './settings/connection-profile';
import { LoomTableSettingTab } from './settings/settings-tab';
import { LOOMTABLE_VIEW_TYPE, LoomTableView } from './ui/loomtable-view';

export default class LoomTablePlugin extends Plugin {
  override settings: PluginSettings = normalizePluginSettings(null);
  private credentials!: ProfileCredentialStore;

  override async onload(): Promise<void> {
    this.settings = normalizePluginSettings(await this.loadData());
    this.credentials = new ProfileCredentialStore(
      new SessionCredentialStore(),
      new ObsidianSecretCredentialStore(this.app.secretStorage),
    );

    this.registerView(
      LOOMTABLE_VIEW_TYPE,
      (leaf) =>
        new LoomTableView(
          leaf,
          () => this.settings,
          () => createTranslator(this.settings.locale),
          (profile) => this.createClient(profile),
        ),
    );

    const openView = async (): Promise<void> => this.activateView();
    this.addRibbonIcon('table-2', createTranslator(this.settings.locale)('command.open'), openView);
    this.addCommand({
      id: 'open',
      name: createTranslator(this.settings.locale)('command.open'),
      callback: openView,
    });
    this.addSettingTab(new LoomTableSettingTab(this.app, this, this.credentials));
  }

  async saveSettings(): Promise<void> {
    this.settings = normalizePluginSettings(this.settings);
    await this.saveData(this.settings);
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

  private async activateView(): Promise<void> {
    let leaf = this.app.workspace.getLeavesOfType(LOOMTABLE_VIEW_TYPE)[0];
    leaf ??= this.app.workspace.getLeaf('tab');
    await leaf.setViewState({ type: LOOMTABLE_VIEW_TYPE, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }
}
