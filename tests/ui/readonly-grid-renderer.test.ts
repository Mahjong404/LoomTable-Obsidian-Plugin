import { describe, expect, it, vi } from 'vitest';

import type {
  Field,
  GridViewConfig,
  JsonValue,
  LoomTableRecord,
  View,
} from '../../src/client/loomtable-client';
import { createTranslator } from '../../src/i18n';
import { ReadonlyGridRenderer, getVirtualRowRange } from '../../src/ui/readonly-grid-renderer';
import type { GridState } from '../../src/ui/grid-view-controller';

describe('ReadonlyGridRenderer', () => {
  it('renders only the fixed-height viewport window for a large result page', () => {
    const container = document.createElement('div');
    const callbacks = rendererCallbacks();
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), callbacks);

    renderer.render(createState(1_000));

    expect(container.querySelectorAll('.loom-grid-row')).toHaveLength(14);
    expect(container.querySelectorAll('.loom-grid-editable')).not.toHaveLength(0);
    expect(container.querySelector('.loom-grid-viewport')).not.toBeNull();
  });

  it('positions virtual rows at their vertical offsets', () => {
    const container = document.createElement('div');
    const renderer = new ReadonlyGridRenderer(
      container,
      createTranslator('en'),
      rendererCallbacks(),
    );

    renderer.render(createState(3));

    const rows = [...container.querySelectorAll<HTMLElement>('.loom-grid-row')];
    expect(rows.map((row) => row.style.top)).toEqual(['0px', '36px', '72px']);
  });

  it('exposes a keyboard detail entry for a read-only row', () => {
    const container = document.createElement('div');
    const callbacks = rendererCallbacks();
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), callbacks);

    renderer.render(createState(1));
    const row = container.querySelector<HTMLElement>('.loom-grid-row');
    row?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(callbacks.onRecordOpen).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'record_01' }),
    );
  });

  it('exposes semantic cells and moves focus with the arrow keys', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const renderer = new ReadonlyGridRenderer(
      container,
      createTranslator('en'),
      rendererCallbacks(),
    );

    renderer.render(createState(3));

    const grid = container.querySelector<HTMLElement>('[role="grid"]');
    const firstCell = container.querySelector<HTMLElement>(
      '.loom-grid-cell[data-record-id="record_01"]',
    );
    expect(grid?.getAttribute('aria-label')).toBe('Table');
    expect(firstCell?.getAttribute('role')).toBe('gridcell');
    expect(firstCell?.tabIndex).toBe(0);
    firstCell?.focus();
    firstCell?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));

    expect(document.activeElement).toBe(
      container.querySelector('.loom-grid-cell[data-record-id="record_02"]'),
    );
  });

  it('restores the focused business cell or clamps to the nearest row after redraw', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const renderer = new ReadonlyGridRenderer(
      container,
      createTranslator('en'),
      rendererCallbacks(),
    );

    renderer.render(createState(3));
    container.querySelector<HTMLElement>('.loom-grid-cell[data-record-id="record_02"]')?.focus();
    renderer.render(createState(1));

    expect(document.activeElement).toBe(
      container.querySelector('.loom-grid-cell[data-record-id="record_01"]'),
    );
  });

  it('moves focus to the Grid status when the focused Record disappears', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const renderer = new ReadonlyGridRenderer(
      container,
      createTranslator('en'),
      rendererCallbacks(),
    );

    renderer.render(createState(2));
    container.querySelector<HTMLElement>('.loom-grid-cell[data-record-id="record_02"]')?.focus();
    renderer.render(createState(0));

    expect(document.activeElement).toBe(container.querySelector('.loom-grid-status'));
  });

  it('commits Tab and Shift+Tab edits while keeping focus in the adjacent cell', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const callbacks = rendererCallbacks();
    const state = createTwoFieldState();
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), callbacks);

    renderer.render(state);
    const firstCell = container.querySelector<HTMLElement>(
      '.loom-grid-cell[data-field-id="field_name"]',
    );
    firstCell?.click();
    const firstEditor = container.querySelector<HTMLInputElement>('.loom-grid-editor');
    expect(firstEditor).not.toBeNull();
    firstEditor?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));

    expect(callbacks.onCellEdit).toHaveBeenCalledWith('record_01', 'field_name', 'Record 1');
    expect(document.activeElement).toBe(
      container.querySelector('.loom-grid-cell[data-field-id="field_second"]'),
    );

    container.querySelector<HTMLElement>('.loom-grid-cell[data-field-id="field_second"]')?.click();
    const secondEditor = container.querySelector<HTMLInputElement>('.loom-grid-editor');
    expect(secondEditor).not.toBeNull();
    secondEditor?.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Tab',
        shiftKey: true,
        bubbles: true,
      }),
    );

    expect(callbacks.onCellEdit).toHaveBeenCalledWith('record_01', 'field_second', 'Second value');
    expect(document.activeElement).toBe(
      container.querySelector('.loom-grid-cell[data-field-id="field_name"]'),
    );
  });

  it('commits an editor on blur and keeps a saving Cell out of edit mode', async () => {
    const container = document.createElement('div');
    const callbacks = rendererCallbacks();
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), callbacks);

    renderer.render(createState(1));
    const cell = container.querySelector<HTMLElement>('.loom-grid-editable');
    cell?.click();
    const editor = container.querySelector<HTMLInputElement>('.loom-grid-editor');
    expect(editor).not.toBeNull();
    editor?.dispatchEvent(new Event('blur', { bubbles: true }));
    await vi.waitFor(() => expect(callbacks.onCellEdit).toHaveBeenCalledTimes(1));

    renderer.render(createState(1, { editStatuses: { record_01: 'saving' } }));
    const savingCell = container.querySelector<HTMLElement>(
      '.loom-grid-cell[data-record-id="record_01"]',
    );
    savingCell?.click();
    expect(container.querySelector('.loom-grid-editor')).toBeNull();
  });

  it('confirms Conflict Overwrite before invoking the recovery callback', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const callbacks = rendererCallbacks();
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), callbacks);

    renderer.render(
      createState(1, {
        conflicts: [
          {
            recordId: 'record_01',
            clientMutationId: 'mutation_01',
            failedCommandIndex: 0,
            expectedRevision: 1,
            currentRevision: 2,
            currentValues: { field_name: 'Server value' },
            submittedSet: { field_name: 'Local value' },
            message: 'Revision conflict.',
          },
        ],
      }),
    );

    const overwrite = container.querySelector<HTMLButtonElement>(
      '.loom-grid-conflict-actions button:nth-child(2)',
    );
    expect(overwrite?.classList.contains('loom-button-danger')).toBe(true);
    expect(overwrite?.dataset.variant).toBe('danger');
    expect(overwrite?.classList.contains('mod-warning')).toBe(false);
    overwrite?.click();
    const firstDialog = container.querySelector<HTMLElement>('[role="alertdialog"]');
    expect(firstDialog?.getAttribute('aria-modal')).toBe('true');
    expect(firstDialog?.querySelector<HTMLButtonElement>('[data-action="cancel"]')).not.toBeNull();
    expect(firstDialog?.querySelector<HTMLButtonElement>('[data-action="confirm"]')).not.toBeNull();
    firstDialog?.querySelector<HTMLButtonElement>('[data-action="cancel"]')?.click();
    expect(callbacks.onConflictAction).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(overwrite);

    overwrite?.click();
    const secondDialog = container.querySelector<HTMLElement>('[role="alertdialog"]');
    expect(secondDialog).not.toBeNull();
    secondDialog?.querySelector<HTMLButtonElement>('[data-action="confirm"]')?.click();
    await vi.waitFor(() =>
      expect(callbacks.onConflictAction).toHaveBeenCalledWith('record_01', 'overwrite'),
    );
  });

  it('keeps raw transport details behind the Grid diagnostic disclosure', () => {
    const container = document.createElement('div');
    const renderer = new ReadonlyGridRenderer(
      container,
      createTranslator('en'),
      rendererCallbacks(),
    );

    renderer.render(
      createState(0, {
        status: 'server-error',
        error: {
          message: 'adapter detail should not be the status summary',
          code: 'SERVER_ERROR',
          requestId: 'req_01',
        },
      }),
    );

    expect(container.querySelector('.loom-grid-status > p')?.textContent).toBe(
      'The Server returned an error while loading this Grid.',
    );
    expect(container.querySelector('.loom-grid-status .loom-diagnostic summary')?.textContent).toBe(
      'Error details',
    );
    expect(
      container.querySelector('.loom-grid-status .loom-diagnostic pre')?.textContent,
    ).toContain('req_01');
  });

  it('keeps a visible status when the data source is offline', () => {
    const container = document.createElement('div');
    const renderer = new ReadonlyGridRenderer(
      container,
      createTranslator('en'),
      rendererCallbacks(),
    );
    const state = createState(0, {
      status: 'offline',
      error: { message: 'offline' },
    });

    renderer.render(state);

    expect(container.querySelector('.loom-grid-status')?.textContent).toContain('offline');
    expect(container.querySelector('.loom-grid-status button')).toBeNull();
  });

  it.each([
    ['authentication', 'Open Settings'],
    ['forbidden', 'Open Settings'],
    ['network', 'Retry'],
    ['server-error', 'Retry'],
  ] as const)('offers the correct actionable %s state', async (status, label) => {
    const container = document.createElement('div');
    const callbacks = rendererCallbacks();
    const retry = deferred<void>();
    callbacks.onRefresh.mockReturnValue(retry.promise);
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), {
      ...callbacks,
      onOpenSettings: callbacks.onOpenSettings,
    });
    renderer.render(
      createState(0, {
        status,
        error: { message: 'transport detail', code: 'TRANSPORT_ERROR' },
      }),
    );

    const action = container.querySelector<HTMLButtonElement>('.loom-grid-status button');
    expect(action?.textContent).toBe(label);
    expect(container.querySelector('.loom-grid-status > p')?.textContent).not.toContain(
      'transport detail',
    );
    expect(container.querySelector('.loom-grid-status .loom-diagnostic')).not.toBeNull();
    if (status === 'authentication' || status === 'forbidden') {
      action?.click();
      await vi.waitFor(() => expect(callbacks.onOpenSettings).toHaveBeenCalledTimes(1));
      return;
    }

    action?.click();
    action?.click();
    await vi.waitFor(() => expect(callbacks.onRefresh).toHaveBeenCalledTimes(1));
    expect(action?.disabled).toBe(true);
    expect(action?.getAttribute('aria-busy')).toBe('true');
    expect(action?.textContent).toBe('Refreshing…');
    retry.resolve();
    await vi.waitFor(() => expect(action?.textContent).toBe('Retry'));
  });

  it('renders the View save status as an accessible live value', () => {
    const container = document.createElement('div');
    const renderer = new ReadonlyGridRenderer(
      container,
      createTranslator('en'),
      rendererCallbacks(),
    );

    renderer.render(createState(1, { saveStatus: 'saving' }));

    const status = container.querySelector<HTMLElement>('.loom-save-status');
    expect(status?.getAttribute('aria-live')).toBe('polite');
    expect(status?.dataset.status).toBe('saving');
    expect(status?.textContent).toContain('Saving');
  });

  it('collapses Saved to an accessible icon after a short delay', () => {
    vi.useFakeTimers();
    try {
      const container = document.createElement('div');
      const renderer = new ReadonlyGridRenderer(
        container,
        createTranslator('en'),
        rendererCallbacks(),
      );

      renderer.render(createState(1));
      const status = container.querySelector<HTMLElement>('.loom-save-status');
      expect(status?.textContent).toBe('Saved');
      vi.advanceTimersByTime(1_200);
      expect(status?.textContent).toBe('✓');
      expect(status?.getAttribute('aria-label')).toBe('Saved');
      expect(status?.title).toBe('Saved');
    } finally {
      vi.useRealTimers();
    }
  });

  it('distinguishes Location values that are unset, unlocated, and not renderable', () => {
    const container = document.createElement('div');
    const renderer = new ReadonlyGridRenderer(
      container,
      createTranslator('en'),
      rendererCallbacks(),
    );

    renderer.render(locationState(undefined));
    expect(container.querySelector('[data-field-id="field_location"]')?.textContent).toBe('Unset');
    renderer.render(locationState({ label: 'No coordinates' }));
    expect(container.querySelector('[data-field-id="field_location"]')?.textContent).toBe(
      'Unlocated',
    );
    renderer.render(locationState({ lat: 90, lng: 0 }));
    expect(container.querySelector('[data-field-id="field_location"]')?.textContent).toContain(
      'Not renderable',
    );
  });

  it('keeps offline Grid Cells read-only and does not start an editor', () => {
    const container = document.createElement('div');
    const callbacks = rendererCallbacks();
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), callbacks);

    renderer.render(createState(1, { status: 'offline', error: { message: 'offline' } }));

    const cell = container.querySelector<HTMLElement>(
      '.loom-grid-cell[data-field-id="field_name"]',
    );
    expect(cell?.getAttribute('aria-readonly')).toBe('true');
    cell?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(container.querySelector('.loom-grid-editor')).toBeNull();
    expect(callbacks.onCellEdit).not.toHaveBeenCalled();
  });

  it('opens an editable Cell and commits after IME composition ends', () => {
    const container = document.createElement('div');
    const callbacks = rendererCallbacks();
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), callbacks);

    renderer.render(createState(1));
    const cell = container.querySelector<HTMLElement>('.loom-grid-editable');
    cell?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const editor = container.querySelector<HTMLInputElement>('.loom-grid-editor');
    expect(editor).not.toBeNull();
    if (editor === null) return;
    editor.value = 'changed';
    editor.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(callbacks.onCellEdit).not.toHaveBeenCalled();
    editor.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(callbacks.onCellEdit).toHaveBeenCalledWith('record_01', 'field_name', 'changed');
  });

  it('restores a failed Cell draft with an associated fixable error', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const renderer = new ReadonlyGridRenderer(
      container,
      createTranslator('en'),
      rendererCallbacks(),
    );

    renderer.render(
      createState(1, {
        editDrafts: [
          {
            recordId: 'record_01',
            fieldId: 'field_name',
            rawValue: 'invalid local value',
          },
        ],
        editStatuses: { record_01: 'error' },
        editError: { code: 'BAD_REQUEST', message: 'The value is invalid.' },
        saveStatus: 'error',
      }),
    );

    const editor = container.querySelector<HTMLInputElement>('.loom-grid-editor');
    expect(editor?.value).toBe('invalid local value');
    expect(editor?.getAttribute('aria-invalid')).toBe('true');
    expect(editor?.getAttribute('aria-describedby')).toBe('loom-grid-edit-status');
    expect(container.querySelector('#loom-grid-edit-status')).not.toBeNull();
    expect(document.activeElement).toBe(editor);
    expect(container.querySelector('.loom-save-status')?.textContent).not.toContain('Saved');
  });

  it('lets Escape dismiss a failed draft without resubmitting it', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const callbacks = rendererCallbacks();
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), callbacks);

    renderer.render(
      createState(1, {
        editDrafts: [
          { recordId: 'record_01', fieldId: 'field_name', rawValue: 'invalid local value' },
        ],
        editStatuses: { record_01: 'error' },
        editErrorRecordId: 'record_01',
        editError: { code: 'BAD_REQUEST', message: 'The value is invalid.' },
        saveStatus: 'error',
      }),
    );

    const editor = container.querySelector<HTMLInputElement>('.loom-grid-editor');
    editor?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(container.querySelector('.loom-grid-editor')).toBeNull();
    expect(callbacks.onCellEdit).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(
      container.querySelector('.loom-grid-cell[data-record-id="record_01"]'),
    );
  });

  it('shows Server and local values with explicit conflict actions', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const confirmDiscardAll = vi.fn().mockReturnValue(true);
    const callbacks = { ...rendererCallbacks(), confirmDiscardAll };
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), callbacks);

    renderer.render(
      createState(1, {
        conflicts: [
          {
            recordId: 'record_01',
            clientMutationId: 'mutation_01',
            failedCommandIndex: 0,
            expectedRevision: 1,
            currentRevision: 2,
            currentValues: { field_name: 'Server value' },
            submittedSet: { field_name: 'Local value' },
            submittedUnsetFieldIds: ['field_archived'],
            message: 'Revision conflict.',
          },
        ],
      }),
    );

    expect(container.querySelector('.loom-grid-conflict-values')?.textContent).toContain(
      'Server value',
    );
    expect(container.querySelector('.loom-grid-conflict-values')?.textContent).toContain(
      'mutation_01',
    );
    expect(container.querySelector('.loom-grid-conflict-values')?.textContent).toContain(
      'failedCommandIndex',
    );
    expect(container.querySelector('.loom-grid-conflict-intent')?.textContent).toContain(
      'Local value',
    );
    expect(container.querySelector('.loom-grid-conflict-intent')?.textContent).toContain(
      'field_archived',
    );
    expect(container.querySelector('.loom-grid-conflicts')?.getAttribute('role')).toBe('region');
    expect(container.querySelector('.loom-grid-conflicts')?.getAttribute('aria-label')).toBe(
      'Conflict details',
    );
    expect(
      container.querySelector('.loom-grid-conflicts')?.querySelector('details'),
    ).not.toBeNull();
    const buttons = container.querySelectorAll<HTMLButtonElement>('.loom-grid-conflict button');
    buttons[0]?.click();
    buttons[1]?.click();
    container
      .querySelector<HTMLElement>('[role="alertdialog"]')
      ?.querySelector<HTMLButtonElement>('[data-action="confirm"]')
      ?.click();
    await vi.waitFor(() =>
      expect(callbacks.onConflictAction).toHaveBeenNthCalledWith(2, 'record_01', 'overwrite'),
    );
    expect(callbacks.onConflictAction).toHaveBeenNthCalledWith(1, 'record_01', 'use-server');

    buttons[2]?.click();
    expect(confirmDiscardAll).toHaveBeenCalledWith('record_01');
    expect(callbacks.onConflictAction).toHaveBeenNthCalledWith(3, 'record_01', 'discard-all');

    const conflicts = container.querySelector<HTMLElement>('.loom-grid-conflicts');
    const shell = container.querySelector<HTMLElement>('.loom-grid-shell');
    expect(conflicts).not.toBeNull();
    expect(shell).not.toBeNull();
    if (conflicts === null || shell === null) return;
    conflicts.focus();
    conflicts.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.activeElement).toBe(shell);
  });

  it('renders idempotency key reuse as a terminal safety error without retry', () => {
    const container = document.createElement('div');
    const callbacks = rendererCallbacks();
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), callbacks);

    renderer.render(
      createState(1, {
        editError: {
          code: 'IDEMPOTENCY_KEY_REUSED',
          httpStatus: 409,
          message: 'The mutation ID was already used with another body.',
        },
        editStatuses: { record_01: 'terminal' },
        saveStatus: 'error',
      }),
    );

    expect(container.querySelector('.loom-grid-edit-status')?.textContent).toContain(
      'already associated with a different request',
    );
    expect(container.querySelector('.loom-grid-edit-status button')).toBeNull();
    expect(container.querySelector('.loom-save-status')?.textContent).not.toContain('Saved');
  });

  it('offers an explicit retry action for a failed save', () => {
    const container = document.createElement('div');
    const callbacks = rendererCallbacks();
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), callbacks);

    renderer.render(
      createState(1, {
        editError: { message: 'The value is invalid.' },
        editStatuses: { record_01: 'error' },
        saveStatus: 'error',
      }),
    );

    container.querySelector<HTMLButtonElement>('.loom-grid-edit-status button')?.click();
    expect(callbacks.onRetryEdit).toHaveBeenCalledWith('record_01');
  });
});

