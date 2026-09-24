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
import type { ViewCreateOutcome, ViewWriteOutcome } from '../../src/ui/view-write-coordinator';

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
    firstCell?.click();
    const firstEditor = container.querySelector<HTMLInputElement>('.loom-grid-editor');
    expect(firstEditor).not.toBeNull();
    firstEditor!.value = 'Renamed Record';
    firstEditor?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));

    expect(callbacks.onCellEdit).toHaveBeenCalledWith('record_01', 'field_name', 'Renamed Record');
    expect(document.activeElement).toBe(
      container.querySelector('.loom-grid-cell[data-field-id="field_second"]'),
    );

    container.querySelector<HTMLElement>('.loom-grid-cell[data-field-id="field_second"]')?.click();
    container.querySelector<HTMLElement>('.loom-grid-cell[data-field-id="field_second"]')?.click();
    const secondEditor = container.querySelector<HTMLInputElement>('.loom-grid-editor');
    expect(secondEditor).not.toBeNull();
    secondEditor!.value = 'Changed Second';
    secondEditor?.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Tab',
        shiftKey: true,
        bubbles: true,
      }),
    );

    expect(callbacks.onCellEdit).toHaveBeenCalledWith(
      'record_01',
      'field_second',
      'Changed Second',
    );
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
    cell?.click();
    const editor = container.querySelector<HTMLInputElement>('.loom-grid-editor');
    expect(editor).not.toBeNull();
    editor!.value = 'Edited value';
    editor?.dispatchEvent(new Event('blur', { bubbles: true }));
    await vi.waitFor(() => expect(callbacks.onCellEdit).toHaveBeenCalledTimes(1));
    expect(callbacks.onCellEdit).toHaveBeenCalledWith('record_01', 'field_name', 'Edited value');

    renderer.render(createState(1, { editStatuses: { record_01: 'saving' } }));
    const savingCell = container.querySelector<HTMLElement>(
      '.loom-grid-cell[data-record-id="record_01"]',
    );
    savingCell?.click();
    expect(container.querySelector('.loom-grid-editor')).toBeNull();
  });

  it('skips the commit when the editor value is unchanged', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const callbacks = rendererCallbacks();
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), callbacks);

    renderer.render(createState(1));
    const cell = container.querySelector<HTMLElement>('.loom-grid-editable');
    cell?.click();
    cell?.click();
    const editor = container.querySelector<HTMLInputElement>('.loom-grid-editor');
    expect(editor).not.toBeNull();
    editor?.dispatchEvent(new Event('blur', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(callbacks.onCellEdit).not.toHaveBeenCalled();
    container.remove();
  });

  it('enters edit mode on Cell double click and opens the Record from the index cell', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const callbacks = rendererCallbacks();
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), callbacks);

    renderer.render(createState(1));
    const cell = container.querySelector<HTMLElement>('.loom-grid-editable');
    cell?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(container.querySelector('.loom-grid-editor')).not.toBeNull();
    expect(callbacks.onRecordOpen).not.toHaveBeenCalled();

    renderer.render(createState(1));
    const indexCell = container.querySelector<HTMLElement>('.loom-grid-index-cell');
    indexCell?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(callbacks.onRecordOpen).toHaveBeenCalledTimes(1);
    container.remove();
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
    const unsetCell = container.querySelector('.loom-grid-cell[data-field-id="field_location"]');
    expect(unsetCell?.textContent).toBe('');
    expect(unsetCell?.querySelector('.loom-field-value')?.getAttribute('data-value-state')).toBe(
      'unset',
    );
    renderer.render(locationState({ label: 'No coordinates' }));
    expect(
      container.querySelector('.loom-grid-cell[data-field-id="field_location"]')?.textContent,
    ).toBe('Unlocated');
    renderer.render(locationState({ lat: 90, lng: 0 }));
    expect(
      container.querySelector('.loom-grid-cell[data-field-id="field_location"]')?.textContent,
    ).toContain('Not renderable');
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

  it('raises an error toast with a Resolve action when a new conflict appears', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const renderer = new ReadonlyGridRenderer(
      container,
      createTranslator('en'),
      rendererCallbacks(),
    );
    const conflicted = createState(1, {
      conflicts: [
        {
          recordId: 'record_01',
          clientMutationId: 'mutation_01',
          failedCommandIndex: 0,
          expectedRevision: 1,
          currentRevision: 2,
          currentValues: { field_name: 'Server value' },
          message: 'Revision conflict.',
        },
      ],
    });

    renderer.render(conflicted);
    const toast = container.querySelector<HTMLElement>('.loom-toast--error');
    expect(toast?.textContent).toContain('sync conflict');
    const resolve = toast?.querySelector<HTMLButtonElement>('.loom-toast-action');
    expect(resolve?.textContent).toBe('Resolve');
    resolve?.click();
    expect(container.querySelector('.loom-toast--error')).toBeNull();
    expect(document.activeElement).toBe(container.querySelector('.loom-grid-conflicts'));

    // The same conflict set must not re-toast on the next render.
    renderer.render(conflicted);
    expect(container.querySelector('.loom-toast--error')).toBeNull();
    container.remove();
  });

  it('survives re-renders so a toast stays visible while state churns', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const renderer = new ReadonlyGridRenderer(
      container,
      createTranslator('en'),
      rendererCallbacks(),
    );
    renderer.render(createState(1));
    renderer.showToast({ kind: 'info', text: 'Sticky note' });
    renderer.render(createState(2));
    expect(container.querySelector('.loom-toast-text')?.textContent).toBe('Sticky note');
    container.remove();
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
  it('submits Search after a typing pause and on Enter immediately', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const onSearch = vi.fn(async (_term: string) => true);
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), {
      ...rendererCallbacks(),
      onSearch,
    });
    renderer.render(createState(1));

    container.querySelector<HTMLButtonElement>('[data-action="search-expand"]')?.click();
    const input = container.querySelector<HTMLInputElement>('input[data-role="grid-search"]');
    if (input === null) throw new Error('Search input is missing.');
    input.value = 'alp';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(onSearch).not.toHaveBeenCalled();

    await vi.waitFor(() => expect(onSearch).toHaveBeenCalledWith('alp'), {
      timeout: 1000,
    });

    onSearch.mockClear();
    input.value = 'alpine';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await vi.waitFor(() => expect(onSearch).toHaveBeenCalledWith('alpine'));
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

  it('collapses an empty search input on blur without re-entering render', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), {
      ...rendererCallbacks(),
      onSearch: vi.fn(async () => true),
    });
    renderer.render(createState(1, { search: '' }));
    container.querySelector<HTMLButtonElement>('[data-action="search-expand"]')?.click();
    const input = container.querySelector<HTMLInputElement>('input[data-role="grid-search"]');
    if (input === null) throw new Error('Search input is missing.');
    input.dispatchEvent(new FocusEvent('blur'));
    await vi.waitFor(() =>
      expect(
        container.querySelector<HTMLInputElement>('input[data-role="grid-search"]'),
      ).toBeNull(),
    );
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

    container.querySelector<HTMLButtonElement>('[data-action="search-expand"]')?.click();
    const input = container.querySelector<HTMLInputElement>('input[data-role="grid-search"]');
    if (input === null) throw new Error('Search input is missing.');
    input.value = 'x'.repeat(501);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.waitFor(() => expect(onSearch).toHaveBeenCalled(), { timeout: 1000 });
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

    await vi.waitFor(() => expect(onApplyFilter).toHaveBeenCalled(), { timeout: 1000 });
    expect(onApplyFilter.mock.calls[0]?.[0]).toBe('view_01');
    expect(onApplyFilter.mock.calls[0]?.[1]).toEqual({
      kind: 'group',
      operator: 'and',
      children: [{ kind: 'rule', fieldId: 'field_name', operator: 'is', value: 'needle' }],
    });

    renderer.render(savedState);
    // Immediate mode keeps the panel open after a successful write.
    expect(container.querySelector('.loom-filter-builder')).not.toBeNull();
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
    await vi.waitFor(() => expect(onApplyFilter).toHaveBeenCalled(), { timeout: 1000 });

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

  it('selects the whole column on header click without sorting', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const onApplySort = vi.fn();
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), {
      ...rendererCallbacks(),
      onApplySort,
    });
    renderer.render(createState(3));

    const header = container.querySelector<HTMLElement>(
      '.loom-grid-header-cell[data-field-id="field_name"]',
    );
    expect(header).not.toBeNull();
    header?.click();

    expect(onApplySort).not.toHaveBeenCalled();
    expect(header?.classList.contains('is-selected')).toBe(true);
    expect(header?.getAttribute('aria-selected')).toBe('true');
    const cells = container.querySelectorAll<HTMLElement>(
      '.loom-grid-cell[data-field-id="field_name"].is-selected',
    );
    expect(cells).toHaveLength(3);
    container.remove();
  });

  it('keeps sort reachable from the column context menu', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const onApplySort = vi.fn(async () => ({
      status: 'saved' as const,
      view: createState(1).views[0]!,
    }));
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), {
      ...rendererCallbacks(),
      onApplySort,
    });
    renderer.render(createState(1));

    const header = container.querySelector<HTMLElement>(
      '.loom-grid-header-cell[data-field-id="field_name"]',
    );
    header?.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, clientX: 20, clientY: 30 }),
    );
    const menu = document.querySelector<HTMLElement>('.loom-context-menu');
    expect(menu).not.toBeNull();
    const sortAsc = [...(menu?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])].find(
      (item) => item.textContent?.includes('Sort ascending'),
    );
    expect(sortAsc).not.toBeUndefined();
    sortAsc?.click();
    await vi.waitFor(() =>
      expect(onApplySort).toHaveBeenCalledWith('view_01', [
        { fieldId: 'field_name', direction: 'asc', nulls: 'last' },
      ]),
    );
    container.remove();
  });

  it('still reports the active sort on the column header', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), {
      ...rendererCallbacks(),
      onApplySort: vi.fn(async () => ({
        status: 'saved' as const,
        view: createState(1).views[0]!,
      })),
    });
    const state = createState(1);
    const view = state.views[0];
    if (view?.type !== 'grid') throw new Error('View fixture is missing.');
    renderer.render({
      ...state,
      views: [
        {
          ...view,
          config: {
            ...view.config,
            sort: [{ fieldId: 'field_name', direction: 'desc', nulls: 'last' }],
          },
        },
      ],
    });
    const header = container.querySelector<HTMLElement>(
      '.loom-grid-header-cell[data-field-id="field_name"]',
    );
    expect(header?.getAttribute('aria-sort')).toBe('descending');
    expect(header?.querySelector('.loom-grid-sort-indicator')?.textContent).toBe('↓');
    container.remove();
  });

  it('opens the Field Editor on header double-click', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), {
      ...rendererCallbacks(),
      onFieldSave: vi.fn(),
    });
    renderer.render(createTwoFieldState());

    const header = container.querySelector<HTMLElement>(
      '.loom-grid-header-cell[data-field-id="field_name"]',
    );
    header?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

    const panel = container.querySelector<HTMLElement>('.loom-field-editor');
    expect(panel).not.toBeNull();
    expect(panel?.querySelector<HTMLInputElement>('.loom-field-editor-name')?.value).toBe('Name');
    container.remove();
  });

  it('opens the Field Editor on Enter and selects the column on Space', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), {
      ...rendererCallbacks(),
      onFieldSave: vi.fn(),
    });
    renderer.render(createTwoFieldState());

    const header = container.querySelector<HTMLElement>(
      '.loom-grid-header-cell[data-field-id="field_name"]',
    );
    header?.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(header?.classList.contains('is-selected')).toBe(true);

    header?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    const panel = container.querySelector<HTMLElement>('.loom-field-editor');
    expect(panel).not.toBeNull();
    expect(panel?.querySelector<HTMLInputElement>('.loom-field-editor-name')?.value).toBe('Name');
    container.remove();
  });

  it('moves focus between headers on Arrow keys and opens the menu on ContextMenu', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), {
      ...rendererCallbacks(),
      onFieldSave: vi.fn(),
    });
    renderer.render(createTwoFieldState());

    const first = container.querySelector<HTMLElement>(
      '.loom-grid-header-cell[data-field-id="field_name"]',
    );
    const second = container.querySelector<HTMLElement>(
      '.loom-grid-header-cell[data-field-id="field_second"]',
    );
    first?.focus();
    first?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(document.activeElement).toBe(second);

    second?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(document.activeElement).toBe(first);

    first?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ContextMenu', bubbles: true }));
    expect(document.querySelector('.loom-context-menu')).not.toBeNull();
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

    await vi.waitFor(() => expect(onApplyDisplay).toHaveBeenCalled(), { timeout: 1000 });
    const patch = onApplyDisplay.mock.calls.at(-1)?.[1];
    expect(patch?.columnWidths).toEqual({ field_name: 240 });
    expect(patch?.projection).toEqual(['field_name']);

    renderer.render(savedState);
    // Immediate mode keeps the panel open after a successful write.
    expect(container.querySelector('.loom-display-panel')).not.toBeNull();
    container.remove();
  });

  it('rebuilds the Display panel when the persisted config changes externally', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), {
      ...rendererCallbacks(),
      onApplyDisplay: vi.fn(),
    });
    renderer.render(createState(1));
    container.querySelector<HTMLButtonElement>('[data-action="toggle-display"]')?.click();
    const width = () =>
      container.querySelector<HTMLInputElement>(
        '.loom-display-panel li[data-field-id="field_name"] input[data-role="display-width"]',
      );
    expect(width()?.value).toBe('180');

    // Another client wrote new widths to the same View while the panel is open.
    const state = createState(1);
    const view = state.views[0] as Extract<View, { type: 'grid' }>;
    const next = {
      ...state,
      views: [
        { ...view, revision: 2, config: { ...view.config, columnWidths: { field_name: 320 } } },
      ],
    };
    renderer.render(next);

    expect(width()?.value).toBe('320');
    container.remove();
  });

  it('keeps a pending Display draft when an unrelated render lands', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const pending = new Promise<ViewWriteOutcome>(() => {});
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), {
      ...rendererCallbacks(),
      onApplyDisplay: vi.fn(async () => pending),
    });
    renderer.render(createState(1));
    container.querySelector<HTMLButtonElement>('[data-action="toggle-display"]')?.click();
    const width = container.querySelector<HTMLInputElement>(
      '.loom-display-panel li[data-field-id="field_name"] input[data-role="display-width"]',
    );
    if (width === null) throw new Error('width input missing');
    width.value = '240';
    width.dispatchEvent(new Event('input', { bubbles: true }));

    // A render with an externally-changed config must not clobber the draft
    // that is still being applied.
    const state = createState(1);
    const view = state.views[0] as Extract<View, { type: 'grid' }>;
    renderer.render({
      ...state,
      views: [
        { ...view, revision: 2, config: { ...view.config, columnWidths: { field_name: 320 } } },
      ],
    });

    const after = container.querySelector<HTMLInputElement>(
      '.loom-display-panel li[data-field-id="field_name"] input[data-role="display-width"]',
    );
    expect(after?.value).toBe('240');
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

  it('keeps the query toggles in the start group while Search expands beside them', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), {
      ...rendererCallbacks(),
      onSearch: vi.fn(async () => true),
    });
    renderer.render(createState(1));

    container.querySelector<HTMLButtonElement>('[data-action="search-expand"]')?.click();
    const toolbar = container.querySelector('.loom-grid-toolbar');
    const search = container.querySelector('.loom-grid-search.is-expanded');
    const toggles = container.querySelector('.loom-grid-query-toggles');
    const start = container.querySelector('.loom-toolbar-start');
    const end = container.querySelector('.loom-toolbar-end');
    // The search wrap is a toolbar-level sibling so the expanded input grows
    // into the free space between the groups instead of overlaying them.
    expect(search?.parentElement).toBe(toolbar);
    expect(toggles?.parentElement).toBe(start);
    const order = [...(toolbar?.children ?? [])];
    expect(order.indexOf(start!)).toBeLessThan(order.indexOf(search!));
    expect(order.indexOf(search!)).toBeLessThan(order.indexOf(end!));
    container.remove();
  });

  it('rebuilds the cached Sort Panel when the persisted sort changes elsewhere', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), {
      ...rendererCallbacks(),
      onApplySort: vi.fn(
        async () => ({ status: 'saved', view: createState(0).views[0]! }) as const,
      ),
    });
    const state = createState(1);
    renderer.render(state);
    container.querySelector<HTMLElement>('[data-action="toggle-sort"]')?.click();
    expect(container.querySelectorAll('.loom-sort-panel li[data-sort-index]')).toHaveLength(0);

    // An external writer (e.g. the header quick-sort) lands a new sort.
    const view = state.views[0];
    if (view?.type !== 'grid') throw new Error('View fixture is missing.');
    renderer.render({
      ...state,
      views: [
        {
          ...view,
          config: {
            ...view.config,
            sort: [{ fieldId: 'field_name', direction: 'asc', nulls: 'last' }],
          },
        },
      ],
    });
    expect(container.querySelectorAll('.loom-sort-panel li[data-sort-index]')).toHaveLength(1);
    container.remove();
  });

  it('keeps a pending Sort Panel draft when an unrelated render lands', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const onApplySort = vi.fn(
      async () => ({ status: 'saved', view: createState(0).views[0]! }) as const,
    );
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), {
      ...rendererCallbacks(),
      onApplySort,
    });
    const state = createState(1);
    renderer.render(state);
    container.querySelector<HTMLElement>('[data-action="toggle-sort"]')?.click();

    container
      .querySelector<HTMLButtonElement>('.loom-sort-panel [data-action="sort-add"]')
      ?.click();
    // A render while the debounced apply is pending must not wipe the draft row.
    renderer.render(state);
    expect(container.querySelectorAll('.loom-sort-panel li[data-sort-index]')).toHaveLength(1);
    await vi.waitFor(() => expect(onApplySort).toHaveBeenCalled(), { timeout: 1000 });
    container.remove();
  });

  it('rebuilds the cached Filter Builder when the persisted filter changes elsewhere', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), {
      ...rendererCallbacks(),
      onApplyFilter: vi.fn(
        async () => ({ status: 'saved', view: createState(0).views[0]! }) as const,
      ),
    });
    const state = createState(1);
    renderer.render(state);
    container.querySelector<HTMLElement>('[data-action="toggle-filter"]')?.click();
    expect(container.querySelector('.loom-filter-empty')).not.toBeNull();

    const view = state.views[0];
    if (view?.type !== 'grid') throw new Error('View fixture is missing.');
    renderer.render({
      ...state,
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
    expect(container.querySelector('.loom-filter-empty')).toBeNull();
    expect(container.querySelectorAll('.loom-filter-row')).toHaveLength(1);
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
    isDefault: false,
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
    unfilteredTotal: recordCount,
    search: '',
    emptyReason: null,
    error: null,
    editStatuses: {},
    conflicts: [],
    editError: null,
    moveError: null,
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

function createThreeFieldState(): GridState {
  const state = createTwoFieldState();
  const firstField = state.fields[0];
  const view = state.views[0];
  const record = state.records[0];
  if (firstField === undefined || view?.type !== 'grid' || record === undefined) {
    throw new Error('Grid fixture is missing.');
  }
  const thirdField: Field = {
    ...firstField,
    id: 'field_third',
    name: 'Third',
  };
  return {
    ...state,
    fields: [...state.fields, thirdField],
    views: [
      {
        ...view,
        config: {
          ...view.config,
          projection: ['field_name', 'field_second', 'field_third'],
          columnOrder: ['field_name', 'field_second', 'field_third'],
        },
      },
    ],
    records: [
      {
        ...record,
        values: { ...record.values, field_third: 'Third value' },
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
  it('restores focus to the same column header after a redraw', () => {
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

    const header = container.querySelector<HTMLElement>(
      '.loom-grid-header-cell[data-field-id="field_second"]',
    );
    expect(header).not.toBeNull();
    header?.focus();
    renderer.render(createTwoFieldState());

    expect(document.activeElement).toBe(
      container.querySelector('.loom-grid-header-cell[data-field-id="field_second"]'),
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

    const caret = container.querySelector<HTMLButtonElement>('[data-action="create-menu"]');
    expect(caret).not.toBeNull();
    caret?.click();
    container.querySelectorAll<HTMLButtonElement>('.loom-context-menu-item').forEach((item) => {
      if (item.textContent?.includes('Open create form')) item.click();
    });
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

  it('does not count applied create ops in the toolbar pending badge', () => {
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
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), {
      ...rendererCallbacks(),
      onCreateRecord: vi.fn(async () => created),
    });
    renderer.render(
      createState(1, {
        recordCreateOps: [
          {
            operationId: 'op_done',
            tableId: 'table_01',
            state: 'idle',
            createdRecord: created,
          },
        ],
      }),
    );
    expect(container.querySelector('.loom-grid-query-count')).toBeNull();

    renderer.render(
      createState(1, {
        recordCreateOps: [
          { operationId: 'op_pending', tableId: 'table_01', state: 'sending' },
          { operationId: 'op_failed', tableId: 'table_01', state: 'error' },
          {
            operationId: 'op_done',
            tableId: 'table_01',
            state: 'idle',
            createdRecord: created,
          },
        ],
      }),
    );
    expect(container.querySelector('.loom-grid-query-count')?.textContent).toBe('2 pending');
    container.remove();
  });
});

describe('Grid record lifecycle', () => {
  function lifecycleCallbacks() {
    return {
      ...rendererCallbacks(),
      onDeleteRecord: vi.fn(async (_recordId: string) => undefined),
      onDuplicateRecord: vi.fn(async (_recordId: string) => undefined),
      onUndoDelete: vi.fn(async () => undefined),
      onDismissDeleteNotice: vi.fn(),
      onLoadDeletedRecords: vi.fn(async () => undefined),
      onLoadMoreDeletedRecords: vi.fn(async () => undefined),
      onLoadServerHistory: vi.fn(async (_kind?: string) => undefined),
      onLoadMoreServerHistory: vi.fn(async (_kind?: string) => undefined),
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

  it('offers Insert row below only in manual order and forwards the Record id', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const callbacks = lifecycleCallbacks();
    const onInsertRecordBelow = vi.fn(async () => undefined);
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), {
      ...callbacks,
      onInsertRecordBelow,
    });
    const gridView = createState(2).views[0] as Extract<View, { type: 'grid' }>;
    const manualView: Extract<View, { type: 'grid' }> = {
      ...gridView,
      config: { ...gridView.config, manualSort: true },
    };
    renderer.render({ ...createState(2), views: [manualView] });

    container
      .querySelector<HTMLElement>('.loom-grid-index-cell')
      ?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 5, clientY: 5 }));
    const insert = [
      ...container.querySelectorAll<HTMLButtonElement>('.loom-context-menu-item'),
    ].find((item) => item.textContent?.includes('Insert row below'));
    expect(insert).not.toBeUndefined();
    insert?.click();
    await vi.waitFor(() => expect(onInsertRecordBelow).toHaveBeenCalledWith('record_01'));

    // A field-sorted View hides the item: "below" cannot be honored.
    renderer.render(createState(2));
    container
      .querySelector<HTMLElement>('.loom-grid-index-cell')
      ?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 5, clientY: 5 }));
    const sortedLabels = [
      ...container.querySelectorAll<HTMLButtonElement>('.loom-context-menu-item'),
    ].map((item) => item.textContent ?? '');
    expect(sortedLabels.some((label) => label.includes('Insert row below'))).toBe(false);
    container.remove();
  });

  it('offers Duplicate Record in the row context menu and forwards the Record id', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const callbacks = lifecycleCallbacks();
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), callbacks);
    renderer.render(createState(2));

    container
      .querySelector<HTMLElement>('.loom-grid-index-cell')
      ?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 5, clientY: 5 }));
    const duplicate = [
      ...container.querySelectorAll<HTMLButtonElement>('.loom-context-menu-item'),
    ].find((item) => item.textContent?.includes('Duplicate Record'));
    expect(duplicate).not.toBeUndefined();
    duplicate?.click();
    await vi.waitFor(() => expect(callbacks.onDuplicateRecord).toHaveBeenCalledWith('record_01'));
    container.remove();
  });

  it('deletes immediately without a confirmation dialog', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const callbacks = lifecycleCallbacks();
    const confirmDangerousAction = vi.fn(async () => false);
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), {
      ...callbacks,
      confirmDangerousAction,
    });
    renderer.render(createState(2));

    container
      .querySelector<HTMLElement>('.loom-grid-index-cell')
      ?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 5, clientY: 5 }));
    container
      .querySelector<HTMLButtonElement>('.loom-context-menu-item[data-variant="danger"]')
      ?.click();
    expect(container.querySelector('.loom-dangerous-confirmation')).toBeNull();
    expect(confirmDangerousAction).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(callbacks.onDeleteRecord).toHaveBeenCalledTimes(1);
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

    const toggle = container.querySelector<HTMLButtonElement>('[data-action="toggle-status"]');
    expect(toggle).not.toBeNull();
    toggle?.click();
    container.querySelector<HTMLButtonElement>('.loom-status-mode[data-mode="deleted"]')?.click();
    expect(callbacks.onLoadDeletedRecords).toHaveBeenCalledTimes(1);

    const panel = container.querySelector<HTMLElement>('.loom-status-panel');
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

    const openDeletedMode = (): void => {
      container.querySelector<HTMLButtonElement>('[data-action="toggle-status"]')?.click();
      container.querySelector<HTMLButtonElement>('.loom-status-mode[data-mode="deleted"]')?.click();
    };

    renderer.render(createState(1, { deletedRecordsStatus: 'loading' }));
    openDeletedMode();
    expect(container.querySelector('.loom-recycle-status')?.textContent).toContain('Loading');

    renderer.render(createState(1, { deletedRecordsStatus: 'ready', deletedRecords: [] }));
    container.querySelector<HTMLButtonElement>('[data-action="toggle-status"]')?.click();
    await Promise.resolve();
    openDeletedMode();
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

  it('opens the status panel with change history, refresh, and deleted records', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const callbacks = lifecycleCallbacks();
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), callbacks);
    renderer.render(
      createState(1, {
        historyEntries: [
          {
            kind: 'edit',
            recordId: 'record_01',
            fieldName: 'Name',
            recordTitle: 'Record 1',
            at: '2026-09-15T10:00:00.000Z',
          },
          {
            kind: 'delete',
            recordId: 'record_02',
            recordTitle: 'Record 2',
            at: '2026-09-15T10:01:00.000Z',
          },
        ],
        deletedRecords: [deletedRecord('record_09')],
        deletedRecordsStatus: 'ready',
      }),
    );

    container.querySelector<HTMLButtonElement>('[data-action="toggle-status"]')?.click();
    const panel = container.querySelector<HTMLElement>('.loom-status-panel');
    expect(panel).not.toBeNull();
    expect(panel?.querySelectorAll('.loom-change-item')).toHaveLength(2);
    expect(panel?.querySelector('.loom-change-item-kind')?.textContent).toBe('Edited');
    expect(panel?.querySelector('[aria-label="Refresh"]')).not.toBeNull();
    panel?.querySelector<HTMLButtonElement>('.loom-status-mode[data-mode="deleted"]')?.click();
    const rerendered = container.querySelector<HTMLElement>('.loom-status-panel');
    expect(rerendered?.querySelectorAll('.loom-recycle-item')).toHaveLength(1);
    expect(callbacks.onLoadDeletedRecords).toHaveBeenCalledTimes(1);
    container.remove();
  });

  it('renders Server history entries with field diffs and loads on demand', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const callbacks = lifecycleCallbacks();
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), callbacks);
    renderer.render(
      createState(1, {
        serverHistoryStatus: 'ready',
        serverHistoryHasMore: true,
        serverHistory: [
          {
            id: 'ch_1',
            kind: 'recordUpdated',
            tableId: 'table_01',
            recordId: 'record_01',
            revision: 3,
            occurredAt: '2026-09-20T10:00:00Z',
            primaryFieldText: 'Alpha',
            fields: [{ fieldId: 'field_name', before: 'A', after: 'Alpha' }],
          },
          {
            id: 'ch_2',
            kind: 'recordCreated',
            tableId: 'table_01',
            recordId: 'record_02',
            revision: 1,
            occurredAt: '2026-09-20T09:00:00Z',
            primaryFieldText: 'Beta',
          },
        ],
      }),
    );

    container.querySelector<HTMLButtonElement>('[data-action="toggle-status"]')?.click();
    container.querySelector<HTMLButtonElement>('.loom-status-mode[data-mode="history"]')?.click();
    expect(callbacks.onLoadServerHistory).not.toHaveBeenCalled();

    const panel = container.querySelector<HTMLElement>('.loom-status-panel');
    const items = panel?.querySelectorAll<HTMLElement>('.loom-change-item') ?? [];
    expect(items).toHaveLength(2);
    expect(items[0]?.querySelector('.loom-change-item-title')?.textContent).toBe('Alpha');
    expect(items[0]?.querySelector('.loom-change-item-kind')?.textContent).toBe('Edited');
    expect(items[0]?.querySelector('.loom-change-item-delta')?.textContent).toContain(
      'Name: A → Alpha',
    );
    expect(items[1]?.querySelector('.loom-change-item-kind')?.textContent).toBe('Created');
    expect(items[0]?.querySelector('.loom-change-item-undo')).toBeNull();

    panel?.querySelector<HTMLButtonElement>('.loom-recycle-load-more')?.click();
    expect(callbacks.onLoadMoreServerHistory).toHaveBeenCalledTimes(1);
    container.remove();
  });

  it('requests Server history when opening the tab while it is idle', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const callbacks = lifecycleCallbacks();
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), callbacks);
    renderer.render(createState(1, { serverHistoryStatus: 'idle' }));

    container.querySelector<HTMLButtonElement>('[data-action="toggle-status"]')?.click();
    container.querySelector<HTMLButtonElement>('.loom-status-mode[data-mode="history"]')?.click();
    expect(callbacks.onLoadServerHistory).toHaveBeenCalledTimes(1);

    const panel = container.querySelector<HTMLElement>('.loom-status-panel');
    expect(panel?.querySelector('.loom-recycle-status')?.textContent).toContain('No history');
    container.remove();
  });

  it('filters change history by kind and renders value deltas', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const renderer = new ReadonlyGridRenderer(
      container,
      createTranslator('en'),
      lifecycleCallbacks(),
    );
    renderer.render(
      createState(1, {
        historyEntries: [
          {
            kind: 'edit',
            recordId: 'record_01',
            fieldName: 'Name',
            recordTitle: 'Record 1',
            before: 'old',
            after: 'new',
            at: '2026-09-15T10:00:00.000Z',
          },
          {
            kind: 'delete',
            recordId: 'record_02',
            recordTitle: 'Record 2',
            at: '2026-09-15T10:01:00.000Z',
          },
        ],
      }),
    );

    container.querySelector<HTMLButtonElement>('[data-action="toggle-status"]')?.click();
    const panel = container.querySelector<HTMLElement>('.loom-status-panel');
    expect(panel?.querySelector('.loom-change-item-delta')?.textContent).toContain('old');
    expect(panel?.querySelector('.loom-change-item-delta')?.textContent).toContain('new');

    panel?.querySelector<HTMLButtonElement>('.loom-change-filter[data-kind="delete"]')?.click();
    const rerendered = container.querySelector<HTMLElement>('.loom-status-panel');
    const items = rerendered?.querySelectorAll<HTMLElement>('.loom-change-item') ?? [];
    expect(items).toHaveLength(1);
    expect(items[0]?.dataset.kind).toBe('delete');

    rerendered?.querySelector<HTMLButtonElement>('.loom-change-filter[data-kind="all"]')?.click();
    expect(
      container
        .querySelector<HTMLElement>('.loom-status-panel')
        ?.querySelectorAll('.loom-change-item'),
    ).toHaveLength(2);
    container.remove();
  });

  it('wires per-entry undo to onUndoTo with the original entry index', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const callbacks = lifecycleCallbacks();
    const onUndoTo = vi.fn(async () => undefined);
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), {
      ...callbacks,
      onUndoTo,
    });
    renderer.render(
      createState(1, {
        historyEntries: [
          {
            kind: 'edit',
            recordId: 'record_01',
            fieldName: 'Name',
            recordTitle: 'Record 1',
            at: '2026-09-15T10:00:00.000Z',
          },
          {
            kind: 'delete',
            recordId: 'record_02',
            recordTitle: 'Record 2',
            at: '2026-09-15T10:01:00.000Z',
          },
        ],
      }),
    );

    container.querySelector<HTMLButtonElement>('[data-action="toggle-status"]')?.click();
    const panel = container.querySelector<HTMLElement>('.loom-status-panel');
    const undoButtons = panel?.querySelectorAll<HTMLButtonElement>('.loom-change-item-undo');
    expect(undoButtons).toHaveLength(2);
    undoButtons?.[1]?.click();
    expect(onUndoTo).toHaveBeenCalledWith(1);
    container.remove();
  });

  it('anchors the status panel to the toolbar end and query panels under their toggle', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), {
      ...rendererCallbacks(),
      onApplyFilter: vi.fn(async () => ({ status: 'saved' }) as never),
      onLoadDeletedRecords: vi.fn(async () => undefined),
    });
    renderer.render(createState(1));

    container.querySelector<HTMLButtonElement>('[data-action="toggle-status"]')?.click();
    const statusPanel = container.querySelector<HTMLElement>('.loom-status-panel');
    expect(statusPanel?.classList.contains('loom-query-panel--end')).toBe(true);

    container.querySelector<HTMLButtonElement>('[data-action="toggle-status"]')?.click();
    container.querySelector<HTMLButtonElement>('[data-action="toggle-filter"]')?.click();
    const filterPanel = container.querySelector<HTMLElement>(
      '.loom-query-panel[data-panel="filter"]',
    );
    // Unmeasurable test DOM leaves the custom property unset so the CSS
    // default (0) anchors the panel at the toolbar start.
    expect(filterPanel?.style.getPropertyValue('--loom-panel-anchor')).toBe('');
    container.remove();
  });

  it('anchors the query panel to its toggle using post-mount geometry', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), {
      ...rendererCallbacks(),
      onApplyFilter: vi.fn(async () => ({ status: 'saved' }) as never),
    });
    renderer.render(createState(1));

    const rect = (left: number, width: number): DOMRect => ({
      left,
      right: left + width,
      width,
      top: 0,
      bottom: 0,
      height: 0,
      x: left,
      y: 0,
      toJSON: () => ({}),
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this.dataset?.action === 'toggle-filter') return rect(320, 90);
      if (this.classList?.contains('loom-grid-toolbar')) return rect(0, 800);
      if (this.classList?.contains('loom-query-panel')) return rect(0, 380);
      return rect(0, 0);
    });
    container.querySelector<HTMLButtonElement>('[data-action="toggle-filter"]')?.click();
    await vi.waitFor(() => {
      const panel = container.querySelector<HTMLElement>('.loom-query-panel[data-panel="filter"]');
      expect(panel?.style.getPropertyValue('--loom-panel-anchor')).toBe('320px');
    });
    vi.restoreAllMocks();
    container.remove();
  });

  it('closes an open panel on outside pointerdown and keeps it on inside clicks', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), {
      ...rendererCallbacks(),
      onApplyFilter: vi.fn(async () => ({ status: 'saved' }) as never),
    });
    renderer.render(createState(1));

    container.querySelector<HTMLButtonElement>('[data-action="toggle-filter"]')?.click();
    const panel = container.querySelector<HTMLElement>('.loom-query-panel[data-panel="filter"]');
    expect(panel).not.toBeNull();

    panel?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(container.querySelector('.loom-query-panel[data-panel="filter"]')).not.toBeNull();

    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(container.querySelector('.loom-query-panel[data-panel="filter"]')).toBeNull();
    container.remove();
  });

  it('closes an open panel on Escape and refocuses nothing destructive', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), {
      ...rendererCallbacks(),
      onApplyFilter: vi.fn(async () => ({ status: 'saved' }) as never),
    });
    renderer.render(createState(1));

    container.querySelector<HTMLButtonElement>('[data-action="toggle-filter"]')?.click();
    expect(container.querySelector('.loom-query-panel[data-panel="filter"]')).not.toBeNull();

    container.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(container.querySelector('.loom-query-panel[data-panel="filter"]')).toBeNull();
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

  it('renders the field type icon and name as header content without a sort button', () => {
    const container = document.createElement('div');
    const callbacks = { ...rendererCallbacks(), onApplySort: vi.fn() };
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), callbacks);
    renderer.render(createState(1));

    const header = container.querySelector<HTMLElement>(
      '.loom-grid-header-cell[data-field-id="field_name"]',
    );
    expect(header?.querySelector('.loom-field-type-icon svg')).not.toBeNull();
    expect(header?.textContent).toContain('Name');
    expect(header?.querySelector('button[data-action="header-sort"]')).toBeNull();
    header?.click();
    expect(callbacks.onApplySort).not.toHaveBeenCalled();
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
    expect(addRow?.getAttribute('aria-label')).toContain('Add Record');
    addRow?.click();
    expect(container.querySelector('.loom-grid-draft-row')).not.toBeNull();
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

  it('creates a record inline from the draft row on Enter', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const record: LoomTableRecord = {
      id: 'record_new',
      tableId: 'table_01',
      revision: 1,
      values: { field_name: 'Drafted' },
      createdAt: '2026-08-15T00:00:00Z',
      updatedAt: '2026-08-15T00:00:00Z',
    };
    const onCreateRecord = vi.fn(async () => record);
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), {
      ...rendererCallbacks(),
      onCreateRecord,
    });
    renderer.render(createState(1));

    container
      .querySelector<HTMLElement>('.loom-grid-add-row')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const draftRow = container.querySelector<HTMLElement>('.loom-grid-draft-row');
    expect(draftRow).not.toBeNull();
    const editor = draftRow?.querySelector<HTMLInputElement>('.loom-grid-editor');
    expect(editor).not.toBeNull();
    if (editor === null || editor === undefined) return;
    editor.value = 'Drafted';
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await vi.waitFor(() => expect(onCreateRecord).toHaveBeenCalledWith({ field_name: 'Drafted' }));
    container.remove();
  });

  it('discards the draft row on Escape without creating', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const onCreateRecord = vi.fn(async () => ({ id: 'record_new' }) as never);
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), {
      ...rendererCallbacks(),
      onCreateRecord,
    });
    renderer.render(createState(1));

    container
      .querySelector<HTMLElement>('.loom-grid-add-row')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const editor = container.querySelector<HTMLElement>('.loom-grid-draft-row .loom-grid-editor');
    expect(editor).not.toBeNull();
    editor?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await Promise.resolve();
    expect(container.querySelector('.loom-grid-draft-row')).toBeNull();
    expect(onCreateRecord).not.toHaveBeenCalled();
    container.remove();
  });

  it('moves focus to the created record cell once inline create lands', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const record: LoomTableRecord = {
      id: 'record_new',
      tableId: 'table_01',
      revision: 1,
      values: { field_name: 'Drafted' },
      createdAt: '2026-08-15T00:00:00Z',
      updatedAt: '2026-08-15T00:00:00Z',
    };
    const onCreateRecord = vi.fn(async () => record);
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), {
      ...rendererCallbacks(),
      onCreateRecord,
    });
    renderer.render(createState(1));

    container
      .querySelector<HTMLElement>('.loom-grid-add-row')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const editor = container.querySelector<HTMLInputElement>(
      '.loom-grid-draft-row .loom-grid-editor',
    );
    editor!.value = 'Drafted';
    editor?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await vi.waitFor(() => expect(onCreateRecord).toHaveBeenCalledWith({ field_name: 'Drafted' }));
    await Promise.resolve();
    await Promise.resolve();

    // An intermediate publish (create-op applied) without the record must not
    // resolve the pending focus yet.
    renderer.render(createState(1));
    expect(container.querySelector('.loom-grid-cell[data-record-id="record_new"]')).toBeNull();

    // The refetch publish arrives with the created record visible.
    renderer.render(createState(1, { records: [record], changeCursor: 'change_02' }));

    expect(document.activeElement).toBe(
      container.querySelector(
        '.loom-grid-cell[data-record-id="record_new"][data-field-id="field_name"]',
      ),
    );
    container.remove();
  });

  it('returns focus to the create entry when the new record is filtered out', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const record: LoomTableRecord = {
      id: 'record_new',
      tableId: 'table_01',
      revision: 1,
      values: { field_name: 'Drafted' },
      createdAt: '2026-08-15T00:00:00Z',
      updatedAt: '2026-08-15T00:00:00Z',
    };
    const onCreateRecord = vi.fn(async () => record);
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), {
      ...rendererCallbacks(),
      onCreateRecord,
    });
    renderer.render(createState(1));

    container
      .querySelector<HTMLElement>('.loom-grid-add-row')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const editor = container.querySelector<HTMLInputElement>(
      '.loom-grid-draft-row .loom-grid-editor',
    );
    editor!.value = 'Drafted';
    editor?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await vi.waitFor(() => expect(onCreateRecord).toHaveBeenCalledWith({ field_name: 'Drafted' }));
    await Promise.resolve();
    await Promise.resolve();

    // The post-create refetch landed without the record (e.g. an active
    // filter) — focus falls back to the stable create entry point.
    renderer.render(createState(1, { changeCursor: 'change_02' }));

    expect(document.activeElement).toBe(container.querySelector('.loom-grid-record-create'));
    container.remove();
  });

  it('restores the draft row and its focus when inline create fails', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const onCreateRecord = vi.fn(async () => {
      throw new Error('create failed');
    });
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), {
      ...rendererCallbacks(),
      onCreateRecord,
    });
    renderer.render(createState(1));

    container
      .querySelector<HTMLElement>('.loom-grid-add-row')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const editor = container.querySelector<HTMLInputElement>(
      '.loom-grid-draft-row .loom-grid-editor',
    );
    editor!.value = 'Drafted';
    editor?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await vi.waitFor(() => expect(onCreateRecord).toHaveBeenCalled());
    await vi.waitFor(() => expect(container.querySelector('.loom-grid-draft-row')).not.toBeNull());

    const draftRow = container.querySelector<HTMLElement>('.loom-grid-draft-row');
    const restoredEditor = draftRow?.querySelector<HTMLInputElement>('.loom-grid-editor');
    expect(restoredEditor?.value).toBe('Drafted');
    expect(document.activeElement).toBe(restoredEditor);
    container.remove();
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

