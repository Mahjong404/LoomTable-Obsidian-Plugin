import type { Field, SortSpec } from '../client/loomtable-client';
import type { Translator } from '../i18n';
import { MAX_SORT_FIELDS, defaultSortFor, isSortableField } from './view-query-model';
import { captureQueryControlFocus, restoreQueryControlFocus } from './query-focus';

import { ensureButtonLabels, labelContainer } from './a11y';
export interface SortPanelOptions {
  readonly fields: readonly Field[];
  readonly translate: Translator;
  readonly onApply: (sort: readonly SortSpec[]) => void | Promise<unknown>;
  readonly onCancel: () => void;
  readonly confirmDiscard?: (message: string) => boolean | Promise<boolean>;
  readonly onInvalidate?: () => void;
}

export class SortPanel {
  readonly #fields: readonly Field[];
  readonly #translate: Translator;
  readonly #onApply: SortPanelOptions['onApply'];
  readonly #onCancel: () => void;
  readonly #confirmDiscard: SortPanelOptions['confirmDiscard'];
  readonly #onInvalidate: (() => void) | undefined;
  #draft: SortSpec[];
  #dirty = false;
  #root: HTMLElement | null = null;
  #applying = false;

  constructor(initial: readonly SortSpec[], options: SortPanelOptions) {
    this.#draft = initial.map((entry) => ({ ...entry }));
    this.#fields = options.fields;
    this.#translate = options.translate;
    this.#onApply = options.onApply;
    this.#onCancel = options.onCancel;
    this.#confirmDiscard = options.confirmDiscard;
    this.#onInvalidate = options.onInvalidate;
  }

