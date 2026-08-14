import { ItemView, type WorkspaceLeaf } from 'obsidian';

import type { LoomTableClient, LoomTableRecord } from '../client/loomtable-client';
import type { Translator } from '../i18n';
import type { ConnectionProfile } from '../settings/connection-profile';
import type { PluginSettings } from '../settings/plugin-settings';
import { GridViewController } from './grid-view-controller';
import { ReadonlyGridRenderer } from './readonly-grid-renderer';

export const LOOMTABLE_VIEW_TYPE = 'loomtable-main';

export type LoomTableClientFactory = (profile: ConnectionProfile) => LoomTableClient;

export class LoomTableView extends ItemView {
  #unsubscribe: (() => void) | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly getSettings: () => PluginSettings,
    private readonly getTranslator: () => Translator,
    private readonly createClient: LoomTableClientFactory,
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
    this.disposeGrid();
  }

  render(): void {
    const settings = this.getSettings();
    const profile = defaultProfile(settings);
    if (profile === null) {
      this.disposeGrid();
      this.contentEl.empty();
      this.contentEl.addClass('loom-root');
      this.contentEl.createEl('h2', { text: this.getTranslator()('view.title') });
      this.contentEl.createEl('p', {
        cls: 'loom-status',
        text: this.getTranslator()('view.configure'),
      });
      return;
    }

    this.disposeGrid();
    this.contentEl.empty();
    this.contentEl.addClass('loom-root');

    const controller = new GridViewController(this.createClient(profile));
    const renderer = new ReadonlyGridRenderer(this.contentEl, this.getTranslator(), {
      onRefresh: () => controller.refresh(),
      onWorkspaceChange: (workspaceId) => controller.selectWorkspace(workspaceId),
      onBaseChange: (baseId) => controller.selectBase(baseId),
      onTableChange: (tableId) => controller.selectTable(tableId),
      onViewChange: (viewId) => controller.selectView(viewId),
      onLoadMore: () => controller.loadNextPage(),
      onRecordOpen: (record) => this.showRecordDetail(record),
    });
    this.#unsubscribe = controller.subscribe((state) => renderer.render(state));
    void controller.load();
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

  private disposeGrid(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
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
