import type {
  DistinctValuesPage,
  Field,
  FilterGroup,
  FilterNode,
  FilterOperator,
  FilterRule,
  JsonValue,
} from '../client/loomtable-client';
import type { Translator } from '../i18n';
import type { MessageKey } from '../i18n/messages';
import { openFilterValuesPopover } from './filter-values-popover';
import { closeActiveContextMenu, openContextMenu } from './context-menu';
import { createUiIcon } from './icons';
import { jsonEqual } from './json-equal';
import {
  addFilterChild,
  coerceRuleForField,
  coerceRuleForOperator,
  countFilterRules,
  createFilterRule,
  filterNodeAt,
  filterOperatorsForField,
  moveFilterChild,
  operatorNeedsValue,
  removeFilterNodeAt,
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
  readonly onDraftCount?: (count: number) => void;
  readonly host?: HTMLElement;
  readonly loadFieldValues?: (
    fieldId: string,
    request: { search?: string; cursor?: string },
  ) => Promise<DistinctValuesPage>;
}

interface SiblingContext {
  readonly index: number;
  readonly count: number;
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
  readonly #onDraftCount: FilterBuilderOptions['onDraftCount'];
  readonly #host: HTMLElement | undefined;
  readonly #loadFieldValues: FilterBuilderOptions['loadFieldValues'];
  #applied: FilterNode | undefined;
  #draft: FilterNode | undefined;
  #root: HTMLElement | null = null;
  #applying = false;
  #applyQueued = false;
  #applyTimer: number | null = null;
  #applyPromise: Promise<void> | null = null;
  #disposed = false;
  readonly #renderTimers = new Set<number>();
  #popoverClose: (() => void) | null = null;
  readonly #localValueFields = new Set<string>();
  /**
   * Stable local identity per draft node — the UI-side counterpart to the
   * index path, which shifts on every sibling reorder or removal. Ids live
   * only in this map (never in the persisted query); draft edits recreate
   * the edited node object, so an unchanged sibling keeps its identity.
   */
  readonly #nodeIds = new WeakMap<FilterNode, string>();
  #idSeq = 0;
  /** Touched tracking keyed by stable node id, immune to reorder. */
  readonly #touchedIds = new Set<string>();
  /**
   * Monotonic semantic generation per rule id: every Field/Operator change
   * bumps it, so a captured picker from an earlier meaning can never become
   * valid again by cycling A → B → A. Local-only — never persisted.
   */
  readonly #ruleGens = new Map<string, number>();

  constructor(initial: FilterNode | undefined, options: FilterBuilderOptions) {
    this.#applied = initial;
    this.#draft = initial;
    this.#fields = options.fields;
    this.#translate = options.translate;
    this.#onApply = options.onApply;
    this.#onInvalidate = options.onInvalidate;
    this.#onDraftCount = options.onDraftCount;
    this.#host = options.host;
    this.#loadFieldValues = options.loadFieldValues;
    const seedTouched = (node: FilterNode | undefined): void => {
      if (node === undefined) return;
      if (node.kind === 'rule') {
        this.#touchedIds.add(this.#idFor(node));
        return;
      }
      node.children.forEach((child) => seedTouched(child));
    };
    seedTouched(initial);
  }

