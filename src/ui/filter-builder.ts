import type {
  Field,
  FilterGroup,
  FilterNode,
  FilterOperator,
  FilterRule,
  JsonValue,
} from '../client/loomtable-client';
import type { Translator } from '../i18n';
import type { MessageKey } from '../i18n/messages';
import {
  addFilterChild,
  coerceRuleForField,
  coerceRuleForOperator,
  countFilterRules,
  createFilterRule,
  filterOperatorsForField,
  operatorNeedsValue,
  removeFilterNodeAt,
  setFilterGroupOperator,
  updateFilterNodeAt,
  validateFilterDraft,
  type FilterIssueReason,
  type FilterPath,
} from './view-query-model';
import { captureQueryControlFocus, restoreQueryControlFocus } from './query-focus';

import { ensureButtonLabels, labelContainer } from './a11y';
export interface FilterBuilderOptions {
  readonly fields: readonly Field[];
  readonly translate: Translator;
  readonly onApply: (filter: FilterNode | undefined) => void | Promise<unknown>;
  readonly onInvalidate?: () => void;
}

const ISSUE_KEYS: Record<FilterIssueReason, MessageKey> = {
  'empty-group': 'filter.issue.emptyGroup',
  depth: 'filter.issue.depth',
  'too-many': 'filter.issue.tooMany',
  'unknown-field': 'filter.issue.unknownField',
  'operator-unsupported': 'filter.issue.operatorUnsupported',
  'value-missing': 'filter.issue.valueMissing',
  'value-invalid': 'filter.issue.valueInvalid',
  'option-unknown': 'filter.issue.optionUnknown',
};

const OPERATOR_KEYS: Record<FilterOperator, MessageKey> = {
  is: 'filter.op.is',
  isNot: 'filter.op.isNot',
  isEmpty: 'filter.op.isEmpty',
  isNotEmpty: 'filter.op.isNotEmpty',
  contains: 'filter.op.contains',
  notContains: 'filter.op.notContains',
  startsWith: 'filter.op.startsWith',
  endsWith: 'filter.op.endsWith',
  greaterThan: 'filter.op.greaterThan',
  greaterOrEqual: 'filter.op.greaterOrEqual',
  lessThan: 'filter.op.lessThan',
  lessOrEqual: 'filter.op.lessOrEqual',
  includes: 'filter.op.includes',
  excludes: 'filter.op.excludes',
};

export class FilterBuilder {
  readonly #fields: readonly Field[];
  readonly #translate: Translator;
  readonly #onApply: FilterBuilderOptions['onApply'];
  readonly #onInvalidate: (() => void) | undefined;
  #applied: FilterNode | undefined;
  #draft: FilterNode | undefined;
  #root: HTMLElement | null = null;
  #applying = false;
  #applyQueued = false;
  #applyTimer: number | null = null;

  constructor(initial: FilterNode | undefined, options: FilterBuilderOptions) {
    this.#applied = initial;
    this.#draft = initial;
    this.#fields = options.fields;
    this.#translate = options.translate;
    this.#onApply = options.onApply;
    this.#onInvalidate = options.onInvalidate;
  }

