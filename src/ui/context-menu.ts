import { createUiIcon, type UiIconName } from './icons';

export interface ContextMenuItem {
  readonly label: string;
  readonly icon?: UiIconName;
  readonly danger?: boolean;
  readonly disabled?: boolean;
  readonly dataAction?: string;
  readonly action: () => void;
}

export type ContextMenuEntry = ContextMenuItem | 'separator';

export interface ContextMenuOptions {
  readonly items: readonly ContextMenuEntry[];
  readonly x: number;
  readonly y: number;
  readonly host: HTMLElement;
  readonly label: string;
}

/**
 * Opens a small right-click menu positioned at pointer coordinates inside a
 * positioned host. Closes on item activation, Escape, outside pointerdown, or
 * host scroll. Rendered with DOM so it inherits the plugin token theme.
 */
export function openContextMenu(options: ContextMenuOptions): () => void {
  const menu = document.createElement('div');
  menu.className = 'loom-context-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', options.label);

  const buttons: HTMLButtonElement[] = [];
  for (const entry of options.items) {
    if (entry === 'separator') {
      const divider = document.createElement('div');
      divider.className = 'loom-context-menu-separator';
      divider.setAttribute('aria-hidden', 'true');
      menu.append(divider);
      continue;
    }
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'loom-context-menu-item clickable-icon';
    item.setAttribute('role', 'menuitem');
    if (entry.danger === true) item.dataset.variant = 'danger';
    if (entry.dataAction !== undefined) item.dataset.action = entry.dataAction;
    item.disabled = entry.disabled === true;
    if (entry.icon !== undefined) item.append(createUiIcon(entry.icon));
    item.append(createTextSpan(entry.label));
    item.setAttribute('aria-label', entry.label);
    item.addEventListener('click', () => {
      close();
      entry.action();
    });
    buttons.push(item);
    menu.append(item);
  }

  const close = (): void => {
    menu.remove();
    options.host.removeEventListener('scroll', onScroll);
    document.removeEventListener('pointerdown', onPointerDown, true);
    document.removeEventListener('keydown', onKeyDown, true);
  };
  const onScroll = (): void => close();
  const onPointerDown = (event: PointerEvent): void => {
    if (!menu.contains(event.target as Node)) close();
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const enabled = buttons.filter((button) => !button.disabled);
    const current = enabled.indexOf(document.activeElement as HTMLButtonElement);
    const step = event.key === 'ArrowDown' ? 1 : -1;
    const next = enabled[(current + step + enabled.length) % enabled.length];
    next?.focus();
  };

  const hostRect = options.host.getBoundingClientRect();
  menu.classList.add('loom-context-menu--measuring');
  options.host.append(menu);
  const menuRect = menu.getBoundingClientRect();
  const offsetX = options.x - hostRect.left + options.host.scrollLeft;
  const offsetY = options.y - hostRect.top + options.host.scrollTop;
  const clampedX = Math.max(0, Math.min(offsetX, options.host.scrollWidth - menuRect.width - 4));
  const clampedY = Math.max(0, Math.min(offsetY, options.host.scrollHeight - menuRect.height - 4));
  menu.style.left = `${clampedX}px`;
  menu.style.top = `${clampedY}px`;
  menu.classList.remove('loom-context-menu--measuring');

  options.host.addEventListener('scroll', onScroll);
  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('keydown', onKeyDown, true);
  buttons.find((button) => !button.disabled)?.focus();
  return close;
}

function createTextSpan(text: string): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = 'loom-context-menu-label';
  span.textContent = text;
  return span;
}
