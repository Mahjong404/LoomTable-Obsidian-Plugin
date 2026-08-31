import type { Translator } from '../i18n';
import type { MessageKey } from '../i18n/messages';
import type { Field, JsonValue, LoomTableRecord } from '../client/loomtable-client';
import type { GridConflict, GridState, GridStatus } from './grid-view-controller';
import { editorTextValue, isEditableField } from './field-value-editor';
import { renderSaveStatus } from './save-status';
import { confirmDangerousAction } from './dangerous-action-confirmation';

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
}

type GridAction = 'refresh' | 'settings';

interface GridActionButtonSpec {
  readonly action: GridAction;
  readonly labelKey: MessageKey;
  readonly pendingKey: MessageKey;
}

interface VirtualGridRefs {
  readonly viewport: HTMLElement;
  readonly rowLayer: HTMLElement;
  readonly state: GridState;
  readonly fields: readonly Field[];
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
  #virtualGrid: VirtualGridRefs | null = null;
  #focusedCellKey: string | null = null;
  #focusedCellPosition: { readonly rowIndex: number; readonly fieldIndex: number } | null = null;
  #lastConflictIds = new Set<string>();
  #lastState: GridState | null = null;
  #dismissedEditDraftKey: string | null = null;
  readonly #pendingActions = new Set<GridAction>();
  readonly #actionButtons = new Map<HTMLButtonElement, GridActionButtonSpec>();
  #focusedAction: GridAction | null = null;

  constructor(container: HTMLElement, translate: Translator, callbacks: GridRendererCallbacks) {
    this.#container = container;
    this.#translate = translate;
    this.#callbacks = callbacks;
  }