  render(): HTMLElement {
    if (this.#root === null) this.#root = this.#build();
    return this.#root;
  }

  #build(): HTMLElement {
    const root = createElement('div', 'loom-filter-builder');
    root.setAttribute('role', 'form');
    labelContainer(root, this.#translate('filter.title'));

    if (this.#applied !== undefined) {
      const summary = createElement('div', 'loom-filter-summary');
      summary.textContent = this.#translate('filter.summary').replace(
        '{count}',
        String(countFilterRules(this.#applied)),
      );
      root.append(summary);
    }

    if (this.#draft === undefined) {
      const empty = createElement('div', 'loom-filter-empty');
      empty.append(createTextElement('p', this.#translate('filter.empty')));
      empty.append(this.#addRuleButton([]));
      root.append(empty);
    } else {
      root.append(this.#renderNode(this.#draft, []));
      if (this.#draft.kind === 'rule') {
        const actions = createElement('div', 'loom-filter-root-actions');
        actions.append(this.#addRuleButton([]), this.#addGroupButton([]));
        root.append(actions);
      }
    }

    const issues = validateFilterDraft(this.#draft, this.#fields);
    for (const issue of issues) {
      const host =
        issue.path.length === 0
          ? root
          : root.querySelector<HTMLElement>(`[data-path="${pathKey(issue.path)}"]`);
      const note = createElement('div', 'loom-filter-issue');
      note.dataset.path = pathKey(issue.path);
      note.setAttribute('role', 'alert');
      note.textContent = this.#translate(ISSUE_KEYS[issue.reason]);
      (host ?? root).append(note);
    }

    const footer = createElement('div', 'loom-filter-actions');
    if (this.#applied !== undefined || this.#draft !== undefined) {
      const clear = createElement('button', 'loom-button');
      clear.type = 'button';
      clear.dataset.action = 'filter-clear';
      clear.textContent = this.#translate('filter.clear');
      clear.disabled = this.#applying;
      clear.addEventListener('click', () => void this.#clear());
      footer.append(clear);
    }
    root.append(footer);
    ensureButtonLabels(root);
    return root;
  }

  #renderNode(node: FilterNode, path: FilterPath): HTMLElement {
    return node.kind === 'group' ? this.#renderGroup(node, path) : this.#renderRule(node, path);
  }

  #renderGroup(group: FilterGroup, path: FilterPath): HTMLElement {
    const container = createElement('div', 'loom-filter-group');
    container.dataset.path = pathKey(path);
    const head = createElement('div', 'loom-filter-group-head');
    const operator = document.createElement('select');
    operator.dataset.role = 'filter-group-op';
    operator.setAttribute('aria-label', this.#translate('filter.group'));
    for (const value of ['and', 'or'] as const) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = this.#translate(
        value === 'and' ? 'filter.group.and' : 'filter.group.or',
      );
      operator.append(option);
    }
    operator.value = group.operator;
    operator.addEventListener('change', () => {
      if (this.#draft === undefined) return;
      this.#draft = setFilterGroupOperator(this.#draft, path, operator.value as 'and' | 'or');
      this.#scheduleApply();
      this.#rerender();
    });
    head.append(operator);
    head.append(this.#addRuleButton(path), this.#addGroupButton(path));
    const remove = this.#removeButton(path);
    if (remove !== null) head.append(remove);
    container.append(head);
    const children = createElement('div', 'loom-filter-children');
    group.children.forEach((child, index) => {
      children.append(this.#renderNode(child, [...path, index]));
    });
    container.append(children);
    return container;
  }

  #renderRule(rule: FilterRule, path: FilterPath): HTMLElement {
    const row = createElement('div', 'loom-filter-row');
    row.dataset.path = pathKey(path);

    const fieldSelect = document.createElement('select');
    fieldSelect.dataset.role = 'filter-field';
    fieldSelect.setAttribute('aria-label', this.#translate('filter.field'));
    for (const field of this.#fields) {
      const option = document.createElement('option');
      option.value = field.id;
      option.textContent = field.name;
      fieldSelect.append(option);
    }
    fieldSelect.value = rule.fieldId;
    fieldSelect.addEventListener('change', () => {
      const field = this.#fields.find((candidate) => candidate.id === fieldSelect.value);
      if (field === undefined || this.#draft === undefined) return;
      this.#draft = updateFilterNodeAt(this.#draft, path, (node) =>
        node.kind === 'rule' ? coerceRuleForField(node, field) : node,
      );
      this.#scheduleApply();
      this.#rerender();
    });
    row.append(fieldSelect);

    const field = this.#fields.find((candidate) => candidate.id === rule.fieldId);
    const operators = field === undefined ? [] : filterOperatorsForField(field);
    const operatorSelect = document.createElement('select');
    operatorSelect.dataset.role = 'filter-operator';
    operatorSelect.setAttribute('aria-label', this.#translate('filter.operator'));
    for (const value of operators) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = this.#translate(OPERATOR_KEYS[value]);
      operatorSelect.append(option);
    }
    operatorSelect.value = rule.operator;
    operatorSelect.addEventListener('change', () => {
      if (this.#draft === undefined) return;
      const operator = operatorSelect.value as FilterOperator;
      this.#draft = updateFilterNodeAt(this.#draft, path, (node) =>
        node.kind === 'rule' ? coerceRuleForOperator(node, operator) : node,
      );
      this.#scheduleApply();
      this.#rerender();
    });
    row.append(operatorSelect);

    if (field !== undefined && operatorNeedsValue(rule.operator)) {
      row.append(this.#valueControl(field, rule, path));
    }

    const remove = this.#removeButton(path);
    if (remove !== null) row.append(remove);
    return row;
  }

  #valueControl(field: Field, rule: FilterRule, path: FilterPath): HTMLElement {
    if (field.type === 'select' || field.type === 'multiSelect') {
      const select = document.createElement('select');
      select.dataset.role = 'filter-value';
      select.setAttribute('aria-label', this.#translate('filter.value'));
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = this.#translate('filter.valuePlaceholder');
      select.append(placeholder);
      for (const option of field.config.options) {
        select.append(this.#optionElement(option.id, option.name, false));
      }
      for (const option of field.config.deletedOptions) {
        select.append(this.#optionElement(option.id, option.name, true));
      }
      select.value = typeof rule.value === 'string' ? rule.value : '';
      select.addEventListener('change', () => {
        this.#setRuleValue(path, select.value === '' ? undefined : select.value);
      });
      return select;
    }
    if (field.type === 'checkbox') {
      const select = document.createElement('select');
      select.dataset.role = 'filter-value';
      select.setAttribute('aria-label', this.#translate('filter.value'));
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = this.#translate('filter.valuePlaceholder');
      select.append(placeholder);
      for (const [value, key] of [
        ['true', 'filter.value.checked'],
        ['false', 'filter.value.unchecked'],
      ] as const) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = this.#translate(key);
        select.append(option);
      }
      select.value = typeof rule.value === 'boolean' ? String(rule.value) : '';
      select.addEventListener('change', () => {
        this.#setRuleValue(path, select.value === '' ? undefined : select.value === 'true');
      });
      return select;
    }
    const input = document.createElement('input');
    input.dataset.role = 'filter-value';
    input.setAttribute('aria-label', this.#translate('filter.value'));
    if (field.type === 'number') {
      input.type = 'number';
      input.value = typeof rule.value === 'number' ? String(rule.value) : '';
      input.addEventListener('input', () => {
        const parsed = input.valueAsNumber;
        this.#setRuleValue(path, Number.isFinite(parsed) ? parsed : undefined);
      });
      return input;
    }
    if (field.type === 'date') {
      input.type = 'date';
      input.value = typeof rule.value === 'string' ? rule.value : '';
      input.addEventListener('input', () => {
        this.#setRuleValue(path, input.value === '' ? undefined : input.value);
      });
      return input;
    }
    input.type = 'text';
    input.value = typeof rule.value === 'string' ? rule.value : '';
    input.addEventListener('input', () => {
      this.#setRuleValue(path, input.value);
    });
    return input;
  }

  #optionElement(id: string, name: string, deleted: boolean): HTMLOptionElement {
    const option = document.createElement('option');
    option.value = id;
    option.textContent = deleted ? `${name} ${this.#translate('filter.option.deleted')}` : name;
    if (deleted) option.dataset.deleted = 'true';
    return option;
  }

  #setRuleValue(path: FilterPath, value: JsonValue | undefined): void {
    if (this.#draft === undefined) return;
    this.#draft = updateFilterNodeAt(this.#draft, path, (node) => {
      if (node.kind !== 'rule') return node;
      return value === undefined
        ? { kind: 'rule', fieldId: node.fieldId, operator: node.operator }
        : { kind: 'rule', fieldId: node.fieldId, operator: node.operator, value };
    });
    this.#scheduleApply();
    this.#rerender();
  }

  #addRuleButton(path: FilterPath): HTMLButtonElement {
    const button = createElement('button', 'loom-button');
    button.type = 'button';
    button.dataset.action = 'filter-add-rule';
    button.textContent = this.#translate('filter.addRule');
    button.addEventListener('click', () => {
      const field = this.#fields.find((candidate) => candidate.deletedAt === undefined);
      if (field === undefined) return;
      if (this.#draft === undefined) {
        this.#draft = {
          kind: 'group',
          operator: 'and',
          children: [createFilterRule(field)],
        };
      } else {
        this.#draft = addFilterChild(this.#draft, path, 'rule', field);
      }
      this.#scheduleApply();
      this.#rerender();
    });
    return button;
  }

  #addGroupButton(path: FilterPath): HTMLButtonElement {
    const button = createElement('button', 'loom-button');
    button.type = 'button';
    button.dataset.action = 'filter-add-group';
    button.textContent = this.#translate('filter.addGroup');
    button.addEventListener('click', () => {
      if (this.#draft === undefined) return;
      const field = this.#fields.find((candidate) => candidate.deletedAt === undefined);
      if (field === undefined) return;
      this.#draft = addFilterChild(this.#draft, path, 'group', field);
      this.#scheduleApply();
      this.#rerender();
    });
    return button;
  }

  #removeButton(path: FilterPath): HTMLButtonElement | null {
    if (this.#draft === undefined) return null;
    const button = createElement('button', 'loom-button');
    button.type = 'button';
    button.dataset.action = 'filter-remove';
    button.textContent = this.#translate('filter.remove');
    button.addEventListener('click', () => {
      if (this.#draft === undefined) return;
      this.#draft = removeFilterNodeAt(this.#draft, path);
      this.#scheduleApply();
      this.#rerender();
    });
    return button;
  }

  #scheduleApply(): void {
    if (this.#applyTimer !== null) window.clearTimeout(this.#applyTimer);
    this.#applyTimer = window.setTimeout(() => {
      this.#applyTimer = null;
      void this.#apply();
    }, 300);
  }

  async #apply(): Promise<void> {
    if (this.#applying) {
      this.#applyQueued = true;
      return;
    }
    const issues = validateFilterDraft(this.#draft, this.#fields);
    if (issues.length > 0) {
      this.#rerender();
      return;
    }
    const draft = this.#draft;
    this.#applying = true;
    try {
      const outcome = await this.#onApply(draft);
      if (
        outcome === undefined ||
        (typeof outcome === 'object' &&
          outcome !== null &&
          (outcome as { status?: unknown }).status === 'saved')
      ) {
        this.#applied = draft;
      }
    } finally {
      this.#applying = false;
      if (this.#applyQueued) {
        this.#applyQueued = false;
        void this.#apply();
      } else {
        this.#rerender();
      }
    }
  }

  async #clear(): Promise<void> {
    this.#draft = undefined;
    this.#applying = true;
    this.#rerender();
    try {
      const outcome = await this.#onApply(undefined);
      if (
        outcome === undefined ||
        (typeof outcome === 'object' &&
          outcome !== null &&
          (outcome as { status?: unknown }).status === 'saved')
      ) {
        this.#applied = undefined;
      }
    } finally {
      this.#applying = false;
      this.#rerender();
    }
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

function pathKey(path: FilterPath): string {
  return path.join('.');
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