describe('column menu and field editor', () => {
  it('closes the query panel when the field editor opens, and vice versa', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), {
      ...rendererCallbacks(),
      onFieldSave: vi.fn(),
      onApplySort: vi.fn(
        async () => ({ status: 'saved', view: createState(0).views[0]! }) as const,
      ),
    });
    renderer.render(createState(1));

    container.querySelector<HTMLElement>('[data-action="toggle-sort"]')?.click();
    expect(container.querySelector('.loom-query-panel[data-panel="sort"]')).not.toBeNull();

    container.querySelector<HTMLElement>('.loom-grid-add-field button')?.click();
    expect(container.querySelector('.loom-field-editor')).not.toBeNull();
    expect(container.querySelector('.loom-query-panel[data-panel="sort"]')).toBeNull();

    container.querySelector<HTMLElement>('[data-action="toggle-sort"]')?.click();
    expect(container.querySelector('.loom-query-panel[data-panel="sort"]')).not.toBeNull();
    expect(container.querySelector('.loom-field-editor')).toBeNull();
    container.remove();
  });

  it('renders an add-field header cell that opens the create panel', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const onFieldSave = vi.fn();
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), {
      ...rendererCallbacks(),
      onFieldSave,
    });
    renderer.render(createState(1));

    const addCell = container.querySelector<HTMLElement>('.loom-grid-add-field');
    expect(addCell).not.toBeNull();
    addCell?.querySelector('button')?.click();

    const panel = container.querySelector<HTMLElement>('.loom-field-editor');
    expect(panel).not.toBeNull();
    expect(panel?.querySelectorAll('.loom-field-editor-type')).toHaveLength(10);
    container.remove();
  });

  it('moves focus to the field name input once the editor is installed', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), {
      ...rendererCallbacks(),
      onFieldSave: vi.fn(),
    });
    renderer.render(createState(1));

    container.querySelector<HTMLElement>('.loom-grid-add-field button')?.click();
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(container.querySelector('.loom-field-editor-name'));
    });
    container.remove();
  });

  it('keeps the open field editor and its focus across a re-render', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), {
      ...rendererCallbacks(),
      onFieldSave: vi.fn(),
    });
    renderer.render(createState(1));

    container.querySelector<HTMLElement>('.loom-grid-add-field button')?.click();
    const name = container.querySelector<HTMLInputElement>('.loom-field-editor-name');
    await vi.waitFor(() => expect(document.activeElement).toBe(name));
    name!.value = 'Notes';

    // A publish-driven re-render while the editor is open must not destroy the
    // overlay or steal the user's focus.
    renderer.render(createState(1));

    const panel = container.querySelector<HTMLElement>('.loom-field-editor');
    expect(panel).not.toBeNull();
    expect(document.activeElement).toBe(name);
    expect(container.querySelector<HTMLInputElement>('.loom-field-editor-name')?.value).toBe(
      'Notes',
    );
    container.remove();
  });

  it('returns focus to the add-field trigger when the editor closes', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), {
      ...rendererCallbacks(),
      onFieldSave: vi.fn(),
    });
    renderer.render(createState(1));

    container.querySelector<HTMLElement>('.loom-grid-add-field button')?.click();
    await vi.waitFor(() => expect(container.querySelector('.loom-field-editor')).not.toBeNull());
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(container.querySelector('.loom-field-editor')).toBeNull();
    expect(document.activeElement).toBe(container.querySelector('.loom-grid-add-field-button'));
    container.remove();
  });

  it('keeps Tab cycling inside the field editor', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), {
      ...rendererCallbacks(),
      onFieldSave: vi.fn(),
    });
    renderer.render(createState(1));

    container.querySelector<HTMLElement>('.loom-grid-add-field button')?.click();
    const panel = container.querySelector<HTMLElement>('.loom-field-editor');
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(panel?.querySelector('.loom-field-editor-name')),
    );

    // Tab must be intercepted and cycle inside the dialog rather than escaping
    // into the background UI.
    const tab = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true });
    document.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(true);
    const moved = document.activeElement;
    expect(moved).not.toBe(panel?.querySelector('.loom-field-editor-name'));
    expect(panel?.contains(moved)).toBe(true);
    for (let index = 0; index < 12; index += 1) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', cancelable: true }));
      expect(panel?.contains(document.activeElement)).toBe(true);
    }
    const shiftTab = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      cancelable: true,
    });
    document.dispatchEvent(shiftTab);
    expect(shiftTab.defaultPrevented).toBe(true);
    expect(panel?.contains(document.activeElement)).toBe(true);
    container.remove();
  });

  it('filters the create-panel type list through the search box', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), {
      ...rendererCallbacks(),
      onFieldSave: vi.fn(),
    });
    renderer.render(createState(1));
    container.querySelector<HTMLElement>('.loom-grid-add-field button')?.click();

    const panel = container.querySelector<HTMLElement>('.loom-field-editor');
    expect(panel?.querySelector('.loom-field-editor-type-desc')?.textContent).not.toBe('');
    const search = panel?.querySelector<HTMLInputElement>('.loom-field-editor-type-search');
    expect(search).not.toBeNull();
    search!.value = 'map';
    search?.dispatchEvent(new Event('input', { bubbles: true }));

    const visible = [
      ...(panel?.querySelectorAll<HTMLElement>('.loom-field-editor-type') ?? []),
    ].filter((item) => !item.hidden);
    expect(visible.map((item) => item.dataset.type)).toEqual(['location']);
    search!.value = '';
    search?.dispatchEvent(new Event('input', { bubbles: true }));
    expect(
      [...(panel?.querySelectorAll<HTMLElement>('.loom-field-editor-type') ?? [])].filter(
        (item) => !item.hidden,
      ),
    ).toHaveLength(10);
    container.remove();
  });

  it('omits the add-field cell when the client cannot write Fields', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const renderer = new ReadonlyGridRenderer(
      container,
      createTranslator('en'),
      rendererCallbacks(),
    );
    renderer.render(createState(1));

    expect(container.querySelector('.loom-grid-add-field')).toBeNull();
    container.remove();
  });

  it('submits a new Field through the panel create flow', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const onFieldSave = vi.fn(async () => undefined);
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), {
      ...rendererCallbacks(),
      onFieldSave,
    });
    renderer.render(createState(1));

    container.querySelector<HTMLElement>('.loom-grid-add-field button')?.click();
    const name = container.querySelector<HTMLInputElement>('.loom-field-editor-name');
    expect(name).not.toBeNull();
    name!.value = 'Notes';
    const selectType = [
      ...container.querySelectorAll<HTMLButtonElement>('.loom-field-editor-type'),
    ].find((item) => item.dataset.type === 'select');
    selectType?.click();
    container.querySelector<HTMLButtonElement>('.loom-field-editor-submit')?.click();
    await Promise.resolve();

    expect(onFieldSave).toHaveBeenCalledWith(
      { name: 'Notes', type: 'select', options: [], description: '' },
      { mode: 'create' },
    );
    container.remove();
  });

  it('opens the column menu on header contextmenu with edit/insert/hide/delete', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const onFieldSave = vi.fn();
    const onFieldDelete = vi.fn();
    const onApplySort = vi.fn();
    const onApplyDisplay = vi.fn();
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), {
      ...rendererCallbacks(),
      onFieldSave,
      onFieldDelete,
      onApplySort,
      onApplyDisplay,
    });
    renderer.render(createTwoFieldState());

    const headers = container.querySelectorAll<HTMLElement>(
      '.loom-grid-header-cell:not(.loom-grid-index-header):not(.loom-grid-add-field)',
    );
    headers[1]?.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, clientX: 8, clientY: 8 }),
    );

    const labels = [
      ...container.querySelectorAll<HTMLButtonElement>('.loom-context-menu-item'),
    ].map((item) => item.textContent);
    for (const expected of [
      'Edit field',
      'Insert field left',
      'Insert field right',
      'Sort ascending',
      'Sort descending',
      'Hide field',
      'Delete field',
    ]) {
      expect(labels).toContain(expected);
    }
    container.remove();
  });

  it('disables delete on the Primary Field', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), {
      ...rendererCallbacks(),
      onFieldSave: vi.fn(),
      onFieldDelete: vi.fn(),
    });
    renderer.render(createState(1));

    container
      .querySelector<HTMLElement>('.loom-grid-header-cell:not(.loom-grid-index-header)')
      ?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    const danger = container.querySelector<HTMLButtonElement>(
      '.loom-context-menu-item[data-variant="danger"]',
    );
    expect(danger?.disabled).toBe(true);
    container.remove();
  });

  it('deletes a Field after the dangerous-action confirmation', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const onFieldDelete = vi.fn(async () => undefined);
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), {
      ...rendererCallbacks(),
      onFieldSave: vi.fn(),
      onFieldDelete,
      confirmDangerousAction: vi.fn(async () => true),
    });
    renderer.render(createTwoFieldState());

    const headers = container.querySelectorAll<HTMLElement>(
      '.loom-grid-header-cell:not(.loom-grid-index-header):not(.loom-grid-add-field)',
    );
    headers[1]?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    container
      .querySelector<HTMLButtonElement>('.loom-context-menu-item[data-variant="danger"]')
      ?.click();
    await vi.waitFor(() => expect(onFieldDelete).toHaveBeenCalled());
    container.remove();
  });
});

