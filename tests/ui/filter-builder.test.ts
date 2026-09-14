import { describe, expect, it, vi } from 'vitest';

import type { Field, FilterGroup, FilterNode } from '../../src/client/loomtable-client';
import { createTranslator } from '../../src/i18n';
import { FilterBuilder } from '../../src/ui/filter-builder';

function field(id: string, type: Field['type'], name = id): Field {
  return {
    id,
    tableId: 'table_01',
    name,
    position: 1,
    schemaVersion: 1,
    revision: 1,
    type,
    config:
      type === 'select' || type === 'multiSelect'
        ? {
            options: [
              { id: 'opt_a', name: 'Alpha', color: 'blue' },
              { id: 'opt_b', name: 'Beta', color: 'red' },
            ],
            deletedOptions: [{ id: 'opt_old', name: 'Legacy', color: 'gray', deletedAt: 'x' }],
          }
        : {},
  } as Field;
}

const FIELDS: readonly Field[] = [
  field('field_name', 'text', 'Name'),
  field('field_count', 'number', 'Count'),
  field('field_due', 'date', 'Due'),
  field('field_done', 'checkbox', 'Done'),
  field('field_status', 'select', 'Status'),
  field('field_tags', 'multiSelect', 'Tags'),
  field('field_site', 'location', 'Site'),
];

function mount(builder: FilterBuilder): HTMLElement {
  const host = document.createElement('div');
  document.body.append(host);
  host.append(builder.render());
  return host;
}

function createBuilder(
  initial: FilterNode | undefined,
  callbacks: {
    onApply?: (filter: FilterNode | undefined) => void | Promise<unknown>;
    onCancel?: () => void;
    confirmDiscard?: (message: string) => boolean | Promise<boolean>;
    onInvalidate?: () => void;
  } = {},
) {
  return new FilterBuilder(initial, {
    fields: FIELDS,
    translate: createTranslator('en'),
    onApply: callbacks.onApply ?? vi.fn(),
    onCancel: callbacks.onCancel ?? vi.fn(),
    ...(callbacks.confirmDiscard === undefined ? {} : { confirmDiscard: callbacks.confirmDiscard }),
    ...(callbacks.onInvalidate === undefined ? {} : { onInvalidate: callbacks.onInvalidate }),
  });
}

