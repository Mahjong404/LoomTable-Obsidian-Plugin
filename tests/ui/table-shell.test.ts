import { describe, expect, it, vi } from 'vitest';

import type { Field, View, ViewBase } from '../../src/client/loomtable-client';
import { createTranslator } from '../../src/i18n';
import { TableShell, type TableShellState, type ViewCreateOutcome } from '../../src/ui/table-shell';
import type { PendingViewCreateIntent } from '../../src/ui/view-write-coordinator';

const WORKSPACE = { id: 'ws_01', name: 'Personal', revision: 1, createdAt: '', updatedAt: '' };
const BASE = {
  id: 'base_01',
  workspaceId: 'ws_01',
  name: 'Notes',
  revision: 1,
  createdAt: '',
  updatedAt: '',
};
const TABLE = {
  id: 'table_01',
  baseId: 'base_01',
  name: 'Projects',
  primaryFieldId: 'field_name',
  revision: 1,
  createdAt: '',
  updatedAt: '',
};

function gridView(id: string, name = 'Board', extra: Partial<ViewBase> = {}): View {
  return {
    id,
    tableId: 'table_01',
    name,
    type: 'grid',
    isDefault: false,
    config: {
      projection: ['field_name'],
      columnOrder: ['field_name'],
      columnWidths: {},
      frozenFieldIds: [],
      rowHeight: 'standard',
      sort: [],
    },
    revision: 1,
    createdAt: '',
    updatedAt: '',
    ...extra,
  };
}

function mapView(id: string, name = 'Map'): View {
  return {
    id,
    tableId: 'table_01',
    name,
    type: 'map',
    isDefault: false,
    config: { locationFieldId: 'field_location' },
    revision: 1,
    createdAt: '',
    updatedAt: '',
  };
}

const LOCATION_FIELD: Field = {
  id: 'field_location',
  tableId: 'table_01',
  name: 'Location',
  position: 1,
  schemaVersion: 1,
  revision: 1,
  type: 'location',
  config: {},
};

function shellState(update: Partial<TableShellState> = {}): TableShellState {
  return {
    workspaces: [WORKSPACE],
    bases: [BASE],
    tables: [TABLE],
    views: [gridView('view_grid'), mapView('view_map')],
    fields: [LOCATION_FIELD],
    selectedWorkspaceId: 'ws_01',
    selectedBaseId: 'base_01',
    selectedTableId: 'table_01',
    selectedViewId: 'view_grid',
    pendingViewIntents: [],
    deletedViews: [],
    deletedViewsStatus: 'idle',
    viewWritePending: [],
    viewWriteIssues: {},
    ...update,
  };
}

function createShell(callbacks: Record<string, unknown> = {}) {
  const onViewChange = vi.fn();
  const onCreateView = vi.fn(async (): Promise<ViewCreateOutcome> => ({
    status: 'created',
    view: gridView('view_new'),
  }));
  const shell = new TableShell(createTranslator('en'), {
    onWorkspaceChange: vi.fn(),
    onBaseChange: vi.fn(),
    onTableChange: vi.fn(),
    onViewChange,
    onCreateView,
    ...callbacks,
  });
  return { shell, onViewChange, onCreateView };
}

function mount(shell: TableShell, state: TableShellState): HTMLElement {
  const host = document.createElement('div');
  document.body.append(host);
  host.append(shell.render(state));
  return host;
}

function tabs(host: HTMLElement): HTMLElement[] {
  return [...host.querySelectorAll<HTMLElement>('[role="tab"]')];
}

