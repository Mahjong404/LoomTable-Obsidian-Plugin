import { ItemView, type WorkspaceLeaf } from 'obsidian';

import type { Translator } from '../i18n';
import type { PluginSettings } from '../settings/plugin-settings';

export const LOOMTABLE_VIEW_TYPE = 'loomtable-main';

export class LoomTableView extends ItemView {
  constructor(
    leaf: WorkspaceLeaf,
    private readonly getSettings: () => PluginSettings,
    private readonly getTranslator: () => Translator,
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

  render(): void {
    const t = this.getTranslator();
    this.contentEl.empty();
    this.contentEl.addClass('loom-root');
    this.contentEl.createEl('h2', { text: t('view.title') });

    const hasProfile = this.getSettings().connectionProfiles.length > 0;
    this.contentEl.createEl('p', {
      cls: hasProfile ? 'loom-status is-ready' : 'loom-status',
      text: hasProfile ? t('view.ready') : t('view.configure'),
    });
  }
}
