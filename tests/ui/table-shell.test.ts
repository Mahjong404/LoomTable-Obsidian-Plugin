import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Field, View, ViewBase } from '../../src/client/loomtable-client';
import { createTranslator } from '../../src/i18n';
import { TableShell, type TableShellState, type ViewCreateOutcome } from '../../src/ui/table-shell';
import type {
  PendingViewCreateIntent,
  ViewWriteOutcome,
} from '../../src/ui/view-write-coordinator';

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
  host.className = 'view-content';
  document.body.append(host);
  host.append(shell.render(state));
  shell.restoreFocus();
  return host;
}

function tabs(host: HTMLElement): HTMLElement[] {
  return [...host.querySelectorAll<HTMLElement>('[role="tab"]')];
}

// Context menus mount on document.body; remove strays so they cannot leak
// into the next test's document-level queries.
afterEach(() => {
  document.querySelectorAll('.loom-context-menu').forEach((menu) => menu.remove());
  vi.restoreAllMocks();
});

describe('TableShell tabs', () => {
  it('renders context selects and View tabs in server order with stable ids', () => {
    const { shell } = createShell();
    const host = mount(shell, shellState());

    expect(host.querySelector('.loom-table-shell')).not.toBeNull();
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

  it('keeps context, View switcher and tabs on one shell row', () => {
    const { shell } = createShell();
    const host = mount(shell, shellState());

    const shellEl = host.querySelector('.loom-table-shell');
    const row = host.querySelector('.loom-shell-row');
    expect(row).not.toBeNull();
    expect(row?.querySelector('.loom-shell-context')).not.toBeNull();
    expect(row?.querySelector('[data-action="view-list"]')).not.toBeNull();
    expect(row?.querySelector('.loom-view-tabs')).not.toBeNull();
    expect(row?.querySelector('.loom-shell-actions')).toBeNull();

    const rows = [...(shellEl?.children ?? [])].filter((el) =>
      el.classList.contains('loom-shell-row'),
    );
    expect(rows).toHaveLength(1);
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

  it('renders Workspace/Base/Table as one breadcrumb with separators and carets', () => {
    const { shell } = createShell();
    const host = mount(shell, shellState());

    const context = host.querySelector<HTMLElement>('.loom-shell-context');
    expect(context).not.toBeNull();
    const levels = [...(context?.querySelectorAll(':scope > .loom-grid-select') ?? [])];
    expect(
      levels.map((level) => level.querySelector('select')?.getAttribute('aria-label')),
    ).toEqual(['Workspace', 'Base', 'Table']);
    // Upper levels are muted; the Table level keeps normal weight + table icon.
    expect(levels[0]?.classList.contains('loom-grid-select-muted')).toBe(true);
    expect(levels[1]?.classList.contains('loom-grid-select-muted')).toBe(true);
    expect(levels[2]?.classList.contains('loom-grid-select-muted')).toBe(false);
    expect(levels[2]?.querySelector('.loom-grid-select-icon')).not.toBeNull();
    const separators = context?.querySelectorAll('.loom-shell-context-sep');
    expect(separators).toHaveLength(2);
    expect([...(separators ?? [])].map((sep) => sep.textContent)).toEqual(['/', '/']);
    expect(context?.querySelectorAll('.loom-grid-select-caret')).toHaveLength(3);
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

describe('TableShell view create picker', () => {
  function openPicker(shell: TableShell, state: TableShellState): HTMLElement {
    const host = mount(shell, state);
    host.querySelector<HTMLButtonElement>('[data-action="view-list"]')?.click();
    host.querySelector<HTMLButtonElement>('[data-action="create-view"]')?.click();
    return host;
  }

  it('expands the type picker without issuing a write', () => {
    const { shell, onCreateView } = createShell();
    const host = mount(shell, shellState());
    host.querySelector<HTMLButtonElement>('[data-action="view-list"]')?.click();

    const create = host.querySelector<HTMLButtonElement>('[data-action="create-view"]');
    expect(create?.getAttribute('aria-expanded')).toBe('false');
    create?.click();

    const picker = host.querySelector('.loom-view-type-picker');
    expect(picker).not.toBeNull();
    expect(
      picker?.querySelector<HTMLButtonElement>('[data-action="create-type:grid"]')?.textContent,
    ).toContain('Grid View');
    expect(
      picker?.querySelector<HTMLButtonElement>('[data-action="create-type:map"]')?.textContent,
    ).toContain('Map View');
    expect(onCreateView).not.toHaveBeenCalled();

    create?.click();
    expect(host.querySelector('.loom-view-type-picker')).toBeNull();
    expect(onCreateView).not.toHaveBeenCalled();
    host.remove();
  });

  it('creates a Grid View immediately when the type is picked', async () => {
    const { shell, onCreateView } = createShell();
    const host = openPicker(shell, shellState());

    host.querySelector<HTMLButtonElement>('[data-action="create-type:grid"]')?.click();
    await vi.waitFor(() =>
      expect(onCreateView).toHaveBeenCalledWith({ type: 'grid', name: 'Grid View' }),
    );
    await vi.waitFor(() => expect(host.querySelector('.loom-view-panel')).toBeNull());
    host.remove();
  });

  it('auto-uses the only Location Field for a Map View', async () => {
    const onCreateView = vi.fn(async (): Promise<ViewCreateOutcome> => ({
      status: 'created',
      view: mapView('view_new'),
    }));
    const { shell } = createShell({ onCreateView });
    const host = openPicker(shell, shellState());

    host.querySelector<HTMLButtonElement>('[data-action="create-type:map"]')?.click();
    await vi.waitFor(() =>
      expect(onCreateView).toHaveBeenCalledWith({
        type: 'map',
        name: 'Map View',
        locationFieldId: 'field_location',
      }),
    );
    host.remove();
  });

  it('lists Location Fields inline when a Map View has several candidates', async () => {
    const onCreateView = vi.fn(async (): Promise<ViewCreateOutcome> => ({
      status: 'created',
      view: mapView('view_new'),
    }));
    const { shell } = createShell({ onCreateView });
    const fields = [
      LOCATION_FIELD,
      { ...LOCATION_FIELD, id: 'field_geo', name: 'Geo' },
      { ...LOCATION_FIELD, id: 'field_deleted', deletedAt: '2026-09-01T00:00:00Z' },
    ];
    const host = openPicker(shell, shellState({ fields }));

    host.querySelector<HTMLButtonElement>('[data-action="create-type:map"]')?.click();
    expect(onCreateView).not.toHaveBeenCalled();
    const options = [...host.querySelectorAll<HTMLButtonElement>('.loom-view-field-option')];
    expect(options.map((option) => option.textContent)).toEqual(['Location', 'Geo']);

    options[1]?.click();
    await vi.waitFor(() =>
      expect(onCreateView).toHaveBeenCalledWith({
        type: 'map',
        name: 'Map View',
        locationFieldId: 'field_geo',
      }),
    );
    host.remove();
  });

  it('disables Map View and explains when no Location Field exists', async () => {
    const { shell, onCreateView } = createShell();
    const host = openPicker(shell, shellState({ fields: [] }));

    const map = host.querySelector<HTMLButtonElement>('[data-action="create-type:map"]');
    expect(map?.disabled).toBe(true);
    expect(host.querySelector('.loom-view-type-note')?.textContent).toContain('Location Field');
    map?.click();
    expect(onCreateView).not.toHaveBeenCalled();
    host.remove();
  });

  it('keeps the picker open with an inline error when the create fails', async () => {
    const onCreateView = vi.fn(async (): Promise<ViewCreateOutcome> => ({
      status: 'failed',
      kind: 'server',
      error: { message: 'nope' },
    }));
    const { shell } = createShell({ onCreateView });
    const host = openPicker(shell, shellState());

    host.querySelector<HTMLButtonElement>('[data-action="create-type:grid"]')?.click();
    await vi.waitFor(() =>
      expect(host.querySelector('.loom-view-panel-error')?.textContent).toContain(
        'could not be created',
      ),
    );
    expect(host.querySelector('.loom-view-type-picker')).not.toBeNull();
    host.remove();
  });

  it('collapses the field list, then the picker, then the panel on Escape', () => {
    const { shell } = createShell();
    const fields = [LOCATION_FIELD, { ...LOCATION_FIELD, id: 'field_geo', name: 'Geo' }];
    const host = openPicker(shell, shellState({ fields }));
    const root = host.querySelector<HTMLElement>('.loom-table-shell');
    if (root === null) throw new Error('Shell missing.');
    const esc = (): void => {
      root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    };

    host.querySelector<HTMLButtonElement>('[data-action="create-type:map"]')?.click();
    expect(host.querySelector('.loom-view-field-list')).not.toBeNull();
    esc();
    expect(host.querySelector('.loom-view-field-list')).toBeNull();
    expect(host.querySelector('.loom-view-type-picker')).not.toBeNull();
    esc();
    expect(host.querySelector('.loom-view-type-picker')).toBeNull();
    expect(host.querySelector('.loom-view-panel')).not.toBeNull();
    esc();
    expect(host.querySelector('.loom-view-panel')).toBeNull();
    host.remove();
  });

  it('issues a Map View create immediately for a preset Location Field', async () => {
    const onCreateView = vi.fn(async (): Promise<ViewCreateOutcome> => ({
      status: 'created',
      view: mapView('view_new'),
    }));
    const { shell } = createShell({ onCreateView });
    const host = mount(shell, shellState());

    shell.createView({ type: 'map', locationFieldId: 'field_location' });
    await vi.waitFor(() =>
      expect(onCreateView).toHaveBeenCalledWith({
        type: 'map',
        name: 'Map View',
        locationFieldId: 'field_location',
      }),
    );
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

describe('TableShell View panel', () => {
  function panelShell(callbacks: Record<string, unknown> = {}) {
    const onRenameView = vi.fn(async () => ({
      status: 'saved' as const,
      view: gridView('view_grid'),
    }));
    const onCopyView = vi.fn(async () => ({
      status: 'created' as const,
      view: gridView('view_copy'),
    }));
    const onDeleteView = vi.fn(async () => ({ status: 'deleted' as const }));
    const onRepairView = vi.fn(async () => ({
      status: 'saved' as const,
      view: gridView('view_grid'),
    }));
    const onSetDefaultView = vi.fn(async () => ({
      status: 'saved' as const,
      view: { ...gridView('view_grid'), isDefault: true },
    }));
    const onResolveViewIssue = vi.fn(async () => undefined);
    const { shell, onViewChange, onCreateView } = createShell({
      onRenameView,
      onCopyView,
      onDeleteView,
      onRepairView,
      onSetDefaultView,
      onResolveViewIssue,
      ...callbacks,
    });
    return {
      shell,
      onViewChange,
      onCreateView,
      onRenameView,
      onCopyView,
      onDeleteView,
      onRepairView,
      onSetDefaultView,
      onResolveViewIssue,
    };
  }

  function openPanel(shell: TableShell, state: TableShellState): HTMLElement {
    const host = mount(shell, state);
    host.querySelector<HTMLButtonElement>('[data-action="view-list"]')?.click();
    return host;
  }

  function rowMenu(host: HTMLElement, viewId: string): HTMLElement {
    const row = host.querySelector<HTMLElement>(`li[data-view-id="${viewId}"]`);
    row?.querySelector<HTMLButtonElement>('[data-action="view-more"]')?.click();
    const menu = document.querySelector<HTMLElement>('.loom-context-menu');
    if (menu === null) throw new Error('Row menu did not open.');
    return menu;
  }

  function menuItem(menu: HTMLElement, action: string): HTMLButtonElement {
    const item = menu.querySelector<HTMLButtonElement>(`[data-action="${action}"]`);
    if (item === null) throw new Error(`Menu item ${action} missing.`);
    return item;
  }

  it('opens the panel listing active Views and closes again', () => {
    const { shell } = panelShell();
    const host = openPanel(
      shell,
      shellState({
        views: [
          gridView('view_grid'),
          mapView('view_map'),
          gridView('view_gone', 'Old', { deletedAt: '2026-09-01T00:00:00Z' }),
        ],
      }),
    );

    const panel = host.querySelector<HTMLElement>('.loom-view-panel');
    expect(panel).not.toBeNull();
    const rows = [...(panel?.querySelectorAll<HTMLElement>('li[data-view-id]') ?? [])];
    expect(rows.map((row) => row.dataset.viewId)).toEqual(['view_grid', 'view_map']);
    expect(panel?.querySelector('.loom-view-panel-divider')).not.toBeNull();
    expect(panel?.querySelector('[data-action="create-view"]')?.textContent).toContain('New View');

    host.querySelector<HTMLButtonElement>('[data-action="view-list"]')?.click();
    expect(host.querySelector('.loom-view-panel')).toBeNull();
    host.remove();
  });

  it('marks the current View inline and switches on row click', () => {
    const { shell, onViewChange } = panelShell();
    const host = openPanel(shell, shellState());

    const current = host.querySelector<HTMLElement>(
      'li[data-view-id="view_grid"] .loom-view-panel-item',
    );
    expect(current?.classList.contains('is-current')).toBe(true);
    expect(current?.getAttribute('aria-current')).toBe('true');
    const other = host.querySelector<HTMLElement>(
      'li[data-view-id="view_map"] .loom-view-panel-item',
    );
    expect(other?.classList.contains('is-current')).toBe(false);

    other?.click();
    expect(onViewChange).toHaveBeenCalledWith('view_map');
    expect(host.querySelector('.loom-view-panel')).toBeNull();
    host.remove();
  });

  it('offers rename/copy/set-default/delete through the row more menu', () => {
    const { shell } = panelShell();
    const host = openPanel(shell, shellState());

    const menu = rowMenu(host, 'view_grid');
    const labels = [...menu.querySelectorAll('.loom-context-menu-item')].map(
      (item) => item.textContent,
    );
    // The fixture View references a Field absent from `fields`, so it is broken.
    expect(labels).toEqual(['Rename', 'Copy', 'Set as default', 'Repair', 'Delete']);
    host.remove();
  });

  it('renames a View inline on Enter and cancels with Escape', async () => {
    const { shell, onRenameView } = panelShell();
    const host = openPanel(shell, shellState());

    menuItem(rowMenu(host, 'view_grid'), 'rename').click();
    const form = host.querySelector<HTMLFormElement>('form[data-panel-form="rename"]');
    const input = form?.querySelector<HTMLInputElement>('input[name="view-name"]');
    if (form === null || input === null || input === undefined) {
      throw new Error('Inline rename missing.');
    }
    expect(input.value).toBe('Board');
    input.value = 'Renamed Board';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(onRenameView).toHaveBeenCalledWith('view_grid', 'Renamed Board'));
    await vi.waitFor(() => expect(host.querySelector('form[data-panel-form="rename"]')).toBeNull());

    menuItem(rowMenu(host, 'view_map'), 'rename').click();
    host
      .querySelector<HTMLInputElement>('form[data-panel-form="rename"] input[name="view-name"]')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(host.querySelector('form[data-panel-form="rename"]')).toBeNull();
    expect(host.querySelector('.loom-view-panel')).not.toBeNull();
    expect(onRenameView).toHaveBeenCalledTimes(1);
    host.remove();
  });

  it('commits an inline rename on blur', async () => {
    const { shell, onRenameView } = panelShell();
    const host = openPanel(shell, shellState());

    menuItem(rowMenu(host, 'view_grid'), 'rename').click();
    const input = host.querySelector<HTMLInputElement>(
      'form[data-panel-form="rename"] input[name="view-name"]',
    );
    if (input === null) throw new Error('Inline rename missing.');
    input.value = 'Board Again';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new FocusEvent('blur'));
    await vi.waitFor(() => expect(onRenameView).toHaveBeenCalledWith('view_grid', 'Board Again'));
    host.remove();
  });

  it('does not recommit when a state push detaches the focused input mid-flight', async () => {
    let resolve: (outcome: ViewWriteOutcome) => void = () => {};
    const onRenameView = vi.fn(() => new Promise<ViewWriteOutcome>((done) => (resolve = done)));
    const { shell } = panelShell({ onRenameView });
    const host = openPanel(shell, shellState());

    menuItem(rowMenu(host, 'view_grid'), 'rename').click();
    const input = host.querySelector<HTMLInputElement>(
      'form[data-panel-form="rename"] input[name="view-name"]',
    );
    if (input === null) throw new Error('Inline rename missing.');
    input.value = 'Renamed Board';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.closest('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(onRenameView).toHaveBeenCalledTimes(1));

    // A viewWritePending push rerenders the shell and detaches the focused
    // input; the resulting blur must not fire a second commit.
    host.replaceChildren(shell.render(shellState({ viewWritePending: ['view_grid'] })));
    input.dispatchEvent(new FocusEvent('blur'));
    await new Promise((r) => setTimeout(r, 20));
    expect(onRenameView).toHaveBeenCalledTimes(1);

    resolve({ status: 'saved', view: gridView('view_grid', 'Renamed Board') });
    await vi.waitFor(() => expect(host.querySelector('form[data-panel-form="rename"]')).toBeNull());
    host.remove();
  });

  it('keeps the input and shows an error when a rename fails', async () => {
    const onRenameView = vi.fn(async () => ({
      status: 'failed' as const,
      kind: 'server' as const,
      error: { message: 'nope' },
    }));
    const { shell } = panelShell({ onRenameView });
    const host = openPanel(shell, shellState());

    menuItem(rowMenu(host, 'view_grid'), 'rename').click();
    const input = host.querySelector<HTMLInputElement>(
      'form[data-panel-form="rename"] input[name="view-name"]',
    );
    if (input === null) throw new Error('Inline rename missing.');
    input.value = 'Broken Name';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.closest('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(onRenameView).toHaveBeenCalledTimes(1));
    await vi.waitFor(() =>
      expect(
        host.querySelector<HTMLElement>('form[data-panel-form="rename"] .loom-view-panel-error')
          ?.textContent,
      ).toContain('could not be saved'),
    );
    const retryInput = host.querySelector<HTMLInputElement>(
      'form[data-panel-form="rename"] input[name="view-name"]',
    );
    expect(retryInput?.value).toBe('Broken Name');
    host.remove();
  });

  it('copies a View with an auto-numbered prefilled name', async () => {
    const { shell, onCopyView } = panelShell();
    const host = openPanel(shell, shellState());

    menuItem(rowMenu(host, 'view_grid'), 'copy').click();
    const form = host.querySelector<HTMLFormElement>('form[data-panel-form="copy"]');
    const input = form?.querySelector<HTMLInputElement>('input[name="view-name"]');
    if (form === null || input === null || input === undefined) {
      throw new Error('Inline copy missing.');
    }
    expect(input.value).toBe('Board 2');
    input.value = 'Board copy';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(onCopyView).toHaveBeenCalledWith('view_grid', 'Board copy'));
    host.remove();
  });

  it('runs set-default from the row menu', async () => {
    const { shell, onSetDefaultView } = panelShell();
    const host = openPanel(shell, shellState());
    const menu = rowMenu(host, 'view_map');
    expect(menuItem(menu, 'set-default').disabled).toBe(false);
    menuItem(menu, 'set-default').click();
    await vi.waitFor(() => expect(onSetDefaultView).toHaveBeenCalledWith('view_map'));
    host.remove();
  });

  it('asks for explicit confirmation naming the View before deleting', async () => {
    const { shell, onDeleteView } = panelShell();
    const host = openPanel(shell, shellState());

    menuItem(rowMenu(host, 'view_map'), 'delete').click();
    const confirm = host.querySelector<HTMLElement>('.loom-view-panel-confirm');
    expect(confirm?.textContent).toContain('Map');
    confirm?.querySelector<HTMLButtonElement>('[data-action="delete-cancel"]')?.click();
    expect(onDeleteView).not.toHaveBeenCalled();

    menuItem(rowMenu(host, 'view_map'), 'delete').click();
    host
      .querySelector<HTMLElement>('.loom-view-panel-confirm')
      ?.querySelector<HTMLButtonElement>('[data-action="delete-confirm"]')
      ?.click();
    await vi.waitFor(() => expect(onDeleteView).toHaveBeenCalledWith('view_map'));
    host.remove();
  });

  it('disables the row and its menu while a write is pending', () => {
    const { shell } = panelShell();
    const host = openPanel(shell, shellState({ viewWritePending: ['view_grid'] }));

    const row = host.querySelector<HTMLElement>('li[data-view-id="view_grid"]');
    expect(row?.getAttribute('aria-busy')).toBe('true');
    expect(row?.querySelector<HTMLButtonElement>('.loom-view-panel-item')?.disabled).toBe(true);
    expect(row?.querySelector<HTMLButtonElement>('[data-action="view-more"]')?.disabled).toBe(true);
    const other = host.querySelector<HTMLElement>('li[data-view-id="view_map"]');
    expect(other?.querySelector<HTMLButtonElement>('.loom-view-panel-item')?.disabled).toBe(false);
    host.remove();
  });

  it('shows a conflict issue with adopt-latest and re-edit actions', async () => {
    const latest = gridView('view_grid', 'Elsewhere', { revision: 4 });
    const { shell, onResolveViewIssue } = panelShell();
    const host = openPanel(
      shell,
      shellState({
        viewWriteIssues: {
          view_grid: { kind: 'conflict', message: 'changed', latestView: latest },
        },
      }),
    );

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
    const { shell, onResolveViewIssue } = panelShell();
    const host = openPanel(
      shell,
      shellState({
        viewWriteIssues: {
          view_map: { kind: 'unresolved', message: 'result unknown' },
        },
      }),
    );

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
    const { shell, onRepairView } = panelShell();
    const host = openPanel(shell, shellState({ views: [broken] }));

    const row = host.querySelector<HTMLElement>('li[data-view-id="view_grid"]');
    expect(row?.querySelector('.loom-view-broken')).not.toBeNull();
    const menu = rowMenu(host, 'view_grid');
    menuItem(menu, 'repair').click();
    const form = host.querySelector<HTMLFormElement>('form[data-panel-form="repair"]');
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

  it('creates a default Grid View with the smallest free suffix and closes the panel', async () => {
    const { shell, onCreateView } = panelShell();
    const host = openPanel(shell, shellState());

    host.querySelector<HTMLButtonElement>('[data-action="create-view"]')?.click();
    host.querySelector<HTMLButtonElement>('[data-action="create-type:grid"]')?.click();
    await vi.waitFor(() =>
      expect(onCreateView).toHaveBeenCalledWith({ type: 'grid', name: 'Grid View' }),
    );
    await vi.waitFor(() => expect(host.querySelector('.loom-view-panel')).toBeNull());
    host.remove();
  });

  it('numbers the default View name past existing duplicates', async () => {
    const { shell, onCreateView } = panelShell();
    const host = openPanel(
      shell,
      shellState({
        views: [gridView('view_grid', 'Grid View'), gridView('view_map', 'Grid View 2')],
      }),
    );

    host.querySelector<HTMLButtonElement>('[data-action="create-view"]')?.click();
    host.querySelector<HTMLButtonElement>('[data-action="create-type:grid"]')?.click();
    await vi.waitFor(() =>
      expect(onCreateView).toHaveBeenCalledWith({ type: 'grid', name: 'Grid View 3' }),
    );
    host.remove();
  });

  it('keeps the panel open with an error when the default create fails', async () => {
    const onCreateView = vi.fn(async (): Promise<ViewCreateOutcome> => ({
      status: 'failed',
      kind: 'server',
      error: { message: 'nope' },
    }));
    const { shell } = panelShell({ onCreateView });
    const host = openPanel(shell, shellState());

    host.querySelector<HTMLButtonElement>('[data-action="create-view"]')?.click();
    host.querySelector<HTMLButtonElement>('[data-action="create-type:grid"]')?.click();
    await vi.waitFor(() => expect(onCreateView).toHaveBeenCalledTimes(1));
    await vi.waitFor(() =>
      expect(host.querySelector('.loom-view-panel-error')?.textContent).toContain(
        'could not be created',
      ),
    );
    expect(host.querySelector('.loom-view-panel')).not.toBeNull();
    host.remove();
  });

  it('anchors the panel under the toggle and clamps it to the pane', () => {
    const { shell } = panelShell();
    const host = openPanel(shell, shellState());
    const panel = host.querySelector<HTMLElement>('.loom-view-panel');
    if (panel === null) throw new Error('Panel missing.');
    // jsdom reports zero rects: the popover still lands at the pane inset.
    expect(panel.style.insetInlineStart).toBe('4px');
    expect(panel.style.top).toBe('4px');
    expect(panel.style.maxHeight).toBe('96px');
    host.remove();
  });

  it('flips above the trigger when the pane has no room below', () => {
    const { shell } = panelShell();
    const host = openPanel(shell, shellState());
    const toggle = host.querySelector<HTMLElement>('[data-action="view-list"]');
    const pane = host;
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(120);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(160);
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element,
    ) {
      const base = { width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) };
      if (this === pane) return { ...base, top: 0, left: 0, right: 600, bottom: 240 };
      if (this === toggle) return { ...base, top: 200, bottom: 224, left: 100, right: 200 };
      return { ...base, top: 0, left: 0, right: 600, bottom: 60 };
    });
    shell.restoreFocus();
    const panel = host.querySelector<HTMLElement>('.loom-view-panel');
    // Flipped above: 200 - min(120, 192) - 4 = 76; height capped to 192.
    expect(panel?.style.top).toBe('76px');
    expect(panel?.style.maxHeight).toBe('192px');
    vi.restoreAllMocks();
    host.remove();
  });
});

describe('view list', () => {
  it('keeps every View in the tab strip without hiding any', () => {
    const { shell } = createShell();
    const views = [
      gridView('view_1', 'One'),
      gridView('view_2', 'Two'),
      gridView('view_3', 'Three'),
      mapView('view_4', 'Four'),
    ];
    const host = mount(shell, shellState({ views, selectedViewId: 'view_1' }));
    const tabElements = tabs(host);
    expect(tabElements.map((tab) => tab.dataset.viewId)).toEqual([
      'view_1',
      'view_2',
      'view_3',
      'view_4',
    ]);
    expect(tabElements.every((tab) => !tab.hidden)).toBe(true);
    expect(host.querySelector('.loom-view-tab-overflow')).toBeNull();
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
    const menu = document.querySelector<HTMLElement>('.loom-context-menu');
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
    const item = [...document.querySelectorAll<HTMLButtonElement>('.loom-context-menu-item')].find(
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
    const item = [...document.querySelectorAll<HTMLButtonElement>('.loom-context-menu-item')].find(
      (entry) => entry.textContent === 'Set as default',
    );
    expect(item?.disabled).toBe(true);
    host.remove();
  });

  it('opens the View panel inline rename from the tab menu', async () => {
    const onRenameView = vi.fn(async () => ({
      status: 'saved' as const,
      view: gridView('view_grid'),
    }));
    const { shell } = createShell({ onRenameView });
    const host = mount(shell, shellState());

    rightClickTab(host);
    const item = [...document.querySelectorAll<HTMLButtonElement>('.loom-context-menu-item')].find(
      (entry) => entry.textContent === 'Rename',
    );
    item?.click();
    const form = host.querySelector<HTMLFormElement>(
      '.loom-view-panel form[data-panel-form="rename"]',
    );
    expect(form).not.toBeNull();
    expect(form?.querySelector('input')?.value).toBe('Board');
    host.remove();
  });
});