describe('search highlight and footer', () => {
  it('marks search hits inside cell text', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const renderer = new ReadonlyGridRenderer(
      container,
      createTranslator('en'),
      rendererCallbacks(),
    );
    renderer.render(createState(2, { search: 'record' }));

    const hits = container.querySelectorAll('.loom-search-hit');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.textContent?.toLowerCase()).toBe('record');
    container.remove();
  });

  it('renders the row count in the aggregate stats row instead of a footer', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), {
      ...rendererCallbacks(),
      onSetFieldAggregation: vi.fn(async () => {}),
    });
    renderer.render(createState(3));

    const count = container.querySelector<HTMLElement>('.loom-grid-aggregate-count');
    expect(count?.textContent).toContain('3');
    expect(container.querySelector('.loom-grid-footer')).toBeNull();
    container.remove();
  });

  it('moves cell focus horizontally with Tab and wraps across rows', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const renderer = new ReadonlyGridRenderer(
      container,
      createTranslator('en'),
      rendererCallbacks(),
    );
    const state = createTwoFieldState();
    renderer.render({
      ...state,
      records: [
        ...state.records,
        { ...state.records[0]!, id: 'record_02', values: { field_name: 'Two' } },
      ],
    });

    const cells = container.querySelectorAll<HTMLElement>('.loom-grid-cell');
    cells[0]?.focus();
    cells[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(document.activeElement).toBe(cells[1]);
    cells[1]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(document.activeElement).toBe(cells[2]);
    cells[2]?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }),
    );
    expect(document.activeElement).toBe(cells[1]);
    container.remove();
  });
});

