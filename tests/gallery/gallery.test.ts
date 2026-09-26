// Automated coverage for the development Gallery. These tests mount every
// registered scenario in jsdom and assert the real production components are
// wired — DOM semantics, roles and user-visible state only; no pixel claims.
import { afterEach, describe, expect, it, vi } from 'vitest';

import { galleryScenarios, type GalleryMountResult } from './scenarios';

async function mountScenario(id: string): Promise<{ host: HTMLElement; dispose: () => void }> {
  const scenario = galleryScenarios.find((candidate) => candidate.id === id);
  if (scenario === undefined) throw new Error(`Unknown Gallery scenario: ${id}`);
  const host = document.createElement('div');
  document.body.append(host);
  const result = await scenario.mount(host);
  return {
    host,
    dispose: () => {
      result?.dispose?.();
      host.remove();
    },
  };
}

const disposers: Array<() => void> = [];

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

async function mount(id: string): Promise<HTMLElement> {
  const mounted = await mountScenario(id);
  disposers.push(mounted.dispose);
  return mounted.host;
}

describe('Gallery registry', () => {
  it('mounts every registered scenario to non-empty DOM', async () => {
    for (const scenario of galleryScenarios) {
      const host = document.createElement('div');
      document.body.append(host);
      const result = await scenario.mount(host);
      expect(host.childElementCount, `scenario "${scenario.id}" mounted nothing`).toBeGreaterThan(
        0,
      );
      result?.dispose?.();
      host.remove();
    }
  });

  it('covers every checklist section', () => {
    const sections = new Set(galleryScenarios.map((scenario) => scenario.section));
    for (const required of [
      'Controls',
      'Fields',
      'Grid',
      'View shell',
      'Filter / Sort / Display',
      'Detail',
      'Record lifecycle',
      'Map',
      'Layout',
    ]) {
      expect(sections.has(required), `missing section "${required}"`).toBe(true);
    }
  });
});

describe('Controls', () => {
  it('renders disabled and pending buttons', async () => {
    const host = await mount('controls');
    const buttons = [...host.querySelectorAll<HTMLButtonElement>('button')];
    expect(buttons.some((button) => button.disabled)).toBe(true);
    expect(buttons.some((button) => button.getAttribute('aria-busy') === 'true')).toBe(true);
    expect(buttons.some((button) => button.classList.contains('loom-button-danger'))).toBe(true);
  });

  it('opens the production dangerous-action overlay and resolves cancel', async () => {
    const host = await mount('controls');
    const trigger = [...host.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
      button.textContent?.includes('destructive'),
    );
    trigger?.click();
    const dialog = host.querySelector<HTMLElement>('.loom-dangerous-confirmation');
    expect(dialog?.getAttribute('role')).toBe('alertdialog');
    dialog?.querySelector<HTMLButtonElement>('[data-action="cancel"]')?.click();
    await vi.waitFor(() => {
      expect(host.querySelector('[data-role="confirm-result"]')?.textContent).toBe('Cancelled');
    });
  });
});

describe('Fields', () => {
  it('renders all ten field types as grid columns and all state rows', async () => {
    const host = await mount('fields');
    expect(
      host.querySelectorAll('.loom-grid-header-cell:not(.loom-grid-index-header)'),
    ).toHaveLength(10);
    expect(host.querySelectorAll('.loom-grid-row').length).toBeGreaterThanOrEqual(10);
  });

  it('shows deleted and unknown select options distinctly', async () => {
    const host = await mount('fields');
    const text = host.textContent ?? '';
    expect(text).toContain('Archived');
    expect(host.querySelector('.loom-grid-cell[data-record-id="record_invalid"]')).not.toBeNull();
  });

  it('renders a safe URL as a link and keeps the unsafe value inert', async () => {
    const host = await mount('fields');
    const safe = host.querySelector<HTMLAnchorElement>('.loom-field-value-link');
    expect(safe?.getAttribute('href')).toBe('https://example.com/project');
    const links = [...host.querySelectorAll<HTMLAnchorElement>('a[href]')];
    expect(links.some((link) => link.href.startsWith('javascript:'))).toBe(false);
  });
});

