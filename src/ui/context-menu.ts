import { createUiIcon, type UiIconName } from './icons';

export interface ContextMenuItem {
  readonly label: string;
  readonly icon?: UiIconName;
  readonly danger?: boolean;
  readonly disabled?: boolean;
  readonly dataAction?: string;
  /**
   * Selection semantics for true choice menus: 'radio' → menuitemradio,
   * 'checkbox' → menuitemcheckbox, each exposing aria-checked. Plain
   * commands must not set this — they stay menuitem.
   */
  readonly checkable?: 'radio' | 'checkbox';
  /** Checked state for checkable items; renders the 14px/1.75 check glyph. */
  readonly checked?: boolean;
  /** Marks the item as the currently active choice (aria-current + check). */
  readonly current?: boolean;
  readonly action: () => void;
}

export type ContextMenuEntry = ContextMenuItem | 'separator';

export interface ContextMenuOptions {
  readonly items: readonly ContextMenuEntry[];
  readonly x: number;
  readonly y: number;
  /** 'end' treats x as the menu's trailing edge (right-aligned triggers). */
  readonly align?: 'start' | 'end';
  /**
   * Element used to find the owning pane (.view-content) for boundary clamping
   * and to close the menu when its content scrolls.
   */
  readonly host: HTMLElement;
  /** Invoking control; the menu flips above it when needed and Escape restores focus. */
  readonly trigger?: HTMLElement;
  readonly label: string;
}

const MENU_MARGIN = 4;

/**
 * Exactly one context menu may be open at a time — it is the explicit owner
 * of the menu overlay lifecycle. Opening a menu closes the previous one so
 * callers never stack floating menus from different triggers or contexts.
 */
let activeMenu: {
  readonly menu: HTMLElement;
  readonly owner: HTMLElement;
  readonly close: () => void;
} | null = null;

/**
 * Closes the currently open context menu. When `owner` is given, only a
 * menu mounted under that owner element is dismissed — a background pane's
 * cleanup path must not close a menu owned by another pane.
 * Returns whether a menu was actually closed.
 */
export function closeActiveContextMenu(owner?: HTMLElement): boolean {
  if (activeMenu === null) return false;
  if (owner !== undefined && activeMenu.owner !== owner) return false;
  activeMenu.close();
  return true;
}

/**
 * Whether the currently open menu is owned by `host` — lets a panel treat
 * its own body-mounted menus (e.g. the filter grip menu) as inside the
 * owned overlay instead of an outside press. Returns false for another
 * pane's menu, so cross-pane clicks still dismiss normally.
 */
export function activeMenuOwnedBy(host: HTMLElement): boolean {
  return activeMenu !== null && activeMenu.owner === host;
}

/**
 * Opens a small menu positioned at pointer coordinates. Mounted on
 * document.body with position:fixed so pane overflow cannot clip it; the
 * `loom-portal` class re-scopes the Loom tokens that body-mounting cannot
 * inherit from `.loom-root`. The visible boundary is the owning
 * .view-content rect (viewport fallback). Closes on item activation, Escape,
 * outside pointerdown, true focus departure, or host scroll.
 */