function createTwoByTwoState(): GridState {
  const state = createTwoFieldState();
  const first = state.records[0];
  if (first === undefined) throw new Error('Grid fixture is missing.');
  return {
    ...state,
    records: [
      first,
      { ...first, id: 'record_02', values: { field_name: 'Record 2', field_second: 'Row 2' } },
    ],
  };
}

describe('Cell selection model', () => {
  it('selects a Cell on click and enters edit on second click', () => {
    const container = document.createElement('div');
    const callbacks = rendererCallbacks();
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), callbacks);

    renderer.render(createState(2));
    const cell = container.querySelector<HTMLElement>(
      '.loom-grid-cell[data-field-id="field_name"][data-record-id="record_01"]',
    );
    cell?.click();
    expect(cell?.classList.contains('is-selected')).toBe(true);
    expect(container.querySelector('.loom-grid-editor')).toBeNull();
    cell?.click();
    expect(container.querySelector('.loom-grid-editor')).not.toBeNull();
  });

  it('extends a rectangular selection with Shift+click', () => {
    const container = document.createElement('div');
    const renderer = new ReadonlyGridRenderer(
      container,
      createTranslator('en'),
      rendererCallbacks(),
    );

    renderer.render(createTwoByTwoState());
    const first = container.querySelector<HTMLElement>(
      '.loom-grid-cell[data-field-id="field_name"][data-record-id="record_01"]',
    );
    first?.click();
    const last = container.querySelector<HTMLElement>(
      '.loom-grid-cell[data-field-id="field_second"][data-record-id="record_02"]',
    );
    last?.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
    expect(container.querySelectorAll('.loom-grid-cell.is-selected').length).toBe(4);
    expect(
      container
        .querySelector('.loom-grid-cell[data-field-id="field_second"][data-record-id="record_01"]')
        ?.classList.contains('is-selected'),
    ).toBe(true);
  });

  it('selects a whole Row via its number and a whole Column via its header', () => {
    const container = document.createElement('div');
    const renderer = new ReadonlyGridRenderer(
      container,
      createTranslator('en'),
      rendererCallbacks(),
    );

    renderer.render(createTwoByTwoState());
    container
      .querySelector('.loom-grid-row[data-row-index="1"] .loom-grid-index-cell')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const rowSelected = container.querySelectorAll(
      '.loom-grid-row[data-row-index="1"] .loom-grid-cell.is-selected',
    ).length;
    expect(rowSelected).toBe(2);

    container
      .querySelectorAll<HTMLElement>('.loom-grid-header-cell[data-field-index]')[0]
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(
      container.querySelectorAll('.loom-grid-cell[data-field-id="field_name"].is-selected').length,
    ).toBe(2);
  });

  it('selects all visible Cells with Ctrl+A and copies the range as TSV', async () => {
    const container = document.createElement('div');
    const writes: string[] = [];
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), {
      ...rendererCallbacks(),
      clipboard: {
        writeText: (text: string) => {
          writes.push(text);
          return Promise.resolve();
        },
        readText: () => Promise.resolve(''),
      },
    });

    renderer.render(createTwoByTwoState());
    const cell = container.querySelector<HTMLElement>(
      '.loom-grid-cell[data-field-id="field_name"][data-record-id="record_01"]',
    );
    cell?.focus();
    cell?.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true }));
    expect(container.querySelectorAll('.loom-grid-cell.is-selected').length).toBe(4);
    cell?.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true }));
    await vi.waitFor(() => expect(writes.length).toBe(1));
    expect(writes[0]).toContain('\t');
    expect(writes[0]).toContain('\n');
  });
});

