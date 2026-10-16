import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTranslator } from '../../src/i18n';
import { resolveGridGeometry } from '../../src/ui/grid-geometry';
import { ReadonlyGridRenderer } from '../../src/ui/readonly-grid-renderer';
import { createGalleryState, GALLERY_GRID_VIEW } from '../gallery/data';

const renderers: ReadonlyGridRenderer[] = [];
afterEach(() => {
  for (const renderer of renderers.splice(0)) renderer.dispose();
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function mount(density: 'compact' | 'standard' | 'comfortable' = 'standard', recordCount?: number) {
  const base = createGalleryState();
  const fields = base.fields.slice(0, 2);
  const ids = fields.map((field) => field.id);
  const view = {
    ...GALLERY_GRID_VIEW,
    config: {
      ...GALLERY_GRID_VIEW.config,
      projection: ids,
      columnOrder: ids,
      columnWidths: { [ids[0]!]: 216, [ids[1]!]: 120 },
      frozenFieldIds: ids,
      rowHeight: density,
    },
  };
  const records =
    recordCount === undefined
      ? base.records
      : Array.from({ length: recordCount }, (_, index) => ({
          ...base.records[0]!,
          id: `record_${index}`,
          values: { ...base.records[0]!.values, [ids[0]!]: `Row ${index}` },
        }));
  const state = { ...base, records, fields, views: [view], selectedViewId: view.id };
  const container = document.createElement('div');
  document.body.append(container);
  const onApplyDisplay = vi.fn();
  const onCellEdit = vi.fn();
  const onCreateRecord = vi.fn();
  const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), {
    onRefresh: vi.fn(),
    onLoadMore: vi.fn(),
    onRecordOpen: vi.fn(),
    onApplyDisplay,
    onCellEdit,
    onSetFieldAggregation: vi.fn(),
    onCreateRecord,
    onFieldSave: vi.fn(),
  });
  renderers.push(renderer);
  renderer.render(state);
  return { container, renderer, state, ids, onApplyDisplay, onCellEdit, onCreateRecord };
}