describe('TableShell tabs', () => {
  it('renders context selects and View tabs in server order with stable ids', () => {
    const { shell } = createShell();
    const host = mount(shell, shellState());

    expect(host.querySelector('.loom-grid-navigation')).not.toBeNull();
    expect(host.querySelector<HTMLSelectElement>('select[aria-label="Workspace"]')?.value).toBe(
      'ws_01',
    );
    expect(host.querySelector<HTMLSelectElement>('select[aria-label="Table"]')?.value).toBe(
      'table_01',
    );
    expect(host.querySelector('[role="tablist"]')).not.toBeNull();

    const tabElements = tabs(host);
    expect(tabElements.map((tab) => tab.dataset.viewId)).toEqual(['view_grid', 'view_map']);
    expect(tabElements.map((tab) => tab.getAttribute('aria-selected'))).toEqual(['true', 'false']);
    expect(tabElements.map((tab) => tab.tabIndex)).toEqual([0, -1]);
    host.remove();
  });

  it('keeps the context selectors on their own row above the tab strip', () => {
    const { shell } = createShell();
    const host = mount(shell, shellState());

    const shellEl = host.querySelector('.loom-table-shell');
    const contextRow = host.querySelector('.loom-shell-context')?.parentElement;
    const tabRow = host.querySelector('.loom-view-tabs')?.parentElement;
    expect(contextRow).not.toBeNull();
    expect(tabRow).not.toBeNull();
    expect(contextRow).not.toBe(tabRow);
    expect(tabRow?.querySelector('.loom-shell-actions')).not.toBeNull();

    const rows = [...(shellEl?.children ?? [])].filter((el) =>
      el.classList.contains('loom-shell-row'),
    );
    expect(rows[0]).toBe(contextRow);
    expect(rows[1]).toBe(tabRow);
    host.remove();
  });

  it('renders a compact context crumb that toggles the selects open', () => {
    const { shell } = createShell();
    const host = mount(shell, shellState());

    const toggle = host.querySelector<HTMLButtonElement>('.loom-shell-context-toggle');
    expect(toggle).not.toBeNull();
    expect(toggle?.textContent).toBe('Personal / Notes / Projects');
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    expect(
      host.querySelector('.loom-shell-context')?.classList.contains('loom-shell-context-open'),
    ).toBe(false);

    toggle?.click();
    const expanded = host.querySelector('.loom-shell-context');
    expect(expanded?.classList.contains('loom-shell-context-open')).toBe(true);
    host.querySelector<HTMLButtonElement>('.loom-shell-context-toggle')?.click();
    expect(
      host.querySelector('.loom-shell-context')?.classList.contains('loom-shell-context-open'),
    ).toBe(false);
    host.remove();
  });

  it('merges Workspace and Base into one crumb group ahead of the Table select', () => {
    const { shell } = createShell();
    const host = mount(shell, shellState());

    const upper = host.querySelector<HTMLElement>('.loom-shell-context-upper');
    expect(upper).not.toBeNull();
    const upperSelects = [...(upper?.querySelectorAll('select') ?? [])];
    expect(upperSelects.map((select) => select.getAttribute('aria-label'))).toEqual([
      'Workspace',
      'Base',
    ]);
    const tableSelect = host.querySelector<HTMLSelectElement>(
      '.loom-shell-context > .loom-grid-select select',
    );
    expect(tableSelect?.getAttribute('aria-label')).toBe('Table');
    expect(host.querySelectorAll('.loom-grid-select-label')).toHaveLength(3);
    host.remove();
  });

  it('keeps duplicate View names distinguishable by type and hides deleted Views', () => {
    const { shell } = createShell();
    const host = mount(
      shell,
      shellState({
        views: [
          gridView('view_a', 'Board'),
          mapView('view_b', 'Board'),
          gridView('view_gone', 'Old', { deletedAt: '2026-09-01T00:00:00Z' }),
        ],
      }),
    );

    const labels = tabs(host).map((tab) => ({
      id: tab.dataset.viewId,
      text: tab.textContent,
    }));
    expect(labels).toEqual([
      { id: 'view_a', text: 'Board · Grid' },
      { id: 'view_b', text: 'Board · Map' },
    ]);
    host.remove();
  });

  it('activates tabs by click and supports roving keyboard navigation', () => {
    const { shell, onViewChange } = createShell();
    const host = mount(shell, shellState());
    const [first, second] = tabs(host);
    if (first === undefined || second === undefined) throw new Error('Tabs missing.');

    first.focus();
    expect(second.tabIndex).toBe(-1);
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(document.activeElement).toBe(second);
    expect(second.tabIndex).toBe(0);
    expect(first.tabIndex).toBe(-1);
    second.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    expect(document.activeElement).toBe(second);
    second.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    expect(document.activeElement).toBe(first);

    second.click();
    expect(onViewChange).toHaveBeenCalledWith('view_map');
    host.remove();
  });
});

