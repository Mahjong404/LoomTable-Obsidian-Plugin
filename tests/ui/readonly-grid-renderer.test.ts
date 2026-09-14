import { describe, expect, it, vi } from 'vitest';

import type {
  Field,
  FilterNode,
  GridViewConfig,
  JsonValue,
  LoomTableRecord,
  SortSpec,
  View,
} from '../../src/client/loomtable-client';
import { createTranslator } from '../../src/i18n';
import { ReadonlyGridRenderer, getVirtualRowRange } from '../../src/ui/readonly-grid-renderer';
import type { GridDisplayPatch } from '../../src/ui/grid-display';
import type { GridState } from '../../src/ui/grid-view-controller';
import type { ViewCreateOutcome } from '../../src/ui/view-write-coordinator';

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
    const gridLabelId = grid?.getAttribute('aria-labelledby');
    expect(gridLabelId ? container.querySelector('#' + gridLabelId)?.textContent : null).toBe(
      'Table',
    );
    expect(firstCell?.getAttribute('role')).toBe('gridcell');
    expect(firstCell?.tabIndex).toBe(0);
    firstCell?.focus();
    firstCell?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));

    expect(document.activeElement).toBe(
      container.querySelector('.loom-grid-cell[data-record-id="record_02"]'),
    );
  });

  it('renders a safe URL as a link in a Grid cell without exposing unsafe values', () => {
    const container = document.createElement('div');
    const renderer = new ReadonlyGridRenderer(
      container,
      createTranslator('en'),
      rendererCallbacks(),
    );

    renderer.render(urlState('https://example.com/docs'));

    const link = container.querySelector<HTMLAnchorElement>('.loom-field-value-link');
    expect(link?.getAttribute('href')).toBe('https://example.com/docs');
    expect(link?.getAttribute('aria-label')).toBe('Open URL: https://example.com/docs');
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
    const conflictRegion = container.querySelector('.loom-grid-conflicts');
    const conflictsLabelId = conflictRegion?.getAttribute('aria-labelledby');
    expect(
      conflictsLabelId ? container.querySelector('#' + conflictsLabelId)?.textContent : null,
    ).toBe('Conflict details');
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

  it('uses shared field value semantics and an accessible value state for Grid cells', () => {
    const container = document.createElement('div');
    const renderer = new ReadonlyGridRenderer(
      container,
      createTranslator('en'),
      rendererCallbacks(),
    );
    const state = createState(1);
    const field = state.fields[0];
    const record = state.records[0];
    if (field === undefined || record === undefined) throw new Error('Grid fixture is missing.');

    renderer.render({
      ...state,
      records: [{ ...record, values: { field_name: '' } }],
      fields: [field],
    });

    const cell = container.querySelector<HTMLElement>(
      '.loom-grid-cell[data-field-id="field_name"]',
    );
    expect(cell?.textContent).toBe('Empty');
    expect(cell?.dataset.valueState).toBe('empty');
  });

  it('keeps Grid attachment values as compact non-interactive summaries', () => {
    const container = document.createElement('div');
    const renderer = new ReadonlyGridRenderer(
      container,
      createTranslator('en'),
      rendererCallbacks(),
    );
    const state = createState(1);
    const nameField = state.fields[0];
    const record = state.records[0];
    if (nameField === undefined || record === undefined) {
      throw new Error('Grid fixture is missing.');
    }
    const attachmentField: Field = {
      id: 'field_attachment',
      tableId: 'table_01',
      name: 'Attachment',
      position: 1,
      schemaVersion: 1,
      revision: 1,
      type: 'attachment',
      config: { maxCount: 10 },
    };

    renderer.render({
      ...state,
      views: state.views.map((view) =>
        view.type === 'grid'
          ? {
              ...view,
              config: {
                ...view.config,
                projection: ['field_name', 'field_attachment'],
                columnOrder: ['field_name', 'field_attachment'],
              },
            }
          : view,
      ),
      records: [
        {
          ...record,
          values: {
            field_attachment: [
              { id: 'attachment_1', source: 'vault', filename: 'notes.md' },
              { id: 'attachment_2', source: 'managed', filename: 'image.png', status: 'pending' },
            ],
          },
        },
      ],
      fields: [nameField, attachmentField],
    });

    const cell = container.querySelector<HTMLElement>(
      '.loom-grid-cell[data-field-id="field_attachment"]',
    );
    expect(cell?.textContent).toContain('2 attachments');
    expect(cell?.querySelector('.loom-attachment-list')).toBeNull();
    expect(cell?.querySelector('button, a, input, select, textarea')).toBeNull();
    expect(cell?.innerHTML).not.toContain('attachment_1');
  });

  it('renders MultiSelect chips and opens its native multiple editor', () => {
    const container = document.createElement('div');
    const callbacks = rendererCallbacks();
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), callbacks);
    const state = createState(1);
    const view = state.views[0];
    const record = state.records[0];
    if (view?.type !== 'grid' || record === undefined) throw new Error('Grid fixture is missing.');
    const field: Field = {
      id: 'field_multi',
      tableId: 'table_01',
      name: 'Tags',
      position: 0,
      schemaVersion: 1,
      revision: 1,
      type: 'multiSelect',
      config: {
        options: [{ id: 'option_1', name: 'One', color: '#000000' }],
        deletedOptions: [
          { id: 'option_old', name: 'Old', color: '#000000', deletedAt: '2026-01-01' },
        ],
      },
    };
    const multiState: GridState = {
      ...state,
      fields: [field],
      views: [
        {
          ...view,
          config: { ...view.config, projection: ['field_multi'], columnOrder: ['field_multi'] },
        },
      ],
      records: [{ ...record, values: { field_multi: ['option_old', 'option_1'] } }],
    };

    renderer.render(multiState);

    const cell = container.querySelector<HTMLElement>(
      '.loom-grid-cell[data-field-id="field_multi"]',
    );
    expect(cell?.querySelector('.loom-field-value-chips')).not.toBeNull();
    expect(
      [...(cell?.querySelectorAll<HTMLElement>('[role="listitem"]') ?? [])].map(
        (chip) => chip.textContent,
      ),
    ).toEqual(['Old (Deleted option)', 'One']);
    expect(cell?.textContent).not.toContain('option_old');

    cell?.click();
    const editor = container.querySelector<HTMLSelectElement>('.loom-grid-editor');
    expect(editor?.multiple).toBe(true);
    expect([...(editor?.selectedOptions ?? [])].map((option) => option.value)).toEqual([
      'option_1',
      'option_old',
    ]);

    if (editor === null) {
      throw new Error('MultiSelect editor is missing.');
    }
    const activeOption = editor.querySelector<HTMLOptionElement>('option[value="option_1"]');
    const deletedOption = editor.querySelector<HTMLOptionElement>('option[value="option_old"]');
    if (activeOption === null || deletedOption === null) {
      throw new Error('MultiSelect editor options are missing.');
    }
    activeOption.selected = true;
    deletedOption.selected = false;
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(callbacks.onCellEdit).toHaveBeenCalledWith('record_01', 'field_multi', ['option_1']);
  });

  it('renders the shared View tabs in the navigation and forwards selection', () => {
    const container = document.createElement('div');
    const callbacks = rendererCallbacks();
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), callbacks);

    renderer.render(createState(1));

    expect(container.querySelector('[role="tablist"]')).not.toBeNull();
    const tabs = [...container.querySelectorAll<HTMLElement>('[role="tab"]')];
    expect(tabs.map((tab) => tab.dataset.viewId)).toEqual(['view_01']);
    expect(tabs[0]?.getAttribute('aria-selected')).toBe('true');
    tabs[0]?.click();
    expect(callbacks.onViewChange).toHaveBeenCalledWith('view_01');
  });

  it('offers an explicit View creation entry when the Table has no Views', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const outcomeView = createState(0).views[0];
    if (outcomeView === undefined) throw new Error('View fixture is missing.');
    const onCreateView = vi.fn(async (): Promise<ViewCreateOutcome> => ({
      status: 'created',
      view: outcomeView,
    }));
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), {
      ...rendererCallbacks(),
      onCreateView,
    });

    renderer.render(
      createState(0, {
        status: 'empty',
        emptyReason: 'view',
        views: [],
        selectedViewId: null,
        totalCount: 0,
      }),
    );

    const entry = container.querySelector<HTMLButtonElement>('.loom-grid-status .loom-button');
    expect(entry?.textContent).toBe('Create a View');
    entry?.click();
    expect(container.querySelector('.loom-view-create-form')).not.toBeNull();
    expect(document.activeElement).toBe(container.querySelector('input[name="view-name"]'));

    const form = container.querySelector<HTMLFormElement>('.loom-view-create-form');
    const name = form?.querySelector<HTMLInputElement>('input[name="view-name"]');
    if (form === null || name === null || name === undefined) {
      throw new Error('Create form is missing.');
    }
    name.value = 'Board';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(onCreateView).toHaveBeenCalledTimes(1));
    expect(onCreateView).toHaveBeenCalledWith({ type: 'grid', name: 'Board' });
    container.remove();
  });
});

