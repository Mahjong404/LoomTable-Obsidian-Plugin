import {
  Notice,
  PluginSettingTab,
  SecretComponent,
  Setting,
  type App,
  type TextComponent,
} from 'obsidian';

import type LoomTablePlugin from '../main';
import type { ProfileCredentialStore } from '../credentials/profile-credential-store';
import { createTranslator } from '../i18n';
import { normalizeServerOrigin, type ConnectionProfile } from './connection-profile';
import {
  addConnectionProfile,
  removeConnectionProfile,
  setDefaultConnectionProfile,
  type SupportedLocale,
} from './plugin-settings';

export class LoomTableSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly loomTablePlugin: LoomTablePlugin,
    private readonly credentials: ProfileCredentialStore,
  ) {
    super(app, loomTablePlugin);
  }

  override display(): void {
    this.containerEl.empty();
    const t = createTranslator(this.loomTablePlugin.settings.locale);
    new Setting(this.containerEl).setName(t('settings.title')).setHeading();

    new Setting(this.containerEl).setName(t('language.label')).addDropdown((dropdown) =>
      dropdown
        .addOption('en', t('language.english'))
        .addOption('zh-CN', t('language.zhCN'))
        .setValue(this.loomTablePlugin.settings.locale)
        .onChange(async (locale) => {
          this.loomTablePlugin.settings.locale = locale as SupportedLocale;
          await this.loomTablePlugin.saveSettings();
          this.display();
          this.loomTablePlugin.refreshViews();
        }),
    );

    new Setting(this.containerEl).setName(t('settings.connections')).setHeading();
    if (this.loomTablePlugin.settings.connectionProfiles.length === 0) {
      this.containerEl.createEl('p', { text: t('connection.empty') });
    }

    for (const profile of this.loomTablePlugin.settings.connectionProfiles) {
      this.renderProfile(profile);
    }

    new Setting(this.containerEl).addButton((button) =>
      button
        .setButtonText(t('common.add'))
        .setCta()
        .onClick(async () => {
          addConnectionProfile(this.loomTablePlugin.settings, {
            name: t('connection.newName'),
            serverOrigin: 'http://localhost:3000',
            rememberToken: false,
            tokenSecretId: null,
          });
          await this.loomTablePlugin.saveSettings();
          this.display();
          this.loomTablePlugin.refreshViews();
        }),
    );
  }

  private renderProfile(profile: ConnectionProfile): void {
    const t = createTranslator(this.loomTablePlugin.settings.locale);
    const section = this.containerEl.createDiv({ cls: 'loom-profile' });
    new Setting(section).setName(profile.name).setHeading();

    new Setting(section).setName(t('connection.name')).addText((text) =>
      text.setValue(profile.name).onChange(async (value) => {
        profile.name = value.trim() || t('connection.newName');
        await this.loomTablePlugin.saveSettings();
      }),
    );

    new Setting(section).setName(t('connection.origin')).addText((text) => {
      text.setValue(profile.serverOrigin);
      text.inputEl.addEventListener('change', () => {
        void this.saveServerOrigin(profile, text);
      });
    });

    new Setting(section)
      .setName(t('connection.token'))
      .setDesc(t('connection.tokenSession'))
      .addText((text) => {
        text.inputEl.type = 'password';
        text.inputEl.autocomplete = 'off';
        text
          .setValue(this.credentials.getSession(profile) ?? '')
          .onChange((token) => this.credentials.setSession(profile, token));
      });

    new Setting(section)
      .setName(t('connection.rememberedToken'))
      .setDesc(t('connection.rememberTokenWarning'))
      .addComponent((container) =>
        new SecretComponent(this.app, container)
          .setValue(profile.tokenSecretId ?? '')
          .onChange(async (secretId) => {
            profile.tokenSecretId = secretId === '' ? null : secretId;
            profile.rememberToken = profile.tokenSecretId !== null;
            await this.loomTablePlugin.saveSettings();
            this.display();
          }),
      );

    new Setting(section)
      .setName(t('connection.rememberToken'))
      .setDesc(t('connection.rememberTokenWarning'))
      .addToggle((toggle) =>
        toggle
          .setValue(profile.rememberToken)
          .setDisabled(profile.tokenSecretId === null)
          .onChange(async (rememberToken) => {
            profile.rememberToken = rememberToken;
            if (!rememberToken) profile.tokenSecretId = null;
            await this.loomTablePlugin.saveSettings();
            this.display();
          }),
      );

    new Setting(section).setName(t('connection.default')).addToggle((toggle) =>
      toggle
        .setValue(this.loomTablePlugin.settings.defaultConnectionProfileId === profile.id)
        .onChange(async (isDefault) => {
          if (!isDefault) return;
          setDefaultConnectionProfile(this.loomTablePlugin.settings, profile.id);
          await this.loomTablePlugin.saveSettings();
          this.display();
        }),
    );

    new Setting(section).addButton((button) =>
      button
        .setButtonText(t('common.delete'))
        .setWarning()
        .onClick(async () => {
          this.credentials.delete(profile);
          removeConnectionProfile(this.loomTablePlugin.settings, profile.id);
          await this.loomTablePlugin.saveSettings();
          this.display();
          this.loomTablePlugin.refreshViews();
        }),
    );
  }

  private async saveServerOrigin(profile: ConnectionProfile, text: TextComponent): Promise<void> {
    const t = createTranslator(this.loomTablePlugin.settings.locale);
    try {
      profile.serverOrigin = normalizeServerOrigin(text.getValue());
      text.setValue(profile.serverOrigin);
      await this.loomTablePlugin.saveSettings();
    } catch {
      new Notice(t('error.invalidOrigin'));
      text.setValue(profile.serverOrigin);
    }
  }
}