describe('TableShell create form', () => {
  it('creates a Grid View through the explicit form', async () => {
    const { shell, onCreateView } = createShell();
    const host = mount(shell, shellState());
    shell.openCreateForm();
    host.replaceChildren(shell.render(shellState()));

    const form = host.querySelector<HTMLFormElement>('.loom-view-create-form');
    const name = form?.querySelector<HTMLInputElement>('input[name="view-name"]');
    const type = form?.querySelector<HTMLSelectElement>('select[name="view-type"]');
    expect(form).not.toBeNull();
    expect(type?.querySelectorAll('option')).toHaveLength(2);
    if (
      form === null ||
      name === null ||
      name === undefined ||
      type === null ||
      type === undefined
    ) {
      throw new Error('Create form is missing fields.');
    }
    name.value = 'New Board';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(onCreateView).toHaveBeenCalledTimes(1));
    expect(onCreateView).toHaveBeenCalledWith({ type: 'grid', name: 'New Board' });
    await vi.waitFor(() => expect(host.querySelector('.loom-view-create-form')).toBeNull());
    host.remove();
  });

  it('requires an active Location Field for a Map View and explains otherwise', async () => {
    const onCreateView = vi.fn(async (): Promise<ViewCreateOutcome> => ({
      status: 'created',
      view: mapView('view_new'),
    }));
    const { shell } = createShell({ onCreateView });
    const host = mount(shell, shellState({ fields: [] }));
    shell.openCreateForm();
    host.replaceChildren(shell.render(shellState({ fields: [] })));

    const type = host.querySelector<HTMLSelectElement>('select[name="view-type"]');
    const name = host.querySelector<HTMLInputElement>('input[name="view-name"]');
    if (type === null || name === null) throw new Error('Form missing.');
    name.value = 'Map';
    type.value = 'map';
    type.dispatchEvent(new Event('change', { bubbles: true }));

    const submit = host.querySelector<HTMLButtonElement>(
      '.loom-view-create-form button[type="submit"]',
    );
    expect(host.textContent).toContain('Location Field');
    expect(submit?.disabled).toBe(true);
    host.remove();

    const withField = createShell({ onCreateView });
    const second = mount(
      withField.shell,
      shellState({
        fields: [
          LOCATION_FIELD,
          { ...LOCATION_FIELD, id: 'field_deleted', deletedAt: '2026-09-01T00:00:00Z' },
        ],
      }),
    );
    withField.shell.openCreateForm();
    second.replaceChildren(
      withField.shell.render(
        shellState({
          fields: [
            LOCATION_FIELD,
            { ...LOCATION_FIELD, id: 'field_deleted', deletedAt: '2026-09-01T00:00:00Z' },
          ],
        }),
      ),
    );
    const form = second.querySelector<HTMLFormElement>('.loom-view-create-form');
    const secondName = second.querySelector<HTMLInputElement>('input[name="view-name"]');
    const secondType = second.querySelector<HTMLSelectElement>('select[name="view-type"]');
    if (form === null || secondName === null || secondType === null) {
      throw new Error('Form missing.');
    }
    secondName.value = 'Map';
    secondType.value = 'map';
    secondType.dispatchEvent(new Event('change', { bubbles: true }));
    const locationSelect = second.querySelector<HTMLSelectElement>(
      'select[name="view-location-field"]',
    );
    expect(locationSelect?.querySelectorAll('option')).toHaveLength(1);
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(onCreateView).toHaveBeenCalledTimes(1));
    expect(onCreateView).toHaveBeenCalledWith({
      type: 'map',
      name: 'Map',
      locationFieldId: 'field_location',
    });
    second.remove();
  });

  it('validates the name and reports a failed create without closing the form', async () => {
    const onCreateView = vi.fn(async (): Promise<ViewCreateOutcome> => ({
      status: 'failed',
      kind: 'server',
      error: { message: 'The Server rejected the View.' },
    }));
    const { shell } = createShell({ onCreateView });
    const host = mount(shell, shellState());
    shell.openCreateForm();
    host.replaceChildren(shell.render(shellState()));

    const form = host.querySelector<HTMLFormElement>('.loom-view-create-form');
    const name = host.querySelector<HTMLInputElement>('input[name="view-name"]');
    if (form === null || name === null) throw new Error('Form missing.');

    name.value = '   ';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await Promise.resolve();
    expect(onCreateView).not.toHaveBeenCalled();
    expect(host.querySelector('.loom-view-create-error')?.textContent).toContain('name');

    name.value = 'Board';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(onCreateView).toHaveBeenCalledTimes(1));
    await vi.waitFor(() =>
      expect(host.querySelector('.loom-view-create-error')?.textContent).toContain(
        'could not be created',
      ),
    );
    expect(host.querySelector('.loom-view-create-form')).not.toBeNull();
    host.remove();
  });

  it('closes without any write when cancelled', async () => {
    const { shell, onCreateView } = createShell();
    const host = mount(shell, shellState());
    shell.openCreateForm();
    host.replaceChildren(shell.render(shellState()));
    host.querySelector<HTMLButtonElement>('.loom-view-create-form [data-action="cancel"]')?.click();
    await vi.waitFor(() => expect(host.querySelector('.loom-view-create-form')).toBeNull());
    expect(onCreateView).not.toHaveBeenCalled();
    host.remove();
  });
});