describe('C review geometry regressions', () => {
  it.each(['record', 'field'] as const)(
    'cancels a deleted %s without a late write',
    async (deleted) => {
      vi.useFakeTimers();
      const { container, renderer, state, ids, onCellEdit } = mount('standard', 1000);
      const viewport = container.querySelector<HTMLElement>('.loom-grid-viewport')!;
      viewport.scrollTop = 7200;
      viewport.dispatchEvent(new Event('scroll'));
      await vi.advanceTimersByTimeAsync(30);
      container
        .querySelector(`[data-record-id="record_200"] [data-field-id="${ids[0]}"]`)!
        .dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      const editor = container.querySelector<HTMLInputElement>('.loom-grid-editor')!;
      editor.value = 'Invalid owner';
      renderer.render({
        ...state,
        ...(deleted === 'record'
          ? { records: state.records.filter((record) => record.id !== 'record_200') }
          : { fields: state.fields.slice(1) }),
      });
      expect(container.querySelector('.loom-grid-editor')).toBeNull();
      editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      editor.dispatchEvent(new Event('blur'));
      await vi.advanceTimersByTimeAsync(100);
      expect(onCellEdit).not.toHaveBeenCalled();
    },
  );

  it('pins only the legal edited row if passive scrolling has moved beyond it before replacement', async () => {
    vi.useFakeTimers();
    const { container, renderer, state, ids, onCellEdit } = mount('standard', 1000);
    const viewport = container.querySelector<HTMLElement>('.loom-grid-viewport')!;
    viewport.scrollTop = 7200;
    viewport.dispatchEvent(new Event('scroll'));
    await vi.advanceTimersByTimeAsync(30);
    container
      .querySelector(`[data-record-id="record_200"] [data-field-id="${ids[0]}"]`)!
      .dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const editor = container.querySelector<HTMLInputElement>('.loom-grid-editor')!;
    editor.value = 'Pinned raw';
    viewport.scrollTop = 18000;
    viewport.dispatchEvent(new Event('scroll'));
    await vi.advanceTimersByTimeAsync(30);
    const view = state.views[0]!;
    renderer.render({
      ...state,
      views: [{ ...view, config: { ...view.config, frozenFieldIds: [] } }],
    });
    expect(container.querySelector('.loom-grid-editor')).toBe(editor);
    expect(editor.value).toBe('Pinned raw');
    expect(container.querySelector<HTMLElement>('.loom-grid-viewport')!.scrollTop).toBe(18000);
    expect(container.querySelectorAll('.loom-grid-row').length).toBeLessThan(50);
    renderer.dispose();
    await vi.advanceTimersByTimeAsync(100);
    expect(onCellEdit).not.toHaveBeenCalled();
  });

  it.each(['width', 'frozen', 'compact', 'standard', 'comfortable'] as const)(
    'preserves a row-200 raw editor across %s geometry with bounded virtualization',
    async (change) => {
      vi.useFakeTimers();
      const { container, renderer, state, ids, onCellEdit } = mount('standard', 1000);
      const viewport = container.querySelector<HTMLElement>('.loom-grid-viewport')!;
      viewport.scrollTop = 7200;
      viewport.scrollLeft = 120;
      viewport.dispatchEvent(new Event('scroll'));
      await vi.advanceTimersByTimeAsync(30);
      const cell = container.querySelector<HTMLElement>(
        `[data-record-id="record_200"] [data-field-id="${ids[0]}"]`,
      )!;
      expect(cell).not.toBeNull();
      cell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      await vi.advanceTimersByTimeAsync(0);
      const editor = cell.querySelector<HTMLInputElement>('.loom-grid-editor')!;
      editor.value = '未提交的中文草稿';
      editor.setSelectionRange(2, 5);
      editor.focus();
      editor.dispatchEvent(new CompositionEvent('compositionstart'));
      const view = state.views[0]!;
      const config = {
        ...view.config,
        ...(change === 'width'
          ? { columnWidths: { ...view.config.columnWidths, [ids[0]!]: 260 } }
          : {}),
        ...(change === 'frozen' ? { frozenFieldIds: [] } : {}),
        ...(change === 'compact' || change === 'standard' || change === 'comfortable'
          ? { rowHeight: change }
          : {}),
      };
      renderer.render({ ...state, views: [{ ...view, config }] });
      expect(container.querySelector('.loom-grid-editor')).toBe(editor);
      expect(editor.value).toBe('未提交的中文草稿');
      expect([editor.selectionStart, editor.selectionEnd]).toEqual([2, 5]);
      expect(document.activeElement).toBe(editor);
      const nextViewport = container.querySelector<HTMLElement>('.loom-grid-viewport')!;
      expect(nextViewport.scrollTop).toBe(
        200 * (change === 'compact' ? 30 : change === 'comfortable' ? 44 : 36),
      );
      expect(nextViewport.scrollLeft).toBe(120);
      expect(container.querySelectorAll('.loom-grid-row').length).toBeLessThan(50);
      editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await vi.advanceTimersByTimeAsync(100);
      expect(onCellEdit).not.toHaveBeenCalled();
      editor.dispatchEvent(new CompositionEvent('compositionend'));
      editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      expect(onCellEdit).toHaveBeenCalledExactlyOnceWith('record_200', ids[0], '未提交的中文草稿');
    },
  );
  it.each([30, 36, 44])('resolves an unclipped coarse hit for density %ipx', (rowHeight) => {
    const geometry = resolveGridGeometry({ rowHeight, coarse: true });
    expect(geometry.rowHeight).toBe(44);
    expect(geometry.systemTrack).toBe(132);
    expect(geometry.systemSlot).toBe(44);
  });

  it('uses a bounded footer scroll box with a complete inner track row', async () => {
    vi.useFakeTimers();
    const { container } = mount();
    const footer = container.querySelector<HTMLElement>('.loom-grid-aggregate')!;
    const row = footer.querySelector<HTMLElement>('.loom-grid-aggregate-row');
    expect(row?.style.gridTemplateColumns).toBe(
      container.querySelector<HTMLElement>('.loom-grid-header')?.style.gridTemplateColumns,
    );
    const viewport = container.querySelector<HTMLElement>('.loom-grid-viewport')!;
    viewport.scrollLeft = 160;
    viewport.dispatchEvent(new Event('scroll'));
    await vi.advanceTimersByTimeAsync(25);
    expect(footer.scrollLeft).toBe(160);
  });

  it.each(['compact', 'standard', 'comfortable'] as const)(
    'keeps Add row at 36px independently of %s data density',
    (density) => {
      const { container } = mount(density);
      expect(container.querySelector<HTMLElement>('.loom-grid-add-row')?.style.height).toBe('36px');
    },
  );

  it('updates every frozen offset during resize preview and cancels without a write', () => {
    const { container, ids, onApplyDisplay } = mount();
    const rail = container.querySelector<HTMLElement>('.loom-grid-col-resize')!;
    rail.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 200 }));
    document.dispatchEvent(new MouseEvent('pointermove', { clientX: 250 }));
    const selector = `[data-field-id="${ids[1]}"]`;
    for (const cell of container.querySelectorAll<HTMLElement>(
      `.loom-grid-header-cell${selector}, .loom-grid-cell${selector}, .loom-grid-aggregate-item${selector}`,
    ))
      expect(cell.style.left).toBe('354px');
    document.dispatchEvent(new Event('pointercancel'));
    expect(onApplyDisplay).not.toHaveBeenCalled();
    expect(
      container.querySelector<HTMLElement>(`.loom-grid-header-cell${selector}`)?.style.left,
    ).toBe('304px');
  });

  it('renders singular and plural row counts from authority', () => {
    const { container, renderer, state } = mount();
    renderer.render({
      ...state,
      totalCount: 1,
      unfilteredTotal: null,
      records: state.records.slice(0, 1),
    });
    expect(container.querySelector('.loom-grid-count')?.textContent).toBe('1 row');
    renderer.render({
      ...state,
      totalCount: 2,
      unfilteredTotal: null,
      records: state.records.slice(0, 2),
    });
    expect(container.querySelector('.loom-grid-count')?.textContent).toBe('2 rows');
  });

  it('refreshes frozen identity even when column order and width do not change', () => {
    const { container, renderer, state } = mount();
    const view = state.views[0]!;
    renderer.render({
      ...state,
      views: [{ ...view, config: { ...view.config, frozenFieldIds: [] } }],
    });
    expect(
      container
        .querySelector('.loom-grid-header-cell[data-field-id]')
        ?.classList.contains('loom-grid-frozen'),
    ).toBe(false);
    renderer.render(state);
    expect(container.querySelector('.loom-grid-header-pin')?.getAttribute('data-pinned')).toBe(
      'true',
    );
  });

  it('preserves the scroll position on a same-view geometry replacement', () => {
    const { container, renderer, state, ids } = mount();
    const viewport = container.querySelector<HTMLElement>('.loom-grid-viewport')!;
    viewport.scrollTop = 72;
    viewport.scrollLeft = 40;
    const view = state.views[0]!;
    renderer.render({
      ...state,
      views: [
        {
          ...view,
          config: { ...view.config, columnWidths: { ...view.config.columnWidths, [ids[0]!]: 260 } },
        },
      ],
    });
    const next = container.querySelector<HTMLElement>('.loom-grid-viewport')!;
    expect(next.scrollTop).toBe(72);
    expect(next.scrollLeft).toBe(40);
  });

  it('retains the live editor and IME draft through geometry changes without accepting a write', async () => {
    vi.useFakeTimers();
    const { container, renderer, state, ids, onCellEdit } = mount();
    const cell = container.querySelector<HTMLElement>('.loom-grid-cell')!;
    cell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const editor = cell.querySelector<HTMLInputElement>('.loom-grid-editor');
    expect(editor).not.toBeNull();
    if (editor === null) throw new Error('editor missing');
    editor.value = 'Unaccepted raw draft';
    editor.dispatchEvent(new CompositionEvent('compositionstart'));
    editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
    const view = state.views[0]!;
    renderer.render({
      ...state,
      views: [
        {
          ...view,
          config: { ...view.config, columnWidths: { ...view.config.columnWidths, [ids[0]!]: 260 } },
        },
      ],
    });
    expect(container.querySelector<HTMLInputElement>('.loom-grid-editor')?.value).toBe(
      'Unaccepted raw draft',
    );
    expect(container.querySelector('.loom-grid-editor')).toBe(editor);
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await vi.advanceTimersByTimeAsync(100);
    expect(onCellEdit).not.toHaveBeenCalled();
    editor.dispatchEvent(new CompositionEvent('compositionend'));
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onCellEdit).toHaveBeenCalledExactlyOnceWith(
      state.records[0]!.id,
      ids[0],
      'Unaccepted raw draft',
    );
  });

  it('cancels unaccepted editor timers on dispose and view switch', async () => {
    vi.useFakeTimers();
    const { container, renderer, state, onCellEdit } = mount();
    container
      .querySelector('.loom-grid-cell')!
      .dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const editor = container.querySelector<HTMLInputElement>('.loom-grid-editor')!;
    editor.value = 'No stale write';
    editor.dispatchEvent(new Event('blur'));
    renderer.render({ ...state, selectedViewId: 'other-view' });
    renderer.dispose();
    await vi.runAllTimersAsync();
    expect(onCellEdit).not.toHaveBeenCalled();
  });

  it('retains the unaccepted Create editor during a same-view geometry replacement', async () => {
    vi.useFakeTimers();
    const { container, renderer, state, ids, onCreateRecord } = mount('standard', 1000);
    const viewport = container.querySelector<HTMLElement>('.loom-grid-viewport')!;
    viewport.scrollTop = 7200;
    viewport.scrollLeft = 120;
    viewport.dispatchEvent(new Event('scroll'));
    await vi.advanceTimersByTimeAsync(30);
    container
      .querySelector(`[data-record-id="record_200"] [data-field-id="${ids[0]}"]`)!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    container.querySelector<HTMLButtonElement>('[data-action="create-record"]')!.click();
    const editor = container.querySelector<HTMLInputElement>(
      '.loom-grid-draft-row .loom-grid-editor',
    )!;
    editor.value = 'Still local create';
    editor.focus();
    editor.setSelectionRange(2, 5);
    editor.dispatchEvent(new CompositionEvent('compositionstart'));
    const view = state.views[0]!;
    renderer.render({
      ...state,
      views: [
        {
          ...view,
          config: { ...view.config, columnWidths: { ...view.config.columnWidths, [ids[0]!]: 260 } },
        },
      ],
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(container.querySelector('.loom-grid-draft-row .loom-grid-editor')).toBe(editor);
    expect(editor.value).toBe('Still local create');
    expect([editor.selectionStart, editor.selectionEnd]).toEqual([2, 5]);
    expect(document.activeElement).toBe(editor);
    expect(container.querySelectorAll('.loom-grid-row').length).toBeLessThan(50);
    expect(onCreateRecord).not.toHaveBeenCalled();
  });

  it('reacts to coarse capability changes and releases the media listener', () => {
    const media = new EventTarget();
    let coarse = false;
    Object.defineProperty(media, 'matches', { get: () => coarse });
    const remove = vi.spyOn(media, 'removeEventListener');
    vi.stubGlobal('matchMedia', () => media);
    const { container, renderer } = mount('compact');
    expect(container.querySelector<HTMLElement>('.loom-grid-row')!.style.height).toBe('30px');
    coarse = true;
    media.dispatchEvent(new Event('change'));
    expect(container.querySelector<HTMLElement>('.loom-grid-row')!.style.height).toBe('44px');
    expect(
      container
        .querySelector<HTMLElement>('.loom-grid-wrapper')!
        .style.getPropertyValue('--loom-grid-system-track'),
    ).toBe('132px');
    renderer.dispose();
    expect(remove).toHaveBeenCalledWith('change', expect.any(Function));
  });

  it('owns the footer semantics on reused renders and restores the aggregate trigger', () => {
    const { container, renderer, state, ids } = mount();
    renderer.render(state);
    expect(container.querySelector('[role="grid"]')!.getAttribute('aria-rowcount')).toBe(
      String(state.records.length + 2),
    );
    const trigger = container.querySelector<HTMLButtonElement>('button.loom-grid-aggregate-cell')!;
    expect(trigger.getAttribute('role')).toBeNull();
    expect(trigger.parentElement!.getAttribute('role')).toBe('gridcell');
    trigger.focus();
    trigger.click();
    document
      .querySelector('.loom-context-menu')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.activeElement).toBe(trigger);
    renderer.render({
      ...state,
      aggregateStatus: 'ready',
      fieldAggregations: { [ids[0]!]: 'count' },
      aggregateResults: { [ids[0]!]: { count: state.records.length } },
    });
    expect(document.activeElement).toBe(container.querySelector('button.loom-grid-aggregate-cell'));
  });

  it('keeps Header Menu and Trigger as one boundary with native toggle and outside focus', async () => {
    const { container } = mount();
    const trigger = container.querySelector<HTMLButtonElement>('.loom-grid-header-menu')!;
    trigger.click();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    trigger.focus();
    await vi.waitFor(() => expect(document.querySelector('.loom-context-menu')).not.toBeNull());
    trigger.click();
    expect(document.querySelector('.loom-context-menu')).toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    trigger.click();
    trigger.focus();
    const outside = document.createElement('button');
    document.body.append(outside);
    outside.focus();
    await vi.waitFor(() => expect(document.querySelector('.loom-context-menu')).toBeNull());
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(outside);
  });
});