describe('Grid states', () => {
  it('marks cells with per-record edit states and surfaces the error banner', async () => {
    const host = await mount('grid-edit-states');
    expect(
      host.querySelector('[data-edit-state="conflict"]') ??
        host.querySelector('.loom-grid-cell[data-edit-state]'),
    ).not.toBeNull();
    const states = new Set(
      [...host.querySelectorAll<HTMLElement>('[data-edit-state]')].map(
        (cell) => cell.dataset.editState,
      ),
    );
    for (const expected of ['queued', 'saving', 'error', 'terminal', 'conflict']) {
      expect(states.has(expected), `missing edit state "${expected}"`).toBe(true);
    }
    expect(host.querySelector('.loom-grid-edit-status')).not.toBeNull();
    expect(host.querySelector('.loom-grid-conflicts')).not.toBeNull();
    expect(host.querySelector('.loom-grid-conflict')).not.toBeNull();
  });

  it('shows the offline state without enabling editing', async () => {
    const host = await mount('grid-offline');
    expect(host.querySelector('.loom-grid-status')).not.toBeNull();
    const deleteButton = host.querySelector<HTMLButtonElement>('.loom-grid-delete-record');
    expect(deleteButton === null || deleteButton.disabled).toBe(true);
  });

  it('shows empty-result actions for a filter/search miss', async () => {
    const host = await mount('grid-empty');
    expect(
      host.querySelector('[data-action="empty-clear-filter"]') ??
        host.querySelector('[data-action="empty-clear-search"]'),
    ).not.toBeNull();
  });

  it('lists deleted records in the status panel with restore affordances', async () => {
    const host = await mount('grid-recycle');
    expect(host.querySelector('.loom-grid-deleted-notice')).not.toBeNull();
    host.querySelector<HTMLButtonElement>('[data-action="toggle-status"]')?.click();
    host.querySelector<HTMLButtonElement>('.loom-status-mode[data-mode="deleted"]')?.click();
    const panel = host.querySelector('.loom-status-panel');
    expect(panel).not.toBeNull();
    expect(panel?.querySelectorAll('.loom-recycle-item')).toHaveLength(2);
    expect(panel?.querySelectorAll('.loom-recycle-restore')).toHaveLength(2);
    expect(panel?.querySelector('.loom-recycle-load-more')).not.toBeNull();
  });

  it('runs a real delete through the queue in the interactive scenario', async () => {
    const host = await mount('grid-interactive');
    await vi.waitFor(() => {
      expect(host.querySelectorAll('.loom-grid-row').length).toBeGreaterThan(0);
    });
    const before = host.querySelectorAll('.loom-grid-row').length;
    host
      .querySelector<HTMLElement>('.loom-grid-index-cell')
      ?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 5, clientY: 5 }));
    host
      .querySelector<HTMLButtonElement>('.loom-context-menu-item[data-variant="danger"]')
      ?.click();
    await vi.waitFor(() => {
      expect(host.querySelector('.loom-grid-deleted-notice')).not.toBeNull();
    });
    await vi.waitFor(() => {
      expect(host.querySelectorAll('.loom-grid-row').length).toBeLessThan(before);
    });
  });

  it('creates a record through the inline draft row and queue', async () => {
    const host = await mount('grid-interactive');
    await vi.waitFor(() => {
      expect(host.querySelectorAll('.loom-grid-row').length).toBeGreaterThan(0);
    });
    const realRows = () => host.querySelectorAll('.loom-grid-row:not(.loom-grid-draft-row)').length;
    const before = realRows();
    host.querySelector<HTMLButtonElement>('.loom-grid-record-create')?.click();
    const draftRow = host.querySelector<HTMLElement>('.loom-grid-draft-row');
    expect(draftRow).not.toBeNull();
    const editor = draftRow?.querySelector<HTMLInputElement>('.loom-grid-editor');
    expect(editor).not.toBeNull();
    editor!.value = 'Gallery record';
    // Leaving the draft row commits it — same contract as a user clicking away.
    editor!.blur();
    draftRow!.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    await vi.waitFor(() => {
      expect(realRows()).toBeGreaterThan(before);
    });
    expect(host.textContent).toContain('Gallery record');
  });
});

