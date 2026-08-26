import {
  getLanguage,
  Notice,
  PluginSettingTab,
  SecretComponent,
  Setting,
  type App,
  type TextComponent,
} from 'obsidian';

import type LoomTablePlugin from '../main';
import type { ProfileCredentialStore } from '../credentials/profile-credential-store';
import type { TileCredentialStore } from '../maps/credentials/tile-credential-store';
import { getBuiltInMapCredentialEntries } from './map-credential-entries';
import { TileProviderRegistry } from '../maps/providers/tile-provider-registry';
import {
  credentialBindingKey,
  validateCustomTileProviderProfile,
  type CustomTileProviderProfileV1,
  type TileProviderRef,
} from '../maps/providers/tile-provider-schema';
import { createTranslator } from '../i18n';
import { getLocaleOptions } from './locale-options';
import {
  connectionCheckTone,
  describeConnectionCheck,
  type ConnectionCheckState,
} from './connection-check-presentation';
import {
  DEFAULT_SERVER_ORIGIN,
  normalizeServerOrigin,
  type ConnectionProfile,
} from './connection-profile';
import {
  addConnectionProfile,
  removeConnectionProfile,
  setConnectionProfileRemembered,
  setDefaultConnectionProfile,
  type LocalePreference,
} from './plugin-settings';

export class LoomTableSettingTab extends PluginSettingTab {
  readonly #connectionChecks = new Map<ConnectionProfile['id'], ConnectionCheckState>();
  readonly #checkSequences = new Map<ConnectionProfile['id'], number>();
  #customNameDraft = '';
  #customUrlDraft = '';

  constructor(
    app: App,
    private readonly loomTablePlugin: LoomTablePlugin,
    private readonly credentials: ProfileCredentialStore,
    private readonly tileCredentials?: TileCredentialStore,
  ) {
    super(app, loomTablePlugin);
  }