export function openContextMenu(options: ContextMenuOptions): () => void {
  const ownerDocument = options.host.ownerDocument;
  const menu = ownerDocument.createElement('div');
  menu.className = 'loom-context-menu loom-portal';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', options.label);

  const buttons: HTMLButtonElement[] = [];
  for (const entry of options.items) {
    if (entry === 'separator') {
      const divider = ownerDocument.createElement('div');
      divider.className = 'loom-context-menu-separator';
      divider.setAttribute('aria-hidden', 'true');
      menu.append(divider);
      continue;
    }
    const item = ownerDocument.createElement('button');
    item.type = 'button';
    item.className = 'loom-context-menu-item clickable-icon';
    if (entry.checkable === 'radio') item.setAttribute('role', 'menuitemradio');
    else if (entry.checkable === 'checkbox') item.setAttribute('role', 'menuitemcheckbox');
    else item.setAttribute('role', 'menuitem');
    if (entry.checkable !== undefined) {
      item.setAttribute('aria-checked', String(entry.checked === true));
    }
    if (entry.danger === true) item.dataset.variant = 'danger';
    if (entry.dataAction !== undefined) item.dataset.action = entry.dataAction;
    item.disabled = entry.disabled === true;
    if (entry.icon !== undefined) item.append(createUiIcon(entry.icon));
    item.append(createTextSpan(ownerDocument, entry.label));
    if (entry.current === true || entry.checked === true) {
      if (entry.current === true) item.setAttribute('aria-current', 'true');
      const check = createUiIcon('menu-check');
      check.classList.add('loom-context-menu-check');
      item.append(check);
    }
    item.setAttribute('aria-label', entry.label);
    item.addEventListener('click', () => {
      if (closed || item.disabled) return;
      close();
      restoreFocus();
      entry.action();
    });
    buttons.push(item);
    menu.append(item);
  }

  const trigger = options.trigger;
  // A menu-trigger control (aria-haspopup) counts as inside the owned overlay
  // so a second press toggles via the caller instead of dismiss-then-reopen;
  // it also exposes aria-expanded while the menu is open.
  const triggerControl = trigger?.hasAttribute('aria-haspopup') === true ? trigger : null;
  const triggerExpanded = triggerControl?.getAttribute('aria-expanded') ?? null;

  const restoreFocus = (): void => {
    if (trigger !== undefined && trigger.isConnected) trigger.focus();
  };
  const observer = new MutationObserver(() => {
    if (
      !options.host.isConnected ||
      !menu.isConnected ||
      (trigger !== undefined && !trigger.isConnected)
    )
      close();
  });
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    if (activeMenu?.menu === menu) activeMenu = null;
    observer.disconnect();
    menu.remove();
    options.host.removeEventListener('scroll', onScroll, true);
    ownerDocument.removeEventListener('pointerdown', onPointerDown, true);
    ownerDocument.removeEventListener('keydown', onKeyDown, true);
    ownerDocument.removeEventListener('focusout', onFocusOut, true);
    if (triggerControl !== null) {
      if (triggerExpanded === null) triggerControl.removeAttribute('aria-expanded');
      else triggerControl.setAttribute('aria-expanded', triggerExpanded);
    }
  };
  const record = { menu, owner: options.host, close };
  const onScroll = (): void => close();
  const onPointerDown = (event: PointerEvent): void => {
    const path = event.composedPath();
    const inside =
      path.includes(menu) || (triggerControl !== null && path.includes(triggerControl));
    if (!inside) close();
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (!ownsFocus(ownerDocument.activeElement)) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      restoreFocus();
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const enabled = buttons.filter((button) => !button.disabled);
    const current = enabled.indexOf(ownerDocument.activeElement as HTMLButtonElement);
    const step = event.key === 'ArrowDown' ? 1 : -1;
    const next =
      enabled[
        current < 0
          ? step === 1
            ? 0
            : enabled.length - 1
          : (current + step + enabled.length) % enabled.length
      ];
    next?.focus();
  };
  // A true focus departure (Tab, or a click landing outside) dismisses the
  // menu without moving focus back — the user's new target is respected.
  // The trigger belongs to the same owned boundary as the menu itself:
  // pointerdown on the trigger moves focus there, and that focusout must
  // not tear the menu down before the trigger's click toggles it.
  const ownsFocus = (target: EventTarget | null): boolean =>
    target instanceof Node &&
    (menu.contains(target) || (trigger !== undefined && trigger.contains(target)));
  const onFocusOut = (event: FocusEvent): void => {
    if (ownsFocus(event.target) && !ownsFocus(event.relatedTarget)) close();
  };

  const pane = options.host.closest('.view-content');
  const bounds = pane?.getBoundingClientRect() ?? {
    top: 0,
    left: 0,
    right: ownerDocument.documentElement.clientWidth,
    bottom: ownerDocument.documentElement.clientHeight,
  };
  menu.classList.add('loom-context-menu--measuring');
  ownerDocument.body.append(menu);
  const menuRect = menu.getBoundingClientRect();

  const maxHeight = Math.max(bounds.bottom - bounds.top - MENU_MARGIN * 2, 0);
  menu.style.maxHeight = `${maxHeight}px`;

  const maxX = bounds.right - MENU_MARGIN - menuRect.width;
  const rawX = options.align === 'end' ? options.x - menuRect.width : options.x;
  const x = Math.min(
    Math.max(rawX, bounds.left + MENU_MARGIN),
    Math.max(maxX, bounds.left + MENU_MARGIN),
  );

  let y = options.y;
  if (y + menuRect.height > bounds.bottom - MENU_MARGIN) {
    const anchorTop = options.trigger?.getBoundingClientRect().top ?? options.y;
    const flipped = anchorTop - MENU_MARGIN - menuRect.height;
    y =
      flipped >= bounds.top + MENU_MARGIN
        ? flipped
        : Math.max(bounds.top + MENU_MARGIN, bounds.bottom - MENU_MARGIN - menuRect.height);
  }

  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  menu.classList.remove('loom-context-menu--measuring');

  activeMenu?.close();
  activeMenu = record;
  triggerControl?.setAttribute('aria-expanded', 'true');
  options.host.addEventListener('scroll', onScroll, true);
  observer.observe(ownerDocument.documentElement, { childList: true, subtree: true });
  ownerDocument.addEventListener('pointerdown', onPointerDown, true);
  ownerDocument.addEventListener('keydown', onKeyDown, true);
  ownerDocument.addEventListener('focusout', onFocusOut, true);
  menu.tabIndex = -1;
  (buttons.find((button) => !button.disabled) ?? menu).focus();
  return close;
}

function createTextSpan(ownerDocument: Document, text: string): HTMLSpanElement {
  const span = ownerDocument.createElement('span');
  span.className = 'loom-context-menu-label';
  span.textContent = text;
  return span;
}
