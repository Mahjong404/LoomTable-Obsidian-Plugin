import type { Translator } from '../i18n';
import type { MessageKey } from '../i18n/messages';
import type {
  AggregateFn,
  ChangeKind,
  ConversionPreview,
  ConvertFieldRequest,
  DistinctValuesPage,
  Field,
  FilterNode,
  JsonValue,
  LoomTableRecord,
  MutationValue,
  SelectOptionColor,
  SortSpec,
  View,
} from '../client/loomtable-client';
import type { GridConflict, GridState, GridStatus } from './grid-view-controller';
import type { UndoEntryMeta } from './undo-history';
import { ensureButtonLabels, labelContainer } from './a11y';
import { openContextMenu, type ContextMenuEntry, type ContextMenuItem } from './context-menu';
import { createFieldTypeIcon } from './field-type-icon';
import { createUiIcon, type UiIconName } from './icons';
import { FilterBuilder } from './filter-builder';
import { openFieldEditor, type FieldEditorSubmit } from './field-editor-panel';
import { openFieldConverter } from './field-convert-panel';
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
import {
  countFilterRules,
  createFilterRule,
  filterOperatorsForField,
  isSortableField,
  nextHeaderSort,
} from './view-query-model';
import { isEditableField, normalizeCellValue } from './field-value-editor';
import {
  createRenderedFieldValueElement,
  type RenderedAttachment,
  defaultFieldRendererRegistry,
} from './field-renderer-registry';
import {
  parseClipboardValue,
  serializeCellForClipboard,
  type GridClipboardHost,
} from './grid-clipboard';
import { describeSaveStatus, renderSaveStatus } from './save-status';
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

export type FieldSaveContext =
  | {
      readonly mode: 'create';
      readonly anchorFieldId?: string;
      readonly side?: 'left' | 'right';
    }
  | { readonly mode: 'edit'; readonly fieldId: string };

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
  readonly onQueryFieldValues?: (
    fieldId: string,
    request: { search?: string; cursor?: string },
  ) => Promise<DistinctValuesPage>;
  readonly onSetFieldAggregation?: (
    fieldId: string,
    fn: AggregateFn | undefined,
  ) => void | Promise<unknown>;
  readonly onApplySort?: (viewId: string, sort: readonly SortSpec[]) => Promise<ViewWriteOutcome>;
  readonly onApplyManualSort?: (viewId: string, enabled: boolean) => Promise<ViewWriteOutcome>;
  readonly onMoveRecord?: (
    recordId: string,
    anchors: { beforeRecordId?: string; afterRecordId?: string },
  ) => Promise<void>;
  readonly onApplyDisplay?: (viewId: string, patch: GridDisplayPatch) => Promise<ViewWriteOutcome>;
  readonly onCreateRecord?: (
    values: Readonly<Record<string, MutationValue>>,
  ) => Promise<LoomTableRecord>;
  readonly onRetryRecordCreate?: (operationId: string) => void | Promise<void>;
  readonly onDiscardRecordCreate?: (operationId: string) => void | Promise<void>;
  readonly onDismissRecordCreate?: (operationId: string) => void;
  readonly onDeleteRecord?: (recordId: string) => void | Promise<void>;
  readonly onDuplicateRecord?: (recordId: string) => void | Promise<void>;
  readonly onUndoDelete?: () => void | Promise<void>;
  readonly attachmentThumbnail?: (attachment: RenderedAttachment) => string | undefined;
  readonly onUndo?: () => void | Promise<void>;
  readonly onRedo?: () => void | Promise<void>;
  readonly onUndoTo?: (index: number) => void | Promise<void>;
  readonly onDismissDeleteNotice?: () => void;
  readonly onLoadDeletedRecords?: () => void | Promise<void>;
  readonly onLoadMoreDeletedRecords?: () => void | Promise<void>;
  readonly onLoadServerHistory?: (kind?: ChangeKind) => void | Promise<void>;
  readonly onLoadMoreServerHistory?: (kind?: ChangeKind) => void | Promise<void>;
  readonly onFieldSave?: (
    input: FieldEditorSubmit,
    context: FieldSaveContext,
  ) => void | Promise<unknown>;
  readonly onFieldDelete?: (fieldId: string) => void | Promise<unknown>;
  readonly onConversionPreview?: (
    fieldId: string,
    type: Field['type'],
  ) => Promise<ConversionPreview>;
  readonly onConvertField?: (fieldId: string, request: ConvertFieldRequest) => Promise<unknown>;
  readonly onRestoreRecord?: (recordId: string) => void | Promise<void>;
  readonly clipboard?: GridClipboardHost;
}

type GridAction = 'refresh' | 'settings' | 'undo' | 'redo';

const CHANGE_KIND_ICONS: Record<UndoEntryMeta['kind'], UiIconName> = {
  create: 'tool-create',
  edit: 'menu-edit',
  delete: 'menu-delete',
  restore: 'tool-undo',
};

const CHANGE_KIND_KEYS: Record<UndoEntryMeta['kind'], MessageKey> = {
  create: 'record.changes.kind.create',
  edit: 'record.changes.kind.edit',
  delete: 'record.changes.kind.delete',
  restore: 'record.changes.kind.restore',
};

const SERVER_KIND_ICONS: Record<ChangeKind, UiIconName> = {
  recordCreated: 'tool-create',
  recordUpdated: 'menu-edit',
  recordDeleted: 'menu-delete',
  recordRestored: 'tool-undo',
  recordMoved: 'nav-next',
  schemaChanged: 'tool-display',
  viewChanged: 'view-grid',
};

const SERVER_KIND_KEYS: Record<ChangeKind, MessageKey> = {
  recordCreated: 'record.changes.kind.create',
  recordUpdated: 'record.changes.kind.edit',
  recordDeleted: 'record.changes.kind.delete',
  recordRestored: 'record.changes.kind.restore',
  recordMoved: 'record.history.kind.moved',
  schemaChanged: 'record.history.kind.schema',
  viewChanged: 'record.history.kind.view',
};

const SERVER_HISTORY_FILTERS: readonly ('all' | ChangeKind)[] = [
  'all',
  'recordUpdated',
  'recordCreated',
  'recordDeleted',
  'recordRestored',
];

const DRAFT_RECORD_ID = 'loom:draft-create';

function formatChangeTime(at: string): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function formatChangeValue(value: unknown, translate: Translator): string {
  if (value === undefined || value === null) return translate('record.changes.unset');
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > 24 ? `${text.slice(0, 24)}…` : text;
}