  override display(): void {
    this.containerEl.empty();
    const t = createTranslator(this.loomTablePlugin.settings.locale, getLanguage);
    new Setting(this.containerEl).setName(t('settings.title')).setHeading();

    new Setting(this.containerEl).setName(t('language.label')).addDropdown((dropdown) =>
      dropdown
        .addOptions(getLocaleOptions(t))
        .setValue(this.loomTablePlugin.settings.locale)
        .onChange(async (locale) => {
          this.loomTablePlugin.settings.locale = locale as LocalePreference;
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

    new Setting(this.containerEl)
      .setDesc(t('connection.addProfileDescription'))
      .addButton((button) =>
        button
          .setButtonText(t('connection.addProfile'))
          .setCta()
          .onClick(async () => {
            addConnectionProfile(this.loomTablePlugin.settings, {
              name: t('connection.newName'),
              serverOrigin: DEFAULT_SERVER_ORIGIN,
            });
            await this.loomTablePlugin.saveSettings();
            this.display();
            this.loomTablePlugin.refreshViews();
          }),
      );

    this.renderMapSettings();
  }

  private renderProfile(profile: ConnectionProfile): void {
    const t = createTranslator(this.loomTablePlugin.settings.locale, getLanguage);
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
          if (
            profile.rememberToken &&
            token.trim() !== '' &&
            !this.credentials.rememberSessionToken(profile)
          ) {
            new Notice(t('connection.rememberTokenFailed'));
          }
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
            const previous = {
              rememberToken: profile.rememberToken,
              tokenSecretId: profile.tokenSecretId,
            };
            profile.tokenSecretId = secretId.trim() === '' ? null : secretId.trim();
            setConnectionProfileRemembered(profile, profile.tokenSecretId !== null);
            if (
              profile.rememberToken &&
              this.credentials.getSession(profile) !== null &&
              !this.credentials.rememberSessionToken(profile)
            ) {
              profile.rememberToken = previous.rememberToken;
              profile.tokenSecretId = previous.tokenSecretId;
              new Notice(t('connection.rememberTokenFailed'));
              return;
            }
            try {
              await this.loomTablePlugin.saveSettings();
              this.display();
            } catch {
              profile.rememberToken = previous.rememberToken;
              profile.tokenSecretId = previous.tokenSecretId;
              new Notice(t('connection.rememberTokenFailed'));
            }
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
            const previous = {
              rememberToken: profile.rememberToken,
              tokenSecretId: profile.tokenSecretId,
            };
            setConnectionProfileRemembered(profile, rememberToken);
            if (
              rememberToken &&
              this.credentials.getSession(profile) !== null &&
              !this.credentials.rememberSessionToken(profile)
            ) {
              profile.rememberToken = previous.rememberToken;
              profile.tokenSecretId = previous.tokenSecretId;
              new Notice(t('connection.rememberTokenFailed'));
              this.display();
              return;
            }
            try {
              await this.loomTablePlugin.saveSettings();
              this.display();
            } catch {
              profile.rememberToken = previous.rememberToken;
              profile.tokenSecretId = previous.tokenSecretId;
              new Notice(t('connection.rememberTokenFailed'));
            }
          }),
      );

    new Setting(section)
      .setName(t('connection.disconnect'))
      .setDesc(t('connection.disconnectDescription'))
      .addButton((button) =>
        button.setButtonText(t('connection.disconnect')).onClick(() => {
          this.invalidateConnectionCheck(profile);
          this.credentials.disconnect(profile);
          this.display();
          this.loomTablePlugin.refreshViews();
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

    new Setting(section).setDesc(t('connection.deleteProfileDescription')).addButton((button) =>
      button
        .setButtonText(t('connection.deleteProfile'))
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
    const t = createTranslator(this.loomTablePlugin.settings.locale, getLanguage);
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

  private renderMapSettings(): void {
    const t = createTranslator(this.loomTablePlugin.settings.locale, getLanguage);
    const section = this.containerEl.createDiv({ cls: 'loom-map-settings' });
    new Setting(section).setName(t('map.settings')).setHeading();
    const registry = new TileProviderRegistry({
      customProfiles: () => this.loomTablePlugin.settings.mapPresentation.customProfiles,
    });
    const providers = registry.list();
    new Setting(section).setName(t('map.defaultProvider')).addDropdown((dropdown) => {
      for (const provider of providers) {
        dropdown.addOption(providerKey(provider.ref), provider.displayName);
      }
      dropdown
        .setValue(providerKey(this.loomTablePlugin.settings.mapPresentation.defaultProvider))
        .onChange(async (value) => {
          const provider = providers.find((candidate) => providerKey(candidate.ref) === value);
          if (provider === undefined) return;
          this.loomTablePlugin.settings.mapPresentation.defaultProvider = provider.ref;
          await this.loomTablePlugin.saveSettings();
          this.loomTablePlugin.refreshViews();
        });
    });

    for (const entry of getBuiltInMapCredentialEntries()) {
      this.renderCredential(
        section,
        t('map.tiandituToken'),
        entry.ref,
        entry.slotId,
        entry.slotName,
        t('map.tiandituCredentialDescription'),
      );
    }
    for (const profile of this.loomTablePlugin.settings.mapPresentation.customProfiles) {
      this.renderCustomProfile(section, profile);
      for (const slot of profile.credentialSlots ?? []) {
        this.renderCredential(
          section,
          profile.name,
          { kind: 'custom', profileId: profile.id },
          slot.id,
          slot.displayName,
        );
      }
    }

    new Setting(section).setName(t('map.customProfile')).setHeading();
    new Setting(section).setName(t('map.customName')).addText((text) =>
      text.setValue(this.#customNameDraft).onChange((value) => {
        this.#customNameDraft = value;
      }),
    );
    new Setting(section)
      .setName(t('map.customUrl'))
      .setDesc(t('map.customUrlDescription'))
      .addText((text) =>
        text.setValue(this.#customUrlDraft).onChange((value) => {
          this.#customUrlDraft = value;
        }),
      );
    new Setting(section).addButton((button) =>
      button
        .setButtonText(t('map.addCustom'))
        .setCta()
        .onClick(async () => {
          const name = this.#customNameDraft.trim();
          const urlTemplate = this.#customUrlDraft.trim();
          const profile: CustomTileProviderProfileV1 = {
            schemaVersion: 1,
            id: `custom-${Date.now().toString(36)}`,
            name,
            urlTemplate,
            minZoom: 0,
            maxZoom: 18,
            tileSize: 256,
            attribution: [{ label: name }],
          };
          const error = validateCustomTileProviderProfile(profile);
          if (error !== null) {
            new Notice(t('map.invalidProvider'));
            return;
          }
          this.loomTablePlugin.settings.mapPresentation.customProfiles.push(profile);
          this.#customNameDraft = '';
          this.#customUrlDraft = '';
          await this.loomTablePlugin.saveSettings();
          this.display();
        }),
    );
  }

  private renderCustomProfile(section: HTMLElement, profile: CustomTileProviderProfileV1): void {
    const t = createTranslator(this.loomTablePlugin.settings.locale, getLanguage);
    new Setting(section)
      .setName(profile.name)
      .setDesc(profile.urlTemplate)
      .addButton((button) =>
        button
          .setButtonText(t('common.delete'))
          .setWarning()
          .onClick(async () => {
            this.loomTablePlugin.settings.mapPresentation.customProfiles =
              this.loomTablePlugin.settings.mapPresentation.customProfiles.filter(
                (candidate) => candidate.id !== profile.id,
              );
            await this.loomTablePlugin.saveSettings();
            this.display();
          }),
      );
  }

  private renderCredential(
    section: HTMLElement,
    providerName: string,
    ref: TileProviderRef,
    slotId: string,
    slotName: string,
    description?: string,
  ): void {
    const t = createTranslator(this.loomTablePlugin.settings.locale, getLanguage);
    const bindingKey = credentialBindingKey(ref, slotId);
    const settings = this.loomTablePlugin.settings.mapPresentation;
    new Setting(section)
      .setName(slotName === '' ? providerName : `${providerName} · ${slotName}`)
      .setDesc(description ?? t('map.credentialDescription'))
      .addText((text) => {
        text.inputEl.type = 'password';
        text.inputEl.autocomplete = 'off';
        text.setValue(this.tileCredentials?.getSession(bindingKey) ?? '').onChange((value) => {
          this.tileCredentials?.setSession(bindingKey, value);
          this.loomTablePlugin.refreshViews();
        });
      })
      .addComponent((container) =>
        new SecretComponent(this.app, container)
          .setValue(settings.credentialBindings[bindingKey] ?? '')
          .onChange(async (secretId) => {
            if (secretId.trim() === '') delete settings.credentialBindings[bindingKey];
            else settings.credentialBindings[bindingKey] = secretId.trim();
            await this.loomTablePlugin.saveSettings();
            this.display();
          }),
      );
  }

  private renderConnectionCheck(section: HTMLElement, profile: ConnectionProfile): () => void {
    const t = createTranslator(this.loomTablePlugin.settings.locale, getLanguage);
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
function providerKey(ref: TileProviderRef): string {
  return ref.kind === 'built-in' ? `built-in:${ref.id}` : `custom:${ref.profileId}`;
}