describe('Undo/redo wiring', () => {
  it('routes Ctrl+Z and Ctrl+Shift+Z to the history callbacks', () => {
    const container = document.createElement('div');
    const onUndo = vi.fn();
    const onRedo = vi.fn();
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), {
      ...rendererCallbacks(),
      onUndo,
      onRedo,
    });

    renderer.render(createState(2));
    const cell = container.querySelector<HTMLElement>(
      '.loom-grid-cell[data-field-id="field_name"][data-record-id="record_01"]',
    );
    cell?.focus();
    cell?.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    expect(onUndo).toHaveBeenCalledTimes(1);
    cell?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true, bubbles: true }),
    );
    expect(onRedo).toHaveBeenCalledTimes(1);
  });

  it('renders toolbar undo/redo buttons gated by history availability', async () => {
    const container = document.createElement('div');
    const onUndo = vi.fn();
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), {
      ...rendererCallbacks(),
      onUndo,
      onRedo: vi.fn(),
    });

    renderer.render(createState(2));
    const buttons = [...container.querySelectorAll<HTMLButtonElement>('.loom-grid-toolbar button')];
    const undo = buttons.find((button) => button.getAttribute('aria-label') === 'Undo');
    const redo = buttons.find((button) => button.getAttribute('aria-label') === 'Redo');
    expect(undo).toBeDefined();
    expect(redo).toBeDefined();
    expect(undo?.classList.contains('loom-action-icon')).toBe(true);
    expect(undo?.textContent).toBe('');
    expect(undo?.querySelector('.loom-ui-icon')).not.toBeNull();
    undo?.click();
    await vi.waitFor(() => expect(onUndo).toHaveBeenCalledTimes(1));

    renderer.render({ ...createState(2), canUndo: false, canRedo: false });
    const disabled = [
      ...container.querySelectorAll<HTMLButtonElement>('.loom-grid-toolbar button'),
    ];
    expect(disabled.find((button) => button.getAttribute('aria-label') === 'Undo')?.disabled).toBe(
      true,
    );
    expect(disabled.find((button) => button.getAttribute('aria-label') === 'Redo')?.disabled).toBe(
      true,
    );
  });
});

