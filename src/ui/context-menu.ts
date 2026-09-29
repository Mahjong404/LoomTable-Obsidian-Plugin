import { createUiIcon, type UiIconName } from './icons';

export interface ContextMenuItem {
  readonly label: string;
  readonly icon?: UiIconName;
  readonly danger?: boolean;
  readonly disabled?: boolean;
  readonly dataAction?: string;
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
 * Opens a small menu positioned at pointer coordinates. Mounted on
 * document.body with position:fixed so pane overflow cannot clip it; the
 * visible boundary is the owning .view-content rect (viewport fallback).
 * Closes on item activation, Escape, outside pointerdown, or host scroll.
 */
export function openContextMenu(options: ContextMenuOptions): () => void {
  const ownerDocument = options.host.ownerDocument;
  const menu = ownerDocument.createElement('div');
  menu.className = 'loom-context-menu';
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
    item.setAttribute('role', 'menuitem');
    if (entry.danger === true) item.dataset.variant = 'danger';
    if (entry.dataAction !== undefined) item.dataset.action = entry.dataAction;
    item.disabled = entry.disabled === true;
    if (entry.icon !== undefined) item.append(createUiIcon(entry.icon));
    item.append(createTextSpan(ownerDocument, entry.label));
    if (entry.current === true) {
      item.setAttribute('aria-current', 'true');
      const check = createUiIcon('menu-check');
      check.classList.add('loom-context-menu-check');
      item.append(check);
    }
    item.setAttribute('aria-label', entry.label);
    item.addEventListener('click', () => {
      close();
      entry.action();
    });
    buttons.push(item);
    menu.append(item);
  }

  const restoreFocus = (): void => {
    const trigger = options.trigger;
    if (trigger !== undefined && trigger.isConnected) trigger.focus();
  };
  const observer = new MutationObserver(() => {
    if (!options.host.isConnected) close();
  });
  const close = (): void => {
    observer.disconnect();
    menu.remove();
    options.host.removeEventListener('scroll', onScroll, true);
    ownerDocument.removeEventListener('pointerdown', onPointerDown, true);
    ownerDocument.removeEventListener('keydown', onKeyDown, true);
  };
  const onScroll = (): void => close();
  const onPointerDown = (event: PointerEvent): void => {
    if (!menu.contains(event.target as Node)) close();
  };
  const onKeyDown = (event: KeyboardEvent): void => {
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
    const next = enabled[(current + step + enabled.length) % enabled.length];
    next?.focus();
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

  options.host.addEventListener('scroll', onScroll, true);
  observer.observe(ownerDocument.documentElement, { childList: true, subtree: true });
  ownerDocument.addEventListener('pointerdown', onPointerDown, true);
  ownerDocument.addEventListener('keydown', onKeyDown, true);
  buttons.find((button) => !button.disabled)?.focus();
  return close;
}

function createTextSpan(ownerDocument: Document, text: string): HTMLSpanElement {
  const span = ownerDocument.createElement('span');
  span.className = 'loom-context-menu-label';
  span.textContent = text;
  return span;
}
