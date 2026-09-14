import type { Translator } from '../i18n';
import type { MessageKey } from '../i18n/messages';
import type {
  Field,
  FilterNode,
  JsonValue,
  LoomTableRecord,
  MutationValue,
  SortSpec,
  View,
} from '../client/loomtable-client';
import type { GridConflict, GridState, GridStatus } from './grid-view-controller';
import { ensureButtonLabels, labelContainer } from './a11y';
import { openContextMenu, type ContextMenuEntry, type ContextMenuItem } from './context-menu';
import { createFieldTypeIcon } from './field-type-icon';
import { createUiIcon, type UiIconName } from './icons';
import { FilterBuilder } from './filter-builder';
import { SortPanel } from './sort-panel';
import { DisplayPanel } from './display-panel';
import { createRecordCreateForm, type RecordCreateForm } from './record-create-form';
import {
  clampGridColumnWidth,
  GRID_COLUMN_WIDTH_DEFAULT,
  GRID_INDEX_COLUMN_WIDTH,
  resolveGridColumns,
  type GridDisplayPatch,
  type ResolvedGridColumns,
} from './grid-display';
import {
  captureQueryControlFocus,
  restoreQueryControlFocus,
  type QueryControlFocus,
} from './query-focus';
import { countFilterRules, isSortableField, nextHeaderSort } from './view-query-model';
import { isEditableField } from './field-value-editor';
import {
  createRenderedFieldValueElement,
  defaultFieldRendererRegistry,
} from './field-renderer-registry';
import {
  parseClipboardValue,
  serializeCellForClipboard,
  type GridClipboardHost,
} from './grid-clipboard';
import { renderSaveStatus } from './save-status';
import { confirmDangerousAction } from './dangerous-action-confirmation';
import { TableShell } from './table-shell';
import type { ViewConfigRepairInput } from './view-config-repair';
import type {
  ViewCopyOutcome,
  ViewCreateInput,
  ViewCreateOutcome,
  ViewIssueAction,
  ViewWriteOutcome,
} from './view-write-coordinator';

export interface GridRendererCallbacks {
  readonly onRefresh: () => void | Promise<void>;
  readonly onWorkspaceChange: (workspaceId: string) => void | Promise<void>;
  readonly onBaseChange: (baseId: string) => void | Promise<void>;
  readonly onTableChange: (tableId: string) => void | Promise<void>;
  readonly onViewChange: (viewId: string) => void | Promise<void>;
  readonly onLoadMore: () => void | Promise<void>;
  readonly onRecordOpen: (record: LoomTableRecord) => void;
  readonly onCellEdit?: (recordId: string, fieldId: string, value: unknown) => void | Promise<void>;
  readonly onConflictAction?: (
    recordId: string,
    action: 'use-server' | 'overwrite' | 'discard-all',
  ) => void;
  readonly confirmDiscardAll?: (recordId: string) => boolean;
  readonly confirmDangerousAction?: (
    message: string,
    host: HTMLElement,
    trigger?: HTMLElement,
  ) => Promise<boolean>;
  readonly onRetryEdit?: (recordId: string) => void;
  readonly onOpenSettings?: () => void | Promise<void>;
  readonly onCreateView?: (input: ViewCreateInput) => Promise<ViewCreateOutcome>;
  readonly onRetryViewIntent?: (intentId: string) => void | Promise<void>;
  readonly onDismissViewIntent?: (intentId: string) => void | Promise<void>;
  readonly onManageViews?: () => void | Promise<void>;
  readonly onCloseManageViews?: () => void;
  readonly onRenameView?: (viewId: string, name: string) => Promise<ViewWriteOutcome>;
  readonly onCopyView?: (viewId: string, name: string) => Promise<ViewCopyOutcome>;
  readonly onDeleteView?: (viewId: string) => Promise<ViewWriteOutcome>;
  readonly onRestoreView?: (viewId: string) => Promise<ViewWriteOutcome>;
  readonly onRepairView?: (
    viewId: string,
    repair: ViewConfigRepairInput,
  ) => Promise<ViewWriteOutcome>;
  readonly onResolveViewIssue?: (
    viewId: string,
    action: ViewIssueAction,
  ) => void | Promise<unknown>;
  readonly onSearch?: (term: string) => void | Promise<unknown>;
  readonly onApplyFilter?: (
    viewId: string,
    filter: FilterNode | undefined,
  ) => Promise<ViewWriteOutcome>;
  readonly onApplySort?: (viewId: string, sort: readonly SortSpec[]) => Promise<ViewWriteOutcome>;
  readonly onApplyDisplay?: (viewId: string, patch: GridDisplayPatch) => Promise<ViewWriteOutcome>;
  readonly onCreateRecord?: (
    values: Readonly<Record<string, MutationValue>>,
  ) => Promise<LoomTableRecord>;
  readonly onRetryRecordCreate?: (operationId: string) => void | Promise<void>;
  readonly onDiscardRecordCreate?: (operationId: string) => void | Promise<void>;
  readonly onDismissRecordCreate?: (operationId: string) => void;
  readonly onDeleteRecord?: (recordId: string) => void | Promise<void>;
  readonly onUndoDelete?: () => void | Promise<void>;
  readonly onDismissDeleteNotice?: () => void;
  readonly onLoadDeletedRecords?: () => void | Promise<void>;
  readonly onLoadMoreDeletedRecords?: () => void | Promise<void>;
  readonly onRestoreRecord?: (recordId: string) => void | Promise<void>;
  readonly clipboard?: GridClipboardHost;
}

type GridAction = 'refresh' | 'settings';

interface GridActionButtonSpec {
  readonly action: GridAction;
  readonly labelKey: MessageKey;
  readonly pendingKey: MessageKey;
  readonly icon: UiIconName | undefined;
}

interface VirtualGridRefs {
  readonly viewport: HTMLElement;
  readonly rowLayer: HTMLElement;
  readonly state: GridState;
  readonly fields: readonly Field[];
  readonly columns: ResolvedGridColumns;
  readonly columnTemplate: string;
  readonly rowHeight: number;
}

export interface VirtualRowRange {
  readonly start: number;
  readonly end: number;
}

