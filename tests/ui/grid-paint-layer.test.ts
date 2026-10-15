import { readFileSync } from 'node:fs';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTranslator } from '../../src/i18n';
import { ReadonlyGridRenderer } from '../../src/ui/readonly-grid-renderer';
import { createGalleryState, GALLERY_GRID_VIEW } from '../gallery/data';

const styles = readFileSync('styles.css', 'utf8');
const renderers: ReadonlyGridRenderer[] = [];
let stylesheet: HTMLStyleElement;

beforeEach(() => {
  // Model the stylesheet supplied by the host, only in the parsed test fixture.
  stylesheet = new DOMParser()
    .parseFromString('<style></style>', 'text/html')
    .querySelector<HTMLStyleElement>('style')!;
  stylesheet.textContent = styles;
  document.head.append(stylesheet);
});

afterEach(() => {
  for (const renderer of renderers.splice(0)) renderer.dispose();
  stylesheet.remove();
  document.body.replaceChildren();
  document.body.className = '';
  vi.useRealTimers();
});

function mount() {
  const base = createGalleryState();
  const fields = base.fields.slice(0, 2);
  const view = {
    ...GALLERY_GRID_VIEW,
    config: {
      ...GALLERY_GRID_VIEW.config,
      projection: fields.map((field) => field.id),
      columnOrder: fields.map((field) => field.id),
      frozenFieldIds: [fields[0]!.id],
    },
  };
  const records = Array.from({ length: 1000 }, (_, index) => ({
    ...base.records[0]!,
    id: `record_${index}`,
  }));
  const container = document.createElement('div');
  document.body.append(container);
  const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), {
    onRefresh: vi.fn(),
    onLoadMore: vi.fn(),
    onRecordOpen: vi.fn(),
  });
  renderers.push(renderer);
  renderer.render({ ...base, records, fields, views: [view], selectedViewId: view.id });
  return container;
}

describe('Grid paint and row-header state contracts', () => {
  it('keeps the complete header plane above scrolling row-header and Current planes', () => {
    const container = mount();
    const header = container.querySelector<HTMLElement>('.loom-grid-header')!;
    const bodyPlanes = container.querySelectorAll<HTMLElement>(
      '.loom-grid-row .loom-grid-index-cell, .loom-grid-row .loom-grid-frozen, .loom-grid-cell.is-active',
    );
    const headerPlane = Number(getComputedStyle(header).zIndex);
    for (const plane of bodyPlanes) {
      expect(headerPlane).toBeGreaterThan(Number(getComputedStyle(plane).zIndex));
    }
    // Geometry remains present while whole-query selection is capability-gated.
    const selectAll = header.querySelector<HTMLInputElement>('.loom-grid-select-all')!;
    expect(selectAll.disabled).toBe(true);
    expect(selectAll.closest('.loom-grid-index-header')).not.toBeNull();
    // At narrow widths frozen headers become static, but retain a stacking
    // level. They must still pass below the sticky system header when scrolled.
    expect(Number(getComputedStyle(selectAll.parentElement!).zIndex)).toBeGreaterThan(
      Number(getComputedStyle(header.querySelector('.loom-grid-frozen')!).zIndex),
    );
  });

  it.each(['theme-light', 'theme-dark'])(
    '%s inherits base selected visibility without a media override',
    (theme) => {
      document.body.className = theme;
      const container = mount();
      const index = container.querySelector<HTMLElement>('.loom-grid-index-cell')!;
      const number = index.querySelector<HTMLElement>('.loom-grid-row-number')!;
      const checkbox = index.querySelector<HTMLInputElement>('.loom-grid-row-check')!;

      expect(getComputedStyle(number).visibility).toBe('visible');
      expect(getComputedStyle(checkbox).opacity).toBe('0');
      checkbox.click();
      expect(index.classList.contains('is-selected')).toBe(true);
      expect(getComputedStyle(number).visibility).toBe('hidden');
      expect(getComputedStyle(checkbox).opacity).toBe('1');
      // Real pointer/focus/media transitions are checked in the visible host;
      // jsdom cannot replace that Cascade and hit-testing evidence.
    },
  );

  it('does not carry a selected row-header state into a new virtual window', async () => {
    vi.useFakeTimers();
    const container = mount();
    container.querySelector<HTMLInputElement>('.loom-grid-row-check')!.click();
    const viewport = container.querySelector<HTMLElement>('.loom-grid-viewport')!;
    viewport.scrollTop = 7200;
    viewport.dispatchEvent(new Event('scroll'));
    await vi.advanceTimersByTimeAsync(30);
    const nextIndex = container.querySelector<HTMLElement>('.loom-grid-index-cell')!;
    expect(nextIndex.classList.contains('is-selected')).toBe(false);
    expect(getComputedStyle(nextIndex.querySelector('.loom-grid-row-number')!).visibility).toBe(
      'visible',
    );
    expect(getComputedStyle(nextIndex.querySelector('.loom-grid-row-check')!).opacity).toBe('0');
    expect(container.querySelectorAll('.loom-grid-row').length).toBeLessThan(50);
    viewport.scrollTop = 0;
    viewport.dispatchEvent(new Event('scroll'));
    await vi.advanceTimersByTimeAsync(30);
    const original = container.querySelector('.loom-grid-row[data-record-id="record_0"]')!;
    expect(getComputedStyle(original.querySelector('.loom-grid-row-number')!).visibility).toBe(
      'hidden',
    );
  });
});
