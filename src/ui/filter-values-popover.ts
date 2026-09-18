import type { DistinctValuesPage, Field } from '../client/loomtable-client';
import type { Translator } from '../i18n';

export interface FilterValuesPopoverOptions {
  readonly field: Field;
  readonly selected: unknown;
  readonly x: number;
  readonly y: number;
  readonly host: HTMLElement;
  readonly translate: Translator;
  readonly load: (request: { search?: string; cursor?: string }) => Promise<DistinctValuesPage>;
  readonly onPick: (value: string | number | boolean) => void;
  readonly onFallback: () => void;
}

/**
 * Opens the Server-backed distinct-value picker used by the Filter Builder:
 * a search box, the distinct values with occurrence counts, and Load more
 * paging. Falls back to the local option list when the request fails.
 */
export function openFilterValuesPopover(options: FilterValuesPopoverOptions): () => void {
  const t = options.translate;
  const panel = document.createElement('div');
  panel.className = 'loom-filter-values';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', t('filter.values.title'));

  const search = document.createElement('input');
  search.type = 'text';
  search.className = 'loom-filter-values-search';
  search.placeholder = t('filter.values.search');
  search.setAttribute('aria-label', t('filter.values.search'));
  panel.append(search);

  const list = document.createElement('div');
  list.className = 'loom-filter-values-list';
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', t('filter.values.title'));
  panel.append(list);

  const footer = document.createElement('div');
  footer.className = 'loom-filter-values-footer';
  panel.append(footer);

  let closed = false;
  let requestToken = 0;
  let searchTerm = '';
  let nextCursor: string | undefined;
  let hasMore = false;
  let searchTimer: number | null = null;

  const itemButton = (value: string | number | boolean, display: string, count: number) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'loom-filter-values-item clickable-icon';
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', String(value === options.selected));
    const name = document.createElement('span');
    name.className = 'loom-filter-values-name';
    name.textContent = display;
    const badge = document.createElement('span');
    badge.className = 'loom-filter-values-count';
    badge.textContent = String(count);
    item.append(name, badge);
    item.addEventListener('click', () => {
      close();
      options.onPick(value);
    });
    return item;
  };

  const renderFooter = (emptyCount: number): void => {
    footer.replaceChildren();
    if (emptyCount > 0) {
      const empty = document.createElement('span');
      empty.className = 'loom-filter-values-empty';
      empty.textContent = t('filter.values.empty').replace('{count}', String(emptyCount));
      footer.append(empty);
    }
    if (hasMore) {
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'loom-button loom-filter-values-more';
      more.dataset.action = 'load-more';
      more.textContent = t('filter.values.more');
      more.addEventListener('click', () => void load(nextCursor, true));
      footer.append(more);
    }
  };

  const renderStatus = (key: 'filter.values.loading' | 'filter.values.error'): void => {
    list.replaceChildren();
    const status = document.createElement('p');
    status.className = 'loom-filter-values-status';
    status.dataset.status = key;
    status.textContent = t(key);
    list.append(status);
    if (key === 'filter.values.error') {
      const row = document.createElement('div');
      row.className = 'loom-filter-values-error-actions';
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'loom-button';
      retry.textContent = t('filter.values.retry');
      retry.addEventListener('click', () => void load(undefined, false));
      const local = document.createElement('button');
      local.type = 'button';
      local.className = 'loom-button';
      local.dataset.action = 'use-local';
      local.textContent = t('filter.values.local');
      local.addEventListener('click', () => {
        close();
        options.onFallback();
      });
      row.append(retry, local);
      list.append(row);
    }
  };

  const load = async (cursor: string | undefined, append: boolean): Promise<void> => {
    const token = ++requestToken;
    if (!append) renderStatus('filter.values.loading');
    try {
      const page = await options.load({
        ...(searchTerm === '' ? {} : { search: searchTerm }),
        ...(cursor === undefined ? {} : { cursor }),
      });
      if (closed || token !== requestToken) return;
      if (!append) list.replaceChildren();
      list.querySelector('.loom-filter-values-status')?.remove();
      for (const item of page.items) {
        list.append(itemButton(item.value, item.display ?? String(item.value), item.count));
      }
      nextCursor = page.nextCursor;
      hasMore = page.hasMore;
      renderFooter(page.emptyCount);
    } catch {
      if (closed || token !== requestToken) return;
      renderStatus('filter.values.error');
    }
  };

  search.addEventListener('input', () => {
    if (searchTimer !== null) window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      searchTimer = null;
      searchTerm = search.value.trim();
      void load(undefined, false);
    }, 300);
  });

  const close = (): void => {
    if (closed) return;
    closed = true;
    if (searchTimer !== null) window.clearTimeout(searchTimer);
    document.removeEventListener('keydown', onKeyDown, true);
    document.removeEventListener('pointerdown', onPointerDown, true);
    options.host.removeEventListener('scroll', onScroll, true);
    panel.remove();
  };
  const onScroll = (): void => close();
  const onPointerDown = (event: PointerEvent): void => {
    if (!panel.contains(event.target as Node)) close();
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  };

  void load(undefined, false);

  const hostRect = options.host.getBoundingClientRect();
  panel.classList.add('loom-field-editor--measuring');
  options.host.append(panel);
  const panelRect = panel.getBoundingClientRect();
  const offsetX = options.x - hostRect.left + options.host.scrollLeft;
  const offsetY = options.y - hostRect.top + options.host.scrollTop;
  panel.style.left = `${Math.max(0, Math.min(offsetX, options.host.scrollWidth - panelRect.width - 4))}px`;
  panel.style.top = `${Math.max(0, Math.min(offsetY, options.host.scrollHeight - panelRect.height - 4))}px`;
  panel.classList.remove('loom-field-editor--measuring');

  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('pointerdown', onPointerDown, true);
  options.host.addEventListener('scroll', onScroll, true);
  search.focus();
  return close;
}
