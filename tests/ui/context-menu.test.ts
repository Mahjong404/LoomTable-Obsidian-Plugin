import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  closeActiveContextMenu,
  openContextMenu,
  type ContextMenuEntry,
} from '../../src/ui/context-menu';

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

  it('carries the portal token scope so body-mounted menus keep Loom tokens', () => {
    const { host } = fixture();
    openContextMenu({ items: ITEMS, x: 10, y: 20, host, label: 'menu' });
    const menu = document.querySelector<HTMLElement>('.loom-context-menu');
    expect(menu?.classList.contains('loom-portal')).toBe(true);
  });

  it('closes the previously open menu when a new one opens', () => {
    const { host } = fixture();
    openContextMenu({ items: ITEMS, x: 10, y: 20, host, label: 'first' });
    const first = document.querySelector<HTMLElement>('.loom-context-menu');
    expect(first?.getAttribute('aria-label')).toBe('first');

    openContextMenu({ items: ITEMS, x: 30, y: 40, host, label: 'second' });
    const menus = [...document.querySelectorAll<HTMLElement>('.loom-context-menu')];
    expect(menus).toHaveLength(1);
    expect(menus[0]?.getAttribute('aria-label')).toBe('second');
    expect(first?.isConnected).toBe(false);
  });

  it('closes the open menu through closeActiveContextMenu', () => {
    const { host } = fixture();
    openContextMenu({ items: ITEMS, x: 10, y: 20, host, label: 'menu' });
    expect(document.querySelector('.loom-context-menu')).not.toBeNull();
    closeActiveContextMenu();
    expect(document.querySelector('.loom-context-menu')).toBeNull();
  });

  it('marks a menu trigger expanded while open and restores it on close', () => {
    const { host, trigger } = fixture();
    trigger.setAttribute('aria-haspopup', 'menu');
    const close = openContextMenu({ items: ITEMS, x: 10, y: 20, host, trigger, label: 'menu' });
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    close();
    expect(trigger.getAttribute('aria-expanded')).toBeNull();
  });

  it('does not close on pointerdown inside the menu-trigger control', () => {
    const { host, trigger } = fixture();
    trigger.setAttribute('aria-haspopup', 'menu');
    openContextMenu({ items: ITEMS, x: 10, y: 20, host, trigger, label: 'menu' });
    trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(document.querySelector('.loom-context-menu')).not.toBeNull();
  });

  it('closes on true focus departure without stealing the new focus target', () => {
    const { host, trigger } = fixture();
    trigger.setAttribute('aria-haspopup', 'menu');
    const elsewhere = document.createElement('button');
    host.append(elsewhere);
    openContextMenu({ items: ITEMS, x: 10, y: 20, host, trigger, label: 'menu' });
    const menu = document.querySelector<HTMLElement>('.loom-context-menu');
    const first = menu?.querySelector<HTMLElement>('.loom-context-menu-item');
    expect(document.activeElement).toBe(first);

    elsewhere.focus();
    first?.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: elsewhere }));
    expect(document.querySelector('.loom-context-menu')).toBeNull();
    expect(document.activeElement).toBe(elsewhere);
  });

  it('returns focus to the trigger after an item runs', () => {
    const { host, trigger } = fixture();
    const action = vi.fn();
    openContextMenu({ items: [{ label: 'One', action }], x: 10, y: 20, host, trigger, label: 'm' });
    document.querySelector<HTMLButtonElement>('.loom-context-menu-item')?.click();
    expect(action).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(trigger);
  });

  it('keeps close() idempotent after explicit dismissal', () => {
    const { host, trigger } = fixture();
    const close = openContextMenu({ items: ITEMS, x: 10, y: 20, host, trigger, label: 'menu' });
    close();
    expect(() => close()).not.toThrow();
    expect(document.querySelector('.loom-context-menu')).toBeNull();
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

describe('W15-01 review remediation', () => {
  it('keeps the menu open when focus moves to its trigger mid-toggle', () => {
    // M1 — real press order on the second trigger click is
    // pointerdown → focusout(to trigger) → click(toggle close). The trigger
    // belongs to the owned boundary, so the focusout must not dismiss first.
    const { host, trigger } = fixture();
    trigger.setAttribute('aria-haspopup', 'menu');
    openContextMenu({ items: ITEMS, x: 10, y: 20, host, trigger, label: 'menu' });
    const menu = document.querySelector<HTMLElement>('.loom-context-menu');
    expect(menu).not.toBeNull();

    menu!.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: trigger }));
    expect(document.querySelector('.loom-context-menu')).not.toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    // The caller-side toggle then closes it — and it must not reopen.
    closeActiveContextMenu();
    expect(document.querySelector('.loom-context-menu')).toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBeNull();
  });

  it('still closes on focusout to an element outside the owned boundary', () => {
    const { host, trigger } = fixture();
    trigger.setAttribute('aria-haspopup', 'menu');
    const elsewhere = document.createElement('button');
    host.append(elsewhere);
    openContextMenu({ items: ITEMS, x: 10, y: 20, host, trigger, label: 'menu' });
    const menu = document.querySelector<HTMLElement>('.loom-context-menu');

    menu!.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: elsewhere }));
    expect(document.querySelector('.loom-context-menu')).toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBeNull();
  });

  it('scopes closeActiveContextMenu to its owner pane', () => {
    // M2 — a background pane's cleanup must not close another pane's menu.
    const paneB = document.createElement('div');
    document.body.append(paneB);
    const { host: hostA } = fixture();
    const hostB = document.createElement('div');
    paneB.append(hostB);

    openContextMenu({ items: ITEMS, x: 10, y: 20, host: hostA, label: 'pane-a' });
    expect(document.querySelector('.loom-context-menu')).not.toBeNull();

    expect(closeActiveContextMenu(hostB)).toBe(false);
    expect(document.querySelector('.loom-context-menu')).not.toBeNull();

    expect(closeActiveContextMenu(hostA)).toBe(true);
    expect(document.querySelector('.loom-context-menu')).toBeNull();
    paneB.remove();
  });

  it('keeps the single-active-menu rule even across pane owners', () => {
    const paneB = document.createElement('div');
    document.body.append(paneB);
    const { host: hostA } = fixture();
    const hostB = document.createElement('div');
    paneB.append(hostB);

    openContextMenu({ items: ITEMS, x: 10, y: 20, host: hostA, label: 'pane-a' });
    openContextMenu({ items: ITEMS, x: 10, y: 20, host: hostB, label: 'pane-b' });
    const menus = [...document.querySelectorAll<HTMLElement>('.loom-context-menu')];
    expect(menus).toHaveLength(1);
    expect(menus[0]?.getAttribute('aria-label')).toBe('pane-b');
    paneB.remove();
  });

  it('uses menuitemradio/aria-checked only for true single-choice entries', () => {
    const { host } = fixture();
    openContextMenu({
      items: [
        { label: 'Retry', action: () => undefined },
        'separator',
        { label: 'Sum', checkable: 'radio', checked: true, action: () => undefined },
        { label: 'Count', checkable: 'radio', checked: false, action: () => undefined },
      ],
      x: 10,
      y: 20,
      host,
      label: 'aggregate',
    });
    const items = [...document.querySelectorAll<HTMLElement>('.loom-context-menu-item')];
    // Plain commands stay ordinary menuitems — no selectable role.
    expect(items[0]?.getAttribute('role')).toBe('menuitem');
    expect(items[0]?.hasAttribute('aria-checked')).toBe(false);
    expect(items[1]?.getAttribute('role')).toBe('menuitemradio');
    expect(items[1]?.getAttribute('aria-checked')).toBe('true');
    expect(items[2]?.getAttribute('role')).toBe('menuitemradio');
    expect(items[2]?.getAttribute('aria-checked')).toBe('false');
    // The check glyph rides only the checked choice.
    expect(items[1]?.querySelector('.loom-context-menu-check')).not.toBeNull();
    expect(items[2]?.querySelector('.loom-context-menu-check')).toBeNull();
    closeActiveContextMenu();
  });
});