export class ReadonlyGridRenderer {
  readonly #container: HTMLElement;
  readonly #translate: Translator;
  readonly #callbacks: GridRendererCallbacks;
  readonly #shell: TableShell;
  #virtualGrid: VirtualGridRefs | null = null;
  #focusedCellKey: string | null = null;
  #focusedHeaderFieldId: string | null = null;
  #focusedCellPosition: { readonly rowIndex: number; readonly fieldIndex: number } | null = null;
  #lastConflictIds = new Set<string>();
  #lastState: GridState | null = null;
  #dismissedEditDraftKey: string | null = null;
  readonly #pendingActions = new Set<GridAction>();
  readonly #actionButtons = new Map<HTMLButtonElement, GridActionButtonSpec>();
  #focusedAction: GridAction | null = null;
  #openPanel: 'filter' | 'sort' | 'display' | 'create' | 'recycle' | null = null;
  #searchDraft: string | null = null;
  #searchError: string | null = null;
  #lastViewId: string | null = null;
  #sortFocusFieldId: string | null = null;
  #filterBuilder: FilterBuilder | null = null;
  #filterBuilderRevision: number | null = null;
  #sortPanel: SortPanel | null = null;
  #sortPanelRevision: number | null = null;
  #displayPanel: DisplayPanel | null = null;
  #displayPanelRevision: number | null = null;
  #createForm: RecordCreateForm | null = null;
  #clipboardNotice: string | null = null;
  #rowHeightAnchor: {
    readonly recordId: string | null;
    readonly index: number;
    readonly offset: number;
  } | null = null;

  constructor(container: HTMLElement, translate: Translator, callbacks: GridRendererCallbacks) {
    this.#container = container;
    this.#translate = translate;
    this.#callbacks = callbacks;
    this.#shell = new TableShell(translate, {
      onWorkspaceChange: (workspaceId) => callbacks.onWorkspaceChange(workspaceId),
      onBaseChange: (baseId) => callbacks.onBaseChange(baseId),
      onTableChange: (tableId) => callbacks.onTableChange(tableId),
      onViewChange: (viewId) => callbacks.onViewChange(viewId),
      ...(callbacks.onCreateView === undefined ? {} : { onCreateView: callbacks.onCreateView }),
      ...(callbacks.onRetryViewIntent === undefined
        ? {}
        : { onRetryViewIntent: callbacks.onRetryViewIntent }),
      ...(callbacks.onDismissViewIntent === undefined
        ? {}
        : { onDismissViewIntent: callbacks.onDismissViewIntent }),
      ...(callbacks.onManageViews === undefined
        ? {}
        : {
            onManageViews: callbacks.onManageViews,
            onCloseManageViews: callbacks.onCloseManageViews,
            onRenameView: callbacks.onRenameView,
            onCopyView: callbacks.onCopyView,
            onDeleteView: callbacks.onDeleteView,
            onRestoreView: callbacks.onRestoreView,
            onRepairView: callbacks.onRepairView,
            onResolveViewIssue: callbacks.onResolveViewIssue,
          }),
    });
  }

  render(state: GridState): void {
    if (state.selectedViewId !== this.#lastViewId) {
      this.#lastViewId = state.selectedViewId;
      this.#openPanel = null;
      this.#searchDraft = null;
      this.#searchError = null;
      this.#sortFocusFieldId = null;
      this.#filterBuilder = null;
      this.#sortPanel = null;
      this.#displayPanel = null;
      this.#rowHeightAnchor = null;
    }
    const previousGrid = this.#virtualGrid;
    const nextRowHeight = rowHeightPixels(state);
    if (
      previousGrid !== null &&
      previousGrid.rowHeight !== nextRowHeight &&
      previousGrid.state.records.length > 0
    ) {
      const firstIndex = Math.max(
        0,
        Math.floor(previousGrid.viewport.scrollTop / previousGrid.rowHeight),
      );
      this.#rowHeightAnchor = {
        recordId: previousGrid.state.records[firstIndex]?.id ?? null,
        index: firstIndex,
        offset: previousGrid.viewport.scrollTop - firstIndex * previousGrid.rowHeight,
      };
    }
    const queryFocus = captureQueryControlFocus(this.#container);
    this.#lastState = state;
    this.#virtualGrid = null;
    this.#actionButtons.clear();
    const root = createElement('div', 'loom-grid-shell');
    root.setAttribute('role', 'region');
    labelContainer(root, this.#translate('grid.table'));
    root.tabIndex = -1;
    root.append(this.#renderNavigation(state), this.#renderToolbar(state));
    root.append(this.#renderClipboardNote());
    const queryPanel = this.#renderQueryPanel(state);
    if (queryPanel !== null) root.append(queryPanel);
    const createOps = this.#renderCreateOps(state);
    if (createOps !== null) root.append(createOps);
    const deleteNotice = this.#renderDeletedNotice(state);
    if (deleteNotice !== null) root.append(deleteNotice);
    if (state.editError !== null) root.append(this.#renderEditError(state));
    if (state.conflicts.length > 0) root.append(this.#renderConflicts(state));

    if (state.status === 'loading' && state.records.length === 0) {
      root.append(this.#renderStatus('loading', state));
    } else if (state.records.length === 0) {
      root.append(this.#renderStatus(state.status, state));
    } else {
      if (state.status !== 'ready') root.append(this.#renderStatus(state.status, state));
      if (state.fields.length === 0) {
        root.append(
          this.#renderStatus('server-error', {
            ...state,
            error: { message: this.#translate('grid.noFields') },
          }),
        );
      } else {
        root.append(this.#renderGrid(state));
      }
    }

    const conflictIds = new Set(state.conflicts.map((conflict) => conflict.recordId));
    const hasNewConflict = [...conflictIds].some(
      (recordId) => !this.#lastConflictIds.has(recordId),
    );
    this.#lastConflictIds = conflictIds;
    ensureButtonLabels(root);
    this.#container.replaceChildren(root);
    this.#restoreRowHeightAnchor();
    this.#syncActionButtons();
    if (hasNewConflict) {
      this.#container.querySelector<HTMLElement>('.loom-grid-conflicts')?.focus();
    } else if (this.#restoreFailedEditDraft(state)) {
      return;
    } else if (this.#focusedAction !== null) {
      this.#restoreFocusedAction();
    } else if (this.#restoreQueryControl(queryFocus)) {
      return;
    } else if (this.#shell.restoreFocus()) {
      return;
    } else {
      const restored = this.#restoreFocusedHeader() || this.#restoreFocusedCell();
      if ((this.#focusedCellKey !== null || this.#focusedHeaderFieldId !== null) && !restored) {
        this.#focusGridFallback();
      }
    }
  }

  #renderToolbar(state: GridState): HTMLElement {
    const toolbar = createElement('div', 'loom-grid-toolbar');
    toolbar.setAttribute('role', 'toolbar');
    labelContainer(toolbar, this.#translate('grid.status'));
    const start = createElement('div', 'loom-toolbar-group loom-toolbar-start');
    const end = createElement('div', 'loom-toolbar-group loom-toolbar-end');
    const gridView = selectedGridView(state);
    if (gridView !== null) {
      const divider = createElement('span', 'loom-toolbar-divider');
      divider.setAttribute('aria-hidden', 'true');
      start.append(
        this.#renderSearchControls(state),
        divider,
        this.#renderQueryToggles(state, gridView),
      );
    }
    const count = createElement('span', 'loom-grid-count');
    if (state.totalCount !== null) {
      count.textContent = `${state.totalCount} ${this.#translate('grid.rows')}`;
    } else if (state.records.length > 0) {
      count.textContent = `${state.records.length} ${this.#translate('grid.rows')}`;
    }
    const saveStatus = createElement('span', 'loom-save-status');
    renderSaveStatus(saveStatus, state.saveStatus, this.#translate);
    end.append(count, saveStatus);
    if (this.#callbacks.onCreateRecord !== undefined && state.selectedTableId !== null) {
      const createButton = this.#toggleButton(
        'create',
        this.#translate('record.create.add'),
        state.recordCreateOps.length,
        'record.create.pendingCount',
        'tool-create',
      );
      createButton.classList.add('loom-grid-record-create');
      createButton.disabled = state.status === 'offline';
      end.append(createButton);
    }
    if (this.#callbacks.onLoadDeletedRecords !== undefined && state.selectedTableId !== null) {
      end.append(
        this.#toggleButton(
          'recycle',
          this.#translate('record.recycle.action'),
          state.deletedRecords.length,
          'record.recycle.count',
          'tool-recycle',
        ),
      );
    }
    end.append(
      this.#createActionButton(
        'refresh',
        'grid.refresh',
        'grid.refreshing',
        () => this.#callbacks.onRefresh(),
        'tool-refresh',
      ),
    );
    toolbar.append(start, end);
    return toolbar;
  }

  #renderClipboardNote(): HTMLElement {
    const clipboardNote = createElement('p', 'loom-grid-clipboard-note');
    clipboardNote.setAttribute('role', 'status');
    clipboardNote.setAttribute('aria-live', 'polite');
    clipboardNote.hidden = this.#clipboardNotice === null;
    clipboardNote.textContent = this.#clipboardNotice ?? '';
    return clipboardNote;
  }

  #renderSearchControls(state: GridState): HTMLElement {
    const wrap = createElement('div', 'loom-grid-search');
    const input = document.createElement('input');
    input.type = 'search';
    input.dataset.role = 'grid-search';
    input.setAttribute('aria-label', this.#translate('grid.search.label'));
    input.placeholder = this.#translate('grid.search.label');
    input.value = this.#searchDraft ?? state.search;
    input.addEventListener('input', () => {
      this.#searchDraft = input.value;
      this.#searchError = null;
      const note = wrap.querySelector('.loom-grid-search-error');
      note?.remove();
      const clear = wrap.querySelector<HTMLButtonElement>('[data-action="search-clear"]');
      if (clear !== null) clear.disabled = input.value === '' && state.search === '';
    });
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      void this.#submitSearch(input.value);
    });
    const submit = createElement('button', 'loom-button');
    submit.type = 'button';
    submit.dataset.action = 'search-submit';
    submit.textContent = this.#translate('grid.search.submit');
    submit.disabled = this.#callbacks.onSearch === undefined;
    submit.addEventListener('click', () => void this.#submitSearch(input.value));
    const clear = createElement('button', 'loom-button');
    clear.type = 'button';
    clear.dataset.action = 'search-clear';
    clear.textContent = this.#translate('grid.search.clear');
    clear.disabled =
      this.#callbacks.onSearch === undefined ||
      (state.search === '' && (this.#searchDraft ?? input.value) === '');
    clear.addEventListener('click', () => void this.#submitSearch(''));
    wrap.append(input, submit, clear);
    if (this.#searchError !== null) {
      const note = createElement('p', 'loom-grid-search-error');
      note.setAttribute('role', 'alert');
      note.textContent = this.#searchError;
      wrap.append(note);
    }
    return wrap;
  }

  #renderQueryToggles(state: GridState, view: Extract<View, { type: 'grid' }>): HTMLElement {
    const wrap = createElement('div', 'loom-grid-query-toggles');
    if (this.#callbacks.onApplyFilter !== undefined) {
      const button = this.#toggleButton(
        'filter',
        this.#translate('grid.filter'),
        view.config.filter === undefined ? 0 : countFilterRules(view.config.filter),
        'grid.filter.active',
        'tool-filter',
      );
      wrap.append(button);
    }
    if (this.#callbacks.onApplySort !== undefined) {
      wrap.append(
        this.#toggleButton(
          'sort',
          this.#translate('grid.sort'),
          view.config.sort.length,
          'grid.sort.active',
          'tool-sort',
        ),
      );
    }
    if (this.#callbacks.onApplyDisplay !== undefined) {
      wrap.append(
        this.#toggleButton(
          'display',
          this.#translate('grid.display'),
          state.fields.filter(
            (field) =>
              field.deletedAt === undefined &&
              view.config.projection.length > 0 &&
              !view.config.projection.includes(field.id),
          ).length,
          'grid.display.active',
          'tool-display',
        ),
      );
    }
    return wrap;
  }

  #toggleButton(
    panel: 'filter' | 'sort' | 'display' | 'create' | 'recycle',
    label: string,
    activeCount: number,
    activeKey: MessageKey,
    icon?: UiIconName,
  ): HTMLButtonElement {
    const button = createElement('button', 'loom-button loom-grid-query-toggle');
    button.type = 'button';
    button.dataset.action = `toggle-${panel}`;
    button.setAttribute('aria-pressed', this.#openPanel === panel ? 'true' : 'false');
    if (icon !== undefined) button.append(createUiIcon(icon));
    const labelSpan = createTextElement('span', label);
    button.append(labelSpan);
    if (activeCount > 0) {
      const count = createElement('span', 'loom-grid-query-count');
      count.textContent = this.#translate(activeKey).replace('{count}', String(activeCount));
      button.append(count);
    }
    button.addEventListener('click', () => {
      const opening = this.#openPanel !== panel;
      this.#openPanel = opening ? panel : null;
      if (opening && panel === 'recycle') void this.#callbacks.onLoadDeletedRecords?.();
      this.#rerenderSelf();
      if (opening) {
        this.#container
          .querySelector<HTMLElement>(
            '.loom-query-panel select, .loom-query-panel input, .loom-query-panel button',
          )
          ?.focus();
      } else {
        this.#container.querySelector<HTMLElement>(`[data-action="toggle-${panel}"]`)?.focus();
      }
    });
    return button;
  }

  #renderQueryPanel(state: GridState): HTMLElement | null {
    if (this.#openPanel === 'create') return this.#renderCreatePanel(state);
    if (this.#openPanel === 'recycle') return this.#renderRecyclePanel(state);
    const view = selectedGridView(state);
    if (view === null || this.#openPanel === null) return null;
    const host = createElement('div', 'loom-query-panel');
    host.dataset.panel = this.#openPanel;
    if (this.#openPanel === 'filter') {
      const onApplyFilter = this.#callbacks.onApplyFilter;
      if (onApplyFilter === undefined) return null;
      if (this.#filterBuilder === null || this.#filterBuilderRevision !== view.revision) {
        this.#filterBuilder = new FilterBuilder(view.config.filter, {
          fields: state.fields.filter((field) => field.deletedAt === undefined),
          translate: this.#translate,
          onApply: async (filter) => {
            const outcome = await onApplyFilter(view.id, filter);
            if (outcome?.status === 'saved') {
              this.#openPanel = null;
              this.#filterBuilder = null;
            }
            return outcome;
          },
          onCancel: () => this.#closePanels(),
          confirmDiscard: (message) => this.#requestDangerousConfirmation(message, this.#container),
          onInvalidate: () => this.#rerenderSelf(),
        });
        this.#filterBuilderRevision = view.revision;
      }
      host.append(this.#filterBuilder.render());
    } else if (this.#openPanel === 'sort') {
      const onApplySort = this.#callbacks.onApplySort;
      if (onApplySort === undefined) return null;
      if (this.#sortPanel === null || this.#sortPanelRevision !== view.revision) {
        this.#sortPanel = new SortPanel(view.config.sort, {
          fields: state.fields.filter((field) => field.deletedAt === undefined),
          translate: this.#translate,
          onApply: async (sort) => {
            const outcome = await onApplySort(view.id, sort);
            if (outcome?.status === 'saved') {
              this.#openPanel = null;
              this.#sortPanel = null;
            }
            return outcome;
          },
          onCancel: () => this.#closePanels(),
          confirmDiscard: (message) => this.#requestDangerousConfirmation(message, this.#container),
          onInvalidate: () => this.#rerenderSelf(),
        });
        this.#sortPanelRevision = view.revision;
      }
      host.append(this.#sortPanel.render());
    } else if (this.#openPanel === 'display') {
      const onApplyDisplay = this.#callbacks.onApplyDisplay;
      if (onApplyDisplay === undefined) return null;
      if (this.#displayPanel === null || this.#displayPanelRevision !== view.revision) {
        this.#displayPanel = new DisplayPanel(view.config, {
          fields: state.fields,
          translate: this.#translate,
          onApply: async (patch) => {
            const outcome = await onApplyDisplay(view.id, patch);
            if (outcome?.status === 'saved') {
              this.#openPanel = null;
              this.#displayPanel = null;
            }
            return outcome;
          },
          onCancel: () => this.#closePanels(),
          confirmDiscard: (message) => this.#requestDangerousConfirmation(message, this.#container),
          onInvalidate: () => this.#rerenderSelf(),
        });
        this.#displayPanelRevision = view.revision;
      }
      host.append(this.#displayPanel.render());
    }
    const issue = state.viewWriteIssues[view.id];
    if (issue !== undefined) {
      const note = createElement('p', 'loom-query-panel-issue');
      note.setAttribute('role', 'alert');
      note.textContent = issue.message;
      host.append(note);
    }
    return host;
  }

  #closePanels(): void {
    this.#openPanel = null;
    this.#filterBuilder = null;
    this.#sortPanel = null;
    this.#displayPanel = null;
    this.#createForm = null;
    this.#rerenderSelf();
  }

  #renderCreatePanel(state: GridState): HTMLElement | null {
    const onCreateRecord = this.#callbacks.onCreateRecord;
    if (onCreateRecord === undefined) return null;
    const host = createElement('div', 'loom-query-panel');
    host.dataset.panel = 'create';
    if (this.#createForm === null) {
      this.#createForm = createRecordCreateForm({
        fields: state.fields.filter((field) => field.deletedAt === undefined),
        translate: this.#translate,
        offline: state.status === 'offline',
        confirmDiscard: (message) => this.#requestDangerousConfirmation(message, this.#container),
        onSubmit: async (values) => {
          this.#createForm?.setBusy(true);
          try {
            const record = await onCreateRecord(values);
            this.#closePanels();
            this.#callbacks.onRecordOpen(record);
          } catch (error) {
            this.#createForm?.setBusy(false);
            this.#createForm?.showError(
              error instanceof Error ? error.message : this.#translate('record.create.failed'),
            );
          }
        },
        onCancel: () => this.#closePanels(),
      });
    }
    host.append(this.#createForm.element);
    return host;
  }

  #renderCreateOps(state: GridState): HTMLElement | null {
    if (state.recordCreateOps.length === 0) return null;
    const host = createElement('div', 'loom-record-create-ops');
    host.setAttribute('role', 'status');
    host.setAttribute('aria-live', 'polite');
    for (const op of state.recordCreateOps) {
      const row = createElement('div', 'loom-record-create-op');
      row.dataset.operationId = op.operationId;
      if (op.createdRecord !== undefined) {
        row.append(
          createTextElement('span', this.#translate('record.create.created')),
          this.#createOpButton('loom-record-create-open', 'record.create.open', () => {
            this.#callbacks.onDismissRecordCreate?.(op.operationId);
            if (op.createdRecord !== undefined) this.#callbacks.onRecordOpen(op.createdRecord);
          }),
          this.#createOpButton('loom-record-create-dismiss', 'record.create.dismiss', () =>
            this.#callbacks.onDismissRecordCreate?.(op.operationId),
          ),
        );
      } else if (op.state === 'queued' || op.state === 'sending') {
        row.append(createTextElement('span', this.#translate('record.create.pending')));
      } else {
        const opError = createTextElement(
          'span',
          op.lastError?.message ?? this.#translate('record.create.failed'),
        );
        opError.className = 'loom-record-create-op-error';
        row.append(
          opError,
          this.#createOpButton('loom-record-create-retry', 'record.create.retry', () =>
            this.#callbacks.onRetryRecordCreate?.(op.operationId),
          ),
          this.#createOpButton('loom-record-create-discard', 'record.create.discard', () =>
            this.#callbacks.onDiscardRecordCreate?.(op.operationId),
          ),
        );
      }
      host.append(row);
    }
    return host;
  }

  #createOpButton(
    className: string,
    labelKey: MessageKey,
    onClick: () => void | Promise<void>,
  ): HTMLButtonElement {
    const button = createElement('button', `loom-button ${className}`);
    button.type = 'button';
    button.append(createTextElement('span', this.#translate(labelKey)));
    button.addEventListener('click', () => void onClick());
    return button;
  }

  #renderDeletedNotice(state: GridState): HTMLElement | null {
    const record = state.lastDeletedRecord;
    if (record === null) return null;
    const host = createElement('div', 'loom-grid-deleted-notice');
    host.setAttribute('role', 'status');
    host.setAttribute('aria-live', 'polite');
    host.append(createTextElement('span', this.#translate('record.deleted.notice')));
    if (this.#callbacks.onUndoDelete !== undefined) {
      host.append(
        this.#createOpButton('loom-grid-undo-delete', 'record.deleted.undo', () =>
          this.#callbacks.onUndoDelete?.(),
        ),
      );
    }
    if (this.#callbacks.onDismissDeleteNotice !== undefined) {
      host.append(
        this.#createOpButton('loom-grid-dismiss-delete', 'record.deleted.dismiss', () =>
          this.#callbacks.onDismissDeleteNotice?.(),
        ),
      );
    }
    return host;
  }

  #renderRecyclePanel(state: GridState): HTMLElement {
    const host = createElement('div', 'loom-query-panel loom-recycle-panel');
    host.dataset.panel = 'recycle';
    host.append(createTextElement('h3', this.#translate('record.recycle.title')));
    if (state.deletedRecordsStatus === 'loading' || state.deletedRecordsStatus === 'idle') {
      const status = createTextElement('p', this.#translate('record.recycle.loading'));
      status.className = 'loom-recycle-status';
      host.append(status);
      return host;
    }
    if (state.deletedRecordsStatus === 'error') {
      const status = createTextElement('p', this.#translate('record.recycle.error'));
      status.className = 'loom-recycle-status';
      host.append(status);
      return host;
    }
    if (state.deletedRecords.length === 0) {
      const status = createTextElement('p', this.#translate('record.recycle.empty'));
      status.className = 'loom-recycle-status';
      host.append(status);
      return host;
    }
    const list = createElement('ul', 'loom-recycle-list');
    const primaryFieldId = state.tables.find(
      (table) => table.id === state.selectedTableId,
    )?.primaryFieldId;
    for (const record of state.deletedRecords) {
      const item = createElement('li', 'loom-recycle-item');
      item.dataset.recordId = record.id;
      item.append(
        createTextElement('span', deletedRecordTitle(record, primaryFieldId, this.#translate)),
      );
      if (this.#callbacks.onRestoreRecord !== undefined) {
        const restore = this.#createOpButton('loom-recycle-restore', 'record.recycle.restore', () =>
          this.#callbacks.onRestoreRecord?.(record.id),
        );
        const pending = state.editStatuses[record.id];
        if (pending === 'queued' || pending === 'saving') {
          restore.disabled = true;
        }
        item.append(restore);
      }
      list.append(item);
    }
    host.append(list);
    if (state.deletedRecordsHasMore && this.#callbacks.onLoadMoreDeletedRecords !== undefined) {
      host.append(
        this.#createOpButton('loom-recycle-load-more', 'record.recycle.loadMore', () =>
          this.#callbacks.onLoadMoreDeletedRecords?.(),
        ),
      );
    }
    return host;
  }

  #restoreRowHeightAnchor(): void {
    const anchor = this.#rowHeightAnchor;
    const grid = this.#virtualGrid;
    if (anchor === null || grid === null || grid.state.records.length === 0) return;
    this.#rowHeightAnchor = null;
    const byId =
      anchor.recordId === null
        ? -1
        : grid.state.records.findIndex((record) => record.id === anchor.recordId);
    const index = Math.max(
      0,
      byId >= 0 ? byId : Math.min(anchor.index, grid.state.records.length - 1),
    );
    grid.viewport.scrollTop = index * grid.rowHeight + anchor.offset;
    this.#renderVirtualRows();
  }

  #rerenderSelf(): void {
    if (this.#lastState === null) return;
    this.render(this.#lastState);
  }

  openViewCreateForm(preset?: { type?: 'grid' | 'map'; locationFieldId?: string }): void {
    this.#shell.openCreateForm(preset);
    if (this.#lastState === null) return;
    this.render(this.#lastState);
    this.#container.querySelector<HTMLElement>('input[name="view-name"]')?.focus();
  }

  async #submitSearch(term: string): Promise<void> {
    const result = await this.#callbacks.onSearch?.(term);
    if (result === false) {
      this.#searchError = this.#translate('grid.search.tooLong');
      this.#rerenderSelf();
      return;
    }
    this.#searchDraft = null;
    this.#searchError = null;
  }

  #restoreQueryControl(ref: QueryControlFocus | null): boolean {
    if (this.#sortFocusFieldId !== null) {
      const fieldId = this.#sortFocusFieldId;
      this.#sortFocusFieldId = null;
      const select = [
        ...this.#container.querySelectorAll<HTMLSelectElement>('select[data-role="sort-field"]'),
      ].find((element) => element.value === fieldId);
      if (select !== undefined) {
        select.focus();
        return true;
      }
    }
    return restoreQueryControlFocus(this.#container, ref);
  }

  #renderNavigation(state: GridState): HTMLElement {
    return this.#shell.render({
      workspaces: state.workspaces,
      bases: state.bases,
      tables: state.tables,
      views: state.views,
      fields: state.fields,
      selectedWorkspaceId: state.selectedWorkspaceId,
      selectedBaseId: state.selectedBaseId,
      selectedTableId: state.selectedTableId,
      selectedViewId: state.selectedViewId,
      pendingViewIntents: state.pendingViewIntents.filter(
        (intent) => intent.tableId === state.selectedTableId,
      ),
      deletedViews: state.deletedViews,
      deletedViewsStatus: state.deletedViewsStatus,
      viewWritePending: state.viewWritePending,
      viewWriteIssues: state.viewWriteIssues,
    });
  }

  #renderGrid(state: GridState): HTMLElement {
    const wrapper = createElement('div', 'loom-grid-wrapper');
    const gridView = selectedGridView(state);
    const columns = resolveGridColumns(state.fields, gridView?.config);
    const fields = columns.ordered;
    const rowHeight = rowHeightPixels(state);
    const lastFrozenId = columns.frozen.at(-1)?.id;
    const columnTemplate = [
      '56px',
      ...fields.map((field) => `${columns.widths.get(field.id) ?? 180}px`),
    ].join(' ');

    const viewport = createElement('div', 'loom-grid-viewport');
    viewport.tabIndex = 0;
    viewport.setAttribute('role', 'grid');
    labelContainer(viewport, this.#translate('grid.table'));
    viewport.setAttribute('aria-rowcount', String(state.records.length + 1));
    viewport.setAttribute('aria-colcount', String(fields.length + 1));

    const header = createElement('div', 'loom-grid-header');
    header.setAttribute('role', 'row');
    header.style.gridTemplateColumns = columnTemplate;
    const indexHeader = createGridCell('#', 'loom-grid-header-cell loom-grid-index-header');
    indexHeader.setAttribute('role', 'columnheader');
    indexHeader.setAttribute('aria-colindex', '1');
    header.append(indexHeader);
    for (const [fieldIndex, field] of fields.entries()) {
      const fieldHeader = createGridCell(field.name, 'loom-grid-header-cell');
      fieldHeader.setAttribute('role', 'columnheader');
      fieldHeader.setAttribute('aria-colindex', String(fieldIndex + 2));
      const frozenOffset = columns.frozenOffsets.get(field.id);
      if (frozenOffset !== undefined) {
        fieldHeader.classList.add('loom-grid-frozen');
        fieldHeader.style.left = `${frozenOffset}px`;
        if (field.id === lastFrozenId) fieldHeader.classList.add('loom-grid-frozen-last');
      }
      if (gridView !== null && isSortableField(field) && this.#callbacks.onApplySort) {
        const entry = gridView.config.sort.find((sort) => sort.fieldId === field.id);
        fieldHeader.setAttribute(
          'aria-sort',
          entry === undefined ? 'none' : entry.direction === 'asc' ? 'ascending' : 'descending',
        );
        const button = createElement('button', 'loom-grid-sort');
        button.type = 'button';
        button.dataset.action = 'header-sort';
        button.dataset.fieldId = field.id;
        button.append(createFieldTypeIcon(field.type), createTextElement('span', field.name));
        const indicator = createElement('span', 'loom-grid-sort-indicator');
        indicator.setAttribute('aria-hidden', 'true');
        indicator.textContent = entry === undefined ? '' : entry.direction === 'asc' ? '↑' : '↓';
        button.append(indicator);
        button.addEventListener('focus', () => {
          this.#focusedHeaderFieldId = field.id;
        });
        button.addEventListener('click', () => {
          const next = nextHeaderSort(gridView.config.sort, field.id);
          if (next === null) {
            this.#openPanel = 'sort';
            this.#sortFocusFieldId = field.id;
            this.#rerenderSelf();
            return;
          }
          void this.#callbacks.onApplySort?.(gridView.id, next);
        });
        fieldHeader.replaceChildren(button);
      } else {
        fieldHeader.replaceChildren(
          createFieldTypeIcon(field.type),
          createTextElement('span', field.name),
        );
      }
      header.append(fieldHeader);
    }

    const canvas = createElement('div', 'loom-grid-canvas');
    canvas.style.height = `${state.records.length * rowHeight}px`;
    canvas.style.backgroundImage = gridFillerBackground(columns, fields, rowHeight);
    const rowLayer = createElement('div', 'loom-grid-row-layer');
    canvas.append(rowLayer);
    if (
      state.status === 'ready' &&
      !state.hasMore &&
      state.selectedTableId !== null &&
      this.#callbacks.onCreateRecord !== undefined
    ) {
      const addRow = createElement('button', 'loom-grid-add-row');
      addRow.type = 'button';
      addRow.dataset.action = 'grid-add-row';
      addRow.style.top = `${state.records.length * rowHeight}px`;
      addRow.style.height = `${rowHeight}px`;
      addRow.style.gridTemplateColumns = columnTemplate;
      const indexCell = createElement('span', 'loom-grid-index-cell loom-grid-add-row-index');
      indexCell.append(createUiIcon('tool-create'));
      const label = createTextElement('span', this.#translate('record.create.add'));
      label.classList.add('loom-grid-add-row-label');
      addRow.append(indexCell, label);
      addRow.setAttribute('aria-label', this.#translate('record.create.add'));
      addRow.addEventListener('click', () => {
        this.#openPanel = 'create';
        this.#rerenderSelf();
      });
      canvas.append(addRow);
    }
    viewport.append(header, canvas);
    this.#virtualGrid = {
      viewport,
      rowLayer,
      state,
      fields,
      columns,
      columnTemplate,
      rowHeight,
    };
    viewport.addEventListener('scroll', () => this.#renderVirtualRows());
    this.#renderVirtualRows();

    wrapper.append(viewport);
    if (state.hasMore) {
      const loadMore = createElement('button', 'loom-button loom-grid-load-more');
      loadMore.type = 'button';
      loadMore.textContent =
        state.status === 'loading'
          ? this.#translate('grid.loadingMore')
          : this.#translate('grid.loadMore');
      loadMore.disabled = state.status === 'loading';
      loadMore.addEventListener('click', () => void this.#callbacks.onLoadMore());
      wrapper.append(loadMore);
    }
    return wrapper;
  }

  #renderEditError(state: GridState): HTMLElement {
    const status = createElement('div', 'loom-status loom-grid-edit-status is-error');
    status.id = 'loom-grid-edit-status';
    status.setAttribute('role', 'alert');
    status.setAttribute('aria-live', 'assertive');
    const terminal = Object.values(state.editStatuses).some((value) => value === 'terminal');
    const idempotencyTerminal = state.editError?.code === 'IDEMPOTENCY_KEY_REUSED';
    status.append(
      createTextElement(
        'p',
        terminal && idempotencyTerminal
          ? this.#translate('grid.idempotencyTerminal')
          : this.#translate('grid.editError'),
      ),
    );
    if (state.editError !== null) {
      status.append(
        renderDiagnostic(
          this.#translate('grid.diagnostic.error'),
          errorDiagnostic(state.editError),
        ),
      );
    }
    const failedRecordId = Object.entries(state.editStatuses).find(
      ([, value]) => value === 'error',
    )?.[0];
    if (!terminal && failedRecordId !== undefined) {
      const retry = createElement('button', 'loom-button');
      retry.type = 'button';
      retry.textContent = this.#translate('grid.retry');
      retry.addEventListener('click', () => this.#callbacks.onRetryEdit?.(failedRecordId));
      status.append(retry);
    }
    return status;
  }

  #renderConflicts(state: GridState): HTMLElement {
    const box = createElement('div', 'loom-grid-conflicts');
    box.setAttribute('role', 'region');
    box.setAttribute('aria-live', 'polite');
    box.setAttribute('aria-atomic', 'true');
    labelContainer(box, this.#translate('grid.diagnostic.conflict'));
    box.tabIndex = -1;
    box.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      this.#container.querySelector<HTMLElement>('.loom-grid-shell')?.focus();
    });
    for (const conflict of state.conflicts) {
      const item = createElement('div', 'loom-grid-conflict');
      item.setAttribute('role', 'group');
      item.append(createTextElement('strong', this.#translate('grid.editConflict')));
      item.append(createTextElement('p', this.#translate('record.serverValue')));
      const values = createElement('pre', 'loom-grid-conflict-values');
      values.textContent = JSON.stringify(
        {
          recordId: conflict.recordId,
          clientMutationId: conflict.clientMutationId,
          failedCommandIndex: conflict.failedCommandIndex,
          expectedRevision: conflict.expectedRevision,
          currentRevision: conflict.currentRevision,
          currentValues: conflict.currentValues,
        },
        null,
        2,
      );
      item.append(values);
      item.append(createTextElement('p', this.#translate('record.localIntent')));
      const intent = createElement('pre', 'loom-grid-conflict-intent');
      intent.textContent = JSON.stringify(
        {
          submittedSet: conflict.submittedSet,
          submittedUnsetFieldIds: conflict.submittedUnsetFieldIds,
        },
        null,
        2,
      );
      item.append(intent);
      item.append(
        renderDiagnostic(this.#translate('common.openDiagnostics'), conflictDiagnostic(conflict)),
      );
      const actions = createElement('div', 'loom-grid-conflict-actions');
      const useServer = document.createElement('button');
      useServer.type = 'button';
      useServer.className = 'loom-button';
      useServer.textContent = this.#translate('grid.useServer');
      useServer.addEventListener('click', () =>
        this.#callbacks.onConflictAction?.(conflict.recordId, 'use-server'),
      );
      const overwrite = document.createElement('button');
      overwrite.type = 'button';
      overwrite.className = 'loom-button loom-button-danger';
      overwrite.dataset.variant = 'danger';
      overwrite.textContent = this.#translate('grid.overwrite');
      overwrite.addEventListener('click', () => {
        void this.#requestDangerousConfirmation(
          this.#translate('record.overwriteConfirm'),
          item,
          overwrite,
        ).then((confirmed) => {
          if (confirmed) this.#callbacks.onConflictAction?.(conflict.recordId, 'overwrite');
        });
      });
      const discardAll = document.createElement('button');
      discardAll.type = 'button';
      discardAll.className = 'loom-button';
      discardAll.textContent = this.#translate('grid.discardAll');
      discardAll.addEventListener('click', () => {
        if (this.#callbacks.confirmDiscardAll?.(conflict.recordId) !== true) return;
        this.#callbacks.onConflictAction?.(conflict.recordId, 'discard-all');
      });
      actions.append(useServer, overwrite, discardAll);
      item.append(actions);
      box.append(item);
    }
    return box;
  }

  #renderVirtualRows(): void {
    const grid = this.#virtualGrid;
    if (grid === null) return;
    const range = getVirtualRowRange(
      grid.state.records.length,
      grid.viewport.scrollTop,
      grid.viewport.clientHeight || 360,
      grid.rowHeight,
    );
    const editingRows = new Map<number, HTMLElement>();
    let focusedEditor: HTMLElement | null = null;
    for (const row of grid.rowLayer.querySelectorAll<HTMLElement>('.loom-grid-row')) {
      const editor = row.querySelector<HTMLElement>('.loom-grid-editor');
      if (editor !== null) {
        editingRows.set(Number(row.dataset.rowIndex), row);
        if (editor === document.activeElement) focusedEditor = editor;
      }
    }
    grid.rowLayer.replaceChildren();
    for (let rowIndex = range.start; rowIndex < range.end; rowIndex += 1) {
      const kept = editingRows.get(rowIndex);
      if (kept !== undefined) {
        grid.rowLayer.append(kept);
        continue;
      }
      const record = grid.state.records[rowIndex];
      if (record === undefined) continue;
      grid.rowLayer.append(this.#renderRow(record, rowIndex, grid.fields, grid.rowHeight));
    }
    for (const [rowIndex, row] of editingRows) {
      if (rowIndex < range.start || rowIndex >= range.end) grid.rowLayer.append(row);
    }
    focusedEditor?.focus();
    if (this.#focusedCellKey !== null) this.#restoreFocusedCell();
  }

  #renderRow(
    record: LoomTableRecord,
    rowIndex: number,
    fields: readonly Field[],
    rowHeight: number,
  ): HTMLElement {
    const gridState = this.#virtualGrid?.state;
    const row = createElement('div', 'loom-grid-row');
    row.setAttribute('role', 'row');
    row.tabIndex = -1;
    row.setAttribute('aria-rowindex', String(rowIndex + 2));
    row.dataset.rowIndex = String(rowIndex);
    row.style.gridTemplateColumns =
      this.#virtualGrid?.columnTemplate ?? columnTemplateFor(fields, this.#virtualGrid?.state);
    row.style.height = rowHeight + 'px';
    row.style.top = rowIndex * rowHeight + 'px';

    const lastFrozenId = this.#virtualGrid?.columns.frozen.at(-1)?.id;
    const indexCell = createElement('div', 'loom-grid-index-cell');
    indexCell.setAttribute('role', 'rowheader');
    indexCell.setAttribute('aria-colindex', '1');
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'loom-grid-open';
    open.setAttribute('aria-label', this.#translate('grid.openDetails'));
    open.textContent = '↗';
    open.addEventListener('click', (event) => {
      event.stopPropagation();
      this.#callbacks.onRecordOpen(record);
    });
    indexCell.append(document.createTextNode(String(rowIndex + 1)), open);
    if (this.#callbacks.onDeleteRecord !== undefined) {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'loom-grid-delete-record';
      remove.dataset.recordId = record.id;
      remove.setAttribute('aria-label', this.#translate('record.delete.action'));
      remove.textContent = '×';
      const editStatus = gridState?.editStatuses[record.id];
      remove.disabled =
        gridState?.status === 'offline' || editStatus === 'queued' || editStatus === 'saving';
      remove.addEventListener('click', (event) => {
        event.stopPropagation();
        void this.#requestDangerousConfirmation(
          this.#translate('record.delete.confirm'),
          row,
          remove,
        ).then((confirmed) => {
          if (confirmed) void this.#callbacks.onDeleteRecord?.(record.id);
        });
      });
      indexCell.append(remove);
    }
    indexCell.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.#openRecordContextMenu(record, event.clientX, event.clientY);
    });
    row.append(indexCell);

    for (const [fieldIndex, field] of fields.entries()) {
      const displayValue = defaultFieldRendererRegistry.render(field, record.values[field.id], {
        translate: this.#translate,
      });
      const cell = createGridCell('', 'loom-grid-cell');
      cell.append(createRenderedFieldValueElement(displayValue, { compactAttachments: true }));
      cell.setAttribute('role', 'gridcell');
      cell.setAttribute('aria-colindex', String(fieldIndex + 2));
      const frozenOffset = this.#virtualGrid?.columns.frozenOffsets.get(field.id);
      if (frozenOffset !== undefined) {
        cell.classList.add('loom-grid-frozen');
        cell.style.left = `${frozenOffset}px`;
        if (field.id === lastFrozenId) cell.classList.add('loom-grid-frozen-last');
      }
      cell.tabIndex = 0;
      const editStatus = gridState?.editStatuses[record.id];
      const canEdit =
        gridState?.status === 'ready' && editStatus !== 'queued' && editStatus !== 'saving';
      if (!isEditableField(field) || !canEdit) {
        cell.setAttribute('aria-readonly', 'true');
      } else {
        cell.classList.add('loom-grid-editable');
      }
      cell.dataset.fieldId = field.id;
      cell.dataset.recordId = record.id;
      cell.dataset.rowIndex = String(rowIndex);
      cell.dataset.fieldIndex = String(fieldIndex);
      cell.dataset.focusKey = focusKey(
        gridState?.selectedTableId ?? record.tableId,
        gridState?.selectedViewId ?? '',
        record.id,
        field.id,
      );
      cell.dataset.valueState = displayValue.state;
      if (editStatus !== undefined) cell.dataset.editState = editStatus;
      cell.addEventListener('focus', () => {
        this.#focusedHeaderFieldId = null;
        this.#rememberCell(cell.dataset.focusKey ?? '', rowIndex, fieldIndex);
      });
      cell.addEventListener('click', (event) => {
        event.stopPropagation();
        this.#rememberCell(cell.dataset.focusKey ?? '', rowIndex, fieldIndex);
        if (isEditableField(field) && canEdit) {
          this.#beginCellEdit(cell, record, field, rowIndex, fieldIndex);
        }
      });
      cell.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.#openCellContextMenu(
          cell,
          record,
          field,
          rowIndex,
          fieldIndex,
          event.clientX,
          event.clientY,
        );
      });
      cell.addEventListener('keydown', (event) => {
        event.stopPropagation();
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          this.#focusAdjacentCell(rowIndex, fieldIndex, event.key === 'ArrowDown' ? 1 : -1);
          return;
        }
        if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
          event.preventDefault();
          this.#focusAdjacentCell(rowIndex, fieldIndex, event.key === 'ArrowRight' ? 1 : -1, true);
          return;
        }
        if ((event.key === 'Delete' || event.key === 'Backspace') && canEdit) {
          if (isEditableField(field)) {
            event.preventDefault();
            void this.#callbacks.onCellEdit?.(record.id, field.id, null);
          }
          return;
        }
        if ((event.ctrlKey || event.metaKey) && !event.altKey) {
          const key = event.key.toLowerCase();
          if (key === 'c' || key === 'v') {
            event.preventDefault();
            if (key === 'c') void this.#copyCell(field, record.values[field.id]);
            else void this.#pasteCell(record, field);
          }
          return;
        }
        if (event.key === 'Enter') {
          event.preventDefault();
          if (isEditableField(field) && canEdit) {
            this.#beginCellEdit(cell, record, field, rowIndex, fieldIndex);
          } else {
            this.#callbacks.onRecordOpen(record);
          }
          return;
        }
        if (
          event.key.length === 1 &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.altKey &&
          !event.isComposing &&
          isEditableField(field) &&
          canEdit
        ) {
          event.preventDefault();
          this.#beginCellEdit(cell, record, field, rowIndex, fieldIndex, event.key, false);
        }
      });
      row.append(cell);
    }

    row.addEventListener('dblclick', () => this.#callbacks.onRecordOpen(record));
    row.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.#callbacks.onRecordOpen(record);
        return;
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        this.#focusAdjacentCell(rowIndex, 0, event.key === 'ArrowDown' ? 1 : -1);
      }
    });
    return row;
  }

  #openCellContextMenu(
    cell: HTMLElement,
    record: LoomTableRecord,
    field: Field,
    rowIndex: number,
    fieldIndex: number,
    x: number,
    y: number,
  ): void {
    const gridState = this.#virtualGrid?.state;
    const editStatus = gridState?.editStatuses[record.id];
    const canEdit =
      gridState?.status === 'ready' && editStatus !== 'queued' && editStatus !== 'saving';
    const cellValue = record.values[field.id];
    const items: ContextMenuEntry[] = [
      {
        label: this.#translate('grid.menu.edit'),
        icon: 'menu-edit',
        disabled: !(isEditableField(field) && canEdit),
        action: () => {
          cell.focus();
          this.#beginCellEdit(cell, record, field, rowIndex, fieldIndex);
        },
      },
      {
        label: this.#translate('grid.menu.copy'),
        icon: 'menu-copy',
        disabled: serializeCellForClipboard(field, cellValue) === null,
        action: () => void this.#copyCell(field, cellValue),
      },
      {
        label: this.#translate('grid.menu.clear'),
        icon: 'menu-clear',
        disabled:
          !isEditableField(field) || !canEdit || cellValue === undefined || cellValue === null,
        action: () => void this.#callbacks.onCellEdit?.(record.id, field.id, null),
      },
      'separator',
      {
        label: this.#translate('grid.openDetails'),
        icon: 'menu-open',
        action: () => this.#callbacks.onRecordOpen(record),
      },
    ];
    if (this.#callbacks.onDeleteRecord !== undefined) {
      items.push(this.#recordDeleteMenuItem(record));
    }
    openContextMenu({
      items,
      x,
      y,
      host: this.#container,
      label: this.#translate('grid.menu.label'),
    });
  }

  #openRecordContextMenu(record: LoomTableRecord, x: number, y: number): void {
    const items: ContextMenuEntry[] = [
      {
        label: this.#translate('grid.openDetails'),
        icon: 'menu-open',
        action: () => this.#callbacks.onRecordOpen(record),
      },
    ];
    if (this.#callbacks.onDeleteRecord !== undefined) {
      items.push(this.#recordDeleteMenuItem(record));
    }
    openContextMenu({
      items,
      x,
      y,
      host: this.#container,
      label: this.#translate('grid.menu.label'),
    });
  }

  #recordDeleteMenuItem(record: LoomTableRecord): ContextMenuItem {
    const gridState = this.#virtualGrid?.state;
    const editStatus = gridState?.editStatuses[record.id];
    return {
      label: this.#translate('record.delete.action'),
      icon: 'menu-delete',
      danger: true,
      disabled:
        gridState?.status === 'offline' || editStatus === 'queued' || editStatus === 'saving',
      action: () =>
        void this.#requestDangerousConfirmation(
          this.#translate('record.delete.confirm'),
          this.#container,
        ).then((confirmed) => {
          if (confirmed) void this.#callbacks.onDeleteRecord?.(record.id);
        }),
    };
  }

  #beginCellEdit(
    cell: HTMLElement,
    record: LoomTableRecord,
    field: Field,
    rowIndex: number,
    fieldIndex: number,
    initialValue: unknown = record.values[field.id],
    selectAll = true,
  ): void {
    if (
      !isEditableField(field) ||
      this.#virtualGrid?.state.status !== 'ready' ||
      this.#virtualGrid?.state.editStatuses[record.id] === 'conflict' ||
      this.#virtualGrid?.state.editStatuses[record.id] === 'queued' ||
      this.#virtualGrid?.state.editStatuses[record.id] === 'saving'
    ) {
      return;
    }
    if (cell.querySelector('input, textarea, select') !== null) return;

    this.#dismissedEditDraftKey = null;
    this.#rememberCell(cell.dataset.focusKey ?? '', rowIndex, fieldIndex);
    const editor = defaultFieldRendererRegistry.createEditor(
      field,
      initialValue as JsonValue | undefined,
      { translate: this.#translate },
    );
    editor.classList.add('loom-grid-editor');
    editor.setAttribute('aria-label', field.name);
    cell.replaceChildren(editor);
    cell.tabIndex = -1;
    let composing = false;
    let finished = false;
    const finish = (commit: boolean, moveOffset = 0): void => {
      if (finished) return;
      finished = true;
      if (!commit) {
        this.#dismissedEditDraftKey = editDraftKey(record.id, field.id);
        this.render(this.#virtualGrid?.state ?? this.#emptyState());
        return;
      }
      const value =
        editor instanceof HTMLInputElement && editor.type === 'checkbox'
          ? editor.checked
          : editor instanceof HTMLSelectElement && editor.multiple
            ? [...editor.selectedOptions].map((option) => option.value)
            : editor.value;
      const result = this.#callbacks.onCellEdit?.(record.id, field.id, value);
      if (result !== undefined) void Promise.resolve(result).catch(() => undefined);
      if (moveOffset !== 0) {
        const state = this.#virtualGrid?.state ?? this.#emptyState();
        this.#focusedCellKey = null;
        this.render(state);
        this.#focusAdjacentCell(rowIndex, fieldIndex, moveOffset, true);
      }
    };
    editor.addEventListener('compositionstart', () => {
      composing = true;
    });
    editor.addEventListener('compositionend', () => {
      composing = false;
    });
    editor.addEventListener('keydown', (event) => {
      const keyboardEvent = event as KeyboardEvent;
      if (keyboardEvent.key === 'Escape') {
        keyboardEvent.preventDefault();
        finish(false);
      } else if (keyboardEvent.key === 'Enter' && !composing && !keyboardEvent.isComposing) {
        keyboardEvent.preventDefault();
        finish(true);
      } else if (keyboardEvent.key === 'Tab' && !composing && !keyboardEvent.isComposing) {
        keyboardEvent.preventDefault();
        finish(true, keyboardEvent.shiftKey ? -1 : 1);
      }
    });
    editor.addEventListener('blur', () => {
      window.setTimeout(() => {
        if (!finished && !composing && document.activeElement !== editor) finish(true);
      }, 0);
    });
    editor.focus();
    if (
      selectAll &&
      (editor instanceof HTMLInputElement || editor instanceof HTMLTextAreaElement)
    ) {
      editor.select?.();
    }
  }

  #requestDangerousConfirmation(
    message: string,
    host: HTMLElement,
    trigger?: HTMLElement,
  ): Promise<boolean> {
    return (
      this.#callbacks.confirmDangerousAction?.(message, host, trigger) ??
      confirmDangerousAction(host, message, this.#translate, trigger)
    );
  }

  #restoreFailedEditDraft(state: GridState): boolean {
    if (state.status === 'offline' || state.saveStatus === 'offline-readonly') return false;
    const errorRecordId =
      state.editErrorRecordId ??
      Object.entries(state.editStatuses).find(([, status]) => status === 'error')?.[0];
    if (state.editError === null || errorRecordId === undefined) return false;
    const draft = state.editDrafts.find(
      (candidate) =>
        candidate.recordId === errorRecordId &&
        state.editStatuses[candidate.recordId] === 'error' &&
        candidate.rawValue !== undefined,
    );
    if (
      draft === undefined ||
      this.#dismissedEditDraftKey === editDraftKey(draft.recordId, draft.fieldId)
    ) {
      return false;
    }
    const record = state.records.find((candidate) => candidate.id === draft.recordId);
    const field = state.fields.find((candidate) => candidate.id === draft.fieldId);
    if (record === undefined || field === undefined || !isEditableField(field)) return false;
    const rowIndex = state.records.indexOf(record);
    const fieldIndex = orderedFields(state).indexOf(field);
    if (rowIndex < 0 || fieldIndex < 0) return false;
    let cell = this.#findCellForRecordField(draft.recordId, draft.fieldId);
    if (cell === null && this.#virtualGrid !== null) {
      this.#virtualGrid.viewport.scrollTop = rowIndex * this.#virtualGrid.rowHeight;
      this.#renderVirtualRows();
      cell = this.#findCellForRecordField(draft.recordId, draft.fieldId);
    }
    if (cell === null) return false;
    this.#beginCellEdit(cell, record, field, rowIndex, fieldIndex, draft.rawValue);
    const editor = cell.querySelector<HTMLElement>('.loom-grid-editor');
    if (editor === null) return false;
    editor.setAttribute('aria-invalid', 'true');
    editor.setAttribute('aria-describedby', 'loom-grid-edit-status');
    editor.focus();
    return true;
  }

  #emptyState(): GridState {
    return {
      status: 'idle',
      phase: 'idle',
      workspaces: [],
      bases: [],
      tables: [],
      views: [],
      fields: [],
      selectedWorkspaceId: null,
      selectedBaseId: null,
      selectedTableId: null,
      selectedViewId: null,
      records: [],
      hasMore: false,
      nextCursor: null,
      changeCursor: null,
      totalCount: null,
      search: '',
      emptyReason: null,
      error: null,
      editStatuses: {},
      conflicts: [],
      editError: null,
      editDrafts: [],
      editErrorRecordId: null,
      saveStatus: 'saved',
      pendingViewIntents: [],
      deletedViews: [],
      deletedViewsStatus: 'idle',
      deletedViewsError: null,
      viewWritePending: [],
      viewWriteIssues: {},
      recordCreateOps: [],
      deletedRecords: [],
      deletedRecordsStatus: 'idle',
      deletedRecordsNextCursor: null,
      deletedRecordsHasMore: false,
      deletedRecordsError: null,
      lastDeletedRecord: null,
    };
  }

  #rememberCell(key: string, rowIndex: number, fieldIndex: number): void {
    if (key === '') return;
    this.#focusedCellKey = key;
    this.#focusedCellPosition = { rowIndex, fieldIndex };
  }

  #findCellByKey(key: string): HTMLElement | null {
    const grid = this.#virtualGrid;
    if (grid === null) return null;
    return (
      [...grid.rowLayer.querySelectorAll<HTMLElement>('.loom-grid-cell')].find(
        (cell) => cell.dataset.focusKey === key,
      ) ?? null
    );
  }

  #findCellAt(rowIndex: number, fieldIndex: number): HTMLElement | null {
    const grid = this.#virtualGrid;
    if (grid === null) return null;
    return (
      [...grid.rowLayer.querySelectorAll<HTMLElement>('.loom-grid-cell')].find(
        (cell) =>
          cell.dataset.rowIndex === String(rowIndex) &&
          cell.dataset.fieldIndex === String(fieldIndex),
      ) ?? null
    );
  }

  #findCellForRecordField(recordId: string, fieldId: string): HTMLElement | null {
    const grid = this.#virtualGrid;
    if (grid === null) return null;
    return (
      [...grid.rowLayer.querySelectorAll<HTMLElement>('.loom-grid-cell')].find(
        (cell) => cell.dataset.recordId === recordId && cell.dataset.fieldId === fieldId,
      ) ?? null
    );
  }

  #restoreFocusedCell(): boolean {
    const grid = this.#virtualGrid;
    if (grid === null || this.#focusedCellKey === null) return false;
    let target = this.#findCellByKey(this.#focusedCellKey);
    if (target === null && this.#focusedCellPosition !== null && grid.state.records.length > 0) {
      const rowIndex = Math.max(
        0,
        Math.min(grid.state.records.length - 1, this.#focusedCellPosition.rowIndex),
      );
      const fieldIndex = Math.max(
        0,
        Math.min(grid.fields.length - 1, this.#focusedCellPosition.fieldIndex),
      );
      target = this.#findCellAt(rowIndex, fieldIndex);
      if (target === null) {
        grid.viewport.scrollTop = rowIndex * grid.rowHeight;
        this.#renderVirtualRows();
        return true;
      }
      this.#focusedCellPosition = { rowIndex, fieldIndex };
      this.#focusedCellKey = target.dataset.focusKey ?? this.#focusedCellKey;
    }
    if (target === null) return false;
    if (target.contains(document.activeElement)) return true;
    target.focus();
    return true;
  }

  #restoreFocusedHeader(): boolean {
    if (this.#focusedHeaderFieldId === null) return false;
    const target = [...this.#container.querySelectorAll<HTMLElement>('.loom-grid-sort')].find(
      (element) => element.dataset.fieldId === this.#focusedHeaderFieldId,
    );
    if (target === undefined) return false;
    target.focus();
    return true;
  }

  #focusGridFallback(): void {
    const fallback =
      this.#container.querySelector<HTMLElement>('.loom-grid-viewport') ??
      this.#container.querySelector<HTMLElement>('.loom-grid-status') ??
      this.#container.querySelector<HTMLElement>('.loom-grid-shell');
    fallback?.focus();
  }

  #copyCell(field: Field, value: JsonValue | undefined): Promise<void> {
    const serialized = serializeCellForClipboard(field, value);
    if (serialized === null) {
      this.#announceClipboard(this.#translate('grid.clipboard.unsupported'));
      return Promise.resolve();
    }
    const host = this.#clipboardHost();
    if (host === null) {
      this.#announceClipboard(this.#translate('grid.clipboard.failed'));
      return Promise.resolve();
    }
    return host.writeText(serialized).then(
      () => this.#announceClipboard(this.#translate('grid.clipboard.copied')),
      () => this.#announceClipboard(this.#translate('grid.clipboard.failed')),
    );
  }

  #pasteCell(record: LoomTableRecord, field: Field): Promise<void> {
    if (!isEditableField(field)) {
      this.#announceClipboard(this.#translate('grid.clipboard.unsupported'));
      return Promise.resolve();
    }
    const host = this.#clipboardHost();
    if (host === null) {
      this.#announceClipboard(this.#translate('grid.clipboard.failed'));
      return Promise.resolve();
    }
    return host.readText().then(
      (text) => {
        const parsed = parseClipboardValue(field, text);
        if (!parsed.ok) {
          this.#announceClipboard(this.#translate('grid.clipboard.invalid'));
          return;
        }
        void this.#callbacks.onCellEdit?.(record.id, field.id, parsed.value);
      },
      () => this.#announceClipboard(this.#translate('grid.clipboard.failed')),
    );
  }

  #clipboardHost(): GridClipboardHost | null {
    if (this.#callbacks.clipboard !== undefined) return this.#callbacks.clipboard;
    return typeof navigator === 'undefined' ? null : navigator.clipboard;
  }

  #announceClipboard(message: string): void {
    this.#clipboardNotice = message;
    const note = this.#container.querySelector<HTMLElement>('.loom-grid-clipboard-note');
    if (note !== null) {
      note.hidden = false;
      note.textContent = message;
    }
  }

  #focusAdjacentCell(
    rowIndex: number,
    fieldIndex: number,
    rowOffset: number,
    horizontal = false,
  ): void {
    const grid = this.#virtualGrid;
    if (grid === null || grid.fields.length === 0 || grid.state.records.length === 0) return;
    const targetRow = Math.max(
      0,
      Math.min(grid.state.records.length - 1, rowIndex + (horizontal ? 0 : rowOffset)),
    );
    const targetField = Math.max(
      0,
      Math.min(grid.fields.length - 1, fieldIndex + (horizontal ? rowOffset : 0)),
    );
    this.#focusedCellPosition = { rowIndex: targetRow, fieldIndex: targetField };
    const target = this.#findCellAt(targetRow, targetField);
    if (target === null) {
      grid.viewport.scrollTop = targetRow * grid.rowHeight;
      this.#renderVirtualRows();
    }
    const next = this.#findCellAt(targetRow, targetField);
    next?.focus();
  }

  #renderStatus(status: GridStatus, state: GridState): HTMLElement {
    const statusBox = createElement('div', 'loom-status loom-grid-status is-' + status);
    statusBox.setAttribute('role', 'status');
    statusBox.setAttribute('aria-live', 'polite');
    statusBox.setAttribute('aria-atomic', 'true');
    statusBox.tabIndex = -1;
    const message = statusMessage(status, state, this.#translate);
    const action = this.#renderStatusAction(status, state);
    statusBox.append(createTextElement('p', message), ...(action === null ? [] : [action]));
    if (state.error !== null) {
      statusBox.append(
        renderDiagnostic(this.#translate('grid.diagnostic.error'), errorDiagnostic(state.error)),
      );
    }
    return statusBox;
  }

  #renderStatusAction(status: GridStatus, state: GridState): HTMLElement | null {
    if (status === 'empty' && state.emptyReason === 'no-match') {
      const view = selectedGridView(state);
      const actions = createElement('div', 'loom-status-actions');
      let count = 0;
      if (
        view !== null &&
        view.config.filter !== undefined &&
        this.#callbacks.onApplyFilter !== undefined
      ) {
        const clear = createElement('button', 'loom-button');
        clear.type = 'button';
        clear.dataset.action = 'empty-clear-filter';
        clear.textContent = this.#translate('grid.empty.clearFilter');
        clear.addEventListener('click', () => {
          void this.#callbacks.onApplyFilter?.(view.id, undefined);
        });
        actions.append(clear);
        count += 1;
      }
      if (this.#callbacks.onApplyFilter !== undefined) {
        const edit = createElement('button', 'loom-button');
        edit.type = 'button';
        edit.dataset.action = 'empty-edit-filter';
        edit.textContent = this.#translate('grid.empty.editFilter');
        edit.addEventListener('click', () => {
          this.#openPanel = 'filter';
          this.#rerenderSelf();
        });
        actions.append(edit);
        count += 1;
      }
      if (state.search !== '' && this.#callbacks.onSearch !== undefined) {
        const clearSearch = createElement('button', 'loom-button');
        clearSearch.type = 'button';
        clearSearch.dataset.action = 'empty-clear-search';
        clearSearch.textContent = this.#translate('grid.search.clear');
        clearSearch.addEventListener('click', () => void this.#submitSearch(''));
        actions.append(clearSearch);
        count += 1;
      }
      return count === 0 ? null : actions;
    }
    if (
      status === 'empty' &&
      state.emptyReason === 'view' &&
      this.#callbacks.onCreateView !== undefined
    ) {
      const button = createElement('button', 'loom-button');
      button.type = 'button';
      button.textContent = this.#translate('view.createEntry');
      button.setAttribute('aria-label', this.#translate('view.createEntry'));
      button.addEventListener('click', () => {
        this.#shell.openCreateForm();
        if (this.#lastState === null) return;
        this.render(this.#lastState);
        this.#container.querySelector<HTMLElement>('input[name="view-name"]')?.focus();
      });
      return button;
    }
    if (status === 'authentication' || status === 'forbidden') {
      if (this.#callbacks.onOpenSettings === undefined) return null;
      return this.#createActionButton(
        'settings',
        'common.openSettings',
        'common.openingSettings',
        this.#callbacks.onOpenSettings,
      );
    }
    if (status === 'network' || status === 'server-error') {
      return this.#createActionButton('refresh', 'grid.retryRequest', 'grid.refreshing', () =>
        this.#callbacks.onRefresh(),
      );
    }
    return null;
  }

  #createActionButton(
    action: GridAction,
    labelKey: MessageKey,
    pendingKey: MessageKey,
    operation: () => void | Promise<void>,
    icon?: UiIconName,
  ): HTMLButtonElement {
    const element = createElement('button', 'loom-button');
    element.type = 'button';
    element.textContent = this.#translate(labelKey);
    if (icon !== undefined) element.prepend(createUiIcon(icon));
    element.setAttribute('aria-label', this.#translate(labelKey));
    element.addEventListener('click', () => {
      if (element.disabled) return;
      this.#focusedAction = action;
      element.focus();
      this.#runAction(action, operation);
    });
    this.#actionButtons.set(element, { action, labelKey, pendingKey, icon });
    return element;
  }

  #runAction(action: GridAction, operation: () => void | Promise<void>): void {
    if (this.#pendingActions.has(action)) return;
    this.#pendingActions.add(action);
    this.#syncActionButtons();
    void Promise.resolve()
      .then(operation)
      .catch(() => undefined)
      .finally(() => {
        this.#pendingActions.delete(action);
        this.#syncActionButtons();
        this.#restoreFocusedAction();
        this.#focusedAction = null;
      });
  }

  #syncActionButtons(): void {
    const state = this.#lastState;
    const offline = state?.status === 'offline';
    const loading = state?.status === 'loading';
    for (const [element, spec] of this.#actionButtons) {
      const pending = this.#pendingActions.has(spec.action);
      const label = this.#translate(pending ? spec.pendingKey : spec.labelKey);
      element.disabled = pending || (spec.action === 'refresh' && (offline || loading));
      element.textContent = label;
      if (spec.icon !== undefined) element.prepend(createUiIcon(spec.icon));
      element.setAttribute('aria-label', label);
      if (pending) element.setAttribute('aria-busy', 'true');
      else element.removeAttribute('aria-busy');
    }
  }

  #restoreFocusedAction(): void {
    if (this.#focusedAction === null) return;
    for (const [element, spec] of this.#actionButtons) {
      if (spec.action === this.#focusedAction && !element.disabled) {
        element.focus();
        return;
      }
    }
  }
}

export function getVirtualRowRange(
  rowCount: number,
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  overscan = 4,
): VirtualRowRange {
  if (rowCount <= 0) return { start: 0, end: 0 };
  const firstVisible = Math.max(0, Math.floor(Math.max(0, scrollTop) / rowHeight));
  const visibleRows = Math.max(1, Math.ceil(Math.max(1, viewportHeight) / rowHeight));
  const start = Math.max(0, firstVisible - overscan);
  const end = Math.min(rowCount, firstVisible + visibleRows + overscan);
  return { start, end };
}

function orderedFields(state: GridState): readonly Field[] {
  const view = selectedGridView(state);
  return resolveGridColumns(state.fields, view?.config).ordered;
}

function selectedGridView(state: GridState): Extract<View, { type: 'grid' }> | null {
  const view = state.views.find((candidate) => candidate.id === state.selectedViewId);
  return view?.type === 'grid' ? view : null;
}

function columnTemplateFor(fields: readonly Field[], state?: GridState): string {
  const view = state === undefined ? null : selectedGridView(state);
  const widths = resolveGridColumns(state?.fields ?? fields, view?.config).widths;
  const columns = fields.map((field) => `${widths.get(field.id) ?? clampGridColumnWidth(180)}px`);
  return ['56px', ...columns].join(' ');
}

function rowHeightPixels(state: GridState): number {
  const view = state.views.find((candidate) => candidate.id === state.selectedViewId);
  if (view?.type !== 'grid') return 36;
  if (view.config.rowHeight === 'compact') return 30;
  if (view.config.rowHeight === 'comfortable') return 44;
  return 36;
}

function statusMessage(status: GridStatus, state: GridState, translate: Translator): string {
  if (status === 'loading') return translate('grid.loading');
  if (status === 'offline') return translate('grid.error.offline');
  if (status === 'authentication') return translate('grid.error.authentication');
  if (status === 'forbidden') return translate('grid.error.forbidden');
  if (status === 'network') return translate('grid.error.network');
  if (status === 'server-error') return translate('grid.error.server');
  if (state.emptyReason === 'workspace') return translate('grid.empty.workspace');
  if (state.emptyReason === 'base') return translate('grid.empty.base');
  if (state.emptyReason === 'table') return translate('grid.empty.table');
  if (state.emptyReason === 'view') return translate('grid.empty.view');
  if (state.emptyReason === 'no-match') return translate('grid.empty.noMatch');
  return translate('grid.empty.records');
}

function createElement<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tagName);
  element.className = className;
  return element;
}