describe('View shell', () => {
  it('renders duplicate view names as disambiguated tabs and a pending intent', async () => {
    const host = await mount('shell');
    const tabs = [...host.querySelectorAll<HTMLElement>('[role="tab"]')].filter((element) =>
      element.textContent?.includes('Daily'),
    );
    expect(tabs.length).toBeGreaterThanOrEqual(2);
    expect(host.textContent).toContain('Queued view');
    expect(host.querySelector('[data-action="retry-intent"]')).not.toBeNull();
  });

  it('shows the write issue and repair affordance in the View panel', async () => {
    const host = await mount('shell');
    host.querySelector<HTMLButtonElement>('[data-action="view-list"]')?.click();
    await vi.waitFor(() => {
      expect(host.querySelector('.loom-view-panel')).not.toBeNull();
    });
    expect(host.textContent).not.toContain('Retired view');
    expect(host.querySelector('li[data-view-id="view_broken"] .loom-view-broken')).not.toBeNull();
    expect(host.textContent).toContain('changed on the Server');
    host
      .querySelector<HTMLButtonElement>('li[data-view-id="view_broken"] [data-action="view-more"]')
      ?.click();
    await vi.waitFor(() => {
      expect(host.querySelector('.loom-context-menu [data-action="repair"]')).not.toBeNull();
    });
  });

  it('shows the no-view empty state with a create entry', async () => {
    const host = await mount('shell-empty');
    expect(host.querySelector('.loom-view-tabs')).not.toBeNull();
    expect(host.querySelectorAll('[role="tab"]')).toHaveLength(0);
    expect(host.querySelector('.loom-grid-status')).not.toBeNull();
    const buttons = [...host.querySelectorAll<HTMLButtonElement>('button')];
    expect(buttons.length).toBeGreaterThan(0);
  });
});

describe('Filter, sort and display panels', () => {
  it('mounts all three production panels with a nested draft', async () => {
    const host = await mount('panels');
    expect(host.querySelector('.loom-filter-builder')).not.toBeNull();
    expect(host.querySelector('.loom-sort-panel')).not.toBeNull();
    expect(host.querySelector('.loom-display-panel')).not.toBeNull();
    expect(host.querySelectorAll('.loom-filter-group').length).toBeGreaterThanOrEqual(2);
  });

  it('reports an operator that is unavailable for the field type', async () => {
    const host = await mount('filter-unavailable');
    const apply = [...host.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
      /apply/i.test(button.textContent ?? ''),
    );
    apply?.click();
    await vi.waitFor(() => {
      const text = host.textContent ?? '';
      expect(
        text.includes('operator') || text.includes('not supported') || text.includes('算'),
      ).toBe(true);
    });
  });
});

describe('Detail and create form', () => {
  it('shows the primary-field title with prev/next navigation', async () => {
    const host = await mount('detail');
    expect(host.querySelector('.loom-record-detail')).not.toBeNull();
    expect(host.textContent).toContain('Valid record');
    const buttons = [...host.querySelectorAll<HTMLButtonElement>('button')];
    expect(buttons.length).toBeGreaterThan(0);
  });

  it('mounts the production create form with all editable fields', async () => {
    const host = await mount('create-form');
    const form = host.querySelector<HTMLFormElement>('.loom-record-create');
    expect(form).not.toBeNull();
    expect(host.querySelector('.loom-record-create-submit')).not.toBeNull();
    expect(host.querySelector('[data-field-id="field_status"]')).not.toBeNull();
  });
});