describe('TableShell unresolved intents', () => {
  const intent: PendingViewCreateIntent = {
    intentId: 'mut_unconfirmed',
    tableId: 'table_01',
    request: {
      type: 'grid',
      name: 'Board',
      config: {
        projection: ['field_name'],
        columnOrder: ['field_name'],
        columnWidths: {},
        frozenFieldIds: [],
        rowHeight: 'standard',
        sort: [],
      },
    },
    createdAt: '2026-09-01T00:00:00Z',
  };

  it('offers an explicit retry and dismiss for an unconfirmed create', async () => {
    const onRetryViewIntent = vi.fn(async () => undefined);
    const onDismissViewIntent = vi.fn(async () => undefined);
    const { shell } = createShell({ onRetryViewIntent, onDismissViewIntent });
    const host = mount(shell, shellState({ pendingViewIntents: [intent] }));

    const notice = host.querySelector<HTMLElement>('.loom-view-intents');
    expect(notice?.textContent).toContain('Board');
    notice?.querySelector<HTMLButtonElement>('[data-action="retry-intent"]')?.click();
    await vi.waitFor(() => expect(onRetryViewIntent).toHaveBeenCalledWith('mut_unconfirmed'));
    notice?.querySelector<HTMLButtonElement>('[data-action="dismiss-intent"]')?.click();
    await vi.waitFor(() => expect(onDismissViewIntent).toHaveBeenCalledWith('mut_unconfirmed'));
    host.remove();
  });
});

