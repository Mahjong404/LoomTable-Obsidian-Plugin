import { afterEach, describe, expect, it, vi } from 'vitest';

import { openContextMenu, type ContextMenuEntry } from '../../src/ui/context-menu';

interface RectLike {
  top?: number;
  left?: number;
  right?: number;
  bottom?: number;
  width?: number;
  height?: number;
}

function mockRects(resolve: (el: Element) => RectLike): void {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const partial = resolve(this);
    const top = partial.top ?? 0;
    const left = partial.left ?? 0;
    const width = partial.width ?? 0;
    const height = partial.height ?? 0;
    return {
      top,
      left,
      width,
      height,
      right: partial.right ?? left + width,
      bottom: partial.bottom ?? top + height,
      x: left,
      y: top,
      toJSON: () => ({}),
    };
  });
}

function fixture(): { pane: HTMLElement; host: HTMLElement; trigger: HTMLButtonElement } {
  const pane = document.createElement('div');
  pane.className = 'view-content';
  const host = document.createElement('div');
  const trigger = document.createElement('button');
  trigger.type = 'button';
  host.append(trigger);
  pane.append(host);
  document.body.append(pane);
  // Pane rect 400x300 at origin; the menu measures 100x60.
  mockRects((el) => {
    if (el.classList.contains('view-content')) return { right: 400, bottom: 300 };
    if (el.classList.contains('loom-context-menu')) return { width: 100, height: 60 };
    if (el === trigger) return { top: 200, bottom: 220, left: 50, right: 100 };
    return {};
  });
  return { pane, host, trigger };
}

const ITEMS: ContextMenuEntry[] = [
  { label: 'One', action: () => undefined },
  { label: 'Two', action: () => undefined },
];

afterEach(() => {
  document.querySelectorAll('.loom-context-menu').forEach((menu) => menu.remove());
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('openContextMenu', () => {
  it('mounts on document.body positioned below the pointer inside the pane', () => {
    const { host } = fixture();
    openContextMenu({ items: ITEMS, x: 10, y: 20, host, label: 'menu' });
    const menu = document.querySelector<HTMLElement>('.loom-context-menu');
    expect(menu).not.toBeNull();
    expect(menu?.parentElement).toBe(document.body);
    expect(menu?.style.left).toBe('10px');
    expect(menu?.style.top).toBe('20px');
  });

  it('clamps to the pane bounds instead of the host size', () => {
    const { host } = fixture();
    openContextMenu({ items: ITEMS, x: 350, y: 280, host, label: 'menu' });
    const menu = document.querySelector<HTMLElement>('.loom-context-menu');
    // 350+100 exceeds the 400-pane → right edge clamped at 296; the menu
    // flips to open upward from the pointer: 280-4-60 = 216.
    expect(menu?.style.left).toBe('296px');
    expect(menu?.style.top).toBe('216px');
  });

  it('flips above the trigger without covering it when space below is short', () => {
    const { host, trigger } = fixture();
    vi.restoreAllMocks();
    mockRects((el) => {
      if (el.classList.contains('view-content')) return { right: 400, bottom: 240 };
      if (el.classList.contains('loom-context-menu')) return { width: 100, height: 60 };
      if (el === trigger) return { top: 200, bottom: 220, left: 50, right: 100 };
      return {};
    });
    openContextMenu({ items: ITEMS, x: 100, y: 224, host, trigger, label: 'menu' });
    const menu = document.querySelector<HTMLElement>('.loom-context-menu');
    // Below would end at 284 > 236; flip above the trigger: 200-4-60 = 136.
    expect(menu?.style.top).toBe('136px');
  });

  it('right-aligns to the trigger edge with align=end', () => {
    const { host, trigger } = fixture();
    openContextMenu({ items: ITEMS, x: 100, y: 224, host, trigger, align: 'end', label: 'menu' });
    const menu = document.querySelector<HTMLElement>('.loom-context-menu');
    expect(menu?.style.left).toBe('4px'); // 100-100=0, clamped to the 4px inset
    expect(menu?.style.top).toBe('224px');
  });

  it('restores focus to the trigger on Escape', () => {
    const { host, trigger } = fixture();
    openContextMenu({ items: ITEMS, x: 10, y: 20, host, trigger, label: 'menu' });
    const menu = document.querySelector<HTMLElement>('.loom-context-menu');
    const first = menu?.querySelector<HTMLButtonElement>('.loom-context-menu-item');
    expect(document.activeElement).toBe(first);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('.loom-context-menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('does not move focus when dismissed by an outside pointerdown', () => {
    const { host, trigger } = fixture();
    const outside = document.createElement('button');
    host.append(outside);
    openContextMenu({ items: ITEMS, x: 10, y: 20, host, trigger, label: 'menu' });
    outside.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(document.querySelector('.loom-context-menu')).toBeNull();
    expect(document.activeElement).not.toBe(trigger);
  });

  it('moves focus between enabled items with ArrowDown/ArrowUp', () => {
    const { host } = fixture();
    openContextMenu({ items: ITEMS, x: 10, y: 20, host, label: 'menu' });
    const items = [...document.querySelectorAll<HTMLButtonElement>('.loom-context-menu-item')];
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(items[1]);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(document.activeElement).toBe(items[0]);
  });

  it('closes when a nested scroller inside the host scrolls', () => {
    const { host } = fixture();
    const scroller = document.createElement('div');
    host.append(scroller);
    openContextMenu({ items: ITEMS, x: 10, y: 20, host, label: 'menu' });
    scroller.dispatchEvent(new Event('scroll', { bubbles: false }));
    expect(document.querySelector('.loom-context-menu')).toBeNull();
  });

  it('runs the item action and closes on click', () => {
    const { host } = fixture();
    const action = vi.fn();
    openContextMenu({
      items: [{ label: 'One', action }],
      x: 10,
      y: 20,
      host,
      label: 'menu',
    });
    document.querySelector<HTMLButtonElement>('.loom-context-menu-item')?.click();
    expect(action).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.loom-context-menu')).toBeNull();
  });
});