interface GridActionButtonSpec {
  readonly action: GridAction;
  readonly labelKey: MessageKey;
  readonly pendingKey: MessageKey;
  readonly icon: UiIconName | undefined;
  readonly iconOnly?: boolean;
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
  #selection: {
    readonly anchor: { readonly rowIndex: number; readonly fieldIndex: number };
    readonly head: { readonly rowIndex: number; readonly fieldIndex: number };
  } | null = null;
  #selectedRows = new Set<number>();
  #rowAnchorIndex: number | null = null;
  #lastConflictIds = new Set<string>();
  #lastState: GridState | null = null;
  #dismissedEditDraftKey: string | null = null;
  readonly #pendingActions = new Set<GridAction>();
  readonly #actionButtons = new Map<HTMLButtonElement, GridActionButtonSpec>();
  #focusedAction: GridAction | null = null;
  #openPanel: 'filter' | 'sort' | 'display' | 'create' | 'status' | null = null;
  #searchDraft: string | null = null;
  #searchExpanded = false;
  #searchDebounceTimer: number | null = null;
  #searchError: string | null = null;
  #draftCreateValues: Record<string, MutationValue> | null = null;
  #draftRowEl: HTMLElement | null = null;
  #filterSeedFieldId: string | null = null;
  #statusPanelMode: 'ops' | 'history' | 'deleted' = 'ops';
  #serverHistoryFilter: 'all' | ChangeKind = 'all';
  #historyFilter: 'all' | UndoEntryMeta['kind'] = 'all';
  #lastViewId: string | null = null;
  #sortFocusFieldId: string | null = null;
  #filterBuilder: FilterBuilder | null = null;
  #filterBuilderViewId: string | null = null;
  #sortPanel: SortPanel | null = null;
  #sortPanelViewId: string | null = null;
  #sortPanelManual = false;
  #displayPanel: DisplayPanel | null = null;
  #displayPanelViewId: string | null = null;
  #createForm: RecordCreateForm | null = null;
  #clipboardNotice: string | null = null;
  #rowHeightAnchor: {
    readonly recordId: string | null;
    readonly index: number;
    readonly offset: number;
  } | null = null;
  #panelDismiss: ((event: PointerEvent) => void) | null = null;

  constructor(container: HTMLElement, translate: Translator, callbacks: GridRendererCallbacks) {
    this.#container = container;
    this.#translate = translate;
    this.#callbacks = callbacks;
    container.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || this.#openPanel === null || event.defaultPrevented) return;
      const el = event.target instanceof Element ? event.target : null;
      if (el !== null && el.closest('.loom-grid-editor, .loom-detail-host') !== null) return;
      event.preventDefault();
      this.#closePanels();
    });
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
    const toolbar = this.#renderToolbar(state);
    root.append(this.#renderNavigation(state), toolbar);
    root.append(this.#renderClipboardNote());
    const queryPanel = this.#renderQueryPanel(state);
    if (queryPanel !== null) {
      toolbar.append(queryPanel);
      this.#anchorQueryPanel(toolbar, queryPanel);
    }
    this.#syncPanelDismissal();
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
      const showStatusBand = state.status !== 'ready' && state.status !== 'loading';
      if (showStatusBand) root.append(this.#renderStatus(state.status, state));
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
    if (this.#callbacks.onCreateRecord !== undefined && state.selectedTableId !== null) {
      const split = createElement('span', 'loom-split-button');
      const createButton = createElement(
        'button',
        'loom-button loom-grid-record-create loom-split-main',
      );
      createButton.type = 'button';
      createButton.dataset.action = 'toggle-create';
      createButton.append(createUiIcon('tool-create'));
      createButton.append(createTextElement('span', this.#translate('record.create.add')));
      if (state.recordCreateOps.length > 0) {
        const count = createElement('span', 'loom-grid-query-count');
        count.textContent = this.#translate('record.create.pendingCount').replace(
          '{count}',
          String(state.recordCreateOps.length),
        );
        createButton.append(count);
      }
      createButton.disabled = state.status === 'offline';
      createButton.addEventListener('click', () => this.#beginDraftCreate());
      const caret = createElement('button', 'loom-button loom-split-caret clickable-icon');
      caret.type = 'button';
      caret.dataset.action = 'create-menu';
      caret.setAttribute('aria-label', this.#translate('record.create.menu'));
      caret.setAttribute('aria-haspopup', 'menu');
      caret.disabled = createButton.disabled;
      caret.append(createUiIcon('caret-down'));
      caret.addEventListener('click', () => {
        const rect = caret.getBoundingClientRect();
        openContextMenu({
          label: this.#translate('record.create.menu'),
          x: rect.left,
          y: rect.bottom + 4,
          host: this.#container,
          items: [
            {
              label: this.#translate('record.create.menu.append'),
              icon: 'tool-create',
              action: () => this.#beginDraftCreate(),
            },
            {
              label: this.#translate('record.create.menu.form'),
              icon: 'menu-open',
              action: () => {
                this.#openPanel = 'create';
                this.#rerenderSelf();
              },
            },
          ],
        });
      });
      split.append(createButton, caret);
      start.append(split);
    }
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
    if (
      state.totalCount !== null &&
      state.unfilteredTotal !== null &&
      state.unfilteredTotal > state.totalCount
    ) {
      // Filtered/total communicates how many rows the active filter hides.
      count.textContent = `${state.totalCount}/${state.unfilteredTotal} ${this.#translate('grid.rows')}`;
    } else if (state.totalCount !== null && state.totalCount > state.records.length) {
      // Loaded/total keeps partial progress visible while paging continues.
      count.textContent = `${state.records.length}/${state.totalCount} ${this.#translate('grid.rows')}`;
    } else if (state.totalCount !== null) {
      count.textContent = `${state.totalCount} ${this.#translate('grid.rows')}`;
    } else if (state.records.length > 0) {
      count.textContent = `${state.records.length} ${this.#translate('grid.rows')}`;
    }
    if (this.#callbacks.onUndo !== undefined || this.#callbacks.onRedo !== undefined) {
      const undoButton = this.#createActionButton(
        'undo',
        'grid.undo',
        'grid.undo',
        () => this.#callbacks.onUndo?.(),
        'tool-undo',
        true,
      );
      undoButton.disabled = state.canUndo === false;
      const redoButton = this.#createActionButton(
        'redo',
        'grid.redo',
        'grid.redo',
        () => this.#callbacks.onRedo?.(),
        'tool-redo',
        true,
      );
      redoButton.disabled = state.canRedo === false;
      end.append(undoButton, redoButton);
    }
    end.append(count);
    const loading = createElement('span', 'loom-grid-loading-note');
    loading.setAttribute('role', 'status');
    loading.dataset.active = state.status === 'loading' ? 'true' : 'false';
    loading.textContent = this.#translate('grid.loading');
    end.append(loading);
    const statusToggle = createElement('button', 'loom-save-status clickable-icon');
    statusToggle.type = 'button';
    statusToggle.dataset.action = 'toggle-status';
    statusToggle.setAttribute('aria-expanded', this.#openPanel === 'status' ? 'true' : 'false');
    renderSaveStatus(statusToggle, state.saveStatus, this.#translate);
    statusToggle.addEventListener('click', () => {
      const opening = this.#openPanel !== 'status';
      this.#openPanel = opening ? 'status' : null;
      if (opening) void this.#callbacks.onLoadDeletedRecords?.();
      this.#rerenderSelf();
      if (opening) {
        this.#container
          .querySelector<HTMLElement>(
            '.loom-status-panel button, .loom-status-panel select, .loom-status-panel input',
          )
          ?.focus();
      } else {
        this.#container.querySelector<HTMLElement>('[data-action="toggle-status"]')?.focus();
      }
    });
    end.append(statusToggle);
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
    const term = this.#searchDraft ?? state.search;
    if (!this.#searchExpanded && term === '') {
      const toggle = createElement('button', 'clickable-icon loom-grid-search-toggle');
      toggle.type = 'button';
      toggle.dataset.action = 'search-expand';
      toggle.setAttribute('aria-label', this.#translate('grid.search.label'));
      toggle.setAttribute('title', this.#translate('grid.search.label'));
      toggle.append(createUiIcon('tool-search'));
      toggle.disabled = this.#callbacks.onSearch === undefined;
      toggle.addEventListener('click', () => {
        this.#searchExpanded = true;
        this.#rerenderSelf();
        this.#container.querySelector<HTMLInputElement>('[data-role="grid-search"]')?.focus();
      });
      wrap.append(toggle);
    } else {
      const input = document.createElement('input');
      input.type = 'search';
      input.dataset.role = 'grid-search';
      input.setAttribute('aria-label', this.#translate('grid.search.label'));
      input.placeholder = this.#translate('grid.search.label');
      input.value = term;
      input.disabled = this.#callbacks.onSearch === undefined;
      input.addEventListener('input', () => {
        this.#searchDraft = input.value;
        this.#searchError = null;
        const note = wrap.querySelector('.loom-grid-search-error');
        note?.remove();
        const clear = wrap.querySelector<HTMLButtonElement>('[data-action="search-clear"]');
        if (clear !== null) {
          clear.hidden = input.value === '' && state.search === '';
        }
        this.#scheduleSearch(input.value);
      });
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          this.#flushSearch(input.value);
          return;
        }
        if (event.key !== 'Escape') return;
        event.preventDefault();
        if (input.value === '' && state.search === '') {
          this.#searchExpanded = false;
          this.#rerenderSelf();
        } else {
          input.value = '';
          this.#searchDraft = '';
          this.#flushSearch('');
        }
      });
      input.addEventListener('blur', (event) => {
        const next = event.relatedTarget;
        if (next instanceof Node && wrap.contains(next)) return;
        if (input.value === '' && state.search === '') {
          this.#searchExpanded = false;
          this.#rerenderSelf();
        }
      });
      const clear = createElement('button', 'clickable-icon loom-grid-search-clear');
      clear.type = 'button';
      clear.dataset.action = 'search-clear';
      clear.setAttribute('aria-label', this.#translate('grid.search.clear'));
      clear.setAttribute('title', this.#translate('grid.search.clear'));
      clear.append(createUiIcon('detail-close'));
      clear.hidden = term === '';
      clear.disabled = this.#callbacks.onSearch === undefined;
      clear.addEventListener('click', () => {
        this.#flushSearch('');
        input.value = '';
        this.#searchDraft = '';
        input.focus();
      });
      wrap.append(input, clear);
    }
    if (this.#searchError !== null) {
      const note = createElement('p', 'loom-grid-search-error');
      note.setAttribute('role', 'alert');
      note.textContent = this.#searchError;
      wrap.append(note);
    }
    return wrap;
  }

  #scheduleSearch(term: string): void {
    if (this.#searchDebounceTimer !== null) {
      window.clearTimeout(this.#searchDebounceTimer);
    }
    this.#searchDebounceTimer = Number(
      window.setTimeout(() => {
        this.#searchDebounceTimer = null;
        void this.#submitSearch(term);
      }, 300),
    );
  }

  #flushSearch(term: string): void {
    if (this.#searchDebounceTimer !== null) {
      window.clearTimeout(this.#searchDebounceTimer);
      this.#searchDebounceTimer = null;
    }
    void this.#submitSearch(term);
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
    panel: 'filter' | 'sort' | 'display' | 'create',
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
    if (this.#openPanel === 'status') return this.#renderStatusPanel(state);
    const view = selectedGridView(state);
    if (view === null || this.#openPanel === null) return null;
    const host = createElement('div', 'loom-query-panel');
    host.dataset.panel = this.#openPanel;
    if (this.#openPanel === 'filter') {
      const onApplyFilter = this.#callbacks.onApplyFilter;
      if (onApplyFilter === undefined) return null;
      // Panels apply changes as they happen; the open builder owns its draft,
      // so it is keyed by View rather than rebuilt on every saved revision.
      if (this.#filterBuilder === null || this.#filterBuilderViewId !== view.id) {
        const seedFieldId = this.#filterSeedFieldId;
        this.#filterSeedFieldId = null;
        let initial = view.config.filter;
        const seedField = state.fields.find(
          (candidate) => candidate.id === seedFieldId && candidate.deletedAt === undefined,
        );
        if (seedField !== undefined) {
          const rule = createFilterRule(seedField);
          initial =
            initial !== undefined && initial.kind === 'group'
              ? { ...initial, children: [...initial.children, rule] }
              : { kind: 'group', operator: 'and', children: [rule] };
        }
        const onQueryFieldValues = this.#callbacks.onQueryFieldValues;
        this.#filterBuilder = new FilterBuilder(initial, {
          fields: state.fields.filter((field) => field.deletedAt === undefined),
          translate: this.#translate,
          onApply: (filter) => onApplyFilter(view.id, filter),
          onInvalidate: () => this.#rerenderSelf(),
          host: this.#container,
          ...(onQueryFieldValues === undefined
            ? {}
            : {
                loadFieldValues: (fieldId, request) => onQueryFieldValues(fieldId, request),
              }),
        });
        this.#filterBuilderViewId = view.id;
      }
      host.append(this.#filterBuilder.render());
    } else if (this.#openPanel === 'sort') {
      const onApplySort = this.#callbacks.onApplySort;
      if (onApplySort === undefined) return null;
      const manualSort = view.config.manualSort === true;
      const onManualSortChange = this.#callbacks.onApplyManualSort;
      if (
        this.#sortPanel === null ||
        this.#sortPanelViewId !== view.id ||
        this.#sortPanelManual !== manualSort
      ) {
        this.#sortPanel = new SortPanel(view.config.sort, {
          fields: state.fields.filter((field) => field.deletedAt === undefined),
          translate: this.#translate,
          onApply: (sort) => onApplySort(view.id, sort),
          onInvalidate: () => this.#rerenderSelf(),
          manualSort,
          ...(onManualSortChange === undefined
            ? {}
            : { onManualSortChange: (enabled) => onManualSortChange(view.id, enabled) }),
        });
        this.#sortPanelViewId = view.id;
        this.#sortPanelManual = manualSort;
      }
      host.append(this.#sortPanel.render());
    } else if (this.#openPanel === 'display') {
      const onApplyDisplay = this.#callbacks.onApplyDisplay;
      if (onApplyDisplay === undefined) return null;
      if (this.#displayPanel === null || this.#displayPanelViewId !== view.id) {
        this.#displayPanel = new DisplayPanel(view.config, {
          fields: state.fields,
          translate: this.#translate,
          onApply: (patch) => onApplyDisplay(view.id, patch),
          onInvalidate: () => this.#rerenderSelf(),
        });
        this.#displayPanelViewId = view.id;
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

  #anchorQueryPanel(toolbar: HTMLElement, panel: HTMLElement): void {
    if (panel.dataset.panel === 'status') {
      panel.classList.add('loom-query-panel--end');
      return;
    }
    const measure = (): void => {
      const toggle = toolbar.querySelector<HTMLElement>(
        `[data-action="toggle-${panel.dataset.panel}"]`,
      );
      if (toggle === null || !panel.isConnected) return;
      const toggleRect = toggle.getBoundingClientRect();
      const toolbarRect = toolbar.getBoundingClientRect();
      if (toolbarRect.width === 0) {
        // Unmeasurable (detached/hidden host or test DOM): fall back to the
        // CSS default (toolbar start) rather than leaving a stale offset.
        panel.style.removeProperty('--loom-panel-anchor');
        return;
      }
      const panelWidth = panel.getBoundingClientRect().width;
      const maxLeft = Math.max(0, toolbarRect.width - panelWidth - 4);
      let left = toggleRect.left - toolbarRect.left;
      if (left + panelWidth > toolbarRect.width - 4) {
        // Near the right edge the panel flips so its right edge aligns with
        // the toggle's right edge instead of overflowing the toolbar.
        left = toggleRect.right - toolbarRect.left - panelWidth;
      }
      panel.style.setProperty('--loom-panel-anchor', `${Math.min(Math.max(0, left), maxLeft)}px`);
    };
    measure();
    if (!toolbar.isConnected) {
      // The panel is appended before the toolbar reaches the document; keep the
      // CSS default (start edge), then measure once mounted so offset lookups
      // see real geometry.
      panel.style.removeProperty('--loom-panel-anchor');
      const schedule =
        typeof requestAnimationFrame === 'function'
          ? requestAnimationFrame
          : (callback: () => void) => window.setTimeout(callback, 0);
      schedule(measure);
    }
  }

  #syncPanelDismissal(): void {
    if (this.#openPanel === null) {
      if (this.#panelDismiss !== null) {
        this.#container.ownerDocument.removeEventListener('pointerdown', this.#panelDismiss, true);
        this.#panelDismiss = null;
      }
      return;
    }
    if (this.#panelDismiss !== null) return;
    const onPointerDown = (event: PointerEvent) => {
      const el = event.target instanceof Element ? event.target : null;
      if (el !== null && el.closest('.loom-query-panel, .loom-grid-toolbar') !== null) return;
      this.#closePanels();
    };
    this.#container.ownerDocument.addEventListener('pointerdown', onPointerDown, true);
    this.#panelDismiss = onPointerDown;
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

  #renderStatusPanel(state: GridState): HTMLElement {
    const host = createElement('div', 'loom-query-panel loom-status-panel');
    host.dataset.panel = 'status';
    const header = createElement('div', 'loom-status-panel-header');
    const statusText = createTextElement(
      'span',
      describeSaveStatus(state.saveStatus, this.#translate),
    );
    statusText.className = 'loom-status-panel-status';
    statusText.dataset.status = state.saveStatus;
    header.append(statusText);
    const modes = createElement('div', 'loom-status-panel-modes');
    modes.setAttribute('role', 'tablist');
    const modeDefs = [
      ['ops', 'record.ops.title', 'tool-ops'],
      ['history', 'record.history.title', 'tool-history'],
      ['deleted', 'record.recycle.title', 'tool-trash'],
    ] as const;
    for (const [mode, key, icon] of modeDefs) {
      const button = createElement('button', 'loom-status-mode loom-action-icon clickable-icon');
      button.type = 'button';
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', this.#statusPanelMode === mode ? 'true' : 'false');
      button.dataset.mode = mode;
      const label = this.#translate(key);
      button.setAttribute('aria-label', label);
      button.append(createUiIcon(icon));
      button.addEventListener('click', () => {
        this.#statusPanelMode = mode;
        if (mode === 'history' && this.#lastState?.serverHistoryStatus === 'idle') {
          void this.#callbacks.onLoadServerHistory?.();
        }
        this.#rerenderSelf();
      });
      modes.append(button);
    }
    const actions = createElement('div', 'loom-status-panel-actions');
    actions.append(modes);
    if (this.#callbacks.onRefresh !== undefined) {
      actions.append(
        this.#createActionButton(
          'refresh',
          'grid.refresh',
          'grid.refreshing',
          () => this.#callbacks.onRefresh(),
          'tool-refresh',
          true,
        ),
      );
    }
    header.append(actions);
    host.append(header);
    if (this.#statusPanelMode === 'deleted') {
      host.append(this.#renderDeletedSection(state));
      return host;
    }
    if (this.#statusPanelMode === 'history') {
      host.append(this.#renderHistorySection(state));
      return host;
    }

    const kinds: readonly ('all' | UndoEntryMeta['kind'])[] = [
      'all',
      'edit',
      'create',
      'delete',
      'restore',
    ];
    const filters = createElement('div', 'loom-change-filters');
    for (const kind of kinds) {
      const chip = createElement('button', 'loom-change-filter clickable-icon');
      chip.type = 'button';
      chip.dataset.kind = kind;
      chip.setAttribute('aria-pressed', this.#historyFilter === kind ? 'true' : 'false');
      chip.textContent = this.#translate(
        kind === 'all' ? 'record.changes.filter.all' : CHANGE_KIND_KEYS[kind],
      );
      chip.addEventListener('click', () => {
        this.#historyFilter = kind;
        this.#rerenderSelf();
      });
      filters.append(chip);
    }
    host.append(filters);

    const entries = state.historyEntries
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => this.#historyFilter === 'all' || entry.kind === this.#historyFilter);
    if (entries.length === 0) {
      const empty = createTextElement('p', this.#translate('record.changes.empty'));
      empty.className = 'loom-change-empty';
      host.append(empty);
    } else {
      const list = createElement('ul', 'loom-change-list');
      for (const { entry, index } of entries) {
        const item = createElement('li', 'loom-change-item');
        item.dataset.recordId = entry.recordId;
        item.dataset.kind = entry.kind;
        item.append(createUiIcon(CHANGE_KIND_ICONS[entry.kind]));
        const text = createElement('span', 'loom-change-item-text');
        const title = createTextElement('span', entry.recordTitle);
        title.className = 'loom-change-item-title';
        const kindLabel = createTextElement('span', this.#translate(CHANGE_KIND_KEYS[entry.kind]));
        kindLabel.className = 'loom-change-item-kind';
        text.append(title, kindLabel);
        if (entry.fieldName !== undefined) {
          const field = createTextElement('span', entry.fieldName);
          field.className = 'loom-change-item-field';
          text.append(field);
        }
        if (entry.kind === 'edit' && (entry.before !== undefined || entry.after !== undefined)) {
          const delta = createTextElement(
            'span',
            `${formatChangeValue(entry.before, this.#translate)} → ${formatChangeValue(entry.after, this.#translate)}`,
          );
          delta.className = 'loom-change-item-delta';
          text.append(delta);
        }
        const time = createTextElement('span', formatChangeTime(entry.at));
        time.className = 'loom-change-item-time';
        text.append(time);
        item.append(text);
        const sync = state.editStatuses[entry.recordId];
        if (sync === 'conflict' || sync === 'error' || sync === 'terminal') {
          const syncKey: MessageKey =
            sync === 'conflict' ? 'record.changes.sync.conflict' : 'record.changes.sync.failed';
          const chip = createTextElement('span', this.#translate(syncKey));
          chip.className = 'loom-change-item-sync';
          chip.dataset.status = sync;
          item.append(chip);
        }
        if (this.#callbacks.onUndoTo !== undefined) {
          const undo = createElement('button', 'loom-change-item-undo clickable-icon');
          undo.type = 'button';
          undo.dataset.action = 'undo-to';
          undo.setAttribute('aria-label', this.#translate('record.changes.undoStep'));
          undo.append(createUiIcon('tool-undo'));
          undo.addEventListener('click', () => {
            void this.#callbacks.onUndoTo?.(index);
          });
          item.append(undo);
        }
        list.append(item);
      }
      host.append(list);
    }
    return host;
  }

  #renderHistorySection(state: GridState): HTMLElement {
    const host = createElement('div', 'loom-status-history');
    const filters = createElement('div', 'loom-change-filters');
    for (const kind of SERVER_HISTORY_FILTERS) {
      const chip = createElement('button', 'loom-change-filter clickable-icon');
      chip.type = 'button';
      chip.dataset.kind = kind;
      chip.setAttribute('aria-pressed', this.#serverHistoryFilter === kind ? 'true' : 'false');
      chip.textContent = this.#translate(
        kind === 'all' ? 'record.changes.filter.all' : SERVER_KIND_KEYS[kind],
      );
      chip.addEventListener('click', () => {
        if (this.#serverHistoryFilter === kind) return;
        this.#serverHistoryFilter = kind;
        void this.#callbacks.onLoadServerHistory?.(kind === 'all' ? undefined : kind);
      });
      filters.append(chip);
    }
    host.append(filters);

    if (state.serverHistoryStatus === 'loading' && state.serverHistory.length === 0) {
      const status = createTextElement('p', this.#translate('record.history.loading'));
      status.className = 'loom-recycle-status';
      host.append(status);
      return host;
    }
    if (state.serverHistoryStatus === 'error' && state.serverHistory.length === 0) {
      const status = createTextElement('p', this.#translate('record.history.error'));
      status.className = 'loom-recycle-status';
      host.append(status);
      return host;
    }
    if (state.serverHistory.length === 0) {
      const status = createTextElement('p', this.#translate('record.history.empty'));
      status.className = 'loom-recycle-status';
      host.append(status);
      return host;
    }

    const list = createElement('ul', 'loom-change-list');
    for (const change of state.serverHistory) {
      const item = createElement('li', 'loom-change-item');
      item.dataset.kind = change.kind;
      if (change.recordId !== undefined) item.dataset.recordId = change.recordId;
      item.append(createUiIcon(SERVER_KIND_ICONS[change.kind]));
      const text = createElement('span', 'loom-change-item-text');
      const title = createTextElement(
        'span',
        change.primaryFieldText ?? change.recordId ?? change.objectId ?? change.kind,
      );
      title.className = 'loom-change-item-title';
      const kindLabel = createTextElement('span', this.#translate(SERVER_KIND_KEYS[change.kind]));
      kindLabel.className = 'loom-change-item-kind';
      text.append(title, kindLabel);
      for (const fieldChange of change.fields ?? []) {
        const field = state.fields.find((candidate) => candidate.id === fieldChange.fieldId);
        const delta = createTextElement(
          'span',
          `${field?.name ?? fieldChange.fieldId}: ${formatChangeValue(fieldChange.before, this.#translate)} → ${formatChangeValue(fieldChange.after, this.#translate)}`,
        );
        delta.className = 'loom-change-item-delta';
        text.append(delta);
      }
      const meta = createTextElement(
        'span',
        [formatChangeTime(change.occurredAt), change.actorId]
          .filter((part) => part !== undefined && part !== '')
          .join(' · '),
      );
      meta.className = 'loom-change-item-time';
      text.append(meta);
      item.append(text);
      list.append(item);
    }
    host.append(list);

    if (state.serverHistoryStatus === 'loading') {
      const status = createTextElement('p', this.#translate('record.history.loading'));
      status.className = 'loom-recycle-status';
      host.append(status);
    } else if (
      state.serverHistoryHasMore &&
      this.#callbacks.onLoadMoreServerHistory !== undefined
    ) {
      host.append(
        this.#createOpButton('loom-recycle-load-more', 'record.history.loadMore', () =>
          this.#callbacks.onLoadMoreServerHistory?.(
            this.#serverHistoryFilter === 'all' ? undefined : this.#serverHistoryFilter,
          ),
        ),
      );
    }
    return host;
  }

  #renderDeletedSection(state: GridState): HTMLElement {
    const host = createElement('div', 'loom-status-deleted');
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
    // Only drop the draft when it is still the term just submitted — typing
    // that happened while the request was in flight belongs to the user.
    if (this.#searchDraft === term) this.#searchDraft = null;
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
    const hasAddField = this.#callbacks.onFieldSave !== undefined;
    const columnTemplate = [
      '56px',
      ...fields.map((field) => `${columns.widths.get(field.id) ?? 180}px`),
    ].join(' ');

    const viewport = createElement('div', 'loom-grid-viewport');
    viewport.tabIndex = 0;
    viewport.setAttribute('role', 'grid');
    labelContainer(viewport, this.#translate('grid.table'));
    viewport.setAttribute('aria-rowcount', String(state.records.length + 1));
    viewport.setAttribute('aria-colcount', String(fields.length + (hasAddField ? 2 : 1)));

    const header = createElement('div', 'loom-grid-header');
    header.setAttribute('role', 'row');
    header.style.gridTemplateColumns = hasAddField ? `${columnTemplate} 2.5rem` : columnTemplate;
    const indexHeader = createGridCell('#', 'loom-grid-header-cell loom-grid-index-header');
    indexHeader.setAttribute('role', 'columnheader');
    indexHeader.setAttribute('aria-colindex', '1');
    header.append(indexHeader);
    for (const [fieldIndex, field] of fields.entries()) {
      const fieldHeader = createGridCell(field.name, 'loom-grid-header-cell');
      if (field.description !== undefined && field.description !== '') {
        fieldHeader.title = `${field.name}: ${field.description}`;
      }
      fieldHeader.setAttribute('role', 'columnheader');
      fieldHeader.setAttribute('aria-colindex', String(fieldIndex + 2));
      fieldHeader.dataset.fieldIndex = String(fieldIndex);
      fieldHeader.addEventListener('click', (event) => {
        if ((event.target as HTMLElement).closest('button') !== null) return;
        this.#selectColumn(fieldIndex);
      });
      if (this.#callbacks.onApplyDisplay !== undefined) {
        fieldHeader.draggable = true;
        fieldHeader.addEventListener('dragstart', (event) => {
          event.dataTransfer?.setData('text/plain', field.id);
          if (event.dataTransfer !== null) event.dataTransfer.effectAllowed = 'move';
          fieldHeader.classList.add('is-dragging');
        });
        fieldHeader.addEventListener('dragend', () => {
          fieldHeader.classList.remove('is-dragging');
          this.#clearDropTargets();
        });
        fieldHeader.addEventListener('dragover', (event) => {
          const dragged = event.dataTransfer?.types.includes('text/plain');
          if (dragged !== true) return;
          event.preventDefault();
          if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'move';
          this.#clearDropTargets();
          fieldHeader.classList.add('is-drop-target');
        });
        fieldHeader.addEventListener('dragleave', () => {
          fieldHeader.classList.remove('is-drop-target');
        });
        fieldHeader.addEventListener('drop', (event) => {
          event.preventDefault();
          this.#clearDropTargets();
          const draggedFieldId = event.dataTransfer?.getData('text/plain');
          if (draggedFieldId !== undefined && draggedFieldId !== field.id) {
            this.#moveColumn(draggedFieldId, field.id);
          }
        });
      }
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
        const button = createElement('button', 'loom-grid-sort clickable-icon');
        button.type = 'button';
        button.dataset.action = 'header-sort';
        button.dataset.fieldId = field.id;
        const label = createElement('span', 'loom-grid-header-label');
        label.append(createFieldTypeIcon(field.type), createTextElement('span', field.name));
        const indicator = createElement('span', 'loom-grid-sort-indicator');
        indicator.setAttribute('aria-hidden', 'true');
        indicator.textContent = entry === undefined ? '' : entry.direction === 'asc' ? '↑' : '↓';
        button.append(label, indicator);
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
        const label = createElement('span', 'loom-grid-header-label');
        label.append(createFieldTypeIcon(field.type), createTextElement('span', field.name));
        const indicator = createElement('span', 'loom-grid-sort-indicator');
        indicator.setAttribute('aria-hidden', 'true');
        fieldHeader.replaceChildren(label, indicator);
      }
      const menuButton = createElement('button', 'loom-grid-header-menu clickable-icon');
      menuButton.type = 'button';
      menuButton.dataset.action = 'field-menu';
      menuButton.setAttribute('aria-label', this.#translate('field.menu.open'));
      menuButton.setAttribute('aria-haspopup', 'menu');
      menuButton.append(createUiIcon('menu-ellipsis'));
      menuButton.addEventListener('click', (event) => {
        event.stopPropagation();
        const rect = menuButton.getBoundingClientRect();
        this.#openColumnMenu(field, rect.left, rect.bottom + 4);
      });
      fieldHeader.append(menuButton);
      if (this.#callbacks.onApplyDisplay !== undefined && gridView !== null) {
        const resize = createElement('span', 'loom-grid-col-resize');
        resize.setAttribute('aria-hidden', 'true');
        resize.addEventListener('pointerdown', (event) => {
          event.preventDefault();
          event.stopPropagation();
          const startX = event.clientX;
          const startWidth = columns.widths.get(field.id) ?? GRID_COLUMN_WIDTH_DEFAULT;
          const onMove = (move: PointerEvent) => {
            this.#previewColumnWidth(
              field.id,
              clampGridColumnWidth(startWidth + move.clientX - startX),
            );
          };
          const onUp = (move: PointerEvent) => {
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', onUp);
            const width = clampGridColumnWidth(startWidth + move.clientX - startX);
            if (width !== startWidth) this.#commitColumnWidth(field, width);
          };
          document.addEventListener('pointermove', onMove);
          document.addEventListener('pointerup', onUp);
        });
        fieldHeader.append(resize);
      }
      fieldHeader.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.#openColumnMenu(field, event.clientX, event.clientY);
      });
      header.append(fieldHeader);
    }
    if (this.#callbacks.onFieldSave !== undefined) {
      const addField = createGridCell('', 'loom-grid-header-cell loom-grid-add-field');
      addField.setAttribute('role', 'columnheader');
      const addButton = createElement('button', 'loom-grid-add-field-button clickable-icon');
      addButton.type = 'button';
      addButton.setAttribute('aria-label', this.#translate('field.add'));
      addButton.append(createUiIcon('field-add'));
      addButton.addEventListener('click', (event) => {
        const rect = addButton.getBoundingClientRect();
        this.#openFieldEditorPanel({ mode: 'create' }, rect.left + 4, rect.bottom + 4, addButton);
      });
      addField.append(addButton);
      header.append(addField);
    }

    const canvas = createElement('div', 'loom-grid-canvas');
    canvas.style.height = `${state.records.length * rowHeight}px`;
    canvas.style.backgroundImage = gridFillerBackground(columns, fields, rowHeight);
    const rowLayer = createElement('div', 'loom-grid-row-layer');
    canvas.append(rowLayer);
    const canCreate =
      state.status === 'ready' &&
      !state.hasMore &&
      state.selectedTableId !== null &&
      this.#callbacks.onCreateRecord !== undefined;
    if (canCreate && this.#draftCreateValues !== null) {
      const draftRow = this.#renderDraftRow(state, fields, rowHeight);
      canvas.append(draftRow);
      this.#draftRowEl = draftRow;
    } else if (canCreate) {
      const addRow = createElement('button', 'loom-grid-add-row clickable-icon');
      addRow.type = 'button';
      addRow.dataset.action = 'grid-add-row';
      addRow.style.top = `${state.records.length * rowHeight}px`;
      addRow.style.height = `${rowHeight}px`;
      addRow.style.width = `${GRID_INDEX_COLUMN_WIDTH}px`;
      const indexCell = createElement('span', 'loom-grid-index-cell loom-grid-add-row-index');
      indexCell.append(createUiIcon('tool-create'));
      addRow.append(indexCell);
      addRow.setAttribute('aria-label', this.#translate('record.create.add'));
      addRow.addEventListener('click', () => this.#beginDraftCreate());
      canvas.append(addRow);
    }
    const aggregateRow =
      this.#callbacks.onSetFieldAggregation === undefined
        ? null
        : this.#renderAggregateRow(
            state,
            fields,
            hasAddField ? `${columnTemplate} 2.5rem` : columnTemplate,
            rowHeight,
          );
    viewport.append(header, canvas);
    if (aggregateRow !== null) viewport.append(aggregateRow);
    const footer = createElement('div', 'loom-grid-footer');
    const footerCount = createElement('span', 'loom-grid-footer-count');
    footerCount.textContent = `${state.records.length} ${this.#translate('grid.rows')}`;
    const footerView = createElement('span', 'loom-grid-footer-view');
    footerView.textContent = gridView?.name ?? '';
    footer.append(footerCount, footerView);
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
    wrapper.append(footer);
    return wrapper;
  }

  #renderAggregateRow(
    state: GridState,
    fields: readonly Field[],
    columnTemplate: string,
    rowHeight: number,
  ): HTMLElement {
    const row = createElement('div', 'loom-grid-aggregate');
    row.setAttribute('role', 'row');
    row.style.gridTemplateColumns = columnTemplate;
    row.style.height = `${rowHeight}px`;
    const indexCell = createElement('div', 'loom-grid-aggregate-cell loom-grid-index-cell');
    indexCell.setAttribute('role', 'cell');
    indexCell.append(createUiIcon('tool-convert'));
    indexCell.setAttribute('aria-label', this.#translate('grid.aggregate.menu'));
    row.append(indexCell);
    for (const field of fields) {
      row.append(this.#renderAggregateCell(state, field));
    }
    const filler = createElement('div', 'loom-grid-aggregate-cell');
    filler.setAttribute('aria-hidden', 'true');
    row.append(filler);
    return row;
  }

  #renderAggregateCell(state: GridState, field: Field): HTMLElement {
    const cell = createElement('button', 'loom-grid-aggregate-cell clickable-icon');
    cell.type = 'button';
    cell.setAttribute('role', 'cell');
    cell.dataset.fieldId = field.id;
    const selected = state.fieldAggregations[field.id];
    cell.setAttribute(
      'aria-label',
      `${field.name}: ${selected === undefined ? this.#translate('grid.aggregate.menu') : this.#aggregateFnLabel(selected)}`,
    );
    if (selected === undefined) {
      cell.dataset.empty = 'true';
    } else if (state.aggregateStatus === 'loading') {
      cell.textContent = this.#translate('grid.aggregate.loading');
    } else if (state.aggregateStatus === 'error') {
      cell.dataset.status = 'error';
      cell.textContent = this.#translate('grid.aggregate.error');
    } else {
      const value = state.aggregateResults?.[field.id]?.[selected];
      cell.textContent = `${this.#aggregateFnLabel(selected)} ${formatAggregateValue(value)}`;
    }
    cell.addEventListener('click', (event) => {
      const onSetFieldAggregation = this.#callbacks.onSetFieldAggregation;
      if (onSetFieldAggregation === undefined) return;
      const items: ContextMenuEntry[] = [
        {
          label: this.#translate('grid.aggregate.none'),
          dataAction: 'aggregate-none',
          disabled: selected === undefined,
          action: () => void onSetFieldAggregation(field.id, undefined),
        },
        'separator',
        ...aggregateFnsForField(field).map((fn): ContextMenuItem => ({
          label: this.#aggregateFnLabel(fn),
          dataAction: `aggregate-${fn}`,
          action: () => void onSetFieldAggregation(field.id, fn),
        })),
      ];
      openContextMenu({
        items,
        x: event.clientX,
        y: event.clientY,
        host: this.#container,
        label: this.#translate('grid.aggregate.menu'),
      });
    });
    return cell;
  }

  #aggregateFnLabel(fn: AggregateFn): string {
    return this.#translate(`grid.aggregate.${fn}` as MessageKey);
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
    const rowNumber = createTextElement('span', String(rowIndex + 1));
    rowNumber.className = 'loom-grid-row-number';
    const check = createElement('input', 'loom-grid-row-check');
    check.type = 'checkbox';
    check.checked = this.#isRowSelected(rowIndex);
    check.tabIndex = -1;
    check.setAttribute('aria-label', this.#translate('grid.selectRow'));
    check.addEventListener('click', (event) => {
      event.stopPropagation();
      this.#toggleRowSelected(rowIndex, event.shiftKey);
    });
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'loom-grid-open loom-grid-row-expand clickable-icon';
    open.dataset.recordId = record.id;
    open.setAttribute('aria-label', this.#translate('grid.openDetails'));
    open.append(createUiIcon('menu-open'));
    open.addEventListener('click', (event) => {
      event.stopPropagation();
      this.#callbacks.onRecordOpen(record);
    });
    indexCell.append(rowNumber, check, open);
    indexCell.addEventListener('click', (event) => {
      event.stopPropagation();
      if ((event.target as HTMLElement).closest('input') !== null) return;
      if (event.shiftKey && this.#rowAnchorIndex !== null) {
        this.#selectRowRange(this.#rowAnchorIndex, rowIndex);
      } else if (event.ctrlKey || event.metaKey) {
        this.#toggleRowSelected(rowIndex);
      } else {
        this.#selectRow(rowIndex);
      }
    });
    indexCell.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.#openRecordContextMenu(record, event.clientX, event.clientY);
    });
    if (manualOrderEnabled(gridState) && this.#callbacks.onMoveRecord !== undefined) {
      indexCell.draggable = true;
      indexCell.addEventListener('dragstart', (event) => {
        if ((event.target as HTMLElement).closest('input,button') !== null) {
          event.preventDefault();
          return;
        }
        event.dataTransfer?.setData(RECORD_DRAG_MIME, record.id);
        if (event.dataTransfer !== null) event.dataTransfer.effectAllowed = 'move';
        row.classList.add('is-dragging');
      });
      indexCell.addEventListener('dragend', () => {
        row.classList.remove('is-dragging');
        this.#clearRowDropTargets();
      });
      row.addEventListener('dragover', (event) => {
        if (event.dataTransfer?.types.includes(RECORD_DRAG_MIME) !== true) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        this.#clearRowDropTargets();
        row.classList.add('is-drop-target');
      });
      row.addEventListener('dragleave', () => {
        row.classList.remove('is-drop-target');
      });
      row.addEventListener('drop', (event) => {
        if (event.dataTransfer?.types.includes(RECORD_DRAG_MIME) !== true) return;
        event.preventDefault();
        this.#clearRowDropTargets();
        const draggedId = event.dataTransfer.getData(RECORD_DRAG_MIME);
        if (draggedId === '' || draggedId === record.id) return;
        const rect = row.getBoundingClientRect();
        const anchors =
          event.clientY > rect.top + rect.height / 2
            ? { afterRecordId: record.id }
            : { beforeRecordId: record.id };
        void this.#callbacks.onMoveRecord?.(draggedId, anchors);
      });
    }
    row.append(indexCell);

    for (const [fieldIndex, field] of fields.entries()) {
      const displayValue = defaultFieldRendererRegistry.render(field, record.values[field.id], {
        translate: this.#translate,
      });
      const cell = createGridCell('', 'loom-grid-cell');
      cell.append(
        createRenderedFieldValueElement(
          displayValue.state === 'unset' ? { ...displayValue, text: '' } : displayValue,
          {
            compactAttachments: true,
            ...(this.#callbacks.attachmentThumbnail === undefined
              ? {}
              : { attachmentThumbnail: this.#callbacks.attachmentThumbnail }),
            ...(gridState?.search !== undefined && gridState.search !== ''
              ? { highlight: gridState.search }
              : {}),
          },
        ),
      );
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
      if (this.#isCellSelected(rowIndex, fieldIndex)) cell.classList.add('is-selected');
      if (this.#isRowSelected(rowIndex)) indexCell.classList.add('is-selected');
      cell.addEventListener('focus', () => {
        this.#focusedHeaderFieldId = null;
        this.#rememberCell(cell.dataset.focusKey ?? '', rowIndex, fieldIndex);
      });
      cell.addEventListener('click', (event) => {
        event.stopPropagation();
        this.#rememberCell(cell.dataset.focusKey ?? '', rowIndex, fieldIndex);
        const wasActive =
          this.#selection !== null &&
          this.#selection.anchor.rowIndex === rowIndex &&
          this.#selection.anchor.fieldIndex === fieldIndex &&
          this.#selection.head.rowIndex === rowIndex &&
          this.#selection.head.fieldIndex === fieldIndex;
        this.#selectCell(rowIndex, fieldIndex, event.shiftKey);
        if (wasActive && !event.shiftKey && isEditableField(field) && canEdit) {
          this.#beginCellEdit(cell, record, field, rowIndex, fieldIndex);
        }
      });
      cell.addEventListener('dblclick', (event) => {
        event.stopPropagation();
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
        if (event.key === 'Tab') {
          const grid = this.#virtualGrid;
          if (grid === null || grid.fields.length === 0) return;
          const cols = grid.fields.length;
          const next = rowIndex * cols + fieldIndex + (event.shiftKey ? -1 : 1);
          if (next >= 0 && next < grid.state.records.length * cols) {
            event.preventDefault();
            this.#focusCellAt(Math.floor(next / cols), next % cols);
          }
          return;
        }
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
          if (key === 'a') {
            event.preventDefault();
            this.#selectAll();
            return;
          }
          if (key === 'z' || key === 'y') {
            if (
              (key === 'z' && !event.shiftKey && this.#callbacks.onUndo === undefined) ||
              ((key === 'y' || (key === 'z' && event.shiftKey)) &&
                this.#callbacks.onRedo === undefined)
            ) {
              return;
            }
            event.preventDefault();
            if (key === 'z' && !event.shiftKey) void this.#callbacks.onUndo?.();
            else void this.#callbacks.onRedo?.();
            return;
          }
          if (key === 'c' || key === 'v') {
            event.preventDefault();
            const rect = this.#selectionRect();
            const range =
              rect !== null && (rect.bottom - rect.top > 0 || rect.right - rect.left > 0);
            if (key === 'c') {
              if (range) this.#copySelection();
              else void this.#copyCell(field, record.values[field.id]);
            } else void this.#pasteCell(record, field);
          }
          return;
        }
        if (event.key === 'F2') {
          if (isEditableField(field) && canEdit) {
            event.preventDefault();
            this.#beginCellEdit(cell, record, field, rowIndex, fieldIndex);
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

    row.addEventListener('dblclick', (event) => {
      if ((event.target as HTMLElement | null)?.closest('.loom-grid-cell') !== null) return;
      this.#callbacks.onRecordOpen(record);
    });
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

  #draftRecord(state: GridState): LoomTableRecord {
    return {
      id: DRAFT_RECORD_ID,
      tableId: state.selectedTableId ?? '',
      revision: 0,
      values: this.#draftCreateValues ?? {},
      createdAt: '',
      updatedAt: '',
    };
  }

  #renderDraftRow(state: GridState, fields: readonly Field[], rowHeight: number): HTMLElement {
    const draftRecord = this.#draftRecord(state);
    const rowIndex = state.records.length;
    const row = createElement('div', 'loom-grid-row loom-grid-draft-row');
    row.setAttribute('role', 'row');
    row.setAttribute('aria-rowindex', String(rowIndex + 2));
    row.style.gridTemplateColumns =
      this.#virtualGrid?.columnTemplate ?? columnTemplateFor(fields, state);
    row.style.height = `${rowHeight}px`;
    row.style.top = `${rowIndex * rowHeight}px`;

    const indexCell = createElement('div', 'loom-grid-index-cell loom-grid-add-row-index');
    indexCell.setAttribute('role', 'rowheader');
    indexCell.append(createUiIcon('tool-create'));
    row.append(indexCell);

    const lastFrozenId = this.#virtualGrid?.columns.frozen.at(-1)?.id;
    for (const [fieldIndex, field] of fields.entries()) {
      const displayValue = defaultFieldRendererRegistry.render(
        field,
        draftRecord.values[field.id],
        { translate: this.#translate },
      );
      const cell = createGridCell('', 'loom-grid-cell');
      cell.append(
        createRenderedFieldValueElement(
          displayValue.state === 'unset' ? { ...displayValue, text: '' } : displayValue,
          {
            compactAttachments: true,
            ...(this.#callbacks.attachmentThumbnail === undefined
              ? {}
              : { attachmentThumbnail: this.#callbacks.attachmentThumbnail }),
          },
        ),
      );
      cell.setAttribute('role', 'gridcell');
      cell.setAttribute('aria-colindex', String(fieldIndex + 2));
      const frozenOffset = this.#virtualGrid?.columns.frozenOffsets.get(field.id);
      if (frozenOffset !== undefined) {
        cell.classList.add('loom-grid-frozen');
        cell.style.left = `${frozenOffset}px`;
        if (field.id === lastFrozenId) cell.classList.add('loom-grid-frozen-last');
      }
      cell.tabIndex = 0;
      cell.dataset.fieldId = field.id;
      cell.dataset.fieldIndex = String(fieldIndex);
      const editable = isEditableField(field);
      if (editable) {
        cell.classList.add('loom-grid-editable');
      } else {
        cell.setAttribute('aria-readonly', 'true');
      }
      cell.addEventListener('click', (event) => {
        event.stopPropagation();
        if (editable) this.#beginCellEdit(cell, draftRecord, field, rowIndex, fieldIndex);
      });
      cell.addEventListener('keydown', (event) => {
        event.stopPropagation();
        if (event.key === 'Escape') {
          event.preventDefault();
          this.#cancelDraftCreate();
          return;
        }
        if (event.key === 'Tab') {
          event.preventDefault();
          const next = this.#nextEditableFieldIndex(fields, fieldIndex, event.shiftKey ? -1 : 1);
          if (next !== null) this.#focusDraftCell(next);
          return;
        }
        if (event.key === 'Enter' || event.key === 'F2') {
          event.preventDefault();
          if (editable) this.#beginCellEdit(cell, draftRecord, field, rowIndex, fieldIndex);
          return;
        }
        if (
          event.key.length === 1 &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.altKey &&
          !event.isComposing &&
          editable
        ) {
          event.preventDefault();
          this.#beginCellEdit(cell, draftRecord, field, rowIndex, fieldIndex, event.key, false);
        }
      });
      row.append(cell);
    }

    // Leaving the draft row commits whatever was typed (or quietly discards an
    // empty draft), matching how other grid tools commit a trailing "+" row.
    row.addEventListener('focusout', () => {
      window.setTimeout(() => {
        const active = this.#draftRowEl;
        if (this.#draftCreateValues === null || active === null) return;
        if (active.isConnected && active.contains(document.activeElement)) return;
        this.#commitDraftCreate();
      }, 0);
    });
    return row;
  }

  #beginDraftCreate(): void {
    const state = this.#virtualGrid?.state ?? this.#lastState;
    if (state === null || this.#callbacks.onCreateRecord === undefined) return;
    if (state.status !== 'ready' || state.selectedTableId === null) return;
    if (state.hasMore) {
      // The trailing draft row only exists at the end of a fully loaded grid;
      // fall back to the create form while more pages remain unloaded.
      this.#openPanel = 'create';
      this.#rerenderSelf();
      return;
    }
    this.#draftCreateValues ??= {};
    this.render(state);
    const grid = this.#virtualGrid;
    if (grid !== null) {
      grid.viewport.scrollTop = state.records.length * grid.rowHeight;
      const first = this.#nextEditableFieldIndex(grid.fields, -1, 1);
      if (first !== null) this.#focusDraftCell(first);
    }
  }

  #cancelDraftCreate(): void {
    if (this.#draftCreateValues === null) return;
    this.#draftCreateValues = null;
    this.#draftRowEl = null;
    this.render(this.#virtualGrid?.state ?? this.#emptyState());
  }

  #commitDraftCreate(): void {
    const values = this.#draftCreateValues;
    if (values === null) return;
    this.#draftCreateValues = null;
    this.#draftRowEl = null;
    this.render(this.#virtualGrid?.state ?? this.#emptyState());
    const hasValue = Object.values(values).some(
      (value) => value !== undefined && value !== null && value !== '',
    );
    const onCreateRecord = this.#callbacks.onCreateRecord;
    if (!hasValue || onCreateRecord === undefined) return;
    void Promise.resolve(onCreateRecord({ ...values })).catch(() => {
      // Keep the typed draft so a failed create can be retried instead of
      // silently losing what the user entered.
      this.#draftCreateValues = values;
      this.render(this.#virtualGrid?.state ?? this.#emptyState());
    });
  }

  #finishDraftCell(
    fieldId: string,
    value: MutationValue,
    fieldIndex: number,
    moveOffset: number | null,
  ): void {
    const values = this.#draftCreateValues;
    if (values === null) return;
    values[fieldId] = value;
    const grid = this.#virtualGrid;
    const state = grid?.state ?? this.#emptyState();
    const next =
      moveOffset === null || grid === null
        ? null
        : this.#nextEditableFieldIndex(grid.fields, fieldIndex, moveOffset);
    this.render(state);
    if (next !== null) {
      this.#focusDraftCell(next);
      return;
    }
    if (moveOffset === null) return;
    if (moveOffset > 0) this.#commitDraftCreate();
    else this.#focusDraftCell(fieldIndex);
  }

  #focusDraftCell(fieldIndex: number): void {
    const row = this.#draftRowEl;
    const grid = this.#virtualGrid;
    if (row === null || grid === null) return;
    const field = grid.fields[fieldIndex];
    const cell = row.querySelector<HTMLElement>(
      `.loom-grid-cell[data-field-index="${fieldIndex}"]`,
    );
    if (field === undefined || cell === null || !isEditableField(field)) return;
    this.#beginCellEdit(
      cell,
      this.#draftRecord(grid.state),
      field,
      grid.state.records.length,
      fieldIndex,
    );
  }

  #nextEditableFieldIndex(
    fields: readonly Field[],
    from: number,
    direction: number,
  ): number | null {
    let index = from + direction;
    while (index >= 0 && index < fields.length) {
      const field = fields[index];
      if (field !== undefined && isEditableField(field)) return index;
      index += direction;
    }
    return null;
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
    if (this.#callbacks.onDuplicateRecord !== undefined) {
      items.push(this.#recordDuplicateMenuItem(record));
    }
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

  #openColumnMenu(field: Field, x: number, y: number): void {
    const gridState = this.#virtualGrid?.state;
    const view = gridState?.views.find((candidate) => candidate.id === gridState.selectedViewId);
    const table = gridState?.tables.find((candidate) => candidate.id === gridState.selectedTableId);
    const isPrimary = field.id === table?.primaryFieldId;
    const items: ContextMenuEntry[] = [];
    if (this.#callbacks.onFieldSave !== undefined) {
      items.push(
        {
          label: this.#translate('field.menu.edit'),
          icon: 'menu-edit',
          action: () =>
            this.#openFieldEditorPanel({ mode: 'edit', fieldId: field.id }, x, y, undefined, field),
        },
        ...(this.#callbacks.onConversionPreview !== undefined &&
        this.#callbacks.onConvertField !== undefined
          ? [
              {
                label: this.#translate('field.convert.title'),
                icon: 'tool-convert' as const,
                disabled: isPrimary,
                action: () => this.#openConvertPanel(field, x, y),
              },
            ]
          : []),
        {
          label: this.#translate('field.menu.insertLeft'),
          icon: 'col-insert-left',
          action: () =>
            this.#openFieldEditorPanel(
              { mode: 'create', anchorFieldId: field.id, side: 'left' },
              x,
              y,
            ),
        },
        {
          label: this.#translate('field.menu.insertRight'),
          icon: 'col-insert-right',
          action: () =>
            this.#openFieldEditorPanel(
              { mode: 'create', anchorFieldId: field.id, side: 'right' },
              x,
              y,
            ),
        },
        {
          label: this.#translate('field.menu.duplicate'),
          icon: 'menu-copy',
          disabled: isPrimary,
          action: () => {
            void this.#callbacks.onFieldSave?.(
              {
                name: `${field.name} copy`,
                type: field.type,
                ...(field.type === 'select' || field.type === 'multiSelect'
                  ? {
                      options: field.config.options.map((option) => ({
                        name: option.name,
                        color: option.color as SelectOptionColor,
                      })),
                    }
                  : {}),
                ...(field.type === 'attachment' ? { maxCount: field.config.maxCount } : {}),
              },
              { mode: 'create', anchorFieldId: field.id, side: 'right' },
            );
          },
        },
      );
    }
    const gridConfig = view?.type === 'grid' ? view.config : null;
    if (view !== undefined && gridConfig !== null && isSortableField(field)) {
      items.push('separator', {
        label: this.#translate('field.menu.sortAsc'),
        icon: 'sort-asc',
        action: () =>
          void this.#callbacks.onApplySort?.(view.id, [
            { fieldId: field.id, direction: 'asc', nulls: 'last' },
          ]),
      });
      items.push({
        label: this.#translate('field.menu.sortDesc'),
        icon: 'sort-desc',
        action: () =>
          void this.#callbacks.onApplySort?.(view.id, [
            { fieldId: field.id, direction: 'desc', nulls: 'last' },
          ]),
      });
    }
    if (
      view !== undefined &&
      gridConfig !== null &&
      this.#callbacks.onApplyFilter !== undefined &&
      filterOperatorsForField(field).length > 0
    ) {
      items.push({
        label: this.#translate('field.menu.filter'),
        icon: 'tool-filter',
        action: () => {
          this.#filterSeedFieldId = field.id;
          this.#openPanel = 'filter';
          this.#rerenderSelf();
        },
      });
    }
    if (
      view !== undefined &&
      gridConfig !== null &&
      this.#callbacks.onApplyDisplay !== undefined &&
      !isPrimary
    ) {
      items.push('separator', {
        label: this.#translate('field.menu.hide'),
        icon: 'field-hide',
        action: () =>
          void this.#callbacks.onApplyDisplay?.(view.id, {
            projection: gridConfig.projection.filter((fieldId) => fieldId !== field.id),
            columnOrder: gridConfig.columnOrder.filter((fieldId) => fieldId !== field.id),
            columnWidths: gridConfig.columnWidths,
            frozenFieldIds: gridConfig.frozenFieldIds.filter((fieldId) => fieldId !== field.id),
            rowHeight: gridConfig.rowHeight,
          }),
      });
    }
    if (this.#callbacks.onFieldDelete !== undefined) {
      items.push('separator', {
        label: this.#translate('field.menu.delete'),
        icon: 'menu-delete',
        danger: true,
        disabled: isPrimary,
        action: () =>
          void this.#requestDangerousConfirmation(
            this.#translate('field.menu.deleteConfirm').replace('{name}', field.name),
            this.#container,
          ).then((confirmed) => {
            if (confirmed) void this.#callbacks.onFieldDelete?.(field.id);
          }),
      });
    }
    if (items.length === 0) return;
    openContextMenu({
      items,
      x,
      y,
      host: this.#container,
      label: this.#translate('grid.menu.column'),
    });
  }

  #openFieldEditorPanel(
    context: FieldSaveContext,
    x: number,
    y: number,
    trigger?: HTMLElement,
    field?: Field,
  ): void {
    openFieldEditor({
      mode: context.mode,
      ...(context.mode === 'edit' && field !== undefined ? { field } : {}),
      x,
      y,
      host: this.#container,
      translate: this.#translate,
      ...(trigger === undefined ? {} : { trigger }),
      onSubmit: async (input) => {
        await this.#callbacks.onFieldSave?.(input, context);
      },
    });
  }

  #openConvertPanel(field: Field, x: number, y: number): void {
    if (
      this.#callbacks.onConversionPreview === undefined ||
      this.#callbacks.onConvertField === undefined
    ) {
      return;
    }
    const onPreview = this.#callbacks.onConversionPreview;
    const onConvert = this.#callbacks.onConvertField;
    openFieldConverter({
      field,
      x,
      y,
      host: this.#container,
      translate: this.#translate,
      onPreview: (fieldId, type) => onPreview(fieldId, type),
      onConvert: (fieldId, request) => onConvert(fieldId, request),
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
    if (this.#callbacks.onDuplicateRecord !== undefined) {
      items.push(this.#recordDuplicateMenuItem(record));
    }
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

  #recordDuplicateMenuItem(record: LoomTableRecord): ContextMenuItem {
    const gridState = this.#virtualGrid?.state;
    return {
      label: this.#translate('record.duplicate.action'),
      icon: 'menu-duplicate',
      disabled: gridState?.status === 'offline',
      action: () => void this.#callbacks.onDuplicateRecord?.(record.id),
    };
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
      // Deletion is recoverable through the deleted-records panel and the
      // undo notice, so it applies immediately without a confirmation step.
      action: () => void this.#callbacks.onDeleteRecord?.(record.id),
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
    const finish = (commit: boolean, moveOffset = 0, advance = false): void => {
      if (finished) return;
      finished = true;
      if (!commit) {
        if (record.id === DRAFT_RECORD_ID) {
          this.#cancelDraftCreate();
          return;
        }
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
      const normalized = normalizeCellValue(field, value);
      if (record.id === DRAFT_RECORD_ID) {
        this.#finishDraftCell(
          field.id,
          normalized.ok ? normalized.value : value,
          fieldIndex,
          advance ? moveOffset || 1 : null,
        );
        return;
      }
      if (normalized.ok && jsonEqual(normalized.value, record.values[field.id])) {
        if (moveOffset !== 0) {
          const state = this.#virtualGrid?.state ?? this.#emptyState();
          this.#focusedCellKey = null;
          this.render(state);
          this.#focusAdjacentCell(rowIndex, fieldIndex, moveOffset, true);
        }
        return;
      }
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
        if (keyboardEvent.altKey && editor instanceof HTMLTextAreaElement) {
          // Alt+Enter inserts a line break inside multiline editors; plain
          // Enter (and Ctrl/Cmd+Enter) commits the edit.
          const start = editor.selectionStart;
          editor.value = `${editor.value.slice(0, start)}\n${editor.value.slice(editor.selectionEnd)}`;
          editor.selectionStart = editor.selectionEnd = start + 1;
        } else {
          finish(true, 0, true);
        }
      } else if (keyboardEvent.key === 'Tab' && !composing && !keyboardEvent.isComposing) {
        keyboardEvent.preventDefault();
        finish(true, keyboardEvent.shiftKey ? -1 : 1, true);
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
      unfilteredTotal: null,
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
      serverHistory: [],
      serverHistoryStatus: 'idle',
      serverHistoryNextCursor: null,
      serverHistoryHasMore: false,
      serverHistoryError: null,
      historyEntries: [],
      fieldAggregations: {},
      aggregateResults: null,
      aggregateStatus: 'idle',
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
    this.#focusCellAt(targetRow, targetField);
  }

  #selectCell(rowIndex: number, fieldIndex: number, extend: boolean): void {
    if (extend && this.#selection !== null) {
      this.#selection = {
        anchor: this.#selection.anchor,
        head: { rowIndex, fieldIndex },
      };
    } else {
      this.#selection = {
        anchor: { rowIndex, fieldIndex },
        head: { rowIndex, fieldIndex },
      };
    }
    this.#selectedRows.clear();
    this.#applySelection();
  }

  #selectRow(rowIndex: number): void {
    const grid = this.#virtualGrid;
    if (grid === null || grid.fields.length === 0) return;
    this.#selection = {
      anchor: { rowIndex, fieldIndex: 0 },
      head: { rowIndex, fieldIndex: grid.fields.length - 1 },
    };
    this.#selectedRows = new Set([rowIndex]);
    this.#rowAnchorIndex = rowIndex;
    this.#applySelection();
  }

  #selectRowRange(from: number, to: number): void {
    const grid = this.#virtualGrid;
    if (grid === null || grid.fields.length === 0) return;
    const top = Math.min(from, to);
    const bottom = Math.max(from, to);
    this.#selection = {
      anchor: { rowIndex: top, fieldIndex: 0 },
      head: { rowIndex: bottom, fieldIndex: grid.fields.length - 1 },
    };
    this.#selectedRows = new Set<number>();
    for (let index = top; index <= bottom; index += 1) this.#selectedRows.add(index);
    this.#applySelection();
  }

  #toggleRowSelected(rowIndex: number, extend = false): void {
    const grid = this.#virtualGrid;
    if (grid === null || grid.fields.length === 0) return;
    if (extend && this.#rowAnchorIndex !== null) {
      this.#selectRowRange(this.#rowAnchorIndex, rowIndex);
      return;
    }
    const next = new Set(this.#selectedRows);
    if (next.has(rowIndex)) {
      next.delete(rowIndex);
    } else {
      next.add(rowIndex);
      this.#rowAnchorIndex = rowIndex;
    }
    this.#selectedRows = next;
    this.#selection = null;
    this.#applySelection();
  }

  #isRowSelected(rowIndex: number): boolean {
    if (this.#selectedRows.has(rowIndex)) return true;
    const grid = this.#virtualGrid;
    const rect = this.#selectionRect();
    return (
      rect !== null &&
      grid !== null &&
      rect.left === 0 &&
      rect.right === grid.fields.length - 1 &&
      rowIndex >= rect.top &&
      rowIndex <= rect.bottom
    );
  }

  #selectColumn(fieldIndex: number): void {
    const grid = this.#virtualGrid;
    if (grid === null || grid.state.records.length === 0) return;
    this.#selection = {
      anchor: { rowIndex: 0, fieldIndex },
      head: { rowIndex: grid.state.records.length - 1, fieldIndex },
    };
    this.#selectedRows.clear();
    this.#applySelection();
  }

  #selectAll(): void {
    const grid = this.#virtualGrid;
    if (grid === null || grid.fields.length === 0 || grid.state.records.length === 0) {
      return;
    }
    this.#selection = {
      anchor: { rowIndex: 0, fieldIndex: 0 },
      head: {
        rowIndex: grid.state.records.length - 1,
        fieldIndex: grid.fields.length - 1,
      },
    };
    this.#selectedRows = new Set(grid.state.records.map((_, index) => index));
    this.#rowAnchorIndex = 0;
    this.#applySelection();
  }

  #selectionRect(): {
    readonly top: number;
    readonly bottom: number;
    readonly left: number;
    readonly right: number;
  } | null {
    const selection = this.#selection;
    if (selection === null) return null;
    const grid = this.#virtualGrid;
    const lastRow = Math.max(0, (grid?.state.records.length ?? 1) - 1);
    const lastCol = Math.max(0, (grid?.fields.length ?? 1) - 1);
    return {
      top: Math.min(selection.anchor.rowIndex, selection.head.rowIndex),
      bottom: Math.min(Math.max(selection.anchor.rowIndex, selection.head.rowIndex), lastRow),
      left: Math.min(selection.anchor.fieldIndex, selection.head.fieldIndex),
      right: Math.min(Math.max(selection.anchor.fieldIndex, selection.head.fieldIndex), lastCol),
    };
  }

  #isCellSelected(rowIndex: number, fieldIndex: number): boolean {
    if (this.#selectedRows.has(rowIndex)) return true;
    const rect = this.#selectionRect();
    if (rect === null) return false;
    return (
      rowIndex >= rect.top &&
      rowIndex <= rect.bottom &&
      fieldIndex >= rect.left &&
      fieldIndex <= rect.right
    );
  }

  #applySelection(): void {
    const grid = this.#virtualGrid;
    if (grid === null) return;
    const rect = this.#selectionRect();
    const lastRow = grid.state.records.length - 1;
    grid.viewport.querySelectorAll<HTMLElement>('.loom-grid-cell').forEach((cell) => {
      const rowIndex = Number(cell.dataset.rowIndex);
      const fieldIndex = Number(cell.dataset.fieldIndex);
      cell.classList.toggle(
        'is-selected',
        this.#selectedRows.has(rowIndex) ||
          (rect !== null &&
            rowIndex >= rect.top &&
            rowIndex <= rect.bottom &&
            fieldIndex >= rect.left &&
            fieldIndex <= rect.right),
      );
    });
    grid.viewport
      .querySelectorAll<HTMLElement>('.loom-grid-row .loom-grid-index-cell')
      .forEach((indexCell) => {
        const row = indexCell.closest<HTMLElement>('.loom-grid-row');
        const rowIndex = Number(row?.dataset.rowIndex);
        const selected = this.#isRowSelected(rowIndex);
        indexCell.classList.toggle('is-selected', selected);
        const check = indexCell.querySelector<HTMLInputElement>('.loom-grid-row-check');
        if (check !== null) check.checked = selected;
      });
    grid.viewport
      .querySelectorAll<HTMLElement>('.loom-grid-header-cell[data-field-index]')
      .forEach((headerCell) => {
        const fieldIndex = Number(headerCell.dataset.fieldIndex);
        headerCell.classList.toggle(
          'is-selected',
          rect !== null &&
            fieldIndex >= rect.left &&
            fieldIndex <= rect.right &&
            rect.top === 0 &&
            rect.bottom === lastRow,
        );
      });
    const footerCount = this.#container.querySelector<HTMLElement>('.loom-grid-footer-count');
    if (footerCount !== null) {
      const base = `${grid.state.records.length} ${this.#translate('grid.rows')}`;
      footerCount.textContent =
        this.#selectedRows.size > 1
          ? `${base} · ${this.#translate('grid.selectedRows').replace('{count}', String(this.#selectedRows.size))}`
          : rect !== null && (rect.bottom - rect.top + 1) * (rect.right - rect.left + 1) > 1
            ? `${base} · ${this.#translate('grid.selectedCount').replace('{count}', String((rect.bottom - rect.top + 1) * (rect.right - rect.left + 1)))}`
            : base;
    }
  }

  #copySelection(): void {
    const grid = this.#virtualGrid;
    const rect = this.#selectionRect();
    if (grid === null || rect === null) return;
    const host = this.#clipboardHost();
    if (host === null) {
      this.#announceClipboard(this.#translate('grid.clipboard.failed'));
      return;
    }
    const lines: string[] = [];
    for (let rowIndex = rect.top; rowIndex <= rect.bottom; rowIndex += 1) {
      const record = grid.state.records[rowIndex];
      const cells: string[] = [];
      for (let fieldIndex = rect.left; fieldIndex <= rect.right; fieldIndex += 1) {
        const field = grid.fields[fieldIndex];
        cells.push(
          record === undefined || field === undefined
            ? ''
            : (serializeCellForClipboard(field, record.values[field.id]) ?? ''),
        );
      }
      lines.push(cells.join('\t'));
    }
    void host.writeText(lines.join('\n')).then(
      () => this.#announceClipboard(this.#translate('grid.clipboard.copied')),
      () => this.#announceClipboard(this.#translate('grid.clipboard.failed')),
    );
  }

  #clearDropTargets(): void {
    this.#container
      .querySelectorAll('.loom-grid-header-cell.is-drop-target')
      .forEach((cell) => cell.classList.remove('is-drop-target'));
  }

  #clearRowDropTargets(): void {
    this.#container
      .querySelectorAll('.loom-grid-row.is-drop-target')
      .forEach((row) => row.classList.remove('is-drop-target'));
  }

  #moveColumn(fromFieldId: string, toFieldId: string): void {
    const state = this.#lastState;
    const gridView = state === null ? null : selectedGridView(state);
    if (gridView === null || this.#callbacks.onApplyDisplay === undefined) return;
    const config = gridView.config;
    const order = [...config.columnOrder];
    const fromIndex = order.indexOf(fromFieldId);
    const toIndex = order.indexOf(toFieldId);
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return;
    const moved = order.splice(fromIndex, 1)[0];
    if (moved === undefined) return;
    order.splice(toIndex, 0, moved);
    void this.#callbacks.onApplyDisplay(gridView.id, {
      projection: config.projection,
      columnOrder: order,
      columnWidths: config.columnWidths,
      frozenFieldIds: config.frozenFieldIds,
      rowHeight: config.rowHeight,
    });
  }

  #previewColumnWidth(fieldId: string, width: number): void {
    const grid = this.#virtualGrid;
    if (grid === null) return;
    const base = [
      `${GRID_INDEX_COLUMN_WIDTH}px`,
      ...grid.fields.map(
        (field) =>
          `${field.id === fieldId ? width : (grid.columns.widths.get(field.id) ?? GRID_COLUMN_WIDTH_DEFAULT)}px`,
      ),
    ].join(' ');
    // The header carries the trailing add-field cell; body rows do not.
    const headerTemplate = this.#callbacks.onFieldSave !== undefined ? `${base} 2.5rem` : base;
    grid.viewport.querySelectorAll<HTMLElement>('.loom-grid-header').forEach((row) => {
      row.style.gridTemplateColumns = headerTemplate;
    });
    grid.viewport
      .querySelectorAll<HTMLElement>('.loom-grid-row, .loom-grid-draft-row')
      .forEach((row) => {
        row.style.gridTemplateColumns = base;
      });
  }

  #commitColumnWidth(field: Field, width: number): void {
    const state = this.#lastState;
    const gridView = state === null ? null : selectedGridView(state);
    if (gridView === null || this.#callbacks.onApplyDisplay === undefined) return;
    const config = gridView.config;
    void this.#callbacks.onApplyDisplay(gridView.id, {
      projection: config.projection,
      columnOrder: config.columnOrder,
      columnWidths: { ...config.columnWidths, [field.id]: width },
      frozenFieldIds: config.frozenFieldIds,
      rowHeight: config.rowHeight,
    });
  }

  #focusCellAt(targetRow: number, targetField: number): void {
    const grid = this.#virtualGrid;
    if (grid === null) return;
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
    iconOnly = false,
  ): HTMLButtonElement {
    const element = createElement(
      'button',
      iconOnly ? 'loom-action-icon clickable-icon' : 'loom-button',
    );
    element.type = 'button';
    element.textContent = iconOnly ? '' : this.#translate(labelKey);
    if (icon !== undefined) element.prepend(createUiIcon(icon));
    element.setAttribute('aria-label', this.#translate(labelKey));
    element.addEventListener('click', () => {
      if (element.disabled) return;
      this.#focusedAction = action;
      element.focus();
      this.#runAction(action, operation);
    });
    this.#actionButtons.set(element, { action, labelKey, pendingKey, icon, iconOnly });
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
      element.disabled =
        pending ||
        (spec.action === 'refresh' && (offline || loading)) ||
        (spec.action === 'undo' && state?.canUndo === false) ||
        (spec.action === 'redo' && state?.canRedo === false);
      element.textContent = spec.iconOnly === true ? '' : label;
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

function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || a === undefined || b === null || b === undefined) {
    return (a === null || a === undefined) && (b === null || b === undefined);
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((entry, index) => jsonEqual(entry, b[index]));
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    return (
      aKeys.length === bKeys.length &&
      aKeys.every((key) =>
        jsonEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
      )
    );
  }
  return false;
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

function aggregateFnsForField(field: Field): readonly AggregateFn[] {
  if (field.type === 'number') return ['count', 'sum', 'avg', 'min', 'max'];
  if (field.type === 'date') return ['count', 'min', 'max'];
  return ['count'];
}

function formatAggregateValue(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

const RECORD_DRAG_MIME = 'application/x-loom-record';

function manualOrderEnabled(state: GridState | undefined): boolean {
  if (state === undefined) return false;
  const view = selectedGridView(state);
  return view !== null && view.config.manualSort === true && view.config.sort.length === 0;
}