describe('TableShell View management', () => {
  function manageShell(callbacks: Record<string, unknown> = {}) {
    const onManageViews = vi.fn(async () => undefined);
    const onRenameView = vi.fn(async () => ({
      status: 'saved' as const,
      view: gridView('view_grid'),
    }));
    const onCopyView = vi.fn(async () => ({
      status: 'created' as const,
      view: gridView('view_copy'),
    }));
    const onDeleteView = vi.fn(async () => ({ status: 'deleted' as const }));
    const onRestoreView = vi.fn(async () => ({
      status: 'saved' as const,
      view: gridView('view_deleted'),
    }));
    const onRepairView = vi.fn(async () => ({
      status: 'saved' as const,
      view: gridView('view_grid'),
    }));
    const onSetDefaultView = vi.fn(async () => ({
      status: 'saved' as const,
      view: { ...gridView('view_grid'), isDefault: true },
    }));
    const onResolveViewIssue = vi.fn(async () => undefined);
    const { shell } = createShell({
      onManageViews,
      onRenameView,
      onCopyView,
      onDeleteView,
      onRestoreView,
      onRepairView,
      onSetDefaultView,
      onResolveViewIssue,
      ...callbacks,
    });
    return {
      shell,
      onManageViews,
      onRenameView,
      onCopyView,
      onDeleteView,
      onRestoreView,
      onRepairView,
      onSetDefaultView,
      onResolveViewIssue,
    };
  }

  function openManage(shell: TableShell, state: TableShellState): HTMLElement {
    const host = mount(shell, state);
    host.querySelector<HTMLButtonElement>('[data-action="manage-views"]')?.click();
    return host;
  }

  it('opens the panel, lists active and deleted Views, and closes again', async () => {
    const { shell, onManageViews } = manageShell();
    const host = openManage(
      shell,
      shellState({
        deletedViews: [
          gridView('view_deleted', 'Old Board', { deletedAt: '2026-09-01T00:00:00Z' }),
        ],
        deletedViewsStatus: 'ready',
      }),
    );

    await vi.waitFor(() => expect(onManageViews).toHaveBeenCalledTimes(1));
    const panel = host.querySelector<HTMLElement>('.loom-view-manage');
    expect(panel).not.toBeNull();
    expect(panel?.querySelectorAll('.loom-view-manage-active li[data-view-id]')).toHaveLength(2);
    const deleted = panel?.querySelector<HTMLElement>('.loom-view-manage-deleted');
    expect(deleted?.textContent).toContain('Old Board');
    expect(deleted?.querySelector('[data-action="restore"]')).not.toBeNull();

    panel?.querySelector<HTMLButtonElement>('[data-action="manage-close"]')?.click();
    expect(host.querySelector('.loom-view-manage')).toBeNull();
    host.remove();
  });

  it('renames a View through the inline form and cancels without writes', async () => {
    const { shell, onRenameView } = manageShell();
    const host = openManage(shell, shellState());
    await vi.waitFor(() => expect(host.querySelector('.loom-view-manage')).not.toBeNull());

    const row = host.querySelector<HTMLElement>('li[data-view-id="view_grid"]');
    row?.querySelector<HTMLButtonElement>('[data-action="rename"]')?.click();
    const form = host.querySelector<HTMLFormElement>('form[data-manage-form="rename"]');
    const input = form?.querySelector<HTMLInputElement>('input[name="view-name"]');
    if (form === null || input === null || input === undefined) {
      throw new Error('Rename form missing.');
    }
    input.value = 'Renamed Board';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(onRenameView).toHaveBeenCalledWith('view_grid', 'Renamed Board'));
    await vi.waitFor(() =>
      expect(host.querySelector('form[data-manage-form="rename"]')).toBeNull(),
    );

    const rowAgain = host.querySelector<HTMLElement>('li[data-view-id="view_map"]');
    rowAgain?.querySelector<HTMLButtonElement>('[data-action="rename"]')?.click();
    host
      .querySelector<HTMLFormElement>('form[data-manage-form="rename"]')
      ?.querySelector<HTMLButtonElement>('[data-action="cancel"]')
      ?.click();
    expect(onRenameView).toHaveBeenCalledTimes(1);
    host.remove();
  });

  it('copies a View after confirming a new name', async () => {
    const { shell, onCopyView } = manageShell();
    const host = openManage(shell, shellState());
    await vi.waitFor(() => expect(host.querySelector('.loom-view-manage')).not.toBeNull());

    host
      .querySelector<HTMLElement>('li[data-view-id="view_grid"]')
      ?.querySelector<HTMLButtonElement>('[data-action="copy"]')
      ?.click();
    const form = host.querySelector<HTMLFormElement>('form[data-manage-form="copy"]');
    const input = form?.querySelector<HTMLInputElement>('input[name="view-name"]');
    if (form === null || input === null || input === undefined) {
      throw new Error('Copy form missing.');
    }
    expect(input.value).toBe('Board');
    input.value = 'Board copy';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(onCopyView).toHaveBeenCalledWith('view_grid', 'Board copy'));
    host.remove();
  });

  it('asks for explicit confirmation naming the View before deleting', async () => {
    const { shell, onDeleteView } = manageShell();
    const host = openManage(shell, shellState());
    await vi.waitFor(() => expect(host.querySelector('.loom-view-manage')).not.toBeNull());

    host
      .querySelector<HTMLElement>('li[data-view-id="view_map"]')
      ?.querySelector<HTMLButtonElement>('[data-action="delete"]')
      ?.click();
    const confirm = host.querySelector<HTMLElement>('.loom-view-manage-confirm');
    expect(confirm?.textContent).toContain('Map');
    confirm?.querySelector<HTMLButtonElement>('[data-action="delete-cancel"]')?.click();
    expect(onDeleteView).not.toHaveBeenCalled();

    host
      .querySelector<HTMLElement>('li[data-view-id="view_map"]')
      ?.querySelector<HTMLButtonElement>('[data-action="delete"]')
      ?.click();
    host
      .querySelector<HTMLElement>('.loom-view-manage-confirm')
      ?.querySelector<HTMLButtonElement>('[data-action="delete-confirm"]')
      ?.click();
    await vi.waitFor(() => expect(onDeleteView).toHaveBeenCalledWith('view_map'));
    host.remove();
  });

  it('restores a deleted View through the recycle list', async () => {
    const { shell, onRestoreView } = manageShell();
    const deleted = { ...mapView('view_deleted', 'Old Map'), deletedAt: '2026-09-01T00:00:00Z' };
    const host = openManage(
      shell,
      shellState({ deletedViews: [deleted], deletedViewsStatus: 'ready' }),
    );
    await vi.waitFor(() => expect(host.querySelector('.loom-view-manage')).not.toBeNull());

    host
      .querySelector<HTMLElement>('.loom-view-manage-deleted li[data-view-id="view_deleted"]')
      ?.querySelector<HTMLButtonElement>('[data-action="restore"]')
      ?.click();
    await vi.waitFor(() => expect(onRestoreView).toHaveBeenCalledWith('view_deleted'));
    host.remove();
  });

  it('disables other write entries for a View while a write is pending', async () => {
    const { shell } = manageShell();
    const host = openManage(shell, shellState({ viewWritePending: ['view_grid'] }));
    await vi.waitFor(() => expect(host.querySelector('.loom-view-manage')).not.toBeNull());

    const row = host.querySelector<HTMLElement>('li[data-view-id="view_grid"]');
    for (const action of ['rename', 'copy', 'delete']) {
      expect(row?.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)?.disabled).toBe(
        true,
      );
    }
    const other = host.querySelector<HTMLElement>('li[data-view-id="view_map"]');
    expect(other?.querySelector<HTMLButtonElement>('[data-action="rename"]')?.disabled).toBe(false);
    host.remove();
  });

  it('shows a conflict issue with adopt-latest and re-edit actions', async () => {
    const latest = gridView('view_grid', 'Elsewhere', { revision: 4 });
    const { shell, onResolveViewIssue } = manageShell();
    const host = openManage(
      shell,
      shellState({
        viewWriteIssues: {
          view_grid: { kind: 'conflict', message: 'changed', latestView: latest },
        },
      }),
    );
    await vi.waitFor(() => expect(host.querySelector('.loom-view-manage')).not.toBeNull());

    const issue = host.querySelector<HTMLElement>('li[data-view-id="view_grid"] .loom-view-issue');
    expect(issue?.textContent).toContain('changed');
    issue?.querySelector<HTMLButtonElement>('[data-action="issue-adopt"]')?.click();
    await vi.waitFor(() =>
      expect(onResolveViewIssue).toHaveBeenCalledWith('view_grid', 'adopt-latest'),
    );
    issue?.querySelector<HTMLButtonElement>('[data-action="issue-reedit"]')?.click();
    await vi.waitFor(() => expect(onResolveViewIssue).toHaveBeenCalledWith('view_grid', 're-edit'));
    host.remove();
  });

  it('offers retry and dismiss for an unresolved write', async () => {
    const { shell, onResolveViewIssue } = manageShell();
    const host = openManage(
      shell,
      shellState({
        viewWriteIssues: {
          view_map: { kind: 'unresolved', message: 'result unknown' },
        },
      }),
    );
    await vi.waitFor(() => expect(host.querySelector('.loom-view-manage')).not.toBeNull());

    const issue = host.querySelector<HTMLElement>('li[data-view-id="view_map"] .loom-view-issue');
    issue?.querySelector<HTMLButtonElement>('[data-action="issue-retry"]')?.click();
    await vi.waitFor(() => expect(onResolveViewIssue).toHaveBeenCalledWith('view_map', 'retry'));
    issue?.querySelector<HTMLButtonElement>('[data-action="issue-dismiss"]')?.click();
    await vi.waitFor(() => expect(onResolveViewIssue).toHaveBeenCalledWith('view_map', 'dismiss'));
    host.remove();
  });

  it('marks broken Views and repairs confirmed Field removals', async () => {
    const base = gridView('view_grid');
    if (base.type !== 'grid') throw new Error('expected a Grid View fixture');
    const broken: View = {
      ...base,
      config: {
        ...base.config,
        projection: ['field_name', 'field_gone'],
        sort: [{ fieldId: 'field_gone', direction: 'asc', nulls: 'last' }],
      },
    };
    const { shell, onRepairView } = manageShell();
    const host = openManage(shell, shellState({ views: [broken] }));
    await vi.waitFor(() => expect(host.querySelector('.loom-view-manage')).not.toBeNull());

    const row = host.querySelector<HTMLElement>('li[data-view-id="view_grid"]');
    expect(row?.querySelector('.loom-view-broken')).not.toBeNull();
    row?.querySelector<HTMLButtonElement>('[data-action="repair"]')?.click();
    const form = host.querySelector<HTMLFormElement>('form[data-manage-form="repair"]');
    expect(form?.textContent).toContain('field_gone');
    const checkbox = form?.querySelector<HTMLInputElement>(
      'input[name="repair-remove"][value="field_gone"]',
    );
    if (checkbox === null || checkbox === undefined) throw new Error('Repair checkbox missing.');
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() =>
      expect(onRepairView).toHaveBeenCalledWith('view_grid', { removeFieldIds: ['field_gone'] }),
    );
    host.remove();
  });
});