function createGridCell(text: string, className: string): HTMLElement {
  const cell = createElement('div', className);
  cell.textContent = text;
  return cell;
}

function editDraftKey(recordId: string, fieldId: string): string {
  return recordId + '\u0000' + fieldId;
}

function renderDiagnostic(label: string, details: string): HTMLElement {
  const wrapper = document.createElement('details');
  wrapper.className = 'loom-diagnostic';
  const summary = document.createElement('summary');
  summary.textContent = label;
  const pre = document.createElement('pre');
  pre.textContent = details;
  wrapper.append(summary, pre);
  return wrapper;
}

function errorDiagnostic(error: {
  readonly message: string;
  readonly code?: string;
  readonly httpStatus?: number;
  readonly requestId?: string;
}): string {
  return JSON.stringify(
    {
      message: error.message,
      ...(error.code === undefined ? {} : { code: error.code }),
      ...(error.httpStatus === undefined ? {} : { httpStatus: error.httpStatus }),
      ...(error.requestId === undefined ? {} : { requestId: error.requestId }),
    },
    null,
    2,
  );
}

function conflictDiagnostic(conflict: GridConflict): string {
  return JSON.stringify(
    {
      clientMutationId: conflict.clientMutationId,
      message: conflict.message,
      expectedRevision: conflict.expectedRevision,
      currentRevision: conflict.currentRevision,
      submittedSet: conflict.submittedSet,
      submittedUnsetFieldIds: conflict.submittedUnsetFieldIds,
    },
    null,
    2,
  );
}