  render(state: GridState): void {
    this.#lastState = state;
    this.#virtualGrid = null;
    this.#actionButtons.clear();
    const root = createElement('div', 'loom-grid-shell');
    root.setAttribute('role', 'region');
    root.setAttribute('aria-label', this.#translate('grid.table'));
    root.tabIndex = -1;
    root.append(this.#renderToolbar(state), this.#renderNavigation(state));
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
    this.#container.replaceChildren(root);
    this.#syncActionButtons();
    if (hasNewConflict) {
      this.#container.querySelector<HTMLElement>('.loom-grid-conflicts')?.focus();
    } else if (this.#restoreFailedEditDraft(state)) {
      return;
    } else if (this.#focusedAction !== null) {
      this.#restoreFocusedAction();
    } else {
      const restored = this.#restoreFocusedCell();
      if (this.#focusedCellKey !== null && !restored) this.#focusGridFallback();
    }
  }

  #renderToolbar(state: GridState): HTMLElement {
    const toolbar = createElement('div', 'loom-grid-toolbar');
    toolbar.setAttribute('role', 'toolbar');
    toolbar.setAttribute('aria-label', this.#translate('grid.status'));
    const title = createElement('div', 'loom-grid-toolbar-title');
    title.append(createTextElement('h2', this.#translate('grid.view')));
    if (state.totalCount !== null) {
      title.append(
        createTextElement('span', `${state.totalCount} ${this.#translate('grid.rows')}`),
      );
    } else if (state.records.length > 0) {
      title.append(
        createTextElement('span', `${state.records.length} ${this.#translate('grid.rows')}`),
      );
    }
    const refresh = this.#createActionButton('refresh', 'grid.refresh', 'grid.refreshing', () =>
      this.#callbacks.onRefresh(),
    );
    const saveStatus = createElement('span', 'loom-save-status');
    renderSaveStatus(saveStatus, state.saveStatus, this.#translate);
    toolbar.append(title, saveStatus, refresh);
    return toolbar;
  }

  #renderNavigation(state: GridState): HTMLElement {
    const navigation = createElement('div', 'loom-grid-navigation');
    navigation.setAttribute('role', 'group');
    navigation.setAttribute('aria-label', this.#translate('grid.status'));
    navigation.append(
      this.#renderSelect(
        'grid.workspace',
        state.workspaces,
        state.selectedWorkspaceId,
        (value) => void this.#callbacks.onWorkspaceChange(value),
      ),
      this.#renderSelect(
        'grid.base',
        state.bases,
        state.selectedBaseId,
        (value) => void this.#callbacks.onBaseChange(value),
      ),
      this.#renderSelect(
        'grid.table',
        state.tables,
        state.selectedTableId,
        (value) => void this.#callbacks.onTableChange(value),
      ),
      this.#renderSelect(
        'grid.view',
        state.views,
        state.selectedViewId,
        (value) => void this.#callbacks.onViewChange(value),
      ),
    );
    return navigation;
  }

  #renderSelect<T extends { id: string; name: string }>(
    labelKey: 'grid.workspace' | 'grid.base' | 'grid.table' | 'grid.view',
    resources: readonly T[],
    selectedId: string | null,
    onChange: (value: string) => void,
  ): HTMLElement {
    const label = createElement('label', 'loom-grid-select');
    label.append(document.createTextNode(this.#translate(labelKey)));
    const select = document.createElement('select');
    select.setAttribute('aria-label', this.#translate(labelKey));
    for (const resource of resources) {
      const option = document.createElement('option');
      option.value = resource.id;
      option.textContent = resource.name;
      option.selected = resource.id === selectedId;
      select.append(option);
    }
    select.disabled = resources.length === 0;
    select.addEventListener('change', () => onChange(select.value));
    label.append(select);
    return label;
  }

  #renderGrid(state: GridState): HTMLElement {
    const wrapper = createElement('div', 'loom-grid-wrapper');
    const fields = orderedFields(state);
    const rowHeight = rowHeightPixels(state);
    const columnTemplate = columnTemplateFor(fields, state);

    const header = createElement('div', 'loom-grid-header');
    header.setAttribute('role', 'row');
    header.style.gridTemplateColumns = columnTemplate;
    const indexHeader = createGridCell('#', 'loom-grid-header-cell');
    indexHeader.setAttribute('role', 'columnheader');
    indexHeader.setAttribute('aria-colindex', '1');
    indexHeader.setAttribute('aria-label', this.#translate('grid.rows'));
    header.append(indexHeader);
    for (const [fieldIndex, field] of fields.entries()) {
      const fieldHeader = createGridCell(field.name, 'loom-grid-header-cell');
      fieldHeader.setAttribute('role', 'columnheader');
      fieldHeader.setAttribute('aria-colindex', String(fieldIndex + 2));
      header.append(fieldHeader);
    }

    const viewport = createElement('div', 'loom-grid-viewport');
    viewport.tabIndex = 0;
    viewport.setAttribute('role', 'grid');
    viewport.setAttribute('aria-label', this.#translate('grid.table'));
    viewport.setAttribute('aria-rowcount', String(state.records.length + 1));
    viewport.setAttribute('aria-colcount', String(fields.length + 1));
    const canvas = createElement('div', 'loom-grid-canvas');
    canvas.style.height = `${state.records.length * rowHeight}px`;
    const rowLayer = createElement('div', 'loom-grid-row-layer');
    canvas.append(rowLayer);
    viewport.append(canvas);
    this.#virtualGrid = { viewport, rowLayer, state, fields, rowHeight };
    viewport.addEventListener('scroll', () => this.#renderVirtualRows());
    this.#renderVirtualRows();

    wrapper.append(header, viewport);
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
    box.setAttribute('aria-label', this.#translate('grid.diagnostic.conflict'));
    box.tabIndex = -1;
    box.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      this.#container.querySelector<HTMLElement>('.loom-grid-shell')?.focus();
    });
    for (const conflict of state.conflicts) {
      const item = createElement('div', 'loom-grid-conflict');
      item.setAttribute('role', 'group');
      item.setAttribute(
        'aria-label',
        this.#translate('grid.editConflict') + ': ' + conflict.recordId,
      );
      item.append(createTextElement('strong', this.#translate('grid.editConflict')));
      item.append(createTextElement('p', this.#translate('record.serverValue')));
      const values = createElement('pre', 'loom-grid-conflict-values');
      values.setAttribute('aria-label', this.#translate('record.serverValue'));
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
      intent.setAttribute('aria-label', this.#translate('record.localIntent'));
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
    grid.rowLayer.replaceChildren();
    for (let rowIndex = range.start; rowIndex < range.end; rowIndex += 1) {
      const record = grid.state.records[rowIndex];
      if (record === undefined) continue;
      grid.rowLayer.append(this.#renderRow(record, rowIndex, grid.fields, grid.rowHeight));
    }
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
    row.style.gridTemplateColumns = columnTemplateFor(fields, this.#virtualGrid?.state);
    row.style.height = rowHeight + 'px';
    row.style.top = rowIndex * rowHeight + 'px';
    row.title = this.#translate('grid.openDetails');

    const indexCell = createElement('div', 'loom-grid-index-cell');
    indexCell.setAttribute('role', 'rowheader');
    indexCell.setAttribute('aria-colindex', '1');
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'loom-grid-open';
    open.setAttribute('aria-label', this.#translate('grid.openDetails'));
    open.title = this.#translate('grid.openDetails');
    open.textContent = '↗';
    open.addEventListener('click', (event) => {
      event.stopPropagation();
      this.#callbacks.onRecordOpen(record);
    });
    indexCell.append(document.createTextNode(String(rowIndex + 1)), open);
    row.append(indexCell);

    for (const [fieldIndex, field] of fields.entries()) {
      const displayValue = formatCellValue(record.values[field.id], field, this.#translate);
      const cell = createGridCell(displayValue, 'loom-grid-cell');
      cell.setAttribute('role', 'gridcell');
      cell.setAttribute('aria-colindex', String(fieldIndex + 2));
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
      cell.setAttribute('aria-label', field.name + ': ' + displayValue);
      if (editStatus !== undefined) cell.dataset.editState = editStatus;
      cell.addEventListener('focus', () => {
        this.#rememberCell(cell.dataset.focusKey ?? '', rowIndex, fieldIndex);
      });
      cell.addEventListener('click', (event) => {
        event.stopPropagation();
        this.#rememberCell(cell.dataset.focusKey ?? '', rowIndex, fieldIndex);
        if (isEditableField(field) && canEdit) {
          this.#beginCellEdit(cell, record, field, rowIndex, fieldIndex);
        }
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
        if (event.key !== 'Enter') return;
        event.preventDefault();
        if (isEditableField(field) && canEdit) {
          this.#beginCellEdit(cell, record, field, rowIndex, fieldIndex);
        } else {
          this.#callbacks.onRecordOpen(record);
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

  #beginCellEdit(
    cell: HTMLElement,
    record: LoomTableRecord,
    field: Field,
    rowIndex: number,
    fieldIndex: number,
    initialValue: unknown = record.values[field.id],
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
    const editor = createEditor(field, initialValue, this.#translate);
    editor.classList.add('loom-grid-editor');
    editor.setAttribute('aria-label', field.name);
    cell.replaceChildren(editor);
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
    if (editor instanceof HTMLInputElement || editor instanceof HTMLTextAreaElement) {
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
      emptyReason: null,
      error: null,
      editStatuses: {},
      conflicts: [],
      editError: null,
      editDrafts: [],
      editErrorRecordId: null,
      saveStatus: 'saved',
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
    target.focus();
    return true;
  }

  #focusGridFallback(): void {
    const fallback =
      this.#container.querySelector<HTMLElement>('.loom-grid-status') ??
      this.#container.querySelector<HTMLElement>('.loom-grid-shell');
    fallback?.focus();
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
    const action = this.#renderStatusAction(status);
    statusBox.append(createTextElement('p', message), ...(action === null ? [] : [action]));
    if (state.error !== null) {
      statusBox.append(
        renderDiagnostic(this.#translate('grid.diagnostic.error'), errorDiagnostic(state.error)),
      );
    }
    return statusBox;
  }

  #renderStatusAction(status: GridStatus): HTMLButtonElement | null {
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
  ): HTMLButtonElement {
    const element = createElement('button', 'loom-button');
    element.type = 'button';
    element.textContent = this.#translate(labelKey);
    element.setAttribute('aria-label', this.#translate(labelKey));
    element.addEventListener('click', () => {
      if (element.disabled) return;
      this.#focusedAction = action;
      element.focus();
      this.#runAction(action, operation);
    });
    this.#actionButtons.set(element, { action, labelKey, pendingKey });
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
  const view = state.views.find((candidate) => candidate.id === state.selectedViewId);
  if (view?.type !== 'grid') return state.fields;
  const ids = view.config.columnOrder.length > 0 ? view.config.columnOrder : view.config.projection;
  if (ids.length === 0)
    return [...state.fields].sort((left, right) => left.position - right.position);
  const byId = new Map(state.fields.map((field) => [field.id, field]));
  return ids.flatMap((fieldId) => {
    const field = byId.get(fieldId);
    return field === undefined ? [] : [field];
  });
}

function columnTemplateFor(fields: readonly Field[], state?: GridState): string {
  const view = state?.views.find((candidate) => candidate.id === state.selectedViewId);
  const widths = view?.type === 'grid' ? view.config.columnWidths : {};
  const columns = fields.map((field) => `${clampColumnWidth(widths[field.id] ?? 180)}px`);
  return ['56px', ...columns].join(' ');
}

function rowHeightPixels(state: GridState): number {
  const view = state.views.find((candidate) => candidate.id === state.selectedViewId);
  if (view?.type !== 'grid') return 36;
  if (view.config.rowHeight === 'compact') return 30;
  if (view.config.rowHeight === 'comfortable') return 44;
  return 36;
}

function clampColumnWidth(width: number): number {
  return Math.max(80, Math.min(500, Math.round(width)));
}

function formatCellValue(
  value: JsonValue | undefined,
  field: Field,
  translate: Translator,
): string {
  if (value === undefined) {
    return field.type === 'location'
      ? translate('record.field.unset')
      : translate('common.emptyValue');
  }
  if (value === null) {
    return field.type === 'location'
      ? translate('record.field.cleared')
      : translate('common.emptyValue');
  }
  if (field.type === 'checkbox' && typeof value === 'boolean') {
    return value ? translate('grid.cell.checked') : translate('grid.cell.unchecked');
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (isJsonArray(value)) {
    return value
      .map((item) => {
        if (isAttachmentReference(item)) return item.filename;
        return typeof item === 'string' ? item : JSON.stringify(item);
      })
      .join(', ');
  }
  if (isLocationValue(value)) {
    const coordinates = locationCoordinates(value);
    if (coordinates === null) return translate('record.location.unlocated');
    if (Math.abs(coordinates.lat) > 85.0511287798066) {
      return translate('record.location.unrenderable');
    }
    if (typeof value.label === 'string') return value.label;
    if (typeof value.address === 'string') return value.address;
    return `${coordinates.lat}, ${coordinates.lng}`;
  }
  return JSON.stringify(value);
}

function locationCoordinates(
  value: Readonly<Record<string, JsonValue>>,
): { readonly lat: number; readonly lng: number } | null {
  const lat = value.lat;
  const lng = value.lng;
  return typeof lat === 'number' && typeof lng === 'number' ? { lat, lng } : null;
}

function isAttachmentReference(value: JsonValue): value is Readonly<Record<string, JsonValue>> & {
  readonly filename: string;
} {
  return isJsonObject(value) && typeof value.filename === 'string';
}

function isLocationValue(value: JsonValue): value is Readonly<Record<string, JsonValue>> {
  return isJsonObject(value);
}

function isJsonObject(value: JsonValue): value is Readonly<Record<string, JsonValue>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isJsonArray(value: JsonValue): value is readonly JsonValue[] {
  return Array.isArray(value);
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

function createEditor(
  field: Field,
  value: unknown,
  translate: Translator,
): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  if (field.type === 'longText') {
    const editor = document.createElement('textarea');
    editor.value = editorTextValue(value as JsonValue | undefined, field);
    return editor;
  }
  if (field.type === 'select') {
    const editor = document.createElement('select');
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = translate('common.emptyValue');
    editor.append(empty);
    for (const option of field.config.options) {
      const item = document.createElement('option');
      item.value = option.id;
      item.textContent = option.name;
      editor.append(item);
    }
    editor.value = typeof value === 'string' ? value : '';
    return editor;
  }
  if (field.type === 'checkbox') {
    const editor = document.createElement('input');
    editor.type = 'checkbox';
    editor.checked = value === true;
    return editor;
  }
  const editor = document.createElement('input');
  editor.type =
    field.type === 'number' || field.type === 'date' || field.type === 'url' ? field.type : 'text';
  editor.value = editorTextValue(value as JsonValue | undefined, field);
  return editor;
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