  #idFor(node: FilterNode): string {
    let id = this.#nodeIds.get(node);
    if (id === undefined) {
      id = `node_${this.#idSeq++}`;
      this.#nodeIds.set(node, id);
    }
    return id;
  }

  /**
   * Pure resource teardown. Unclaimed UI intents are cancelled; a callback
   * already accepted by the consumer keeps its original operation identity.
   */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#applyQueued = false;
    for (const timer of this.#renderTimers) window.clearTimeout(timer);
    this.#renderTimers.clear();
    this.#closePopover();
    if (this.#applyTimer !== null) {
      window.clearTimeout(this.#applyTimer);
      this.#applyTimer = null;
    }
  }

  /** Explicit same-owner close: serially claim the last pending valid edit. */
  flushPendingApply(): Promise<void> {
    if (this.#disposed) return Promise.resolve();
    this.#closePopover();
    const pending = this.#applyTimer !== null || this.#applyQueued;
    if (this.#applyTimer !== null) window.clearTimeout(this.#applyTimer);
    this.#applyTimer = null;
    if (pending) return this.#apply();
    return this.#applyPromise ?? Promise.resolve();
  }

  /** The values popover is an owned child: exactly one may be open. */
  #closePopover(): void {
    this.#popoverClose?.();
    this.#popoverClose = null;
  }

  render(): HTMLElement {
    if (this.#root === null) this.#root = this.#build();
    if (!this.#disposed) this.#onDraftCount?.(this.getValidRuleCount());
    return this.#root;
  }

  /** True while a draft change is waiting for the debounced apply or an apply
      is in flight — the host must not rebuild the panel in that window. */
  hasPendingEdits(): boolean {
    return this.#applyTimer !== null || this.#applying || this.#draft !== this.#applied;
  }

  getValidRuleCount(): number {
    const count = (node: FilterNode | undefined): number =>
      node === undefined
        ? 0
        : node.kind === 'group'
          ? node.children.reduce((sum, child) => sum + count(child), 0)
          : validateFilterDraft(node, this.#fields).length === 0
            ? 1
            : 0;
    return count(this.#draft);
  }

  /** True when the draft already matches the persisted config slice. */
  isInSyncWith(source: FilterNode | undefined): boolean {
    return this.#draft === source || jsonEqual(this.#draft, source);
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

    // Prune touched entries whose nodes left the draft (remove/collapse)
    // and anchor issues by stable node id so a reorder keeps them attached.
    const liveIds = new Set<string>();
    const collectLive = (node: FilterNode | undefined): void => {
      if (node === undefined) return;
      liveIds.add(this.#idFor(node));
      if (node.kind === 'group') node.children.forEach(collectLive);
    };
    collectLive(this.#draft);
    for (const id of this.#touchedIds) {
      if (!liveIds.has(id)) this.#touchedIds.delete(id);
    }
    const issues = validateFilterDraft(this.#draft, this.#fields).filter((issue) => {
      if (issue.reason !== 'value-missing' && issue.reason !== 'value-invalid') return true;
      const node = this.#draft === undefined ? undefined : filterNodeAt(this.#draft, issue.path);
      return node !== undefined && this.#touchedIds.has(this.#idFor(node));
    });
    for (const issue of issues) {
      const issueNode =
        this.#draft === undefined ? undefined : filterNodeAt(this.#draft, issue.path);
      const host =
        issue.path.length === 0 || issueNode === undefined
          ? root
          : (root.querySelector<HTMLElement>(`[data-node-id="${this.#idFor(issueNode)}"]`) ?? root);
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

  #renderNode(node: FilterNode, path: FilterPath, siblings?: SiblingContext): HTMLElement {
    return node.kind === 'group'
      ? this.#renderGroup(node, path, siblings)
      : this.#renderRule(node, path, siblings);
  }

  #renderGroup(group: FilterGroup, path: FilterPath, siblings?: SiblingContext): HTMLElement {
    const container = createElement('div', 'loom-filter-group');
    container.dataset.path = pathKey(path);
    container.dataset.nodeId = this.#idFor(group);
    const head = createElement('div', 'loom-filter-group-head');
    const handle = this.#moveHandle(path, siblings);
    if (handle !== null) head.append(handle);
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
      if (this.#disposed || this.#draft === undefined) return;
      this.#replaceNodeAt(path, (node) =>
        node.kind === 'group' ? { ...node, operator: operator.value as 'and' | 'or' } : node,
      );
      this.#scheduleApply();
      this.#rerender();
    });
    head.append(operator);
    head.append(this.#addRuleButton(path), this.#addGroupButton(path));
    const remove = this.#removeButton(path, 'group');
    if (remove !== null) head.append(remove);
    container.append(head);
    const children = createElement('div', 'loom-filter-children');
    group.children.forEach((child, index) => {
      children.append(
        this.#renderNode(child, [...path, index], { index, count: group.children.length }),
      );
    });
    container.append(children);
    return container;
  }

  #renderRule(rule: FilterRule, path: FilterPath, siblings?: SiblingContext): HTMLElement {
    const row = createElement('div', 'loom-filter-row');
    row.dataset.path = pathKey(path);
    row.dataset.nodeId = this.#idFor(rule);

    const handle = this.#moveHandle(path, siblings);
    if (handle !== null) row.append(handle);

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
      if (field === undefined || this.#disposed || this.#draft === undefined) return;
      // A semantic change retires any outstanding picker for this rule —
      // close the owned one and bump the generation so a late callback can
      // never revive it by cycling back to the original meaning.
      this.#closePopover();
      this.#replaceNodeAt(path, (node) =>
        node.kind === 'rule' ? coerceRuleForField(node, field) : node,
      );
      this.#bumpRuleSemantic(path);
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
      if (this.#disposed || this.#draft === undefined) return;
      const operator = operatorSelect.value as FilterOperator;
      this.#closePopover();
      this.#replaceNodeAt(path, (node) =>
        node.kind === 'rule' ? coerceRuleForOperator(node, operator) : node,
      );
      this.#bumpRuleSemantic(path);
      this.#scheduleApply();
      this.#rerender();
    });
    row.append(operatorSelect);

    if (field !== undefined && operatorNeedsValue(rule.operator)) {
      row.append(this.#valueControl(field, rule, path));
    }

    const remove = this.#removeButton(path, 'rule');
    if (remove !== null) row.append(remove);
    row.addEventListener('change', () => this.#markTouched(path), true);
    row.addEventListener(
      'focusout',
      (event) => {
        if (event.relatedTarget instanceof Node && row.contains(event.relatedTarget)) return;
        if (!this.#markTouched(path)) return;
        const timer = window.setTimeout(() => {
          this.#renderTimers.delete(timer);
          this.#rerender();
        }, 0);
        this.#renderTimers.add(timer);
      },
      true,
    );
    return row;
  }

  #valueControl(field: Field, rule: FilterRule, path: FilterPath): HTMLElement {
    if (field.type === 'select' || field.type === 'multiSelect') {
      const load = this.#loadFieldValues;
      if (load !== undefined && this.#host !== undefined && !this.#localValueFields.has(field.id)) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'loom-filter-value-pick clickable-icon';
        button.dataset.role = 'filter-value';
        button.setAttribute('aria-label', this.#translate('filter.value'));
        button.dataset.empty = rule.value === undefined ? 'true' : 'false';
        button.textContent = this.#optionLabel(field, rule.value);
        const host = this.#host;
        button.addEventListener('click', (event) => {
          // The popover is an owned child — a second picker replaces the
          // open one — and the pick is bound by stable node identity plus
          // the captured field/operator, not by the index path that may
          // have moved under an open picker.
          this.#closePopover();
          const nodeId = this.#idFor(rule);
          const capture = {
            nodeId,
            fieldId: rule.fieldId,
            operator: rule.operator,
            gen: this.#ruleGens.get(nodeId) ?? 0,
          };
          const close = openFilterValuesPopover({
            field,
            selected: rule.value,
            x: event.clientX,
            y: event.clientY,
            host,
            translate: this.#translate,
            load: (request) => load(field.id, request),
            onPick: (value) => this.#pickRuleValue(capture, value),
            onFallback: () => {
              if (this.#disposed) return;
              this.#localValueFields.add(field.id);
              this.#rerender();
            },
          });
          this.#popoverClose = () => {
            close();
            if (this.#popoverClose !== null) this.#popoverClose = null;
          };
        });
        return button;
      }
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
    // IME composition must not write mid-composition: the candidate string
    // is not the committed operand yet.
    let composing = false;
    input.addEventListener('compositionstart', () => {
      composing = true;
    });
    input.addEventListener('compositionend', () => {
      composing = false;
    });
    input.addEventListener('input', () => {
      if (composing) return;
      // A cleared operand is undefined — an incomplete draft never writes
      // an empty-string value over the last valid query.
      this.#setRuleValue(path, input.value === '' ? undefined : input.value);
    });
    return input;
  }

  #optionLabel(field: Field, value: unknown): string {
    if (
      typeof value !== 'string' ||
      value === '' ||
      (field.type !== 'select' && field.type !== 'multiSelect')
    ) {
      return this.#translate('filter.valuePlaceholder');
    }
    const active = field.config.options.find((candidate) => candidate.id === value);
    if (active !== undefined) return active.name;
    const deleted = field.config.deletedOptions.find((candidate) => candidate.id === value);
    return deleted === undefined
      ? this.#translate('filter.valuePlaceholder')
      : `${deleted.name} ${this.#translate('filter.option.deleted')}`;
  }

  #optionElement(id: string, name: string, deleted: boolean): HTMLOptionElement {
    const option = document.createElement('option');
    option.value = id;
    option.textContent = deleted ? `${name} ${this.#translate('filter.option.deleted')}` : name;
    if (deleted) option.dataset.deleted = 'true';
    return option;
  }

  /**
   * Applies a popover pick only when the captured rule still exists with
   * the same field, operator, and semantic generation — a rule that was
   * removed, reordered into a different position, or changed and changed
   * back while the picker was open must not receive a stale write.
   */
  #pickRuleValue(
    capture: {
      readonly nodeId: string;
      readonly fieldId: string;
      readonly operator: string;
      readonly gen: number;
    },
    value: JsonValue | undefined,
  ): void {
    if (this.#disposed || this.#draft === undefined) return;
    const path = this.#findNodePath(this.#draft, capture.nodeId);
    if (path === null) return;
    const node = filterNodeAt(this.#draft, path);
    if (node === undefined || node.kind !== 'rule') return;
    if (node.fieldId !== capture.fieldId || node.operator !== capture.operator) return;
    if ((this.#ruleGens.get(capture.nodeId) ?? 0) !== capture.gen) return;
    this.#setRuleValue(path, value);
  }

  /** Invalidates every outstanding semantic capture for the rule at path. */
  #bumpRuleSemantic(path: FilterPath): void {
    const node = this.#draft === undefined ? undefined : filterNodeAt(this.#draft, path);
    if (node === undefined || node.kind !== 'rule') return;
    const id = this.#idFor(node);
    this.#ruleGens.set(id, (this.#ruleGens.get(id) ?? 0) + 1);
  }

  #findNodePath(node: FilterNode, id: string, base: number[] = []): FilterPath | null {
    if (this.#idFor(node) === id) return base;
    if (node.kind !== 'group') return null;
    for (let index = 0; index < node.children.length; index += 1) {
      const found = this.#findNodePath(node.children[index]!, id, [...base, index]);
      if (found !== null) return found;
    }
    return null;
  }

  /**
   * Replaces the node at path — the edit keeps the rule's identity. Stable
   * ids for the whole tree are then reconciled by #preserveIds so the
   * recreated ancestor chain keeps its identity too.
   */
  #replaceNodeAt(path: FilterPath, updater: (node: FilterNode) => FilterNode): void {
    if (this.#draft === undefined) return;
    const before = this.#draft;
    this.#draft = updateFilterNodeAt(before, path, updater);
    this.#preserveIds(before, this.#draft);
  }

  /**
   * Reconciles stable ids across an immutable draft rewrite: a node whose
   * object was recreated inherits the id of the node that sat at the same
   * path — but only when it has none and kinds match. Unchanged subtrees
   * reuse the same object (WeakMap id intact); a structural wrapper (root
   * promotion) differs in kind and correctly gains a fresh id, a removed
   * node's id dies with it, and a new child has no before-counterpart.
   */
  #preserveIds(before: FilterNode | undefined, after: FilterNode | undefined): void {
    if (before === undefined || after === undefined) return;
    if (this.#nodeIds.get(after) === undefined && before.kind === after.kind) {
      const id = this.#nodeIds.get(before);
      if (id !== undefined) this.#nodeIds.set(after, id);
    }
    if (before.kind === 'group' && after.kind === 'group') {
      const shared = Math.min(before.children.length, after.children.length);
      for (let index = 0; index < shared; index += 1) {
        this.#preserveIds(before.children[index], after.children[index]);
      }
    }
  }

  #setRuleValue(path: FilterPath, value: JsonValue | undefined): void {
    if (this.#disposed || this.#draft === undefined) return;
    this.#replaceNodeAt(path, (node) => {
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
        this.#draft = createFilterRule(field);
      } else {
        this.#addChild(path, 'rule', field);
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
      this.#addChild(path, 'group', field);
      this.#scheduleApply();
      this.#rerender();
    });
    return button;
  }

  #removeButton(path: FilterPath, target: 'rule' | 'group'): HTMLButtonElement | null {
    if (this.#draft === undefined) return null;
    const button = createElement('button', 'loom-button');
    button.type = 'button';
    button.dataset.action = 'filter-remove';
    button.textContent = this.#translate(
      target === 'rule' ? 'filter.removeRule' : 'filter.removeGroup',
    );
    button.addEventListener('click', () => {
      if (this.#disposed || this.#draft === undefined) return;
      const next = removeFilterNodeAt(this.#draft, path);
      this.#preserveIds(this.#draft, next);
      this.#draft = next;
      this.#scheduleApply();
      this.#rerender();
    });
    return button;
  }

  /** Adds a move handle that opens the up/down menu — the non-drag,
      keyboard-reachable entry for same-parent reorder. */
  #moveHandle(path: FilterPath, siblings: SiblingContext | undefined): HTMLButtonElement | null {
    if (siblings === undefined || siblings.count < 2) return null;
    const { index, count } = siblings;
    const button = createElement('button', 'loom-button loom-filter-handle');
    button.type = 'button';
    button.dataset.action = 'filter-move';
    button.dataset.role = 'filter-move-handle';
    button.setAttribute('aria-label', this.#translate('filter.move'));
    button.setAttribute('aria-haspopup', 'menu');
    button.append(createUiIcon('menu-grip'));
    button.addEventListener('click', () => {
      // The trigger is inside the owned overlay: a second press toggles the
      // open menu off instead of dismissing it and immediately reopening.
      if (button.getAttribute('aria-expanded') === 'true') {
        closeActiveContextMenu();
        return;
      }
      const rect = button.getBoundingClientRect();
      openContextMenu({
        label: this.#translate('filter.move'),
        x: rect.left,
        y: rect.bottom + 4,
        host: this.#host ?? this.#root ?? document.body,
        trigger: button,
        items: [
          {
            label: this.#translate('filter.moveUp'),
            dataAction: 'filter-move-up',
            disabled: index === 0,
            action: () => this.#moveNode(path, -1),
          },
          {
            label: this.#translate('filter.moveDown'),
            dataAction: 'filter-move-down',
            disabled: index === count - 1,
            action: () => this.#moveNode(path, 1),
          },
        ],
      });
    });
    return button;
  }

  #moveNode(path: FilterPath, delta: -1 | 1): void {
    if (this.#disposed || this.#draft === undefined) return;
    const moved = filterNodeAt(this.#draft, path);
    const movedId = moved === undefined ? undefined : this.#idFor(moved);
    const next = moveFilterChild(this.#draft, path, delta);
    if (next === this.#draft) return;
    this.#preserveIds(this.#draft, next);
    this.#draft = next;
    this.#scheduleApply();
    this.#rerender();
    // The handle that issued the move was rerendered away — restore focus
    // to the same logical node's new grip, resolved through its stable id.
    if (movedId !== undefined) {
      this.#root
        ?.querySelector<HTMLElement>(`[data-node-id="${movedId}"] [data-role="filter-move-handle"]`)
        ?.focus();
    }
  }

  /** Appends a child — the parent's recreated object keeps its identity via
      #preserveIds, while a promotion wrapper is a new kind and gets its own. */
  #addChild(path: FilterPath, kind: 'rule' | 'group', field: Field): void {
    if (this.#draft === undefined) return;
    const before = this.#draft;
    this.#draft = addFilterChild(before, path, kind, field);
    this.#preserveIds(before, this.#draft);
  }

  #markTouched(path: FilterPath): boolean {
    const node = this.#draft === undefined ? undefined : filterNodeAt(this.#draft, path);
    if (node === undefined) return false;
    const id = this.#idFor(node);
    if (this.#touchedIds.has(id)) return false;
    this.#touchedIds.add(id);
    return true;
  }

  #scheduleApply(): void {
    if (this.#disposed) return;
    this.#onDraftCount?.(this.getValidRuleCount());
    if (this.#applyTimer !== null) window.clearTimeout(this.#applyTimer);
    this.#applyTimer = window.setTimeout(() => {
      this.#applyTimer = null;
      void this.#apply();
    }, 300);
  }

  #apply(): Promise<void> {
    if (this.#disposed) return Promise.resolve();
    if (this.#applying) {
      this.#applyQueued = true;
      return this.#applyPromise ?? Promise.resolve();
    }
    this.#applying = true;
    this.#applyPromise = this.#runApply();
    return this.#applyPromise;
  }

  async #runApply(): Promise<void> {
    try {
      do {
        this.#applyQueued = false;
        if (validateFilterDraft(this.#draft, this.#fields).length > 0) break;
        const draft = this.#draft;
        const outcome = await this.#onApply(draft);
        if (
          !this.#disposed &&
          (outcome === undefined ||
            (typeof outcome === 'object' &&
              outcome !== null &&
              (outcome as { status?: unknown }).status === 'saved'))
        ) {
          this.#applied = draft;
        }
      } while (!this.#disposed && this.#applyQueued);
    } finally {
      this.#applying = false;
      this.#applyQueued = false;
      this.#applyPromise = null;
      this.#rerender();
    }
  }

  async #clear(): Promise<void> {
    if (this.#disposed) return;
    this.#draft = undefined;
    this.#touchedIds.clear();
    if (this.#applyTimer !== null) window.clearTimeout(this.#applyTimer);
    this.#applyTimer = null;
    this.#rerender();
    await this.#apply();
  }

  #rerender(): void {
    if (this.#disposed) return;
    this.#onDraftCount?.(this.getValidRuleCount());
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
