import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceLeaf } from 'obsidian';
import { createTranslator } from '../../src/i18n';
import { addConnectionProfile, DEFAULT_PLUGIN_SETTINGS } from '../../src/settings/plugin-settings';
import { TileProviderRegistry } from '../../src/maps/providers/tile-provider-registry';
import { LoomTableView } from '../../src/ui/loomtable-view';
import { closeActiveContextMenu, openContextMenu } from '../../src/ui/context-menu';
import { openFieldEditor } from '../../src/ui/field-editor-panel';
import { FilterBuilder } from '../../src/ui/filter-builder';
import { LoomTableClientError } from '../../src/client/loomtable-client';
import { InMemoryLoomTableClient } from '../fixtures/in-memory-loomtable-client';
import type { InMemoryGridData } from '../fixtures/in-memory-loomtable-client';
import { galleryData } from '../gallery/data';
import { GalleryMapRenderer } from '../gallery/scenarios';

// Only the host shell is substituted. View, Renderer, Controller and View CAS
// all execute their production paths against the contract-aware memory client.
vi.mock('obsidian', () => ({
  ItemView: class {
    contentEl = Object.assign(document.createElement('div'), {
      empty(this: HTMLElement) {
        this.replaceChildren();
      },
      addClass(this: HTMLElement, name: string) {
        this.classList.add(name);
      },
    });
    app = {};
  },
  TFile: class {},
}));