function focusKey(tableId: string, viewId: string, recordId: string, fieldId: string): string {
  return JSON.stringify([tableId, viewId, recordId, fieldId]);
}

function createTextElement<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  text: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tagName);
  element.textContent = text;
  return element;
}

function gridFillerBackground(
  columns: ResolvedGridColumns,
  fields: readonly Field[],
  rowHeight: number,
): string {
  const layers = [
    `repeating-linear-gradient(to bottom, transparent 0, transparent ${rowHeight - 1}px, var(--loom-grid-line) ${rowHeight - 1}px, var(--loom-grid-line) ${rowHeight}px)`,
  ];
  let edge = GRID_INDEX_COLUMN_WIDTH;
  for (const field of fields) {
    layers.push(
      `linear-gradient(to right, transparent ${edge - 1}px, var(--loom-grid-line) ${edge - 1}px, var(--loom-grid-line) ${edge}px, transparent ${edge}px)`,
    );
    edge += columns.widths.get(field.id) ?? GRID_COLUMN_WIDTH_DEFAULT;
  }
  return layers.join(', ');
}

function deletedRecordTitle(
  record: LoomTableRecord,
  primaryFieldId: string | undefined,
  translate: (key: MessageKey) => string,
): string {
  const value = primaryFieldId === undefined ? undefined : record.values[primaryFieldId];
  if (typeof value === 'string' && value.trim() !== '') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return translate('grid.untitledRecord');
}
