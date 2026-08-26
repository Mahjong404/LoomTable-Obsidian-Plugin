import type { Translator } from '../i18n';
import type { Field, JsonValue, LoomTableRecord } from '../client/loomtable-client';
import type { GridState, GridStatus } from './grid-view-controller';
import { editorTextValue, isEditableField } from './field-value-editor';
import { renderSaveStatus } from './save-status';

export interface GridRendererCallbacks {
  readonly onRefresh: () => void | Promise<void>;
  readonly onWorkspaceChange: (workspaceId: string) => void | Promise<void>;
  readonly onBaseChange: (baseId: string) => void | Promise<void>;
  readonly onTableChange: (tableId: string) => void | Promise<void>;
  readonly onViewChange: (viewId: string) => void | Promise<void>;
  readonly onLoadMore: () => void | Promise<void>;
  readonly onRecordOpen: (record: LoomTableRecord) => void;
  readonly onCellEdit?: (recordId: string, fieldId: string, value: unknown) => void | Promise<void>;
  readonly onConflictAction?: (recordId: string, action: 'use-server' | 'overwrite') => void;
  readonly onRetryEdit?: (recordId: string) => void;
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

  constructor(container: HTMLElement, translate: Translator, callbacks: GridRendererCallbacks) {
    this.#container = container;
    this.#translate = translate;
    this.#callbacks = callbacks;
  }

  render(state: GridState): void {
    this.#virtualGrid = null;
    const root = createElement('div', 'loom-grid-shell');
    root.setAttribute('role', 'region');
    root.setAttribute('aria-label', this.#translate('grid.table'));
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
    const hasNewConflict = [...conflictIds].some((recordId) => !this.#lastConflictIds.has(recordId));
    this.#lastConflictIds = conflictIds;
    this.#container.replaceChildren(root);
    if (hasNewConflict) {
      this.#container.querySelector<HTMLElement>('.loom-grid-conflicts')?.focus();
    } else {
      this.#restoreFocusedCell();
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
    const refresh = createElement('button', 'loom-button');
    refresh.type = 'button';
    refresh.textContent = this.#translate('grid.refresh');
    refresh.disabled = state.status === 'loading';
    refresh.addEventListener('click', () => void this.#callbacks.onRefresh());
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
    status.setAttribute('role', 'alert');
    status.setAttribute('aria-live', 'assertive');
    status.append(createTextElement('p', this.#translate('grid.editError')));
    if (state.editError !== null) {
      status.append(
        renderDiagnostic(
          this.#translate('grid.diagnostic.error'),
          errorDiagnostic(state.editError),
        ),
      );
    }
    const failedRecordId = Object.entries(state.editStatuses).find(
      ([, status]) => status === 'error',
    )?.[0];
    if (failedRecordId !== undefined) {
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
    box.setAttribute('aria-label', this.#translate('grid.diagnostic.conflict'));
    box.tabIndex = -1;
    for (const conflict of state.conflicts) {
      const item = createElement('div', 'loom-grid-conflict');
      item.setAttribute(
        'role',
        'group',
      );
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
        renderDiagnostic(
          this.#translate('common.openDiagnostics'),
          conflictDiagnostic(conflict),
        ),
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
      overwrite.className = 'loom-button mod-warning';
      overwrite.textContent = this.#translate('grid.overwrite');
      overwrite.addEventListener('click', () =>
        this.#callbacks.onConflictAction?.(conflict.recordId, 'overwrite'),
      );
      actions.append(useServer, overwrite);
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
      const canEdit = gridState?.status === 'ready';
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
      const editStatus = gridState?.editStatuses[record.id];
      if (editStatus !== undefined) cell.dataset.editState = editStatus;
      cell.addEventListener('focus', () => {
        this.#rememberCell(
          cell.dataset.focusKey ?? '',
          rowIndex,
          fieldIndex,
        );
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
        const keyboard = event as KeyboardEvent;
        if (keyboard.key === 'ArrowDown' || keyboard.key === 'ArrowUp') {
          keyboard.preventDefault();
          this.#focusAdjacentCell(rowIndex, fieldIndex, keyboard.key === 'ArrowDown' ? 1 : -1);
          return;
        }
        if (keyboard.key === 'ArrowRight' || keyboard.key === 'ArrowLeft') {
          keyboard.preventDefault();
          this.#focusAdjacentCell(
            rowIndex,
            fieldIndex,
            keyboard.key === 'ArrowRight' ? 1 : -1,
            true,
          );
          return;
        }
        if (keyboard.key !== 'Enter') return;
        keyboard.preventDefault();
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
  ): void {
    if (
      !isEditableField(field) ||
      this.#virtualGrid?.state.status !== 'ready' ||
      this.#virtualGrid?.state.editStatuses[record.id] === 'conflict'
    ) {
      return;
    }
    if (cell.querySelector('input, textarea, select') !== null) return;

    this.#rememberCell(cell.dataset.focusKey ?? '', rowIndex, fieldIndex);
    const editor = createEditor(field, record.values[field.id], this.#translate);
    editor.classList.add('loom-grid-editor');
    editor.setAttribute('aria-label', field.name);
    cell.replaceChildren(editor);
    let composing = false;
    let finished = false;
    const finish = (commit: boolean, moveOffset = 0): void => {
      if (finished) return;
      finished = true;
      if (!commit) {
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
      } else if (keyboardEvent.key === 'Enter' && !composing) {
        keyboardEvent.preventDefault();
        finish(true);
      } else if (keyboardEvent.key === 'Tab' && !composing) {
        keyboardEvent.preventDefault();
        finish(true, keyboardEvent.shiftKey ? -1 : 1);
      }
    });
    editor.focus();
    if (editor instanceof HTMLInputElement || editor instanceof HTMLTextAreaElement) {
      editor.select?.();
    }
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

  #restoreFocusedCell(): void {
    const grid = this.#virtualGrid;
    if (grid === null || this.#focusedCellKey === null) return;
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
        return;
      }
      this.#focusedCellPosition = { rowIndex, fieldIndex };
      this.#focusedCellKey = target.dataset.focusKey ?? this.#focusedCellKey;
    }
    target?.focus();
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
    const message = statusMessage(status, state, this.#translate);
    statusBox.append(createTextElement('p', message));
    if (state.error !== null) {
      statusBox.append(
        renderDiagnostic(
          this.#translate('grid.diagnostic.error'),
          errorDiagnostic(state.error),
        ),
      );
    }
    return statusBox;
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
    return field.type === 'location' ? translate('record.field.unset') : translate('common.emptyValue');
  }
  if (value === null) {
    return field.type === 'location' ? translate('record.field.cleared') : translate('common.emptyValue');
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
  value: JsonValue | undefined,
  translate: Translator,
): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  if (field.type === 'longText') {
    const editor = document.createElement('textarea');
    editor.value = editorTextValue(value, field);
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
  editor.value = editorTextValue(value, field);
  return editor;
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