describe('Grid query controls', () => {
  it('submits Search only on Enter or the Search button, never while typing', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const onSearch = vi.fn(async (_term: string) => true);
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), {
      ...rendererCallbacks(),
      onSearch,
    });
    renderer.render(createState(1));

    const input = container.querySelector<HTMLInputElement>('input[data-role="grid-search"]');
    if (input === null) throw new Error('Search input is missing.');
    input.value = 'alp';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(onSearch).not.toHaveBeenCalled();

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await vi.waitFor(() => expect(onSearch).toHaveBeenCalledWith('alp'));
    container.remove();
  });

  it('shows the applied Search term and clears it explicitly', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const onSearch = vi.fn(async (_term: string) => true);
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), {
      ...rendererCallbacks(),
      onSearch,
    });
    renderer.render(createState(1, { search: 'alpha' }));

    const input = container.querySelector<HTMLInputElement>('input[data-role="grid-search"]');
    expect(input?.value).toBe('alpha');
    container.querySelector<HTMLButtonElement>('[data-action="search-clear"]')?.click();
    await vi.waitFor(() => expect(onSearch).toHaveBeenCalledWith(''));
    container.remove();
  });

  it('surfaces a too-long Search rejection and keeps the typed draft', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const onSearch = vi.fn(async (_term: string) => false);
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), {
      ...rendererCallbacks(),
      onSearch,
    });
    renderer.render(createState(1));

    const input = container.querySelector<HTMLInputElement>('input[data-role="grid-search"]');
    if (input === null) throw new Error('Search input is missing.');
    input.value = 'x'.repeat(501);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    container.querySelector<HTMLButtonElement>('[data-action="search-submit"]')?.click();
    await vi.waitFor(() => expect(onSearch).toHaveBeenCalled());
    await vi.waitFor(() =>
      expect(container.querySelector('.loom-grid-search-error')).not.toBeNull(),
    );
    expect(container.querySelector<HTMLInputElement>('input[data-role="grid-search"]')?.value).toBe(
      'x'.repeat(501),
    );
    container.remove();
  });

  it('opens the Filter Builder and applies the draft through onApplyFilter', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const savedState = createState(1);
    const onApplyFilter = vi.fn(
      async (_viewId: string, _filter: FilterNode | undefined) =>
        ({ status: 'saved', view: savedState.views[0]! }) as const,
    );
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), {
      ...rendererCallbacks(),
      onApplyFilter,
    });
    renderer.render(savedState);

    container.querySelector<HTMLButtonElement>('[data-action="toggle-filter"]')?.click();
    const builder = container.querySelector('.loom-filter-builder');
    expect(builder).not.toBeNull();

    builder?.querySelector<HTMLButtonElement>('[data-action="filter-add-rule"]')?.click();
    const valueInput = container.querySelector<HTMLInputElement>('input[data-role="filter-value"]');
    if (valueInput === null) throw new Error('Filter value input is missing.');
    valueInput.value = 'needle';
    valueInput.dispatchEvent(new Event('input', { bubbles: true }));

    container.querySelector<HTMLButtonElement>('[data-action="filter-apply"]')?.click();
    await vi.waitFor(() => expect(onApplyFilter).toHaveBeenCalled());
    expect(onApplyFilter.mock.calls[0]?.[0]).toBe('view_01');
    expect(onApplyFilter.mock.calls[0]?.[1]).toEqual({
      kind: 'group',
      operator: 'and',
      children: [{ kind: 'rule', fieldId: 'field_name', operator: 'is', value: 'needle' }],
    });

    renderer.render(savedState);
    expect(container.querySelector('.loom-filter-builder')).toBeNull();
    container.remove();
  });

  it('keeps the Filter Builder open when the config write fails', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const state = createState(1);
    const onApplyFilter = vi.fn(
      async (_viewId: string, _filter: FilterNode | undefined) =>
        ({
          status: 'failed',
          kind: 'validation',
          error: { message: 'The Server rejected the Filter.' },
        }) as const,
    );
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), {
      ...rendererCallbacks(),
      onApplyFilter,
    });
    renderer.render(state);
    container.querySelector<HTMLButtonElement>('[data-action="toggle-filter"]')?.click();
    container
      .querySelector<HTMLElement>('.loom-filter-builder')
      ?.querySelector<HTMLButtonElement>('[data-action="filter-add-rule"]')
      ?.click();
    const valueInput = container.querySelector<HTMLInputElement>('input[data-role="filter-value"]');
    if (valueInput === null) throw new Error('Filter value input is missing.');
    valueInput.value = 'x';
    valueInput.dispatchEvent(new Event('input', { bubbles: true }));
    container.querySelector<HTMLButtonElement>('[data-action="filter-apply"]')?.click();
    await vi.waitFor(() => expect(onApplyFilter).toHaveBeenCalled());

    const issueState: GridState = {
      ...state,
      viewWriteIssues: {
        view_01: { kind: 'error', message: 'The Server rejected the Filter.' },
      },
    };
    renderer.render(issueState);
    expect(container.querySelector('.loom-filter-builder')).not.toBeNull();
    expect(container.querySelector('.loom-query-panel-issue')?.textContent).toBe(
      'The Server rejected the Filter.',
    );
    container.remove();
  });

  it('cycles the saved sort from the column header', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const onApplySort = vi.fn(
      async (_viewId: string, _sort: readonly SortSpec[]) =>
        ({ status: 'saved', view: createState(0).views[0]! }) as const,
    );
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), {
      ...rendererCallbacks(),
      onApplySort,
    });
    renderer.render(createState(1));

    const headerButton = container.querySelector<HTMLButtonElement>(
      '[data-action="header-sort"][data-field-id="field_name"]',
    );
    if (headerButton === null) throw new Error('Sortable header is missing.');
    headerButton.click();
    await vi.waitFor(() =>
      expect(onApplySort).toHaveBeenCalledWith('view_01', [
        { fieldId: 'field_name', direction: 'asc', nulls: 'last' },
      ]),
    );

    const sorted = createState(1);
    const sortedView = sorted.views[0];
    if (sortedView?.type !== 'grid') throw new Error('View fixture is missing.');
    renderer.render({
      ...sorted,
      views: [
        {
          ...sortedView,
          config: {
            ...sortedView.config,
            sort: [{ fieldId: 'field_name', direction: 'asc', nulls: 'last' }],
          },
        },
      ],
    });
    container
      .querySelector<HTMLButtonElement>('[data-action="header-sort"][data-field-id="field_name"]')
      ?.click();
    await vi.waitFor(() =>
      expect(onApplySort).toHaveBeenLastCalledWith('view_01', [
        { fieldId: 'field_name', direction: 'desc', nulls: 'last' },
      ]),
    );

    const descending = createState(1);
    const descendingView = descending.views[0];
    if (descendingView?.type !== 'grid') throw new Error('View fixture is missing.');
    renderer.render({
      ...descending,
      views: [
        {
          ...descendingView,
          config: {
            ...descendingView.config,
            sort: [{ fieldId: 'field_name', direction: 'desc', nulls: 'last' }],
          },
        },
      ],
    });
    const header = container
      .querySelector<HTMLElement>('[data-action="header-sort"][data-field-id="field_name"]')
      ?.closest('[role="columnheader"]');
    expect(header?.getAttribute('aria-sort')).toBe('descending');
    container.remove();
  });

  it('opens the Sort Panel instead of dropping other rules when multiple sorts exist', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const onApplySort = vi.fn();
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), {
      ...rendererCallbacks(),
      onApplySort,
    });
    const state = createTwoFieldState();
    const view = state.views[0];
    if (view?.type !== 'grid') throw new Error('View fixture is missing.');
    renderer.render({
      ...state,
      views: [
        {
          ...view,
          config: {
            ...view.config,
            sort: [
              { fieldId: 'field_name', direction: 'asc', nulls: 'last' },
              { fieldId: 'field_second', direction: 'desc', nulls: 'first' },
            ],
          },
        },
      ],
    });

    container
      .querySelector<HTMLButtonElement>('[data-action="header-sort"][data-field-id="field_name"]')
      ?.click();

    expect(onApplySort).not.toHaveBeenCalled();
    const panel = container.querySelector('.loom-sort-panel');
    expect(panel).not.toBeNull();
    expect(panel?.querySelectorAll('li[data-sort-index]')).toHaveLength(2);
    expect(
      document.activeElement instanceof HTMLSelectElement &&
        document.activeElement.dataset.role === 'sort-field' &&
        document.activeElement.value === 'field_name',
    ).toBe(true);
    container.remove();
  });

  it('offers clear-filter, editor and clear-search actions for a no-match result', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const onApplyFilter = vi.fn(
      async (_viewId: string, _filter: FilterNode | undefined) =>
        ({ status: 'saved', view: createState(0).views[0]! }) as const,
    );
    const onSearch = vi.fn(async (_term: string) => true);
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), {
      ...rendererCallbacks(),
      onApplyFilter,
      onSearch,
    });
    const state = createState(0);
    const view = state.views[0];
    if (view?.type !== 'grid') throw new Error('View fixture is missing.');
    renderer.render({
      ...state,
      status: 'empty',
      emptyReason: 'no-match',
      search: 'alpha',
      records: [],
      totalCount: 0,
      views: [
        {
          ...view,
          config: {
            ...view.config,
            filter: {
              kind: 'rule',
              fieldId: 'field_name',
              operator: 'contains',
              value: 'a',
            },
          },
        },
      ],
    });

    container.querySelector<HTMLButtonElement>('[data-action="empty-clear-filter"]')?.click();
    await vi.waitFor(() => expect(onApplyFilter).toHaveBeenCalledWith('view_01', undefined));
    container.querySelector<HTMLButtonElement>('[data-action="empty-clear-search"]')?.click();
    await vi.waitFor(() => expect(onSearch).toHaveBeenCalledWith(''));
    container.querySelector<HTMLButtonElement>('[data-action="empty-edit-filter"]')?.click();
    expect(container.querySelector('.loom-filter-builder')).not.toBeNull();
    container.remove();
  });

  it('opens the Display panel and applies the patch through onApplyDisplay', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const savedState = createState(1);
    const onApplyDisplay = vi.fn(async (_viewId: string, _patch: GridDisplayPatch) => ({
      status: 'saved' as const,
      view: savedState.views[0]!,
    }));
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), {
      ...rendererCallbacks(),
      onApplyDisplay,
    });
    renderer.render(savedState);

    container.querySelector<HTMLButtonElement>('[data-action="toggle-display"]')?.click();
    const panel = container.querySelector('.loom-display-panel');
    expect(panel).not.toBeNull();

    panel
      ?.querySelector<HTMLInputElement>(
        'li[data-field-id="field_name"] input[data-role="display-width"]',
      )
      ?.focus();
    const width = panel?.querySelector<HTMLInputElement>(
      'li[data-field-id="field_name"] input[data-role="display-width"]',
    );
    if (width === null || width === undefined) throw new Error('width input missing');
    width.value = '240';
    width.dispatchEvent(new Event('input', { bubbles: true }));

    container.querySelector<HTMLButtonElement>('[data-action="display-apply"]')?.click();
    await vi.waitFor(() => expect(onApplyDisplay).toHaveBeenCalled());
    const patch = onApplyDisplay.mock.calls[0]?.[1];
    expect(patch?.columnWidths).toEqual({ field_name: 240 });
    expect(patch?.projection).toEqual(['field_name']);

    renderer.render(savedState);
    expect(container.querySelector('.loom-display-panel')).toBeNull();
    container.remove();
  });

  it('hides a column that remains in columnOrder', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const state = createTwoFieldState();
    const view = state.views[0];
    if (view?.type !== 'grid') throw new Error('View fixture is missing.');
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), {
      ...rendererCallbacks(),
    });
    renderer.render({
      ...state,
      views: [
        {
          ...view,
          config: {
            ...view.config,
            projection: ['field_name'],
            columnOrder: ['field_second', 'field_name'],
          },
        },
      ],
    });

    const headers = [...container.querySelectorAll<HTMLElement>('.loom-grid-header-cell')].map(
      (cell) => cell.textContent,
    );
    expect(headers).not.toContain('Second');
    const cells = [
      ...container.querySelectorAll<HTMLElement>('.loom-grid-row .loom-grid-cell'),
    ].map((cell) => cell.dataset.fieldId);
    expect(cells).toEqual(['field_name']);
    container.remove();
  });

  it('pins frozen columns with shared sticky offsets in header and rows', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const state = createTwoFieldState();
    const view = state.views[0];
    if (view?.type !== 'grid') throw new Error('View fixture is missing.');
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), {
      ...rendererCallbacks(),
    });
    renderer.render({
      ...state,
      views: [
        {
          ...view,
          config: {
            ...view.config,
            frozenFieldIds: ['field_second'],
            columnWidths: { field_name: 200 },
            columnOrder: ['field_name', 'field_second'],
          },
        },
      ],
    });

    const headerCell = container.querySelector<HTMLElement>(
      '.loom-grid-header-cell.loom-grid-frozen',
    );
    const rowCell = container.querySelector<HTMLElement>(
      '.loom-grid-row .loom-grid-cell.loom-grid-frozen',
    );
    const indexCell = container.querySelector<HTMLElement>('.loom-grid-index-cell');
    expect(headerCell?.style.left).toBe('56px');
    expect(rowCell?.style.left).toBe('56px');
    expect(indexCell?.classList.contains('loom-grid-index-cell')).toBe(true);
    expect(headerCell?.classList.contains('loom-grid-frozen-last')).toBe(true);
    expect(headerCell?.textContent).toContain('Second');
    container.remove();
  });

  it('restores the scroll anchor by first visible Record and offset after a row-height change', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const state = createState(50);
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), {
      ...rendererCallbacks(),
    });
    renderer.render(state);
    const viewport = container.querySelector<HTMLElement>('.loom-grid-viewport');
    if (viewport === null) throw new Error('viewport missing');
    viewport.scrollTop = 36 * 10 + 12;

    const view = state.views[0];
    if (view?.type !== 'grid') throw new Error('View fixture is missing.');
    renderer.render({
      ...state,
      views: [
        {
          ...view,
          revision: 2,
          config: { ...view.config, rowHeight: 'compact' },
        },
      ],
    });

    const nextViewport = container.querySelector<HTMLElement>('.loom-grid-viewport');
    expect(nextViewport?.scrollTop).toBe(10 * 30 + 12);
    container.remove();
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