describe('getVirtualRowRange', () => {
  it('keeps the rendered range bounded and overscanned', () => {
    expect(getVirtualRowRange(20_000, 3_600, 360, 36)).toEqual({
      start: 96,
      end: 114,
    });
    expect(getVirtualRowRange(4, 0, 360, 36)).toEqual({ start: 0, end: 4 });
  });
});

function rendererCallbacks() {
  return {
    onRefresh: vi.fn(),
    onWorkspaceChange: vi.fn(),
    onBaseChange: vi.fn(),
    onTableChange: vi.fn(),
    onViewChange: vi.fn(),
    onLoadMore: vi.fn(),
    onRecordOpen: vi.fn(),
    onCellEdit: vi.fn(),
    onConflictAction: vi.fn(),
    onRetryEdit: vi.fn(),
    onOpenSettings: vi.fn(),
  };
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
  readonly reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function createState(recordCount: number, update: Partial<GridState> = {}): GridState {
  const config: GridViewConfig = {
    projection: ['field_name'],
    columnOrder: ['field_name'],
    columnWidths: { field_name: 180 },
    frozenFieldIds: [],
    rowHeight: 'standard',
    sort: [],
  };
  const view: Extract<View, { type: 'grid' }> = {
    id: 'view_01',
    tableId: 'table_01',
    name: 'Grid',
    type: 'grid',
    config,
    revision: 1,
    createdAt: '2026-08-14T00:00:00Z',
    updatedAt: '2026-08-14T00:00:00Z',
  };
  const field: Field = {
    id: 'field_name',
    tableId: 'table_01',
    name: 'Name',
    position: 0,
    schemaVersion: 1,
    revision: 1,
    type: 'text',
    config: {},
  };
  const records: readonly LoomTableRecord[] = Array.from({ length: recordCount }, (_, index) => ({
    id: `record_${String(index + 1).padStart(2, '0')}`,
    tableId: 'table_01',
    revision: 1,
    values: { field_name: `Record ${index + 1}` },
    createdAt: '2026-08-14T00:00:00Z',
    updatedAt: '2026-08-14T00:00:00Z',
  }));
  return {
    status: 'ready',
    phase: 'idle',
    workspaces: [
      {
        id: 'workspace_01',
        name: 'Personal',
        revision: 1,
        createdAt: '',
        updatedAt: '',
      },
    ],
    bases: [
      {
        id: 'base_01',
        workspaceId: 'workspace_01',
        name: 'Notes',
        revision: 1,
        createdAt: '',
        updatedAt: '',
      },
    ],
    tables: [
      {
        id: 'table_01',
        baseId: 'base_01',
        name: 'Projects',
        primaryFieldId: 'field_name',
        revision: 1,
        createdAt: '',
        updatedAt: '',
      },
    ],
    views: [view],
    fields: [field],
    selectedWorkspaceId: 'workspace_01',
    selectedBaseId: 'base_01',
    selectedTableId: 'table_01',
    selectedViewId: 'view_01',
    records,
    hasMore: false,
    nextCursor: null,
    changeCursor: 'change_01',
    totalCount: recordCount,
    emptyReason: null,
    error: null,
    editStatuses: {},
    conflicts: [],
    editError: null,
    editDrafts: [],
    editErrorRecordId: null,
    saveStatus: 'saved',
    ...update,
  };
}

function createTwoFieldState(): GridState {
  const state = createState(1);
  const firstField = state.fields[0];
  const view = state.views[0];
  const record = state.records[0];
  if (firstField === undefined || view?.type !== 'grid' || record === undefined) {
    throw new Error('Grid fixture is missing.');
  }
  const secondField: Field = {
    ...firstField,
    id: 'field_second',
    name: 'Second',
  };
  return {
    ...state,
    fields: [firstField, secondField],
    views: [
      {
        ...view,
        config: {
          ...view.config,
          projection: ['field_name', 'field_second'],
          columnOrder: ['field_name', 'field_second'],
        },
      },
    ],
    records: [
      {
        ...record,
        values: { ...record.values, field_second: 'Second value' },
      },
    ],
  };
}

function locationState(value: JsonValue | undefined): GridState {
  const state = createState(1);
  const view = state.views[0];
  if (view?.type !== 'grid') throw new Error('Grid fixture is missing.');
  const field: Field = {
    id: 'field_location',
    tableId: 'table_01',
    name: 'Location',
    position: 0,
    schemaVersion: 1,
    revision: 1,
    type: 'location',
    config: {},
  };
  const record = state.records[0];
  if (record === undefined) throw new Error('Record fixture is missing.');
  return {
    ...state,
    fields: [field],
    views: [
      {
        ...view,
        config: {
          ...view.config,
          projection: ['field_location'],
          columnOrder: ['field_location'],
        },
      },
    ],
    records: [
      {
        ...record,
        values: value === undefined ? {} : { field_location: value },
      },
    ],
  };
}

