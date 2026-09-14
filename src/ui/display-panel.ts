import type { Field, GridViewConfig } from '../client/loomtable-client';
import type { Translator } from '../i18n';
import type { MessageKey } from '../i18n/messages';
import {
  GRID_COLUMN_WIDTH_DEFAULT,
  GRID_COLUMN_WIDTH_MAX,
  GRID_COLUMN_WIDTH_MIN,
  validateDisplayPatch,
  type DisplayPatchIssue,
  type DisplayPatchIssueReason,
  type GridDisplayPatch,
} from './grid-display';
import { captureQueryControlFocus, restoreQueryControlFocus } from './query-focus';

import { ensureButtonLabels, labelContainer } from './a11y';
export interface DisplayPanelOptions {
  readonly fields: readonly Field[];
  readonly translate: Translator;
  readonly onApply: (patch: GridDisplayPatch) => void | Promise<unknown>;
  readonly onCancel: () => void;
  readonly confirmDiscard?: (message: string) => boolean | Promise<boolean>;
  readonly onInvalidate?: () => void;
}

const ISSUE_KEYS: Record<DisplayPatchIssueReason, MessageKey> = {
  'no-visible-fields': 'display.issue.noVisible',
  'unknown-field': 'display.issue.unknownField',
  'width-out-of-range': 'display.issue.widthRange',
  'frozen-not-visible': 'display.issue.frozenHidden',
};

const ROW_HEIGHTS: readonly GridViewConfig['rowHeight'][] = ['compact', 'standard', 'comfortable'];

export class DisplayPanel {
  readonly #translate: Translator;
  readonly #onApply: DisplayPanelOptions['onApply'];
  readonly #onCancel: () => void;
  readonly #confirmDiscard: DisplayPanelOptions['confirmDiscard'];
  readonly #onInvalidate: (() => void) | undefined;
  readonly #fieldsById: ReadonlyMap<string, Field>;
  #order: string[];
  #visible: Set<string>;
  #widths: Map<string, string>;
  #frozen: Set<string>;
  #rowHeight: GridViewConfig['rowHeight'];
  #dirty = false;
  #issues: readonly DisplayPatchIssue[] = [];
  #root: HTMLElement | null = null;
  #applying = false;