function urlState(value: JsonValue | undefined): GridState {
  const state = createState(1);
  const view = state.views[0];
  if (view?.type !== 'grid') throw new Error('Grid fixture is missing.');
  const field: Field = {
    id: 'field_url',
    tableId: 'table_01',
    name: 'Website',
    position: 0,
    schemaVersion: 1,
    revision: 1,
    type: 'url',
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
          projection: ['field_url'],
          columnOrder: ['field_url'],
        },
      },
    ],
    records: [
      {
        ...record,
        values: value === undefined ? {} : { field_url: value },
      },
    ],
  };
}

describe('Grid V5 cell interactions', () => {
  function numberFieldState(): GridState {
    const state = createState(1);
    const view = state.views[0];
    const field = state.fields[0];
    const record = state.records[0];
    if (view?.type !== 'grid' || field === undefined || record === undefined) {
      throw new Error('Grid fixture is missing.');
    }
    const numberField: Field = {
      id: 'field_name',
      tableId: 'table_01',
      name: 'Name',
      position: 0,
      schemaVersion: 1,
      revision: 1,
      type: 'number',
      config: {},
    };
    return {
      ...state,
      fields: [numberField],
      records: [{ ...record, values: { field_name: 42 } }],
    };
  }

  it('starts a replacement edit from a printable character', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const renderer = new ReadonlyGridRenderer(
      container,
      createTranslator('en'),
      rendererCallbacks(),
    );
    renderer.render(createState(1));

    const cell = container.querySelector<HTMLElement>(
      '.loom-grid-cell[data-record-id="record_01"]',
    );
    cell?.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    const editor = container.querySelector<HTMLInputElement>('.loom-grid-editor');
    expect(editor?.value).toBe('a');
    container.remove();
  });

  it('clears the Cell to null on Delete and Backspace', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const callbacks = rendererCallbacks();
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), callbacks);
    renderer.render(createState(1));

    const cell = container.querySelector<HTMLElement>(
      '.loom-grid-cell[data-record-id="record_01"]',
    );
    cell?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    expect(callbacks.onCellEdit).toHaveBeenCalledWith('record_01', 'field_name', null);
    cell?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
    expect(callbacks.onCellEdit).toHaveBeenCalledTimes(2);
    container.remove();
  });

  it('copies the Cell text through the clipboard host seam', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const clipboard = { writeText: vi.fn(async () => {}), readText: vi.fn(async () => '') };
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), {
      ...rendererCallbacks(),
      clipboard,
    });
    renderer.render(createState(1));

    container
      .querySelector<HTMLElement>('.loom-grid-cell[data-record-id="record_01"]')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true }));
    await vi.waitFor(() => expect(clipboard.writeText).toHaveBeenCalledWith('Record 1'));
    expect(container.querySelector('.loom-grid-clipboard-note')?.textContent).toContain('Copied');
    container.remove();
  });

  it('pastes a valid clipboard value through the edit seam', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const callbacks = rendererCallbacks();
    const clipboard = { writeText: vi.fn(async () => {}), readText: vi.fn(async () => '12.5') };
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), {
      ...callbacks,
      clipboard,
    });
    renderer.render(numberFieldState());

    container
      .querySelector<HTMLElement>('.loom-grid-cell[data-record-id="record_01"]')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true }));
    await vi.waitFor(() =>
      expect(callbacks.onCellEdit).toHaveBeenCalledWith('record_01', 'field_name', 12.5),
    );
    container.remove();
  });

  it('rejects an invalid paste with an explicit message and no write', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const callbacks = rendererCallbacks();
    const clipboard = { writeText: vi.fn(async () => {}), readText: vi.fn(async () => 'abc') };
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), {
      ...callbacks,
      clipboard,
    });
    renderer.render(numberFieldState());

    container
      .querySelector<HTMLElement>('.loom-grid-cell[data-record-id="record_01"]')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true }));
    await vi.waitFor(() =>
      expect(container.querySelector('.loom-grid-clipboard-note')?.textContent).toContain(
        'not valid',
      ),
    );
    expect(callbacks.onCellEdit).not.toHaveBeenCalled();
    container.remove();
  });

  it('reports copy and paste as unsupported on complex Fields', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const callbacks = rendererCallbacks();
    const clipboard = { writeText: vi.fn(async () => {}), readText: vi.fn(async () => 'x') };
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), {
      ...callbacks,
      clipboard,
    });
    renderer.render(locationState({ lat: 31.2, lng: 121.4 }));

    const cell = container.querySelector<HTMLElement>(
      '.loom-grid-cell[data-field-id="field_location"]',
    );
    cell?.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true }));
    await vi.waitFor(() =>
      expect(container.querySelector('.loom-grid-clipboard-note')?.textContent).toContain(
        'cannot be copied or pasted',
      ),
    );
    expect(clipboard.writeText).not.toHaveBeenCalled();
    cell?.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true }));
    expect(callbacks.onCellEdit).not.toHaveBeenCalled();
    container.remove();
  });

  it('falls back to the nearest visible Cell when the focused Field is hidden', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const renderer = new ReadonlyGridRenderer(
      container,
      createTranslator('en'),
      rendererCallbacks(),
    );
    const state = createTwoFieldState();
    renderer.render(state);
    container.querySelector<HTMLElement>('.loom-grid-cell[data-field-id="field_second"]')?.focus();

    const view = state.views[0];
    if (view?.type !== 'grid') throw new Error('View fixture is missing.');
    renderer.render({
      ...state,
      views: [
        {
          ...view,
          config: { ...view.config, projection: ['field_name'] },
        },
      ],
    });
    expect((document.activeElement as HTMLElement | null)?.dataset.fieldId).toBe('field_name');
    container.remove();
  });
});