describe('Map', () => {
  it('loads features through the real MapViewController and fake renderer', async () => {
    const host = await mount('map-ready');
    await vi.waitFor(() => {
      expect(host.querySelector('[data-role="map-feature"]')).not.toBeNull();
    });
    expect(host.querySelector('.loom-map-status')).not.toBeNull();
  });

  it('opens the cluster list through the real cluster flow', async () => {
    const host = await mount('map-ready');
    await vi.waitFor(() => {
      expect(host.querySelector('[data-role="map-feature"]')).not.toBeNull();
    });
    [...host.querySelectorAll<HTMLButtonElement>('[data-role="map-fake-control"]')]
      .find((button) => button.textContent === 'Select cluster')
      ?.click();
    await vi.waitFor(() => {
      expect(host.querySelector('.loom-map-cluster-records')).not.toBeNull();
    });
  });

  it('reports tile failures through the production tile status element', async () => {
    const host = await mount('map-ready');
    [...host.querySelectorAll<HTMLButtonElement>('[data-role="map-fake-control"]')]
      .find((button) => button.textContent === 'Tile error')
      ?.click();
    await vi.waitFor(() => {
      const status = host.querySelector<HTMLElement>('.loom-map-tile-status');
      expect(status?.dataset.status).toBe('error');
    });
  });

  it('shows a configuration error when the tile provider is missing', async () => {
    const host = await mount('map-provider-error');
    await vi.waitFor(() => {
      const text = host.textContent ?? '';
      expect(text.length).toBeGreaterThan(0);
      expect(host.querySelector('.loom-map-tile-status, .loom-map-status')).not.toBeNull();
    });
    const status = host.querySelector<HTMLElement>('.loom-map-tile-status');
    expect(status === null || (status.dataset.status ?? '') !== 'ready').toBe(true);
  });
});

describe('Layout', () => {
  it('renders the navigation bar and command bar as stable zones', async () => {
    const host = await mount('component-zones');
    const shell = host.querySelector('.loom-table-shell');
    expect(shell?.querySelector('.loom-shell-context')).not.toBeNull();
    expect(shell?.querySelector('.loom-view-tabs')).not.toBeNull();
    expect(shell?.querySelector('.loom-view-list-toggle')).not.toBeNull();
    const toolbar = host.querySelector('.loom-grid-toolbar');
    expect(toolbar?.querySelector('.loom-toolbar-start')).not.toBeNull();
    expect(toolbar?.querySelector('.loom-toolbar-end')).not.toBeNull();
    expect(toolbar?.querySelector('.loom-toolbar-end .loom-save-status')).not.toBeNull();
    expect(toolbar?.querySelector('.loom-grid-clipboard-note')).toBeNull();
    expect(host.querySelector('.loom-grid-clipboard-note')).not.toBeNull();
    const children = [...(host.querySelector('.loom-grid-shell')?.children ?? [])];
    expect(children.indexOf(host.querySelector('.loom-table-shell') as Element)).toBeLessThan(
      children.indexOf(toolbar as Element),
    );
  });

  it('renders every save-status state inside the fixed-width chip', async () => {
    const host = await mount('component-save-status');
    const chips = [...host.querySelectorAll<HTMLElement>('.loom-save-status')];
    expect(chips.map((chip) => chip.dataset.status)).toEqual([
      'dirty',
      'saving',
      'saved',
      'error',
      'conflict',
      'offline-readonly',
    ]);
  });

  it('mounts the record detail inside the right overlay host', async () => {
    const host = await mount('component-detail-panel');
    const detailHost = host.querySelector('.loom-detail-host');
    expect(detailHost?.querySelector('.loom-record-detail')).not.toBeNull();
    expect(detailHost?.textContent).toContain('Alpha project');
    const next = detailHost?.querySelector<HTMLButtonElement>('[aria-label="Next Record"]');
    next?.click();
    await vi.waitFor(() => {
      expect(detailHost?.textContent).toContain('Beta project');
    });
  });

  it('mounts width variants and a dark token environment', async () => {
    const host = await mount('layout');
    const widths = [...host.querySelectorAll<HTMLElement>('[data-gallery-width]')].map(
      (element) => element.dataset.galleryWidth,
    );
    expect(widths).toEqual(['360', '640', '1024']);
    expect(host.querySelector('.loom-gallery-dark')).not.toBeNull();
    for (const frame of host.querySelectorAll('[data-gallery-width]')) {
      expect(frame.querySelectorAll('.loom-grid-row').length).toBeGreaterThan(0);
    }
  });
});