describe('FilterBuilder', () => {
  it('starts empty drafts with an add-rule entry and no Apply until valid', async () => {
    const onApply = vi.fn();
    const builder = createBuilder(undefined, { onApply });
    const host = mount(builder);

    host.querySelector<HTMLButtonElement>('[data-action="filter-add-rule"]')?.click();
    const ruleRow = host.querySelector<HTMLElement>('[data-path="0"]');
    expect(ruleRow).not.toBeNull();
    const fieldSelect = ruleRow?.querySelector<HTMLSelectElement>(
      'select[data-role="filter-field"]',
    );
    expect(fieldSelect?.value).toBe('field_name');
    const apply = host.querySelector<HTMLButtonElement>('[data-action="filter-apply"]');
    expect(apply?.disabled).toBe(true);
    host.remove();
  });

  it('applies a complete draft as a FilterNode tree', async () => {
    const onApply = vi.fn(async (_filter: FilterNode | undefined) => true);
    const builder = createBuilder(undefined, { onApply });
    const host = mount(builder);
    host.querySelector<HTMLButtonElement>('[data-action="filter-add-rule"]')?.click();

    const row = host.querySelector<HTMLElement>('[data-path="0"]');
    const valueInput = row?.querySelector<HTMLInputElement>('input[data-role="filter-value"]');
    if (valueInput === null || valueInput === undefined) throw new Error('value input missing');
    valueInput.value = '  alpha ';
    valueInput.dispatchEvent(new Event('input', { bubbles: true }));

    const apply = host.querySelector<HTMLButtonElement>('[data-action="filter-apply"]');
    expect(apply?.disabled).toBe(false);
    apply?.click();
    await vi.waitFor(() => expect(onApply).toHaveBeenCalled());
    const sent = onApply.mock.calls[0]?.[0];
    expect(sent).toEqual({
      kind: 'group',
      operator: 'and',
      children: [{ kind: 'rule', fieldId: 'field_name', operator: 'is', value: '  alpha ' }],
    });
    host.remove();
  });

  it('nests groups and reports issues by path without applying', async () => {
    const onApply = vi.fn();
    const initial: FilterNode = {
      kind: 'group',
      operator: 'and',
      children: [{ kind: 'rule', fieldId: 'field_name', operator: 'contains', value: 'a' }],
    };
    const builder = createBuilder(initial, { onApply });
    const host = mount(builder);

    host
      .querySelector<HTMLElement>('[data-path=""]')
      ?.querySelector<HTMLButtonElement>('[data-action="filter-add-group"]')
      ?.click();
    const emptyGroup = host.querySelector<HTMLElement>('[data-path="1"]');
    expect(emptyGroup?.querySelector('select[data-role="filter-group-op"]')).not.toBeNull();
    const apply = host.querySelector<HTMLButtonElement>('[data-action="filter-apply"]');
    expect(apply?.disabled).toBe(true);
    const issue = host.querySelector<HTMLElement>('.loom-filter-issue[data-path="1"]');
    expect(issue).not.toBeNull();
    apply?.click();
    await Promise.resolve();
    expect(onApply).not.toHaveBeenCalled();
    host.remove();
  });

  it('marks deleted Select options and rejects unknown ones', async () => {
    const builder = createBuilder(
      { kind: 'rule', fieldId: 'field_status', operator: 'is', value: 'opt_old' },
      {},
    );
    const host = mount(builder);
    const option = host.querySelector<HTMLOptionElement>(
      'select[data-role="filter-value"] option[value="opt_old"]',
    );
    expect(option?.textContent).toContain('Legacy');
    expect(option?.dataset.deleted).toBe('true');
    const apply = host.querySelector<HTMLButtonElement>('[data-action="filter-apply"]');
    expect(apply?.disabled).toBe(false);
    host.remove();
  });

  it('omits the value for isEmpty and requires one otherwise', async () => {
    const builder = createBuilder(
      { kind: 'rule', fieldId: 'field_name', operator: 'is', value: 'a' },
      {},
    );
    const host = mount(builder);
    const operator = host.querySelector<HTMLSelectElement>(
      '[data-path=""] select[data-role="filter-operator"], [data-path="0"] select[data-role="filter-operator"]',
    );
    if (operator === null) throw new Error('operator select missing');
    operator.value = 'isEmpty';
    operator.dispatchEvent(new Event('change', { bubbles: true }));
    expect(
      host.querySelector('input[data-role="filter-value"], select[data-role="filter-value"]'),
    ).toBeNull();
    const apply = host.querySelector<HTMLButtonElement>('[data-action="filter-apply"]');
    expect(apply?.disabled).toBe(false);
    host.remove();
  });

  it('removes the last root rule and applies an empty filter', async () => {
    const onApply = vi.fn(async () => true);
    const builder = createBuilder(
      { kind: 'rule', fieldId: 'field_name', operator: 'is', value: 'a' },
      { onApply },
    );
    const host = mount(builder);
    host
      .querySelector<HTMLButtonElement>(
        '[data-path=""] [data-action="filter-remove"], [data-path="0"] [data-action="filter-remove"]',
      )
      ?.click();
    host.querySelector<HTMLButtonElement>('[data-action="filter-apply"]')?.click();
    await vi.waitFor(() => expect(onApply).toHaveBeenCalledWith(undefined));
    host.remove();
  });

  it('shows the applied rule count and clears via the explicit action', async () => {
    const onApply = vi.fn(async () => true);
    const initial: FilterGroup = {
      kind: 'group',
      operator: 'or',
      children: [
        { kind: 'rule', fieldId: 'field_name', operator: 'contains', value: 'a' },
        { kind: 'rule', fieldId: 'field_count', operator: 'greaterThan', value: 2 },
      ],
    };
    const builder = createBuilder(initial, { onApply });
    const host = mount(builder);
    expect(host.querySelector('.loom-filter-summary')?.textContent).toContain('2');
    host.querySelector<HTMLButtonElement>('[data-action="filter-clear"]')?.click();
    await vi.waitFor(() => expect(onApply).toHaveBeenCalledWith(undefined));
    host.remove();
  });

  it('recovers through onInvalidate when the root detaches before a rerender', () => {
    const onInvalidate = vi.fn();
    const builder = createBuilder(undefined, { onInvalidate });
    const host = document.createElement('div');
    document.body.append(host);
    const root = builder.render();
    host.append(root);

    root.remove();
    root.querySelector<HTMLButtonElement>('[data-action="filter-add-rule"]')?.click();

    expect(onInvalidate).toHaveBeenCalled();
    const rebuilt = builder.render();
    host.append(rebuilt);
    expect(rebuilt.querySelector('[data-path="0"]')).not.toBeNull();
    host.remove();
  });

  it('confirms before discarding a dirty draft', async () => {
    const onCancel = vi.fn();
    const confirmDiscard = vi.fn(() => true);
    const builder = createBuilder(undefined, { onCancel, confirmDiscard });
    const host = mount(builder);
    host.querySelector<HTMLButtonElement>('[data-action="filter-add-rule"]')?.click();
    host.querySelector<HTMLButtonElement>('[data-action="filter-cancel"]')?.click();
    await vi.waitFor(() => expect(confirmDiscard).toHaveBeenCalled());
    await vi.waitFor(() => expect(onCancel).toHaveBeenCalled());
    host.remove();
  });
});