describe('Grid V5 virtualization safety', () => {
  it('keeps an active editor mounted when virtual scrolling past its row', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const callbacks = rendererCallbacks();
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), callbacks);
    renderer.render(createState(200));

    const cell = container.querySelector<HTMLElement>(
      '.loom-grid-cell[data-record-id="record_01"]',
    );
    cell?.click();
    const editor = container.querySelector<HTMLInputElement>('.loom-grid-editor');
    expect(editor).not.toBeNull();
    if (editor === null) return;
    editor.value = 'draft text';
    editor.dispatchEvent(new Event('input', { bubbles: true }));

    const viewport = container.querySelector<HTMLElement>('.loom-grid-viewport');
    expect(viewport).not.toBeNull();
    if (viewport === null) return;
    viewport.scrollTop = 36 * 150;
    viewport.dispatchEvent(new Event('scroll'));

    const kept = container.querySelector<HTMLInputElement>('.loom-grid-editor');
    expect(kept).toBe(editor);
    expect(kept?.value).toBe('draft text');
    expect(document.activeElement).toBe(editor);
    expect(callbacks.onCellEdit).not.toHaveBeenCalled();
    container.remove();
  });
});

describe('Grid V5 header action focus', () => {
  it('restores focus to the same header sort control after a redraw', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), {
      ...rendererCallbacks(),
      onApplySort: vi.fn(async () => ({
        status: 'saved' as const,
        view: createState(1).views[0]!,
      })),
    });
    renderer.render(createTwoFieldState());

    const button = container.querySelector<HTMLElement>(
      '.loom-grid-sort[data-field-id="field_second"]',
    );
    expect(button).not.toBeNull();
    button?.focus();
    renderer.render(createTwoFieldState());

    expect(document.activeElement).toBe(
      container.querySelector('.loom-grid-sort[data-field-id="field_second"]'),
    );
    container.remove();
  });
});