  constructor(config: GridViewConfig, options: DisplayPanelOptions) {
    this.#translate = options.translate;
    this.#onApply = options.onApply;
    this.#onCancel = options.onCancel;
    this.#confirmDiscard = options.confirmDiscard;
    this.#onInvalidate = options.onInvalidate;

    const active = options.fields
      .filter((field) => field.deletedAt === undefined)
      .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id));
    this.#fieldsById = new Map(active.map((field) => [field.id, field]));

    const seen = new Set<string>();
    const order: string[] = [];
    for (const fieldId of config.columnOrder) {
      if (this.#fieldsById.has(fieldId) && !seen.has(fieldId)) {
        seen.add(fieldId);
        order.push(fieldId);
      }
    }
    for (const field of active) {
      if (!seen.has(field.id)) order.push(field.id);
    }
    this.#order = order;

    this.#visible =
      config.projection.length === 0
        ? new Set(active.map((field) => field.id))
        : new Set(config.projection.filter((fieldId) => this.#fieldsById.has(fieldId)));

    this.#widths = new Map();
    for (const [fieldId, width] of Object.entries(config.columnWidths)) {
      if (this.#fieldsById.has(fieldId)) this.#widths.set(fieldId, String(width));
    }

    this.#frozen = new Set(
      config.frozenFieldIds.filter(
        (fieldId) => this.#visible.has(fieldId) && this.#fieldsById.has(fieldId),
      ),
    );
    this.#rowHeight = config.rowHeight;
  }

  render(): HTMLElement {
    if (this.#root === null) this.#root = this.#build();
    return this.#root;
  }

  #build(): HTMLElement {
    const root = createElement('div', 'loom-display-panel');
    root.setAttribute('role', 'form');
    labelContainer(root, this.#translate('display.title'));

    const list = createElement('ol', 'loom-display-list');
    this.#order.forEach((fieldId, index) => {
      const field = this.#fieldsById.get(fieldId);
      if (field === undefined) return;
      list.append(this.#renderRow(field, index));
    });
    root.append(list);

    const heightGroup = createElement('fieldset', 'loom-display-row-height');
    heightGroup.append(createTextElement('legend', this.#translate('display.rowHeight')));
    for (const value of ROW_HEIGHTS) {
      const label = createElement('label', 'loom-display-row-height-option');
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'loom-display-row-height';
      radio.value = value;
      radio.dataset.role = 'display-row-height';
      radio.checked = this.#rowHeight === value;
      radio.addEventListener('change', () => {
        if (radio.checked) {
          this.#rowHeight = value;
          this.#dirty = true;
        }
      });
      label.append(radio, createTextElement('span', this.#translate(`display.rowHeight.${value}`)));
      heightGroup.append(label);
    }
    root.append(heightGroup);

    const note = createElement('p', 'loom-display-narrow-note');
    note.textContent = this.#translate('display.frozenNarrowNote');
    root.append(note);

    if (this.#issues.length > 0) {
      const issueList = createElement('ul', 'loom-display-issues');
      issueList.setAttribute('role', 'alert');
      for (const issue of this.#issues) {
        const item = createElement('li', 'loom-display-issue');
        const fieldName =
          issue.fieldId === undefined
            ? ''
            : ` (${this.#fieldsById.get(issue.fieldId)?.name ?? issue.fieldId})`;
        item.textContent = this.#translate(ISSUE_KEYS[issue.reason]) + fieldName;
        issueList.append(item);
      }
      root.append(issueList);
    }

    const actions = createElement('div', 'loom-display-actions');
    const apply = createElement('button', 'loom-button loom-display-apply');
    apply.type = 'button';
    apply.dataset.action = 'display-apply';
    apply.textContent = this.#translate('display.apply');
    apply.disabled = this.#applying;
    apply.addEventListener('click', () => void this.#apply());
    const cancel = createElement('button', 'loom-button');
    cancel.type = 'button';
    cancel.dataset.action = 'display-cancel';
    cancel.textContent = this.#translate('display.cancel');
    cancel.disabled = this.#applying;
    cancel.addEventListener('click', () => void this.#cancel());
    actions.append(apply, cancel);
    root.append(actions);
    ensureButtonLabels(root);
    return root;
  }

  #renderRow(field: Field, index: number): HTMLElement {
    const row = createElement('li', 'loom-display-row');
    row.dataset.fieldId = field.id;
    const visible = this.#visible.has(field.id);

    const visibleLabel = createElement('label', 'loom-display-visible');
    const visibleToggle = document.createElement('input');
    visibleToggle.type = 'checkbox';
    visibleToggle.dataset.role = 'display-visible';
    visibleToggle.checked = visible;
    visibleToggle.setAttribute(
      'aria-label',
      this.#translate('display.visible') + ': ' + field.name,
    );
    visibleToggle.addEventListener('change', () => {
      this.#dirty = true;
      if (visibleToggle.checked) {
        this.#visible.add(field.id);
      } else {
        this.#visible.delete(field.id);
        this.#frozen.delete(field.id);
      }
      this.#rerender();
    });
    visibleLabel.append(visibleToggle, createTextElement('span', field.name));
    row.append(visibleLabel);

    const controls = createElement('span', 'loom-display-row-controls');

    const up = createElement('button', 'loom-button loom-display-move');
    up.type = 'button';
    up.dataset.action = 'display-move-up';
    up.disabled = index === 0;
    up.setAttribute('aria-label', `${this.#translate('display.moveUp')}: ${field.name}`);
    up.textContent = '↑';
    up.addEventListener('click', () => this.#move(index, -1));
    const down = createElement('button', 'loom-button loom-display-move');
    down.type = 'button';
    down.dataset.action = 'display-move-down';
    down.disabled = index === this.#order.length - 1;
    down.setAttribute('aria-label', `${this.#translate('display.moveDown')}: ${field.name}`);
    down.textContent = '↓';
    down.addEventListener('click', () => this.#move(index, 1));
    controls.append(up, down);

    const width = document.createElement('input');
    width.type = 'text';
    width.inputMode = 'numeric';
    width.dataset.role = 'display-width';
    width.placeholder = String(GRID_COLUMN_WIDTH_DEFAULT);
    width.value = this.#widths.get(field.id) ?? '';
    width.disabled = !visible;
    width.setAttribute('aria-label', `${this.#translate('display.width')}: ${field.name}`);
    if (this.#widthIssueFields.has(field.id)) width.setAttribute('aria-invalid', 'true');
    width.addEventListener('input', () => {
      this.#dirty = true;
      if (width.value.trim() === '') this.#widths.delete(field.id);
      else this.#widths.set(field.id, width.value);
    });
    controls.append(width);

    const frozenLabel = createElement('label', 'loom-display-frozen');
    const frozenToggle = document.createElement('input');
    frozenToggle.type = 'checkbox';
    frozenToggle.dataset.role = 'display-frozen';
    frozenToggle.checked = this.#frozen.has(field.id);
    frozenToggle.disabled = !visible;
    frozenToggle.setAttribute('aria-label', `${this.#translate('display.frozen')}: ${field.name}`);
    frozenToggle.addEventListener('change', () => {
      this.#dirty = true;
      if (frozenToggle.checked) this.#frozen.add(field.id);
      else this.#frozen.delete(field.id);
    });
    frozenLabel.append(frozenToggle, createTextElement('span', this.#translate('display.frozen')));
    controls.append(frozenLabel);

    row.append(controls);
    return row;
  }

  get #widthIssueFields(): ReadonlySet<string> {
    return new Set(
      this.#issues
        .filter((issue) => issue.reason === 'width-out-of-range')
        .map((issue) => issue.fieldId)
        .filter((fieldId): fieldId is string => fieldId !== undefined),
    );
  }

  #move(index: number, offset: number): void {
    const target = index + offset;
    if (target < 0 || target >= this.#order.length) return;
    const next = [...this.#order];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved!);
    this.#order = next;
    this.#dirty = true;
    this.#rerender();
  }

  #draftPatch(): { patch: GridDisplayPatch | null; issues: DisplayPatchIssue[] } {
    const issues: DisplayPatchIssue[] = [];
    const widths: Record<string, number> = {};
    for (const [fieldId, raw] of this.#widths) {
      const trimmed = raw.trim();
      if (trimmed === '') continue;
      const parsed = Number(trimmed);
      if (
        !Number.isInteger(parsed) ||
        parsed < GRID_COLUMN_WIDTH_MIN ||
        parsed > GRID_COLUMN_WIDTH_MAX
      ) {
        issues.push({ reason: 'width-out-of-range', fieldId });
        continue;
      }
      if (this.#visible.has(fieldId)) widths[fieldId] = parsed;
    }
    const projection = this.#order.filter((fieldId) => this.#visible.has(fieldId));
    const patch: GridDisplayPatch = {
      projection,
      columnOrder: [...this.#order],
      columnWidths: widths,
      frozenFieldIds: this.#order.filter(
        (fieldId) => this.#visible.has(fieldId) && this.#frozen.has(fieldId),
      ),
      rowHeight: this.#rowHeight,
    };
    const fields = [...this.#fieldsById.values()];
    return { patch, issues: [...issues, ...validateDisplayPatch(patch, fields)] };
  }

  async #apply(): Promise<void> {
    if (this.#applying) return;
    const { patch, issues } = this.#draftPatch();
    if (issues.length > 0 || patch === null) {
      this.#issues = issues;
      this.#rerender();
      return;
    }
    this.#issues = [];
    this.#applying = true;
    this.#rerender();
    try {
      await this.#onApply(patch);
    } finally {
      this.#applying = false;
      this.#rerender();
    }
  }

  async #cancel(): Promise<void> {
    if (this.#dirty) {
      const confirmed =
        (await this.#confirmDiscard?.(this.#translate('display.discardConfirm'))) ?? false;
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