const t = createTranslator('en');
const views: LoomTableView[] = [];
const releases: Array<() => void> = [];
function host(): HTMLElement {
  const element = document.createElement('div');
  document.body.append(element);
  return element;
}
async function mountView() {
  const fixture = galleryData();
  const data: InMemoryGridData = {
    ...fixture,
    views: fixture.views.map((view) =>
      view.type === 'grid'
        ? {
            ...view,
            config: {
              ...view.config,
              filter: { kind: 'rule', fieldId: 'field_title', operator: 'contains', value: 'old' },
            },
          }
        : view,
    ),
  };
  const client = new InMemoryLoomTableClient(data);
  const settings = structuredClone(DEFAULT_PLUGIN_SETTINGS);
  addConnectionProfile(settings, {
    name: 'Synthetic',
    serverOrigin: 'http://127.0.0.1:31201',
    rememberToken: false,
  });
  const view = new LoomTableView(
    {} as WorkspaceLeaf,
    () => settings,
    () => t,
    () => client,
    {
      registry: new TileProviderRegistry(),
      credentials: { get: () => null },
      saveSettings: async () => {},
      createRenderer: () => ({
        renderer: new GalleryMapRenderer(),
        viewport: {
          getViewport: () => ({ boxes: [{ west: 0, south: 0, east: 1, north: 1 }] }),
          getPixelSize: () => ({ width: 800, height: 600 }),
        },
      }),
    },
  );
  document.body.append(view.contentEl);
  views.push(view);
  await view.onOpen();
  await vi.waitFor(() =>
    expect(view.contentEl.querySelector('[data-action="toggle-filter"]')).not.toBeNull(),
  );
  view.contentEl.querySelector<HTMLButtonElement>('[data-action="toggle-filter"]')!.click();
  return { view, client, write: vi.spyOn(client, 'updateView') };
}
function edit(view: LoomTableView, value: string): void {
  const input = view.contentEl.querySelector<HTMLInputElement>('[data-role="filter-value"]')!;
  expect(input).not.toBeNull();
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function expectFilterCount(view: LoomTableView, open: boolean, count: number): void {
  const button = view.contentEl.querySelector<HTMLButtonElement>('[data-action="toggle-filter"]')!;
  expect(button.getAttribute('aria-expanded')).toBe(String(open));
  expect(button.dataset.active).toBe(String(count > 0));
  expect(button.querySelector('.loom-grid-query-count')?.textContent).toBe(
    count > 0 ? String(count) : '',
  );
  expect(button.getAttribute('aria-label')).toBe(
    count > 0 ? `Filter, ${count} conditions` : 'Filter',
  );
}

// Observe even a transient accessible-label overwrite before a later render
// replaces the button. Final DOM alone can hide the closed draft publication.
function closedFilterLabels(): string[] {
  const labels: string[] = [];
  // The spy supplies the original Element receiver via .call below.
  // eslint-disable-next-line @typescript-eslint/unbound-method -- Original receiver is supplied with .call.
  const original = Element.prototype.setAttribute;
  vi.spyOn(Element.prototype, 'setAttribute').mockImplementation(function (
    this: Element,
    name,
    value,
  ) {
    if (
      this instanceof HTMLButtonElement &&
      this.isConnected &&
      this.dataset.action === 'toggle-filter' &&
      this.getAttribute('aria-expanded') === 'false' &&
      name === 'aria-label'
    )
      labels.push(value);
    original.call(this, name, value);
  });
  return labels;
}

function addValidRule(view: LoomTableView): void {
  view.contentEl.querySelector<HTMLButtonElement>('[data-action="filter-add-rule"]')!.click();
  const input = [
    ...view.contentEl.querySelectorAll<HTMLInputElement>('[data-role="filter-value"]'),
  ].at(-1)!;
  input.value = 'new';
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
afterEach(async () => {
  for (const view of views.splice(0)) await view.onClose();
  for (const release of releases.splice(0)) release();
  closeActiveContextMenu();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('shared owner lifecycle', () => {
  it('keeps a failed closed Apply count authoritative and restores its draft on reopen', async () => {
    const { view, client, write } = await mountView();
    let reject!: (reason: Error) => void;
    write.mockImplementationOnce(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
    );
    const labels = closedFilterLabels();
    vi.useFakeTimers();
    addValidRule(view);
    expectFilterCount(view, true, 2);
    view.contentEl.querySelector<HTMLButtonElement>('[data-action="toggle-filter"]')!.click();
    expectFilterCount(view, false, 1);
    await vi.advanceTimersByTimeAsync(0);
    reject(new LoomTableClientError('forbidden', { message: 'Synthetic rejection' }));
    await vi.advanceTimersByTimeAsync(1000);
    expect(labels).toEqual([]);
    expectFilterCount(view, false, 1);
    expect((await client.getView('view_grid')).revision).toBe(1);
    expect(write).toHaveBeenCalledTimes(1);
    view.contentEl.querySelector<HTMLButtonElement>('[data-action="toggle-filter"]')!.click();
    expectFilterCount(view, true, 2);
    expect(view.contentEl.querySelectorAll('[data-role="filter-value"]')).toHaveLength(2);
  });

  it('keeps a failed closed Clear active and preserves the cleared recovery draft', async () => {
    const { view, client, write } = await mountView();
    let reject!: (reason: Error) => void;
    write.mockImplementationOnce(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
    );
    const labels = closedFilterLabels();
    vi.useFakeTimers();
    view.contentEl.querySelector<HTMLButtonElement>('[data-action="filter-clear"]')!.click();
    expectFilterCount(view, true, 0);
    view.contentEl.querySelector<HTMLButtonElement>('[data-action="toggle-filter"]')!.click();
    expectFilterCount(view, false, 1);
    await vi.advanceTimersByTimeAsync(0);
    reject(new LoomTableClientError('forbidden', { message: 'Synthetic rejection' }));
    await vi.advanceTimersByTimeAsync(1000);
    expect(labels).toEqual([]);
    expectFilterCount(view, false, 1);
    expect((await client.getView('view_grid')).revision).toBe(1);
    expect(write).toHaveBeenCalledTimes(1);
    view.contentEl.querySelector<HTMLButtonElement>('[data-action="toggle-filter"]')!.click();
    expectFilterCount(view, true, 0);
  });

  it('refreshes a successful closed Apply from Controller state without a late draft publication', async () => {
    const { view, client, write } = await mountView();
    let finish!: () => void;
    write.mockImplementationOnce(
      (...args) =>
        new Promise((resolve) => {
          finish = () => {
            void InMemoryLoomTableClient.prototype.updateView.call(client, ...args).then(resolve);
          };
        }),
    );
    const labels = closedFilterLabels();
    vi.useFakeTimers();
    addValidRule(view);
    view.contentEl.querySelector<HTMLButtonElement>('[data-action="toggle-filter"]')!.click();
    expectFilterCount(view, false, 1);
    await vi.advanceTimersByTimeAsync(0);
    finish();
    await vi.advanceTimersByTimeAsync(1000);
    expectFilterCount(view, false, 2);
    expect(labels).toEqual([]);
    expect(write).toHaveBeenCalledTimes(1);
    expect((await client.getView('view_grid')).revision).toBe(2);
    view.contentEl.querySelector<HTMLButtonElement>('[data-action="toggle-filter"]')!.click();
    expectFilterCount(view, true, 2);
  });

  it('ignores a retained Builder callback while closed but accepts the same owner on reopen', async () => {
    const render = vi.spyOn(FilterBuilder.prototype, 'render');
    const { view, write } = await mountView();
    const builder = render.mock.contexts.find((context) => context instanceof FilterBuilder)!;
    vi.useFakeTimers();
    edit(view, ''); // Invalid local draft: zero valid rules, no write.
    view.contentEl.querySelector<HTMLButtonElement>('[data-action="toggle-filter"]')!.click();
    const labels = closedFilterLabels();
    builder.render();
    expect(labels).toEqual([]);
    expectFilterCount(view, false, 1);
    view.contentEl.querySelector<HTMLButtonElement>('[data-action="toggle-filter"]')!.click();
    expectFilterCount(view, true, 0);
    expect(write).not.toHaveBeenCalled();
  });

  it('removes closed Active state only after a successful Clear is committed', async () => {
    const { view, client, write } = await mountView();
    let finish!: () => void;
    write.mockImplementationOnce(
      (...args) =>
        new Promise((resolve) => {
          finish = () => {
            void InMemoryLoomTableClient.prototype.updateView.call(client, ...args).then(resolve);
          };
        }),
    );
    vi.useFakeTimers();
    view.contentEl.querySelector<HTMLButtonElement>('[data-action="filter-clear"]')!.click();
    expectFilterCount(view, true, 0);
    view.contentEl.querySelector<HTMLButtonElement>('[data-action="toggle-filter"]')!.click();
    expectFilterCount(view, false, 1);
    await vi.advanceTimersByTimeAsync(0);
    finish();
    await vi.advanceTimersByTimeAsync(1000);
    expectFilterCount(view, false, 0);
    const saved = await client.getView('view_grid');
    expect(saved.type === 'grid' && saved.config.filter).toBeUndefined();
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('does not publish old Builder counts after View switch and return', async () => {
    const render = vi.spyOn(FilterBuilder.prototype, 'render');
    const { view, client, write } = await mountView();
    const builder = render.mock.contexts.find((context) => context instanceof FilterBuilder)!;
    let reject!: (reason: Error) => void;
    write.mockImplementationOnce(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
    );
    vi.useFakeTimers();
    addValidRule(view);
    await vi.advanceTimersByTimeAsync(301);
    const map = [...view.contentEl.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((b) =>
      b.textContent?.includes('Map'),
    )!;
    map.click();
    await vi.advanceTimersByTimeAsync(300);
    const grid = [...view.contentEl.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((b) =>
      b.textContent?.includes('Grid'),
    )!;
    grid.click();
    await vi.advanceTimersByTimeAsync(300);
    view.contentEl.querySelector<HTMLButtonElement>('[data-action="toggle-filter"]')!.click();
    expectFilterCount(view, true, 1);
    reject(new LoomTableClientError('forbidden', { message: 'Synthetic rejection' }));
    await vi.advanceTimersByTimeAsync(1000);
    builder.render();
    expectFilterCount(view, true, 1);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0]?.[0]).toBe('view_grid');
    expect((await client.getView('view_grid')).revision).toBe(1);
  });

  it('updates the real Toolbar count from valid draft without applying invalid input', async () => {
    const { view, write } = await mountView();
    const button = view.contentEl.querySelector<HTMLButtonElement>(
      '[data-action="toggle-filter"]',
    )!;
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(button.querySelector('.loom-grid-query-count')?.textContent).toBe('1');
    edit(view, '');
    expect(button.dataset.active).toBe('false');
    expect(button.querySelector<HTMLElement>('.loom-grid-query-count')?.hidden).toBe(true);
    expect(button.getAttribute('aria-label')).toBe('Filter');
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(write).not.toHaveBeenCalled();
    edit(view, 'valid');
    expect(button.dataset.active).toBe('true');
    expect(button.querySelector('.loom-grid-query-count')?.textContent).toBe('1');
    expect(button.getAttribute('aria-expanded')).toBe('true');
    await view.onClose();
  });
  it('closes menu → trigger → outside and leaves outside Arrow focus alone', () => {
    const owner = host();
    const trigger = document.createElement('button');
    trigger.setAttribute('aria-haspopup', 'menu');
    trigger.setAttribute('aria-expanded', 'false');
    const outside = document.createElement('input');
    owner.append(trigger, outside);
    releases.push(
      openContextMenu({
        host: owner,
        trigger,
        x: 0,
        y: 0,
        label: 'Commands',
        items: [{ label: 'Action', action: vi.fn() }],
      }),
    );
    trigger.focus();
    expect(document.querySelector('.loom-context-menu')).not.toBeNull();
    outside.focus();
    outside.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }),
    );
    expect(document.querySelector('.loom-context-menu')).toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(outside);
  });

  it('releases Palette capture before keyboard type replacement', () => {
    const owner = host();
    const add = vi.spyOn(document, 'addEventListener');
    const remove = vi.spyOn(document, 'removeEventListener');
    releases.push(
      openFieldEditor({ mode: 'create', host: owner, x: 0, y: 0, translate: t, onSubmit: vi.fn() }),
    );
    owner.querySelector<HTMLButtonElement>('[data-type="select"]')!.click();
    owner.querySelector<HTMLButtonElement>('.loom-field-editor-option-add')!.click();
    owner.querySelector<HTMLButtonElement>('.loom-field-editor-option-row > button')!.click();
    const listener = add.mock.calls
      .filter((call) => call[0] === 'pointerdown' && call[2] === true)
      .at(-1)![1];
    const type = owner.querySelector<HTMLButtonElement>('[data-type="attachment"]')!;
    type.focus();
    type.click(); // Native keyboard activation emits click without pointerdown.
    expect(owner.querySelector('.loom-field-editor-palette')).toBeNull();
    expect(
      remove.mock.calls.some(
        (call) => call[0] === 'pointerdown' && call[1] === listener && call[2] === true,
      ),
    ).toBe(true);
  });

  it('Pane unload cancels a 300ms Filter intent through the real View', async () => {
    const { view, write } = await mountView();
    vi.useFakeTimers();
    edit(view, 'unissued');
    await view.onClose();
    await vi.advanceTimersByTimeAsync(1000);
    expect(write).not.toHaveBeenCalled();
  });

  it('Escape from a Grid cell cancels pending Filter and restores its trigger', async () => {
    const { view, write } = await mountView();
    vi.useFakeTimers();
    edit(view, 'unissued-cell-escape');
    const cell = view.contentEl.querySelector<HTMLElement>('.loom-grid-cell')!;
    cell.focus();
    cell.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    await vi.advanceTimersByTimeAsync(1000);
    expect(write).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(
      view.contentEl.querySelector('[data-action="toggle-filter"]'),
    );
  });

  it.each(['unload', 'pointercancel'] as const)(
    'releases an active resize on %s without a late write',
    async (exit) => {
      const { view, write } = await mountView();
      const add = vi.spyOn(document, 'addEventListener');
      const remove = vi.spyOn(document, 'removeEventListener');
      view.contentEl
        .querySelector('.loom-grid-col-resize')!
        .dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, bubbles: true }));
      const listeners = add.mock.calls.filter((call) =>
        ['pointermove', 'pointerup', 'pointercancel'].includes(call[0]),
      );
      expect(listeners).toHaveLength(3);
      if (exit === 'unload') await view.onClose();
      else document.dispatchEvent(new PointerEvent('pointercancel'));
      for (const [name, listener] of listeners)
        expect(remove.mock.calls.some((call) => call[0] === name && call[1] === listener)).toBe(
          true,
        );
      document.dispatchEvent(new PointerEvent('pointerup', { clientX: 140 }));
      expect(write).not.toHaveBeenCalled();
    },
  );

  it.each(['pointer', 'keyboard'])(
    'Grid → Map cancels pending Filter via %s navigation',
    async (mode) => {
      const { view, write } = await mountView();
      vi.useFakeTimers();
      edit(view, 'unissued');
      const map = [...view.contentEl.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
        (tab) => tab.textContent?.includes('Map'),
      )!;
      expect(map).toBeDefined();
      if (mode === 'pointer') map.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      map.click();
      await vi.advanceTimersByTimeAsync(1500);
      expect(view.contentEl.querySelector('.loom-map-shell')).not.toBeNull();
      expect(write).not.toHaveBeenCalled();
    },
  );

  it('ordinary same-owner close flushes a valid draft once', async () => {
    const { view, write } = await mountView();
    vi.useFakeTimers();
    edit(view, 'last-valid');
    view.contentEl.querySelector<HTMLButtonElement>('[data-action="toggle-filter"]')!.click();
    await vi.advanceTimersByTimeAsync(1000);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0]?.[0]).toBe('view_grid');
  });

  it('Escape cancels an unissued draft without changing the saved query', async () => {
    const { view, write } = await mountView();
    vi.useFakeTimers();
    edit(view, 'unissued');
    view.contentEl
      .querySelector<HTMLInputElement>('[data-role="filter-value"]')!
      .dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );
    await vi.advanceTimersByTimeAsync(1000);
    expect(write).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(
      view.contentEl.querySelector('[data-action="toggle-filter"]'),
    );
  });

  it('in-flight → queued → owner dispose permits only the accepted original View write', async () => {
    const { view, client, write } = await mountView();
    const original = (
      id: Parameters<typeof client.updateView>[0],
      request: Parameters<typeof client.updateView>[1],
    ) => InMemoryLoomTableClient.prototype.updateView.call(client, id, request);
    let finish!: () => void;
    write.mockImplementationOnce(
      (...args) =>
        new Promise((resolve) => {
          finish = () => {
            void original(...args).then(resolve);
          };
        }),
    );
    vi.useFakeTimers();
    edit(view, 'first');
    await vi.advanceTimersByTimeAsync(301);
    expect(write).toHaveBeenCalledTimes(1);
    edit(view, 'queued');
    await vi.advanceTimersByTimeAsync(301);
    expect(write).toHaveBeenCalledTimes(1);
    await view.onClose();
    finish();
    await vi.advanceTimersByTimeAsync(1000);
    expect(
      write.mock.calls.map((call) => ({
        viewId: call[0],
        filter: call[1].type === 'grid' ? call[1].config?.filter : undefined,
      })),
    ).toEqual([
      {
        viewId: 'view_grid',
        filter: { kind: 'rule', fieldId: 'field_title', operator: 'contains', value: 'first' },
      },
    ]);
    const saved = await client.getView('view_grid');
    expect(saved.type === 'grid' && saved.config.filter).toEqual({
      kind: 'rule',
      fieldId: 'field_title',
      operator: 'contains',
      value: 'first',
    });
  });

  it('standalone dispose never invokes an unissued callback', async () => {
    vi.useFakeTimers();
    const owner = host();
    const onApply = vi.fn();
    const field = galleryData().fields[0]!;
    const builder = new FilterBuilder(
      { kind: 'rule', fieldId: field.id, operator: 'contains', value: 'old' },
      { fields: [field], translate: t, onApply, host: owner },
    );
    owner.append(builder.render());
    const input = owner.querySelector<HTMLInputElement>('[data-role="filter-value"]')!;
    input.value = 'unissued';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    builder.dispose();
    builder.dispose();
    await vi.advanceTimersByTimeAsync(1000);
    expect(onApply).not.toHaveBeenCalled();
  });

  it('a queued ordinary-close flush is still cancelled by a subsequent context switch', async () => {
    const { view, client, write } = await mountView();
    let finish!: () => void;
    write.mockImplementationOnce(
      (id, request) =>
        new Promise((resolve) => {
          finish = () => {
            void InMemoryLoomTableClient.prototype.updateView
              .call(client, id, request)
              .then(resolve);
          };
        }),
    );
    vi.useFakeTimers();
    edit(view, 'accepted');
    await vi.advanceTimersByTimeAsync(301);
    edit(view, 'unissued');
    view.contentEl.querySelector<HTMLButtonElement>('[data-action="toggle-filter"]')!.click();
    const map = [...view.contentEl.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
      (tab) => tab.textContent?.includes('Map'),
    )!;
    map.click();
    await vi.advanceTimersByTimeAsync(50);
    finish();
    await vi.advanceTimersByTimeAsync(1000);
    expect(write).toHaveBeenCalledTimes(1);
    expect(view.contentEl.querySelector('.loom-map-shell')).not.toBeNull();
  });

  it('serializes an ordinary-close queued flush while the original owner remains valid', async () => {
    const { view, client, write } = await mountView();
    let finish!: () => void;
    write.mockImplementationOnce(
      (id, request) =>
        new Promise((resolve) => {
          finish = () => {
            void InMemoryLoomTableClient.prototype.updateView
              .call(client, id, request)
              .then(resolve);
          };
        }),
    );
    vi.useFakeTimers();
    edit(view, 'first');
    await vi.advanceTimersByTimeAsync(301);
    edit(view, 'last-valid');
    view.contentEl.querySelector<HTMLButtonElement>('[data-action="toggle-filter"]')!.click();
    expect(write).toHaveBeenCalledTimes(1);
    finish();
    await vi.advanceTimersByTimeAsync(1000);
    expect(write).toHaveBeenCalledTimes(2);
    expect(write.mock.calls.every((call) => call[0] === 'view_grid')).toBe(true);
    const saved = await client.getView('view_grid');
    expect(
      saved.type === 'grid' && saved.config.filter?.kind === 'rule' && saved.config.filter.value,
    ).toBe('last-valid');
  });

  it('ordinary-close failure keeps raw input available for correction and retry', async () => {
    const { view, write } = await mountView();
    write.mockRejectedValueOnce(
      new LoomTableClientError('forbidden', { message: 'Synthetic rejection' }),
    );
    vi.useFakeTimers();
    edit(view, 'failed-draft');
    view.contentEl.querySelector<HTMLButtonElement>('[data-action="toggle-filter"]')!.click();
    await vi.advanceTimersByTimeAsync(1000);
    view.contentEl.querySelector<HTMLButtonElement>('[data-action="toggle-filter"]')!.click();
    expect(
      view.contentEl.querySelector<HTMLInputElement>('[data-role="filter-value"]')!.value,
    ).toBe('failed-draft');
    expect(view.contentEl.querySelector('[role="alert"]')).not.toBeNull();
    edit(view, 'retry');
    await vi.advanceTimersByTimeAsync(1000);
    expect(write).toHaveBeenCalledTimes(2);
  });

  it('invalid ordinary-close input cannot overwrite the last valid query', async () => {
    const { view, client, write } = await mountView();
    vi.useFakeTimers();
    edit(view, '');
    view.contentEl.querySelector<HTMLButtonElement>('[data-action="toggle-filter"]')!.click();
    await vi.advanceTimersByTimeAsync(1000);
    expect(write).not.toHaveBeenCalled();
    const saved = await client.getView('view_grid');
    expect(
      saved.type === 'grid' && saved.config.filter?.kind === 'rule' && saved.config.filter.value,
    ).toBe('old');
  });

  it.each(['sort', 'display'])('owner teardown also cancels the owned %s timer', async (panel) => {
    const { view, write } = await mountView();
    view.contentEl.querySelector<HTMLButtonElement>(`[data-action="toggle-${panel}"]`)!.click();
    vi.useFakeTimers();
    if (panel === 'sort') {
      const direction = view.contentEl.querySelector<HTMLSelectElement>(
        '[data-role="sort-direction"]',
      )!;
      expect(direction).not.toBeNull();
      direction.value = 'desc';
      direction.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      const width = view.contentEl.querySelector<HTMLInputElement>('[data-role="display-width"]')!;
      expect(width).not.toBeNull();
      width.value = '250';
      width.dispatchEvent(new Event('input', { bubbles: true }));
    }
    await view.onClose();
    await vi.advanceTimersByTimeAsync(1000);
    expect(write).not.toHaveBeenCalled();
  });

  it('View teardown releases Query and Shell document capture listeners', async () => {
    const add = vi.spyOn(document, 'addEventListener');
    const remove = vi.spyOn(document, 'removeEventListener');
    const { view } = await mountView();
    view.contentEl.querySelector<HTMLButtonElement>('[data-action="view-list"]')!.click();
    const captures = add.mock.calls.filter(
      (call) => call[2] === true && ['pointerdown', 'keydown', 'focusout'].includes(call[0]),
    );
    expect(captures.length).toBeGreaterThan(0);
    await view.onClose();
    expect(
      captures.every((call) =>
        remove.mock.calls.some(
          (release) => release[0] === call[0] && release[1] === call[1] && release[2] === true,
        ),
      ),
    ).toBe(true);
  });

  it('a late Field failure never unlocks a closed draft or activates a stale submit', async () => {
    const owner = host();
    let fail!: (error: Error) => void;
    const onSubmit = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          fail = reject;
        }),
    );
    const close = openFieldEditor({
      mode: 'create',
      host: owner,
      x: 0,
      y: 0,
      translate: t,
      onSubmit,
    });
    releases.push(close);
    const name = owner.querySelector<HTMLInputElement>('.loom-field-editor-name')!;
    name.value = 'Pending';
    const submit = owner.querySelector<HTMLButtonElement>('.loom-field-editor-submit')!;
    submit.click();
    expect(name.disabled).toBe(true);
    close();
    const outside = document.createElement('input');
    owner.append(outside);
    outside.focus();
    fail(new Error('Synthetic late failure'));
    await Promise.resolve();
    await Promise.resolve();
    expect(name.disabled).toBe(true);
    name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    submit.click();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(outside);
  });
});