describe('Grid V5 bounded DOM', () => {
  it('keeps the row DOM bounded for a 20k-Record result set', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const renderer = new ReadonlyGridRenderer(
      container,
      createTranslator('en'),
      rendererCallbacks(),
    );
    renderer.render(createState(20_000));

    const rows = container.querySelectorAll('.loom-grid-row');
    expect(rows.length).toBeLessThan(100);
    expect(container.querySelector('.loom-grid-canvas')).not.toBeNull();
    container.remove();
  });
});

describe('Grid record create', () => {
  it('opens the create form from the toolbar and submits through onCreateRecord', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const record: LoomTableRecord = {
      id: 'record_new',
      tableId: 'table_01',
      revision: 1,
      values: { field_name: 'Fresh' },
      createdAt: '2026-08-15T00:00:00Z',
      updatedAt: '2026-08-15T00:00:00Z',
    };
    const callbacks = {
      ...rendererCallbacks(),
      onCreateRecord: vi.fn(async () => record),
    };
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), callbacks);
    renderer.render(createState(1));

    const button = container.querySelector<HTMLButtonElement>('.loom-grid-record-create');
    expect(button).not.toBeNull();
    button?.click();
    const form = container.querySelector<HTMLElement>('.loom-record-create');
    expect(form).not.toBeNull();
    const input = container.querySelector<HTMLInputElement>('.loom-record-create-fields input');
    expect(input).not.toBeNull();
    if (input === null) return;
    input.value = 'Fresh';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    form?.querySelector<HTMLButtonElement>('.loom-record-create-submit')?.click();
    await vi.waitFor(() => expect(callbacks.onCreateRecord).toHaveBeenCalled());
    expect(callbacks.onCreateRecord).toHaveBeenCalledWith({ field_name: 'Fresh' });
    await vi.waitFor(() =>
      expect(callbacks.onRecordOpen).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'record_new' }),
      ),
    );
    expect(container.querySelector('.loom-record-create')).toBeNull();
    container.remove();
  });

  it('hides the create entry without the callback and disables it while offline', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const renderer = new ReadonlyGridRenderer(
      container,
      createTranslator('en'),
      rendererCallbacks(),
    );
    renderer.render(createState(1));
    expect(container.querySelector('.loom-grid-record-create')).toBeNull();

    const withCreate = new ReadonlyGridRenderer(container, createTranslator('en'), {
      ...rendererCallbacks(),
      onCreateRecord: vi.fn(async () => {
        throw new Error('unreachable');
      }),
    });
    withCreate.render(createState(1, { status: 'offline' }));
    const button = container.querySelector<HTMLButtonElement>('.loom-grid-record-create');
    expect(button?.disabled).toBe(true);
    container.remove();
  });

  it('surfaces queued, failed, and applied create ops with retry/discard/open actions', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const created: LoomTableRecord = {
      id: 'record_new',
      tableId: 'table_01',
      revision: 1,
      values: {},
      createdAt: '2026-08-15T00:00:00Z',
      updatedAt: '2026-08-15T00:00:00Z',
    };
    const callbacks = {
      ...rendererCallbacks(),
      onCreateRecord: vi.fn(async () => created),
      onRetryRecordCreate: vi.fn(),
      onDiscardRecordCreate: vi.fn(async () => undefined),
      onDismissRecordCreate: vi.fn(),
    };
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), callbacks);
    renderer.render(
      createState(1, {
        recordCreateOps: [
          { operationId: 'op_pending', tableId: 'table_01', state: 'sending' },
          {
            operationId: 'op_failed',
            tableId: 'table_01',
            state: 'error',
            lastError: {
              kind: 'network',
              message: 'offline',
            },
          },
          {
            operationId: 'op_done',
            tableId: 'table_01',
            state: 'idle',
            createdRecord: created,
          },
        ],
      }),
    );

    const ops = container.querySelectorAll<HTMLElement>('.loom-record-create-op');
    expect(ops).toHaveLength(3);
    const failed = [...ops].find((op) => op.dataset.operationId === 'op_failed');
    failed?.querySelector<HTMLButtonElement>('.loom-record-create-retry')?.click();
    expect(callbacks.onRetryRecordCreate).toHaveBeenCalledWith('op_failed');
    failed?.querySelector<HTMLButtonElement>('.loom-record-create-discard')?.click();
    expect(callbacks.onDiscardRecordCreate).toHaveBeenCalledWith('op_failed');

    const done = [...ops].find((op) => op.dataset.operationId === 'op_done');
    done?.querySelector<HTMLButtonElement>('.loom-record-create-open')?.click();
    expect(callbacks.onRecordOpen).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'record_new' }),
    );
    expect(callbacks.onDismissRecordCreate).toHaveBeenCalledWith('op_done');
    container.remove();
  });
});