describe('view tab overflow', () => {
  it('collapses overflowing tabs behind a +N menu', () => {
    const roCallbacks: ResizeObserverCallback[] = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          roCallbacks.push(callback);
        }
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      },
    );
    const { shell, onViewChange } = createShell();
    const views = [
      gridView('view_1', 'One'),
      gridView('view_2', 'Two'),
      gridView('view_3', 'Three'),
      mapView('view_4', 'Four'),
    ];
    const host = mount(shell, shellState({ views, selectedViewId: 'view_1' }));
    const tablist = host.querySelector<HTMLElement>('.loom-view-tabs');
    expect(tablist).not.toBeNull();
    if (tablist === null) throw new Error('tablist missing');
    const tabs = [...tablist.querySelectorAll<HTMLElement>('[role="tab"]')];
    expect(tabs).toHaveLength(4);

    Object.defineProperty(tablist, 'clientWidth', { value: 220, configurable: true });
    for (const tab of tabs) {
      Object.defineProperty(tab, 'offsetWidth', { value: 120, configurable: true });
    }
    roCallbacks[0]?.([], {} as ResizeObserver);

    const overflow = tablist.querySelector<HTMLElement>('.loom-view-tab-overflow');
    expect(overflow?.hidden).toBe(false);
    expect(overflow?.textContent).toBe('+3');
    expect(tabs[0]?.hidden).toBe(false);
    expect(tabs[1]?.hidden).toBe(true);
    expect(tabs[2]?.hidden).toBe(true);
    expect(tabs[3]?.hidden).toBe(true);

    overflow?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const menu = host.querySelector('.loom-context-menu');
    expect(menu).not.toBeNull();
    const items = [...menu!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
    expect(items.map((item) => item.textContent)).toEqual(['Two', 'Three', 'Four']);
    items[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onViewChange).toHaveBeenCalledWith('view_2');
    expect(host.querySelector('.loom-context-menu')).toBeNull();
    host.remove();
  });

  it('keeps the selected tab visible even when it would overflow', () => {
    const roCallbacks: ResizeObserverCallback[] = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          roCallbacks.push(callback);
        }
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      },
    );
    const { shell } = createShell();
    const views = [
      gridView('view_1', 'One'),
      gridView('view_2', 'Two'),
      gridView('view_3', 'Three'),
    ];
    const host = mount(shell, shellState({ views, selectedViewId: 'view_3' }));
    const tablist = host.querySelector<HTMLElement>('.loom-view-tabs');
    if (tablist === null) throw new Error('tablist missing');
    const tabs = [...tablist.querySelectorAll<HTMLElement>('[role="tab"]')];
    Object.defineProperty(tablist, 'clientWidth', { value: 160, configurable: true });
    for (const tab of tabs) {
      Object.defineProperty(tab, 'offsetWidth', { value: 120, configurable: true });
    }
    roCallbacks[0]?.([], {} as ResizeObserver);
    expect(tabs[2]?.hidden).toBe(false);
    expect(tabs[1]?.hidden).toBe(true);
    host.remove();
  });
});

