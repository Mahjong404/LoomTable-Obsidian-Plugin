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
import {
  connectionCheckTone,
  describeConnectionCheck,
  type ConnectionCheckState,
} from './connection-check-presentation';
import { normalizeServerOrigin, type ConnectionProfile } from './connection-profile';
import {
  addConnectionProfile,
  removeConnectionProfile,
  setDefaultConnectionProfile,
  type SupportedLocale,
} from './plugin-settings';

export class LoomTableSettingTab extends PluginSettingTab {
  readonly #connectionChecks = new Map<ConnectionProfile['id'], ConnectionCheckState>();
  readonly #checkSequences = new Map<ConnectionProfile['id'], number>();

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
    let refreshConnectionCheck = (): void => undefined;
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
        text.setValue(this.credentials.getSession(profile) ?? '').onChange((token) => {
          this.invalidateConnectionCheck(profile);
          this.credentials.setSession(profile, token);
          refreshConnectionCheck();
        });
      });

    new Setting(section)
      .setName(t('connection.rememberedToken'))
      .setDesc(t('connection.rememberTokenWarning'))
      .addComponent((container) =>
        new SecretComponent(this.app, container)
          .setValue(profile.tokenSecretId ?? '')
          .onChange(async (secretId) => {
            this.invalidateConnectionCheck(profile);
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
            this.invalidateConnectionCheck(profile);
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

    refreshConnectionCheck = this.renderConnectionCheck(section, profile);

    new Setting(section).addButton((button) =>
      button
        .setButtonText(t('common.delete'))
        .setWarning()
        .onClick(async () => {
          this.invalidateConnectionCheck(profile);
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
      this.invalidateConnectionCheck(profile);
      text.setValue(profile.serverOrigin);
      await this.loomTablePlugin.saveSettings();
      window.setTimeout(() => this.display(), 0);
    } catch {
      new Notice(t('error.invalidOrigin'));
      text.setValue(profile.serverOrigin);
    }
  }

  private renderConnectionCheck(section: HTMLElement, profile: ConnectionProfile): () => void {
    const t = createTranslator(this.loomTablePlugin.settings.locale);
    const status = new Setting(section).setName(t('connection.test'));
    status.settingEl.addClass('loom-connection-check');
    let refresh = (): void => undefined;
    status.addButton((button) => {
      refresh = (): void => {
        const state = this.#connectionChecks.get(profile.id) ?? { kind: 'idle' };
        status.setDesc(describeConnectionCheck(state, t));
        status.settingEl.removeClass(
          'is-idle',
          'is-pending',
          'is-success',
          'is-warning',
          'is-error',
        );
        status.settingEl.addClass(`is-${connectionCheckTone(state)}`);
        button
          .setButtonText(state.kind === 'checking' ? t('connection.testing') : t('connection.test'))
          .setDisabled(state.kind === 'checking');
      };
      button.onClick(() => this.testConnection(profile));
    });
    refresh();
    return refresh;
  }

  private async testConnection(profile: ConnectionProfile): Promise<void> {
    const sequence = (this.#checkSequences.get(profile.id) ?? 0) + 1;
    this.#checkSequences.set(profile.id, sequence);
    this.#connectionChecks.set(profile.id, { kind: 'checking' });
    this.display();

    const result = await this.loomTablePlugin.checkConnection(profile);
    if (
      this.#checkSequences.get(profile.id) !== sequence ||
      !this.loomTablePlugin.settings.connectionProfiles.some(
        (candidate) => candidate.id === profile.id,
      )
    ) {
      return;
    }
    this.#connectionChecks.set(profile.id, { kind: 'complete', result });
    this.display();
  }

  private invalidateConnectionCheck(profile: ConnectionProfile): void {
    this.#checkSequences.set(profile.id, (this.#checkSequences.get(profile.id) ?? 0) + 1);
    this.#connectionChecks.delete(profile.id);
  }
}
