import type { Translator } from '../i18n';
import type { Field, JsonValue, LoomTableRecord } from '../client/loomtable-client';
import type { GridState, GridStatus } from './grid-view-controller';

export interface GridRendererCallbacks {
  readonly onRefresh: () => void | Promise<void>;
  readonly onWorkspaceChange: (workspaceId: string) => void | Promise<void>;
  readonly onBaseChange: (baseId: string) => void | Promise<void>;
  readonly onTableChange: (tableId: string) => void | Promise<void>;
  readonly onViewChange: (viewId: string) => void | Promise<void>;
  readonly onLoadMore: () => void | Promise<void>;
  readonly onRecordOpen: (record: LoomTableRecord) => void;
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

  constructor(container: HTMLElement, translate: Translator, callbacks: GridRendererCallbacks) {
    this.#container = container;
    this.#translate = translate;
    this.#callbacks = callbacks;
  }

  render(state: GridState): void {
    this.#virtualGrid = null;
    const root = createElement('div', 'loom-grid-shell');
    root.append(this.#renderToolbar(state), this.#renderNavigation(state));

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

    this.#container.replaceChildren(root);
  }

  #renderToolbar(state: GridState): HTMLElement {
    const toolbar = createElement('div', 'loom-grid-toolbar');
    const title = createElement('div', 'loom-grid-toolbar-title');
    title.append(createTextElement('strong', this.#translate('grid.view')));
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
    toolbar.append(title, refresh);
    return toolbar;
  }

  #renderNavigation(state: GridState): HTMLElement {
    const navigation = createElement('div', 'loom-grid-navigation');
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
    header.style.gridTemplateColumns = columnTemplate;
    header.append(createGridCell('#', 'loom-grid-header-cell'));
    for (const field of fields) header.append(createGridCell(field.name, 'loom-grid-header-cell'));

    const viewport = createElement('div', 'loom-grid-viewport');
    viewport.tabIndex = 0;
    viewport.setAttribute('role', 'grid');
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
  }

  #renderRow(
    record: LoomTableRecord,
    rowIndex: number,
    fields: readonly Field[],
    rowHeight: number,
  ): HTMLElement {
    const row = createElement('div', 'loom-grid-row');
    row.setAttribute('role', 'row');
    row.tabIndex = 0;
    row.dataset.rowIndex = String(rowIndex);
    row.style.gridTemplateColumns = columnTemplateFor(fields, this.#virtualGrid?.state);
    row.style.height = `${rowHeight}px`;
    row.title = this.#translate('grid.openDetails');

    const indexCell = createElement('div', 'loom-grid-index-cell');
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
    row.append(indexCell);

    for (const field of fields) {
      const cell = createGridCell(
        formatCellValue(record.values[field.id], field),
        'loom-grid-cell',
      );
      cell.setAttribute('role', 'gridcell');
      cell.setAttribute('aria-readonly', 'true');
      cell.dataset.fieldId = field.id;
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
        this.#focusAdjacentRow(rowIndex, event.key === 'ArrowDown' ? 1 : -1);
      }
    });
    return row;
  }

  #focusAdjacentRow(rowIndex: number, offset: number): void {
    const grid = this.#virtualGrid;
    if (grid === null) return;
    const targetIndex = Math.max(0, Math.min(grid.state.records.length - 1, rowIndex + offset));
    const target = grid.rowLayer.querySelector<HTMLElement>(`[data-row-index="${targetIndex}"]`);
    if (target !== null) {
      target.focus();
      return;
    }
    grid.viewport.scrollTop = targetIndex * grid.rowHeight;
    this.#renderVirtualRows();
    grid.rowLayer.querySelector<HTMLElement>(`[data-row-index="${targetIndex}"]`)?.focus();
  }

  #renderStatus(status: GridStatus, state: GridState): HTMLElement {
    const statusBox = createElement('div', `loom-status loom-grid-status is-${status}`);
    const message = statusMessage(status, state, this.#translate);
    statusBox.append(createTextElement('p', message));
    if (state.error?.requestId !== undefined) {
      statusBox.append(createTextElement('small', `Request ID: ${state.error.requestId}`));
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

function formatCellValue(value: JsonValue | undefined, field: Field): string {
  if (value === undefined || value === null) return '—';
  if (field.type === 'checkbox' && typeof value === 'boolean') return value ? '✓' : '—';
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
    if (typeof value.label === 'string') return value.label;
    if (typeof value.address === 'string') return value.address;
    return formatCoordinates(value) ?? '—';
  }
  return JSON.stringify(value);
}

function formatCoordinates(value: Readonly<Record<string, JsonValue>>): string | null {
  const lat = value.lat;
  const lng = value.lng;
  return typeof lat === 'number' && typeof lng === 'number' ? `${lat}, ${lng}` : null;
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
  if (status === 'server-error') return state.error?.message ?? translate('grid.error.server');
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

function createTextElement<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  text: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tagName);
  element.textContent = text;
  return element;
}