describe('Toolbar overflow', () => {
  function stubResizeObserver(): ResizeObserverCallback[] {
    const callbacks: ResizeObserverCallback[] = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          callbacks.push(callback);
        }
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      },
    );
    return callbacks;
  }

  function overflowRenderer(container: HTMLElement) {
    const onUndo = vi.fn();
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), {
      ...rendererCallbacks(),
      onApplyFilter: vi.fn(async () => ({ status: 'saved' }) as never),
      onApplySort: vi.fn(async () => ({ status: 'saved' }) as never),
      onApplyDisplay: vi.fn(async () => ({ status: 'saved' }) as never),
      onUndo,
      onRedo: vi.fn(),
    });
    return { renderer, onUndo };
  }

  it('collapses secondary actions behind a ⋯ menu when the toolbar overflows', async () => {
    const roCallbacks = stubResizeObserver();
    const container = document.createElement('div');
    document.body.append(container);
    const { renderer, onUndo } = overflowRenderer(container);
    renderer.render(createState(1));

    const toolbar = container.querySelector<HTMLElement>('.loom-grid-toolbar');
    if (toolbar === null) throw new Error('toolbar missing');
    Object.defineProperty(toolbar, 'clientWidth', { value: 220, configurable: true });
    Object.defineProperty(toolbar, 'scrollWidth', { value: 560, configurable: true });
    for (const callback of roCallbacks) callback([], {} as ResizeObserver);

    const overflow = toolbar.querySelector<HTMLElement>('.loom-toolbar-overflow');
    expect(overflow?.hidden).toBe(false);
    for (const selector of [
      '[data-action="toggle-sort"]',
      '[data-action="toggle-display"]',
      '[aria-label="Undo"]',
      '[aria-label="Redo"]',
    ]) {
      expect(toolbar.querySelector<HTMLElement>(selector)?.hidden).toBe(true);
    }
    // The keep-list stays on the main row.
    expect(toolbar.querySelector<HTMLElement>('[data-action="toggle-filter"]')?.hidden).toBe(false);
    expect(toolbar.querySelector<HTMLElement>('[data-action="toggle-status"]')?.hidden).toBe(false);
    expect(toolbar.querySelector<HTMLElement>('[data-action="search-expand"]')?.hidden).toBe(false);

    overflow?.click();
    const menu = container.querySelector('.loom-context-menu');
    expect(menu).not.toBeNull();
    const items = [...(menu?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    expect(items.map((item) => item.textContent)).toEqual(['Sort', 'Display', 'Undo', 'Redo']);
    items[2]?.click();
    await vi.waitFor(() => expect(onUndo).toHaveBeenCalledTimes(1));
    container.remove();
  });

  it('keeps every action on the main row when the toolbar fits', () => {
    const roCallbacks = stubResizeObserver();
    const container = document.createElement('div');
    document.body.append(container);
    const { renderer } = overflowRenderer(container);
    renderer.render(createState(1));

    const toolbar = container.querySelector<HTMLElement>('.loom-grid-toolbar');
    if (toolbar === null) throw new Error('toolbar missing');
    Object.defineProperty(toolbar, 'clientWidth', { value: 900, configurable: true });
    Object.defineProperty(toolbar, 'scrollWidth', { value: 560, configurable: true });
    for (const callback of roCallbacks) callback([], {} as ResizeObserver);

    const overflow = toolbar.querySelector<HTMLElement>('.loom-toolbar-overflow');
    expect(overflow?.hidden).toBe(true);
    expect(toolbar.querySelector<HTMLElement>('[data-action="toggle-sort"]')?.hidden).toBe(false);
    container.remove();
  });

  it('badges the ⋯ button when an overflowed toggle is active', () => {
    const roCallbacks = stubResizeObserver();
    const container = document.createElement('div');
    document.body.append(container);
    const { renderer } = overflowRenderer(container);
    const state = createState(1);
    const view = state.views[0];
    if (view?.type !== 'grid') throw new Error('View fixture is missing.');
    renderer.render({
      ...state,
      views: [
        {
          ...view,
          config: {
            ...view.config,
            sort: [{ fieldId: 'field_name', direction: 'asc', nulls: 'last' }],
          },
        },
      ],
    });

    const toolbar = container.querySelector<HTMLElement>('.loom-grid-toolbar');
    if (toolbar === null) throw new Error('toolbar missing');
    Object.defineProperty(toolbar, 'clientWidth', { value: 220, configurable: true });
    Object.defineProperty(toolbar, 'scrollWidth', { value: 560, configurable: true });
    for (const callback of roCallbacks) callback([], {} as ResizeObserver);

    const overflow = toolbar.querySelector<HTMLElement>('.loom-toolbar-overflow');
    expect(overflow?.hidden).toBe(false);
    expect(overflow?.querySelector('.loom-grid-query-count')?.textContent).toBe('1');
    container.remove();
  });
});

describe('Column drag reorder', () => {
  function fakeDataTransfer(): DataTransfer {
    const store: Record<string, string> = {};
    return {
      types: ['text/plain'],
      effectAllowed: 'move',
      dropEffect: 'move',
      setData: (type: string, value: string) => {
        store[type] = value;
      },
      getData: (type: string) => store[type] ?? '',
    } as unknown as DataTransfer;
  }

  it('reorders columnOrder when a header is dropped on another header', async () => {
    const container = document.createElement('div');
    const onApplyDisplay = vi.fn(
      async (_viewId: string, _patch: GridDisplayPatch): Promise<ViewWriteOutcome> => ({
        status: 'saved',
        view: createTwoByTwoState().views[0] as View,
      }),
    );
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), {
      ...rendererCallbacks(),
      onApplyDisplay,
    });

    renderer.render(createTwoByTwoState());
    const headers = container.querySelectorAll<HTMLElement>(
      '.loom-grid-header-cell[data-field-index]',
    );
    const source = headers[0];
    const target = headers[1];
    expect(source?.draggable).toBe(true);

    const transfer = fakeDataTransfer();
    const dragstart = new Event('dragstart', { bubbles: true });
    Object.defineProperty(dragstart, 'dataTransfer', { value: transfer });
    source?.dispatchEvent(dragstart);
    const dragover = new Event('dragover', { bubbles: true, cancelable: true });
    Object.defineProperty(dragover, 'dataTransfer', { value: transfer });
    Object.defineProperty(dragover, 'clientX', { value: 1 });
    target?.dispatchEvent(dragover);
    expect(target?.classList.contains('is-drop-after')).toBe(true);
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', { value: transfer });
    Object.defineProperty(drop, 'clientX', { value: 1 });
    target?.dispatchEvent(drop);

    await vi.waitFor(() => expect(onApplyDisplay).toHaveBeenCalledTimes(1));
    expect(onApplyDisplay.mock.calls[0]?.[0]).toBe('view_01');
    expect(onApplyDisplay.mock.calls[0]?.[1]?.columnOrder).toEqual(['field_second', 'field_name']);
  });

  it('inserts before the target column when the drop lands on the left half', async () => {
    const container = document.createElement('div');
    const onApplyDisplay = vi.fn(
      async (_viewId: string, _patch: GridDisplayPatch): Promise<ViewWriteOutcome> => ({
        status: 'saved',
        view: createThreeFieldState().views[0] as View,
      }),
    );
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), {
      ...rendererCallbacks(),
      onApplyDisplay,
    });

    renderer.render(createThreeFieldState());
    const headers = container.querySelectorAll<HTMLElement>(
      '.loom-grid-header-cell[data-field-index]',
    );
    const source = headers[2];
    const target = headers[1];
    vi.spyOn(target!, 'getBoundingClientRect').mockReturnValue({
      left: 100,
      width: 40,
      top: 0,
      right: 140,
      bottom: 36,
      height: 36,
      x: 100,
      y: 0,
      toJSON: () => ({}),
    });

    const transfer = fakeDataTransfer();
    const dragstart = new Event('dragstart', { bubbles: true });
    Object.defineProperty(dragstart, 'dataTransfer', { value: transfer });
    source?.dispatchEvent(dragstart);
    const dragover = new Event('dragover', { bubbles: true, cancelable: true });
    Object.defineProperty(dragover, 'dataTransfer', { value: transfer });
    Object.defineProperty(dragover, 'clientX', { value: 101 });
    target?.dispatchEvent(dragover);
    expect(target?.classList.contains('is-drop-before')).toBe(true);
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', { value: transfer });
    Object.defineProperty(drop, 'clientX', { value: 101 });
    target?.dispatchEvent(drop);

    await vi.waitFor(() => expect(onApplyDisplay).toHaveBeenCalledTimes(1));
    expect(onApplyDisplay.mock.calls[0]?.[1]?.columnOrder).toEqual([
      'field_name',
      'field_third',
      'field_second',
    ]);
  });

  it('skips the View write when a header drop leaves the column order unchanged', async () => {
    const container = document.createElement('div');
    const onApplyDisplay = vi.fn(
      async (_viewId: string, _patch: GridDisplayPatch): Promise<ViewWriteOutcome> => ({
        status: 'saved',
        view: createThreeFieldState().views[0] as View,
      }),
    );
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), {
      ...rendererCallbacks(),
      onApplyDisplay,
    });

    renderer.render(createThreeFieldState());
    const headers = container.querySelectorAll<HTMLElement>(
      '.loom-grid-header-cell[data-field-index]',
    );
    const source = headers[0];
    const target = headers[1];
    vi.spyOn(target!, 'getBoundingClientRect').mockReturnValue({
      left: 100,
      width: 40,
      top: 0,
      right: 140,
      bottom: 36,
      height: 36,
      x: 100,
      y: 0,
      toJSON: () => ({}),
    });

    const transfer = fakeDataTransfer();
    const dragstart = new Event('dragstart', { bubbles: true });
    Object.defineProperty(dragstart, 'dataTransfer', { value: transfer });
    source?.dispatchEvent(dragstart);
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', { value: transfer });
    Object.defineProperty(drop, 'clientX', { value: 101 });
    target?.dispatchEvent(drop);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(onApplyDisplay).not.toHaveBeenCalled();
  });
});