  render(): HTMLElement {
    if (this.#root === null) this.#root = this.#build();
    return this.#root;
  }

  #build(): HTMLElement {
    const root = createElement('div', 'loom-sort-panel');
    root.setAttribute('role', 'form');
    labelContainer(root, this.#translate('sort.title'));

    const sortable = this.#fields.filter(
      (field) => field.deletedAt === undefined && isSortableField(field),
    );
    const usedIds = new Set(this.#draft.map((entry) => entry.fieldId));
    const choices = sortable.filter((field) => !usedIds.has(field.id));

    const list = createElement('ol', 'loom-sort-list');
    this.#draft.forEach((entry, index) => {
      list.append(this.#renderEntry(entry, index, sortable, usedIds));
    });
    root.append(list);
    if (this.#draft.length === 0) {
      root.append(createTextElement('p', this.#translate('sort.empty')));
    }

    const addRow = createElement('div', 'loom-sort-add');
    const choice = document.createElement('select');
    choice.dataset.role = 'sort-field-choice';
    choice.setAttribute('aria-label', this.#translate('sort.field'));
    for (const field of choices) {
      const option = document.createElement('option');
      option.value = field.id;
      option.textContent = field.name;
      choice.append(option);
    }
    const add = createElement('button', 'loom-button');
    add.type = 'button';
    add.dataset.action = 'sort-add';
    add.textContent = this.#translate('sort.add');
    add.disabled = this.#applying || this.#draft.length >= MAX_SORT_FIELDS || choices.length === 0;
    add.addEventListener('click', () => {
      const field = choices.find((candidate) => candidate.id === choice.value);
      if (field === undefined || this.#draft.length >= MAX_SORT_FIELDS) return;
      this.#draft.push(defaultSortFor(field.id));
      this.#dirty = true;
      this.#rerender();
    });
    addRow.append(choice, add);
    root.append(addRow);

    const footer = createElement('div', 'loom-sort-actions');
    const apply = createElement('button', 'loom-button');
    apply.type = 'button';
    apply.dataset.action = 'sort-apply-all';
    apply.textContent = this.#translate('sort.apply');
    apply.disabled = this.#applying;
    apply.addEventListener('click', () => void this.#apply());
    const cancel = createElement('button', 'loom-button');
    cancel.type = 'button';
    cancel.dataset.action = 'sort-cancel';
    cancel.textContent = this.#translate('common.cancel');
    cancel.disabled = this.#applying;
    cancel.addEventListener('click', () => void this.#cancel());
    footer.append(apply, cancel);
    root.append(footer);
    ensureButtonLabels(root);
    return root;
  }

  #renderEntry(
    entry: SortSpec,
    index: number,
    sortable: readonly Field[],
    usedIds: ReadonlySet<string>,
  ): HTMLElement {
    const item = createElement('li', 'loom-sort-entry');
    item.dataset.sortIndex = String(index);

    const fieldSelect = document.createElement('select');
    fieldSelect.dataset.role = 'sort-field';
    fieldSelect.setAttribute('aria-label', this.#translate('sort.field'));
    for (const field of sortable) {
      if (field.id !== entry.fieldId && usedIds.has(field.id)) continue;
      const option = document.createElement('option');
      option.value = field.id;
      option.textContent = field.name;
      fieldSelect.append(option);
    }
    fieldSelect.value = entry.fieldId;
    fieldSelect.addEventListener('change', () => {
      entry = { ...entry, fieldId: fieldSelect.value };
      this.#draft[index] = entry;
      this.#dirty = true;
      this.#rerender();
    });
    item.append(fieldSelect);

    const direction = document.createElement('select');
    direction.dataset.role = 'sort-direction';
    direction.setAttribute('aria-label', this.#translate('sort.direction'));
    for (const [value, key] of [
      ['asc', 'sort.direction.asc'],
      ['desc', 'sort.direction.desc'],
    ] as const) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = this.#translate(key);
      direction.append(option);
    }
    direction.value = entry.direction;
    direction.addEventListener('change', () => {
      entry = { ...entry, direction: direction.value === 'desc' ? 'desc' : 'asc' };
      this.#draft[index] = entry;
      this.#dirty = true;
      this.#rerender();
    });
    item.append(direction);

    const nulls = document.createElement('select');
    nulls.dataset.role = 'sort-nulls';
    nulls.setAttribute('aria-label', this.#translate('sort.nulls'));
    for (const [value, key] of [
      ['last', 'sort.nulls.last'],
      ['first', 'sort.nulls.first'],
    ] as const) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = this.#translate(key);
      nulls.append(option);
    }
    nulls.value = entry.nulls;
    nulls.addEventListener('change', () => {
      entry = { ...entry, nulls: nulls.value === 'first' ? 'first' : 'last' };
      this.#draft[index] = entry;
      this.#dirty = true;
      this.#rerender();
    });
    item.append(nulls);

    const up = this.#entryButton('sort-up', 'sort.up', index === 0, () => {
      this.#move(index, -1);
    });
    const down = this.#entryButton(
      'sort-down',
      'sort.down',
      index === this.#draft.length - 1,
      () => {
        this.#move(index, 1);
      },
    );
    const remove = this.#entryButton('sort-remove', 'sort.remove', false, () => {
      this.#draft.splice(index, 1);
      this.#dirty = true;
      this.#rerender();
    });
    item.append(up, down, remove);
    return item;
  }

  #entryButton(
    action: string,
    labelKey: 'sort.up' | 'sort.down' | 'sort.remove',
    disabled: boolean,
    onClick: () => void,
  ): HTMLButtonElement {
    const button = createElement('button', 'loom-button');
    button.type = 'button';
    button.dataset.action = action;
    button.textContent = this.#translate(labelKey);
    button.disabled = disabled || this.#applying;
    button.addEventListener('click', onClick);
    return button;
  }

  #move(index: number, delta: number): void {
    const target = index + delta;
    if (target < 0 || target >= this.#draft.length) return;
    const [entry] = this.#draft.splice(index, 1);
    this.#draft.splice(target, 0, entry!);
    this.#dirty = true;
    this.#rerender();
  }

  async #apply(): Promise<void> {
    this.#applying = true;
    this.#rerender();
    try {
      await this.#onApply([...this.#draft]);
    } finally {
      this.#applying = false;
      this.#rerender();
    }
  }

  async #cancel(): Promise<void> {
    if (this.#dirty) {
      const confirmed =
        (await this.#confirmDiscard?.(this.#translate('sort.discardConfirm'))) ?? false;
      if (!confirmed) return;
    }
    this.#onCancel();
  }

  #rerender(): void {
    const focus = captureQueryControlFocus(this.#root);
    const next = this.#build();
    if (this.#root?.isConnected === true) {
      this.#root.replaceWith(next);
      this.#root = next;
      restoreQueryControlFocus(next, focus);
      return;
    }
    this.#root = next;
    this.#onInvalidate?.();
  }
}

function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className !== undefined) element.className = className;
  return element;
}

function createTextElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.textContent = text;
  return element;
}