describe('Grid record lifecycle', () => {
  function lifecycleCallbacks() {
    return {
      ...rendererCallbacks(),
      onDeleteRecord: vi.fn(async (_recordId: string) => undefined),
      onUndoDelete: vi.fn(async () => undefined),
      onDismissDeleteNotice: vi.fn(),
      onLoadDeletedRecords: vi.fn(async () => undefined),
      onLoadMoreDeletedRecords: vi.fn(async () => undefined),
      onRestoreRecord: vi.fn(async (_recordId: string) => undefined),
    };
  }

  function deletedRecord(id: string): LoomTableRecord {
    return {
      id,
      tableId: 'table_01',
      revision: 3,
      values: { field_name: 'Deleted ' + id },
      createdAt: '2026-08-14T00:00:00Z',
      updatedAt: '2026-08-15T00:00:00Z',
      deletedAt: '2026-08-15T01:00:00Z',
    };
  }

  it('confirms before deleting and reports the Record id after confirmation', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const callbacks = lifecycleCallbacks();
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), {
      ...callbacks,
      confirmDangerousAction: vi.fn(async () => true),
    });
    renderer.render(createState(2));

    container
      .querySelector<HTMLElement>('.loom-grid-index-cell')
      ?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 5, clientY: 5 }));
    const danger = [
      ...container.querySelectorAll<HTMLButtonElement>('.loom-context-menu-item'),
    ].find((item) => item.dataset.variant === 'danger');
    expect(danger?.textContent).toContain('Delete Record');
    danger?.click();
    await vi.waitFor(() => expect(callbacks.onDeleteRecord).toHaveBeenCalledWith('record_01'));
    container.remove();
  });

  it('does not delete when the confirmation is cancelled', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const callbacks = lifecycleCallbacks();
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), {
      ...callbacks,
      confirmDangerousAction: vi.fn(async () => false),
    });
    renderer.render(createState(2));

    container
      .querySelector<HTMLElement>('.loom-grid-index-cell')
      ?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 5, clientY: 5 }));
    container
      .querySelector<HTMLButtonElement>('.loom-context-menu-item[data-variant="danger"]')
      ?.click();
    await Promise.resolve();
    expect(callbacks.onDeleteRecord).not.toHaveBeenCalled();
    container.remove();
  });

  it('hides the delete action without the callback and disables it while the Record is pending', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const renderer = new ReadonlyGridRenderer(
      container,
      createTranslator('en'),
      rendererCallbacks(),
    );
    renderer.render(createState(2));
    container
      .querySelector<HTMLElement>('.loom-grid-index-cell')
      ?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 5, clientY: 5 }));
    expect(container.querySelector('.loom-context-menu-item[data-variant="danger"]')).toBeNull();

    const withDelete = new ReadonlyGridRenderer(
      container,
      createTranslator('en'),
      lifecycleCallbacks(),
    );
    withDelete.render(createState(2, { editStatuses: { record_01: 'queued' } }));
    container
      .querySelector<HTMLElement>('.loom-grid-index-cell')
      ?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 5, clientY: 5 }));
    const danger = container.querySelector<HTMLButtonElement>(
      '.loom-context-menu-item[data-variant="danger"]',
    );
    expect(danger?.disabled).toBe(true);
    container.remove();
  });

  it('shows the deleted notice with undo and dismiss actions', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const callbacks = lifecycleCallbacks();
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), callbacks);
    renderer.render(createState(1, { lastDeletedRecord: deletedRecord('record_01') }));

    const notice = container.querySelector<HTMLElement>('.loom-grid-deleted-notice');
    expect(notice).not.toBeNull();
    notice?.querySelector<HTMLButtonElement>('.loom-grid-undo-delete')?.click();
    expect(callbacks.onUndoDelete).toHaveBeenCalledTimes(1);
    notice?.querySelector<HTMLButtonElement>('.loom-grid-dismiss-delete')?.click();
    expect(callbacks.onDismissDeleteNotice).toHaveBeenCalledTimes(1);
    container.remove();
  });

  it('loads the deleted Records list on demand and restores entries', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const callbacks = lifecycleCallbacks();
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), callbacks);
    renderer.render(
      createState(1, {
        deletedRecords: [deletedRecord('record_09'), deletedRecord('record_10')],
        deletedRecordsStatus: 'ready',
        deletedRecordsHasMore: true,
        deletedRecordsNextCursor: 'cursor_2',
      }),
    );

    const toggle = container.querySelector<HTMLButtonElement>('[data-action="toggle-recycle"]');
    expect(toggle).not.toBeNull();
    toggle?.click();
    expect(callbacks.onLoadDeletedRecords).toHaveBeenCalledTimes(1);

    const panel = container.querySelector<HTMLElement>('.loom-recycle-panel');
    expect(panel).not.toBeNull();
    const items = panel?.querySelectorAll<HTMLElement>('.loom-recycle-item') ?? [];
    expect(items).toHaveLength(2);
    items[0]?.querySelector<HTMLButtonElement>('.loom-recycle-restore')?.click();
    expect(callbacks.onRestoreRecord).toHaveBeenCalledWith('record_09');
    panel?.querySelector<HTMLButtonElement>('.loom-recycle-load-more')?.click();
    expect(callbacks.onLoadMoreDeletedRecords).toHaveBeenCalledTimes(1);
    container.remove();
  });

  it('surfaces the recycle list loading, empty, and error states', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const callbacks = lifecycleCallbacks();
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), callbacks);

    renderer.render(createState(1, { deletedRecordsStatus: 'loading' }));
    container.querySelector<HTMLButtonElement>('[data-action="toggle-recycle"]')?.click();
    expect(container.querySelector('.loom-recycle-status')?.textContent).toContain('Loading');

    renderer.render(createState(1, { deletedRecordsStatus: 'ready', deletedRecords: [] }));
    container.querySelector<HTMLButtonElement>('[data-action="toggle-recycle"]')?.click();
    await Promise.resolve();
    container.querySelector<HTMLButtonElement>('[data-action="toggle-recycle"]')?.click();
    expect(container.querySelector('.loom-recycle-status')?.textContent).toContain('No deleted');

    renderer.render(
      createState(1, {
        deletedRecordsStatus: 'error',
        deletedRecordsError: { message: 'boom' },
      }),
    );
    expect(container.querySelector('.loom-recycle-status')?.textContent).toContain(
      'could not be loaded',
    );
    container.remove();
  });

  it('renders a field type icon beside each column header name', () => {
    const container = document.createElement('div');
    const renderer = new ReadonlyGridRenderer(
      container,
      createTranslator('en'),
      rendererCallbacks(),
    );
    renderer.render(createTwoFieldState());

    const headers = [...container.querySelectorAll<HTMLElement>('.loom-grid-header-cell')];
    const nameHeader = headers.find((header) => header.textContent?.includes('Name'));
    const secondHeader = headers.find((header) => header.textContent?.includes('Second'));
    expect(nameHeader?.querySelector('.loom-field-type-icon svg')).not.toBeNull();
    expect(secondHeader?.querySelector('.loom-field-type-icon svg')).not.toBeNull();
    expect(nameHeader?.querySelector('.loom-field-type-icon')?.getAttribute('aria-hidden')).toBe(
      'true',
    );
    expect(nameHeader?.textContent).toContain('Name');
    expect(secondHeader?.textContent).toContain('Second');
  });

  it('keeps the sort control working when a field type icon is present', () => {
    const container = document.createElement('div');
    const callbacks = { ...rendererCallbacks(), onApplySort: vi.fn() };
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), callbacks);
    renderer.render(createState(1));

    const button = container.querySelector<HTMLButtonElement>('.loom-grid-sort');
    expect(button?.querySelector('.loom-field-type-icon svg')).not.toBeNull();
    expect(button?.textContent).toContain('Name');
    button?.click();
    expect(callbacks.onApplySort).toHaveBeenCalled();
  });

  it('opens a cell context menu with edit, copy, and details actions', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const callbacks = rendererCallbacks();
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), callbacks);
    renderer.render(createState(1));

    const cell = container.querySelector<HTMLElement>(
      '.loom-grid-cell[data-record-id="record_01"]',
    );
    cell?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 40, clientY: 50 }));

    const menu = container.querySelector<HTMLElement>('.loom-context-menu');
    expect(menu?.getAttribute('role')).toBe('menu');
    const items = [...(menu?.querySelectorAll<HTMLButtonElement>('.loom-context-menu-item') ?? [])];
    expect(items.map((item) => item.textContent)).toEqual([
      'Edit cell',
      'Copy cell',
      'Clear cell',
      'Open details',
    ]);
    expect(items.every((item) => item.querySelector('.loom-ui-icon svg') !== null)).toBe(true);
    items.find((item) => item.textContent === 'Open details')?.click();
    expect(callbacks.onRecordOpen).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'record_01' }),
    );
    expect(container.querySelector('.loom-context-menu')).toBeNull();
    container.remove();
  });

  it('dismisses the context menu with Escape and closes on outside pointerdown', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const renderer = new ReadonlyGridRenderer(
      container,
      createTranslator('en'),
      rendererCallbacks(),
    );
    renderer.render(createState(1));
    const cell = container.querySelector<HTMLElement>('.loom-grid-cell');

    cell?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 5, clientY: 5 }));
    expect(container.querySelector('.loom-context-menu')).not.toBeNull();
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    expect(container.querySelector('.loom-context-menu')).toBeNull();

    cell?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 5, clientY: 5 }));
    expect(container.querySelector('.loom-context-menu')).not.toBeNull();
    document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(container.querySelector('.loom-context-menu')).toBeNull();
    container.remove();
  });

  it('routes the context-menu delete entry through the confirmation flow', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const callbacks = {
      ...rendererCallbacks(),
      onDeleteRecord: vi.fn(async (_recordId: string) => undefined),
      confirmDangerousAction: vi.fn(async () => true),
    };
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), callbacks);
    renderer.render(createState(1));

    const cell = container.querySelector<HTMLElement>(
      '.loom-grid-cell[data-record-id="record_01"]',
    );
    cell?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 5, clientY: 5 }));
    const danger = [
      ...container.querySelectorAll<HTMLButtonElement>('.loom-context-menu-item'),
    ].find((item) => item.dataset.variant === 'danger');
    expect(danger?.textContent).toBe('Delete Record');
    danger?.click();
    await vi.waitFor(() => expect(callbacks.onDeleteRecord).toHaveBeenCalledWith('record_01'));
    container.remove();
  });

  it('paints filler grid lines and an inline add-record row below the last record', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const callbacks = {
      ...rendererCallbacks(),
      onCreateRecord: vi.fn(async () => ({ id: 'record_new' }) as never),
    };
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), callbacks);
    renderer.render(createState(2));

    const canvas = container.querySelector<HTMLElement>('.loom-grid-canvas');
    expect(canvas?.style.backgroundImage).toContain('repeating-linear-gradient');
    const addRow = container.querySelector<HTMLButtonElement>(
      '.loom-grid-add-row[data-action="grid-add-row"]',
    );
    expect(addRow).not.toBeNull();
    expect(addRow?.textContent).toContain('Add Record');
    addRow?.click();
    expect(container.querySelector('.loom-record-create')).not.toBeNull();
    container.remove();
  });

  it('does not render the inline add row while more pages remain', () => {
    const container = document.createElement('div');
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), {
      ...rendererCallbacks(),
      onCreateRecord: vi.fn(async () => ({ id: 'record_new' }) as never),
    });
    renderer.render(createState(2, { hasMore: true, nextCursor: 'cursor_2' }));
    expect(container.querySelector('.loom-grid-add-row')).toBeNull();
  });

  it('clears an editable cell value from the context menu', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const callbacks = rendererCallbacks();
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), callbacks);
    renderer.render(createState(1));

    container
      .querySelector<HTMLElement>('.loom-grid-cell[data-record-id="record_01"]')
      ?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 5, clientY: 5 }));
    const clearItem = [
      ...container.querySelectorAll<HTMLButtonElement>('.loom-context-menu-item'),
    ].find((item) => item.textContent === 'Clear cell');
    expect(clearItem?.disabled).toBe(false);
    clearItem?.click();
    expect(callbacks.onCellEdit).toHaveBeenCalledWith('record_01', 'field_name', null);
    container.remove();
  });
});