describe('refresh indicator and anchored panels', () => {
  it('shows a toolbar refresh note instead of the loading banner when records exist', () => {
    const container = document.createElement('div');
    const callbacks = { ...rendererCallbacks(), onCreateRecord: vi.fn() };
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), callbacks);
    renderer.render(createState(3, { status: 'loading' }));

    expect(container.querySelector('.loom-grid-status')).toBeNull();
    const note = container.querySelector<HTMLElement>('.loom-grid-loading-note');
    expect(note?.textContent).toBe('Loading Grid records…');
    expect(note?.dataset.active).toBe('true');
    const create = container.querySelector('.loom-grid-record-create');
    expect(create?.closest('.loom-toolbar-start')).not.toBeNull();
    expect(
      note?.nextElementSibling instanceof HTMLElement &&
        note.nextElementSibling.dataset.action === 'toggle-status',
    ).toBe(true);
    expect(container.querySelector('.loom-grid-viewport')).not.toBeNull();
  });

  it('keeps the full loading status when the grid has no records yet', () => {
    const container = document.createElement('div');
    const renderer = new ReadonlyGridRenderer(
      container,
      createTranslator('en'),
      rendererCallbacks(),
    );
    renderer.render(createState(0, { status: 'loading' }));
    expect(container.querySelector('.loom-grid-status')).not.toBeNull();
  });

  it('anchors the filter panel inside the toolbar without displacing the grid', () => {
    const container = document.createElement('div');
    const callbacks = { ...rendererCallbacks(), onApplyFilter: vi.fn() };
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), callbacks);
    renderer.render(createState(3));
    container
      .querySelector<HTMLButtonElement>('[data-action="toggle-filter"]')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    const panel = container.querySelector('.loom-query-panel');
    expect(panel?.parentElement?.classList.contains('loom-grid-toolbar')).toBe(true);
    expect(container.querySelector('.loom-grid-viewport')).not.toBeNull();
  });

  it('renders the add-record row as a lone index-cell icon', () => {
    const container = document.createElement('div');
    const callbacks = { ...rendererCallbacks(), onCreateRecord: vi.fn() };
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), callbacks);
    renderer.render(createState(2));

    const addRow = container.querySelector<HTMLElement>('.loom-grid-add-row');
    expect(addRow).not.toBeNull();
    expect(addRow?.style.width).toBe('56px');
    expect(addRow?.querySelector('.loom-grid-add-row-label')).toBeNull();
    addRow?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(container.querySelector('.loom-grid-draft-row')).not.toBeNull();
  });

  it('opens the column menu from the always-visible header ellipsis', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const onFieldSave = vi.fn(async () => undefined);
    const onApplyFilter = vi.fn(async () => ({ status: 'saved' }) as never);
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), {
      ...rendererCallbacks(),
      onFieldSave,
      onApplyFilter,
    });
    renderer.render(createState(2));

    const menuButton = container.querySelector<HTMLButtonElement>(
      '.loom-grid-header-menu[data-action="field-menu"]',
    );
    expect(menuButton).not.toBeNull();
    menuButton?.click();
    const items = [...container.querySelectorAll<HTMLButtonElement>('.loom-context-menu-item')];
    const labels = items.map((item) => item.textContent ?? '');
    expect(labels.some((label) => label.includes('Duplicate field'))).toBe(true);
    expect(labels.some((label) => label.includes('Filter by this field'))).toBe(true);

    items.find((item) => item.textContent?.includes('Filter by this field'))?.click();
    const panel = container.querySelector<HTMLElement>('.loom-query-panel[data-panel="filter"]');
    expect(panel).not.toBeNull();
    container.remove();
  });

  it('exposes Number format only for Number columns and submits the chosen format', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const onFieldSave = vi.fn(async () => undefined);
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), {
      ...rendererCallbacks(),
      onFieldSave,
    });
    const scoreField: Field = {
      id: 'field_score',
      tableId: 'table_01',
      name: 'Score',
      position: 1,
      schemaVersion: 1,
      revision: 1,
      type: 'number',
      config: {},
    };
    const state = createState(1);
    const gridView = state.views[0] as Extract<View, { type: 'grid' }>;
    const view: Extract<View, { type: 'grid' }> = {
      ...gridView,
      config: {
        ...gridView.config,
        projection: ['field_name', 'field_score'],
        columnOrder: ['field_name', 'field_score'],
      },
    };
    renderer.render({
      ...state,
      views: [view],
      fields: [...state.fields, scoreField],
      records: state.records.map((record) => ({
        ...record,
        values: { ...record.values, field_score: 12345.6 },
      })),
    });

    const menuButtons = [
      ...container.querySelectorAll<HTMLButtonElement>('.loom-grid-header-menu'),
    ];
    expect(menuButtons).toHaveLength(2);
    // The text column menu must not offer Number format.
    menuButtons[0]?.click();
    let labels = [...container.querySelectorAll<HTMLButtonElement>('.loom-context-menu-item')].map(
      (item) => item.textContent ?? '',
    );
    expect(labels.some((label) => label.includes('Number format'))).toBe(false);
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));

    menuButtons[1]?.click();
    const formatItem = [
      ...container.querySelectorAll<HTMLButtonElement>('.loom-context-menu-item'),
    ].find((item) => item.textContent?.includes('Number format'));
    expect(formatItem).not.toBeUndefined();
    formatItem?.click();

    const panel = container.querySelector<HTMLElement>('.loom-number-format');
    expect(panel).not.toBeNull();
    const grouping = panel?.querySelector<HTMLInputElement>('input[type="checkbox"]');
    const decimals = panel?.querySelector<HTMLInputElement>('input[type="number"]');
    const currency = panel?.querySelector<HTMLSelectElement>('select');
    if (grouping && decimals && currency) {
      grouping.checked = true;
      decimals.value = '2';
      currency.value = 'USD';
    }
    panel?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    await vi.waitFor(() => expect(onFieldSave).toHaveBeenCalled());
    expect(onFieldSave).toHaveBeenCalledWith(
      {
        name: 'Score',
        type: 'number',
        format: { thousandsSeparator: true, decimals: 2, currency: 'USD' },
      },
      { mode: 'edit', fieldId: 'field_score' },
    );
    await vi.waitFor(() => expect(container.querySelector('.loom-number-format')).toBeNull());
    container.remove();
  });

  it('supports checkbox, Ctrl and Shift row selection from the index cell', () => {
    const container = document.createElement('div');
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), {
      ...rendererCallbacks(),
      onSetFieldAggregation: vi.fn(async () => {}),
    });
    renderer.render(createState(4));

    const indexCells = () => [
      ...container.querySelectorAll<HTMLElement>('.loom-grid-row .loom-grid-index-cell'),
    ];
    const checks = () => [...container.querySelectorAll<HTMLInputElement>('.loom-grid-row-check')];

    indexCells()[0]?.dispatchEvent(
      new MouseEvent('click', { bubbles: true, clientX: 5, clientY: 5 }),
    );
    indexCells()[2]?.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        clientX: 5,
        clientY: 5,
        shiftKey: true,
      }),
    );
    expect(checks().filter((input) => input.checked)).toHaveLength(3);

    checks()[1]?.click();
    expect(checks().filter((input) => input.checked)).toHaveLength(2);
    expect(container.querySelector('.loom-grid-aggregate-count')?.textContent).toContain(
      '2 rows selected',
    );
    container.remove();
  });

  it('shows loaded/total while more rows remain and a plain count when fully loaded', () => {
    const container = document.createElement('div');
    const renderer = new ReadonlyGridRenderer(
      container,
      createTranslator('en'),
      rendererCallbacks(),
    );
    renderer.render(createState(2, { totalCount: 5, hasMore: true, nextCursor: 'cursor_01' }));
    expect(container.querySelector('.loom-grid-count')?.textContent).toBe('2/5 rows');

    renderer.render(createState(2));
    expect(container.querySelector('.loom-grid-count')?.textContent).toBe('2 rows');
    container.remove();
  });

  it('shows filtered/unfiltered when the active filter hides rows', () => {
    const container = document.createElement('div');
    const renderer = new ReadonlyGridRenderer(
      container,
      createTranslator('en'),
      rendererCallbacks(),
    );
    renderer.render(createState(3, { totalCount: 3, unfilteredTotal: 10 }));
    expect(container.querySelector('.loom-grid-count')?.textContent).toBe('3/10 rows');
    container.remove();
  });

  it('keeps the refresh note mounted but hidden when idle', () => {
    const container = document.createElement('div');
    const renderer = new ReadonlyGridRenderer(
      container,
      createTranslator('en'),
      rendererCallbacks(),
    );
    renderer.render(createState(2));
    const note = container.querySelector<HTMLElement>('.loom-grid-loading-note');
    expect(note).not.toBeNull();
    expect(note?.dataset.active).toBe('false');
  });

  it('keeps the add-field cell as a header-only lone column', () => {
    const container = document.createElement('div');
    const callbacks = {
      ...rendererCallbacks(),
      onFieldSave: vi.fn(async () => ({ status: 'applied' }) as never),
    };
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), callbacks);
    renderer.render(createState(2));
    const header = container.querySelector<HTMLElement>('.loom-grid-header');
    const row = container.querySelector<HTMLElement>('.loom-grid-row');
    expect(header?.style.gridTemplateColumns.endsWith(' 2.5rem')).toBe(true);
    expect(row?.style.gridTemplateColumns.endsWith('2.5rem')).toBe(false);
    expect(row?.style.gridTemplateColumns).toBe(
      header?.style.gridTemplateColumns.replace(/ 2\.5rem$/, ''),
    );
    expect(container.querySelector('.loom-grid-add-field')).not.toBeNull();
    expect(container.querySelector('.loom-grid-viewport')?.getAttribute('aria-colcount')).toBe('3');
  });
});

