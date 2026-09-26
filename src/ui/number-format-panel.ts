import type { Field, NumberFormatConfig } from '../client/loomtable-client';
import type { Translator } from '../i18n';

export interface NumberFormatPanelOptions {
  readonly field: Extract<Field, { readonly type: 'number' }>;
  readonly x: number;
  readonly y: number;
  readonly host: HTMLElement;
  readonly translate: Translator;
  readonly onSubmit: (format: NumberFormatConfig | null) => void | Promise<void>;
}

const CURRENCY_CODES = ['CNY', 'USD', 'EUR', 'JPY', 'GBP', 'HKD', 'TWD', 'KRW'] as const;

/**
 * Opens the Number Field display-format popover anchored at pointer
 * coordinates. Closes on submit, Escape, outside pointerdown, or host scroll.
 * The format is display metadata only; stored values are unchanged.
 */
export function openNumberFormatPanel(options: NumberFormatPanelOptions): () => void {
  const t = options.translate;
  const current = options.field.config.format;
  const panel = document.createElement('form');
  panel.className = 'loom-field-editor loom-number-format';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', t('field.format.title'));

  const title = document.createElement('div');
  title.className = 'loom-convert-title';
  title.textContent = `${options.field.name}: ${t('field.format.title')}`;
  panel.append(title);

  const body = createElement('div', 'loom-number-format-body');

  const grouping = createElement('label', 'loom-number-format-row');
  const groupingCheck = document.createElement('input');
  groupingCheck.type = 'checkbox';
  groupingCheck.checked = current?.thousandsSeparator === true;
  grouping.append(groupingCheck, document.createTextNode(t('field.format.thousands')));
  body.append(grouping);

  const decimals = createElement('label', 'loom-number-format-row');
  decimals.append(document.createTextNode(t('field.format.decimals')));
  const decimalsInput = document.createElement('input');
  decimalsInput.type = 'number';
  decimalsInput.min = '0';
  decimalsInput.max = '10';
  decimalsInput.step = '1';
  decimalsInput.placeholder = t('field.format.decimalsAuto');
  if (current?.decimals !== undefined) decimalsInput.value = String(current.decimals);
  decimals.append(decimalsInput);
  body.append(decimals);

  const currency = createElement('label', 'loom-number-format-row');
  currency.append(document.createTextNode(t('field.format.currency')));
  const currencySelect = document.createElement('select');
  const none = document.createElement('option');
  none.value = '';
  none.textContent = t('field.format.currencyNone');
  currencySelect.append(none);
  for (const code of CURRENCY_CODES) {
    const option = document.createElement('option');
    option.value = code;
    option.textContent = code;
    currencySelect.append(option);
  }
  currencySelect.value = current?.currency ?? '';
  currency.append(currencySelect);
  body.append(currency);
  panel.append(body);

  const actions = createElement('div', 'loom-field-editor-actions');
  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'loom-button';
  submit.textContent = t('common.save');
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'loom-button';
  cancel.textContent = t('common.cancel');
  cancel.addEventListener('click', () => close());
  actions.append(submit, cancel);
  panel.append(actions);

  const error = createTextElement('p', '');
  error.className = 'loom-view-panel-error';
  error.setAttribute('role', 'alert');
  error.hidden = true;
  panel.append(error);

  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKeyDown, true);
    document.removeEventListener('pointerdown', onPointerDown, true);
    options.host.removeEventListener('scroll', onScroll, true);
    panel.remove();
  };

  panel.addEventListener('submit', (event) => {
    event.preventDefault();
    const decimalsText = decimalsInput.value.trim();
    const decimals = decimalsText === '' ? undefined : Number.parseInt(decimalsText, 10);
    if (decimals !== undefined && (!Number.isInteger(decimals) || decimals < 0 || decimals > 10)) {
      error.textContent = t('field.format.decimalsInvalid');
      error.hidden = false;
      return;
    }
    const format: NumberFormatConfig = {
      ...(groupingCheck.checked ? { thousandsSeparator: true } : {}),
      ...(decimals === undefined ? {} : { decimals }),
      ...(currencySelect.value === '' ? {} : { currency: currencySelect.value }),
    };
    const empty =
      !format.thousandsSeparator && format.decimals === undefined && format.currency === undefined;
    Promise.resolve(options.onSubmit(empty ? null : format)).then(
      () => close(),
      () => {
        error.textContent = t('field.format.error');
        error.hidden = false;
      },
    );
  });

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
  return close;
}

function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.className = className;
  return element;
}

function createTextElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text: string,
): HTMLElementTagNameMap[K] {
  const element = createElement(tag, '');
  element.textContent = text;
  return element;
}