describe('TableShell tab context menu', () => {
  function rightClickTab(host: HTMLElement, index = 0): void {
    const tab = tabs(host)[index];
    tab?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 24, clientY: 12 }));
  }

  it('opens a menu with rename/copy/set-default/delete on tab right-click', async () => {
    const { shell } = createShell();
    const host = mount(shell, shellState());

    rightClickTab(host);
    const menu = host.querySelector<HTMLElement>('.loom-context-menu');
    expect(menu).not.toBeNull();
    const labels = [...(menu?.querySelectorAll('.loom-context-menu-item') ?? [])].map(
      (item) => item.textContent,
    );
    expect(labels).toEqual(['Rename', 'Copy', 'Set as default', 'Delete']);
    host.remove();
  });

  it('runs set-default directly from the tab menu', async () => {
    const onSetDefaultView = vi.fn(async () => ({
      status: 'saved' as const,
      view: { ...gridView('view_map_2'), isDefault: true },
    }));
    const { shell } = createShell({ onSetDefaultView });
    const host = mount(shell, shellState());

    rightClickTab(host, 1);
    const item = [...host.querySelectorAll<HTMLButtonElement>('.loom-context-menu-item')].find(
      (entry) => entry.textContent === 'Set as default',
    );
    item?.click();
    await vi.waitFor(() => expect(onSetDefaultView).toHaveBeenCalledWith('view_map'));
    host.remove();
  });

  it('disables set-default for the current default View', () => {
    const { shell } = createShell();
    const host = mount(
      shell,
      shellState({ views: [{ ...gridView('view_grid'), isDefault: true }, mapView('view_map')] }),
    );

    rightClickTab(host);
    const item = [...host.querySelectorAll<HTMLButtonElement>('.loom-context-menu-item')].find(
      (entry) => entry.textContent === 'Set as default',
    );
    expect(item?.disabled).toBe(true);
    host.remove();
  });

  it('opens the manage panel rename form from the tab menu', async () => {
    const onManageViews = vi.fn(async () => undefined);
    const onRenameView = vi.fn(async () => ({
      status: 'saved' as const,
      view: gridView('view_grid'),
    }));
    const { shell } = createShell({ onManageViews, onRenameView });
    const host = mount(shell, shellState());

    rightClickTab(host);
    const item = [...host.querySelectorAll<HTMLButtonElement>('.loom-context-menu-item')].find(
      (entry) => entry.textContent === 'Rename',
    );
    item?.click();
    const form = host.querySelector<HTMLFormElement>('form[data-manage-form="rename"]');
    expect(form).not.toBeNull();
    expect(form?.querySelector('input')?.value).toBe('Board');
    host.remove();
  });
});