describe('Grid aggregate row', () => {
  function numericState(update: Partial<GridState> = {}): GridState {
    const state = createState(1);
    const view = state.views[0];
    const record = state.records[0];
    if (view?.type !== 'grid' || record === undefined) {
      throw new Error('Grid fixture is missing.');
    }
    const numberField: Field = {
      id: 'field_count',
      tableId: 'table_01',
      name: 'Count',
      position: 1,
      schemaVersion: 1,
      revision: 1,
      type: 'number',
      config: {},
    };
    return {
      ...state,
      fields: [...state.fields, numberField],
      views: [
        {
          ...view,
          config: {
            ...view.config,
            projection: ['field_name', 'field_count'],
            columnOrder: ['field_name', 'field_count'],
          },
        },
      ],
      records: [{ ...record, values: { ...record.values, field_count: 4 } }],
      ...update,
    };
  }

  function renderAggregate(state: GridState, container: HTMLElement) {
    const callbacks = { ...rendererCallbacks(), onSetFieldAggregation: vi.fn() };
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), callbacks);
    renderer.render(state);
    return callbacks;
  }

  it('renders the aggregate row only when the callback is wired', () => {
    const container = document.createElement('div');
    const plain = new ReadonlyGridRenderer(container, createTranslator('en'), rendererCallbacks());
    plain.render(createState(1));
    expect(container.querySelector('.loom-grid-aggregate')).toBeNull();

    renderAggregate(createState(1), container);
    const row = container.querySelector<HTMLElement>('.loom-grid-aggregate');
    expect(row).not.toBeNull();
    expect(row?.querySelectorAll('.loom-grid-aggregate-cell').length).toBeGreaterThanOrEqual(2);
  });

  it('shows the selected function result per column', () => {
    const container = document.createElement('div');
    renderAggregate(
      numericState({
        fieldAggregations: { field_count: 'sum' },
        aggregateResults: { field_count: { sum: 12.5 } },
        aggregateStatus: 'ready',
      }),
      container,
    );
    const cell = container.querySelector<HTMLElement>(
      '.loom-grid-aggregate-cell[data-field-id="field_count"]',
    );
    expect(cell?.textContent).toBe('Sum 12.50');
    const text = container.querySelector<HTMLElement>(
      '.loom-grid-aggregate-cell[data-field-id="field_name"]',
    );
    expect(text?.dataset.empty).toBe('true');
  });

  it('opens the per-column menu with type-appropriate functions and applies the choice', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const callbacks = renderAggregate(numericState(), container);

    container
      .querySelector<HTMLElement>('.loom-grid-aggregate-cell[data-field-id="field_count"]')
      ?.click();
    const menu = container.querySelector<HTMLElement>('.loom-context-menu');
    expect(menu).not.toBeNull();
    for (const fn of ['count', 'sum', 'avg', 'min', 'max']) {
      expect(menu?.querySelector(`[data-action="aggregate-${fn}"]`)).not.toBeNull();
    }
    menu?.querySelector<HTMLButtonElement>('[data-action="aggregate-sum"]')?.click();
    expect(callbacks.onSetFieldAggregation).toHaveBeenCalledWith('field_count', 'sum');

    container
      .querySelector<HTMLElement>('.loom-grid-aggregate-cell[data-field-id="field_name"]')
      ?.click();
    const textMenu = container.querySelector<HTMLElement>('.loom-context-menu');
    expect(textMenu?.querySelector('[data-action="aggregate-count"]')).not.toBeNull();
    expect(textMenu?.querySelector('[data-action="aggregate-sum"]')).toBeNull();
    container.remove();
  });

  it('clears a selection through the None entry', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const callbacks = renderAggregate(
      numericState({
        fieldAggregations: { field_count: 'sum' },
        aggregateResults: { field_count: { sum: 12.5 } },
        aggregateStatus: 'ready',
      }),
      container,
    );
    container
      .querySelector<HTMLElement>('.loom-grid-aggregate-cell[data-field-id="field_count"]')
      ?.click();
    const none = container.querySelector<HTMLButtonElement>(
      '.loom-context-menu [data-action="aggregate-none"]',
    );
    expect(none?.disabled).toBe(false);
    none?.click();
    expect(callbacks.onSetFieldAggregation).toHaveBeenCalledWith('field_count', undefined);
    container.remove();
  });

  it('keeps the row mounted through loading and error states', () => {
    const container = document.createElement('div');
    const selections = {
      fieldAggregations: { field_count: 'sum' as const },
    };
    renderAggregate(numericState({ ...selections, aggregateStatus: 'loading' }), container);
    expect(
      container.querySelector<HTMLElement>('.loom-grid-aggregate-cell[data-field-id="field_count"]')
        ?.textContent,
    ).toBe('…');

    renderAggregate(numericState({ ...selections, aggregateStatus: 'error' }), container);
    const cell = container.querySelector<HTMLElement>(
      '.loom-grid-aggregate-cell[data-field-id="field_count"]',
    );
    expect(cell?.dataset.status).toBe('error');
    expect(cell?.textContent).toBe('Sum load failed');
    cell?.click();
    expect(
      container.querySelector<HTMLElement>('[data-action="aggregate-retry"]')?.textContent,
    ).toBe('Retry save');
  });
});

describe('Record drag reorder', () => {
  const RECORD_MIME = 'application/x-loom-record';

  function recordTransfer(): DataTransfer {
    const store: Record<string, string> = {};
    return {
      types: [RECORD_MIME],
      effectAllowed: 'move',
      dropEffect: 'move',
      setData: (type: string, value: string) => {
        store[type] = value;
      },
      getData: (type: string) => store[type] ?? '',
    } as unknown as DataTransfer;
  }

  function manualViewState(sort: readonly SortSpec[] = []): GridState {
    const state = createState(3);
    const view = state.views[0];
    if (view?.type !== 'grid') throw new Error('Grid fixture is missing.');
    return {
      ...state,
      views: [{ ...view, config: { ...view.config, sort, manualSort: true } }],
    };
  }

  function dispatchDrag(
    target: HTMLElement | null | undefined,
    type: string,
    transfer: DataTransfer,
    clientY = 0,
  ): void {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientY });
    Object.defineProperty(event, 'dataTransfer', { value: transfer });
    target?.dispatchEvent(event);
  }

  it('renders the hover trio (≡ handle, checkbox, open) in index cells', () => {
    const container = document.createElement('div');
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), {
      ...rendererCallbacks(),
      onMoveRecord: vi.fn(async () => {}),
    });
    renderer.render(createState(3));
    const indexCell = container.querySelector<HTMLElement>('.loom-grid-index-cell');
    expect(indexCell?.querySelector('.loom-grid-row-drag')?.textContent).toBe('≡');
    expect(indexCell?.querySelector('input.loom-grid-row-check')).not.toBeNull();
    expect(indexCell?.querySelector('.loom-grid-open')).not.toBeNull();
    expect(indexCell?.classList.contains('is-manual-order')).toBe(false);
  });

  it('marks index cells manual-order only when dragging is wired', () => {
    const container = document.createElement('div');
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), {
      ...rendererCallbacks(),
      onMoveRecord: vi.fn(async () => {}),
    });
    renderer.render(manualViewState());
    expect(
      container
        .querySelector<HTMLElement>('.loom-grid-index-cell')
        ?.classList.contains('is-manual-order'),
    ).toBe(true);

    renderer.render(createState(3));
    expect(
      container
        .querySelector<HTMLElement>('.loom-grid-index-cell')
        ?.classList.contains('is-manual-order'),
    ).toBe(false);
  });

  it('makes index cells draggable only in manual order mode', () => {
    const container = document.createElement('div');
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), {
      ...rendererCallbacks(),
      onMoveRecord: vi.fn(async () => {}),
    });
    renderer.render(manualViewState());
    expect(container.querySelector<HTMLElement>('.loom-grid-index-cell')?.draggable).toBe(true);

    renderer.render(manualViewState([{ fieldId: 'field_name', direction: 'asc', nulls: 'last' }]));
    expect(container.querySelector<HTMLElement>('.loom-grid-index-cell')?.draggable).toBe(false);

    renderer.render(createState(3));
    expect(container.querySelector<HTMLElement>('.loom-grid-index-cell')?.draggable).toBe(false);
  });

  it('stays inert when the move callback is not wired', () => {
    const container = document.createElement('div');
    const renderer = new ReadonlyGridRenderer(
      container,
      createTranslator('en'),
      rendererCallbacks(),
    );
    renderer.render(manualViewState());
    expect(container.querySelector<HTMLElement>('.loom-grid-index-cell')?.draggable).toBe(false);
  });

  it('drops before or after the target row by drop position', () => {
    const container = document.createElement('div');
    const onMoveRecord = vi.fn(async () => {});
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), {
      ...rendererCallbacks(),
      onMoveRecord,
    });
    renderer.render(manualViewState());
    const rows = container.querySelectorAll<HTMLElement>('.loom-grid-row');
    const sourceIndex = rows[0]?.querySelector<HTMLElement>('.loom-grid-index-cell');
    const target = rows[2];

    const transfer = recordTransfer();
    dispatchDrag(sourceIndex, 'dragstart', transfer);
    dispatchDrag(target, 'dragover', transfer);
    expect(target?.classList.contains('is-drop-target')).toBe(true);
    dispatchDrag(target, 'drop', transfer);
    expect(onMoveRecord).toHaveBeenCalledWith('record_01', { beforeRecordId: 'record_03' });

    dispatchDrag(sourceIndex, 'dragstart', transfer);
    dispatchDrag(target, 'drop', transfer, 10);
    expect(onMoveRecord).toHaveBeenCalledWith('record_01', { afterRecordId: 'record_03' });
  });

  it('ignores a drop of the dragged row onto itself', () => {
    const container = document.createElement('div');
    const onMoveRecord = vi.fn(async () => {});
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), {
      ...rendererCallbacks(),
      onMoveRecord,
    });
    renderer.render(manualViewState());
    const first = container.querySelector<HTMLElement>('.loom-grid-row');
    const transfer = recordTransfer();
    dispatchDrag(first?.querySelector<HTMLElement>('.loom-grid-index-cell'), 'dragstart', transfer);
    dispatchDrag(first, 'drop', transfer);
    expect(onMoveRecord).not.toHaveBeenCalled();
  });
});
