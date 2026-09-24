import { describe, expect, it, vi } from 'vitest';

import type {
  DistinctValuesPage,
  Field,
  FilterGroup,
  FilterNode,
} from '../../src/client/loomtable-client';
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
    onInvalidate?: () => void;
    host?: HTMLElement;
    loadFieldValues?: (
      fieldId: string,
      request: { search?: string; cursor?: string },
    ) => Promise<DistinctValuesPage>;
  } = {},
) {
  return new FilterBuilder(initial, {
    fields: FIELDS,
    translate: createTranslator('en'),
    onApply: callbacks.onApply ?? vi.fn(),
    ...(callbacks.onInvalidate === undefined ? {} : { onInvalidate: callbacks.onInvalidate }),
    ...(callbacks.host === undefined ? {} : { host: callbacks.host }),
    ...(callbacks.loadFieldValues === undefined
      ? {}
      : { loadFieldValues: callbacks.loadFieldValues }),
  });
}

async function waitForApply(onApply: ReturnType<typeof vi.fn>): Promise<void> {
  await vi.waitFor(() => expect(onApply).toHaveBeenCalled(), { timeout: 1000 });
}

describe('FilterBuilder', () => {
  it('starts empty drafts with an add-rule entry and never applies invalid state', async () => {
    const onApply = vi.fn();
    const builder = createBuilder(undefined, { onApply });
    const host = mount(builder);

    host.querySelector<HTMLButtonElement>('[data-action="filter-add-rule"]')?.click();
    const ruleRow = host.querySelector<HTMLElement>('[data-path=""]');
    expect(ruleRow).not.toBeNull();
    const fieldSelect = ruleRow?.querySelector<HTMLSelectElement>(
      'select[data-role="filter-field"]',
    );
    expect(fieldSelect?.value).toBe('field_name');
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(onApply).not.toHaveBeenCalled();
    host.remove();
  });

  it('applies a complete draft as a FilterNode tree without an apply step', async () => {
    const onApply = vi.fn(async (_filter: FilterNode | undefined) => true);
    const builder = createBuilder(undefined, { onApply });
    const host = mount(builder);
    host.querySelector<HTMLButtonElement>('[data-action="filter-add-rule"]')?.click();

    const row = host.querySelector<HTMLElement>('[data-path=""]');
    const valueInput = row?.querySelector<HTMLInputElement>('input[data-role="filter-value"]');
    if (valueInput === null || valueInput === undefined) throw new Error('value input missing');
    valueInput.value = '  alpha ';
    valueInput.dispatchEvent(new Event('input', { bubbles: true }));

    await waitForApply(onApply);
    const sent = onApply.mock.calls[0]?.[0];
    expect(sent).toEqual({
      kind: 'rule',
      fieldId: 'field_name',
      operator: 'is',
      value: '  alpha ',
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
    const issue = host.querySelector<HTMLElement>('.loom-filter-issue[data-path="1"]');
    expect(issue).not.toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 400));
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
    host.remove();
  });

  it('omits the value for isEmpty and applies the change automatically', async () => {
    const onApply = vi.fn(async (_filter: FilterNode | undefined) => true);
    const builder = createBuilder(
      { kind: 'rule', fieldId: 'field_name', operator: 'is', value: 'a' },
      { onApply },
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
    await waitForApply(onApply);
    expect(onApply.mock.calls[0]?.[0]).toEqual({
      kind: 'rule',
      fieldId: 'field_name',
      operator: 'isEmpty',
    });
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
    await waitForApply(onApply);
    expect(onApply).toHaveBeenCalledWith(undefined);
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
    expect(rebuilt.querySelector('[data-path=""]')).not.toBeNull();
    host.remove();
  });

  it('shows the first rule without group chrome and wraps it on the second rule', () => {
    const builder = createBuilder(undefined, {});
    const host = mount(builder);
    host.querySelector<HTMLButtonElement>('[data-action="filter-add-rule"]')?.click();

    expect(host.querySelector('[data-path=""]')?.classList.contains('loom-filter-row')).toBe(true);
    expect(host.querySelector('select[data-role="filter-group-op"]')).toBeNull();

    host
      .querySelector<HTMLButtonElement>('.loom-filter-root-actions [data-action="filter-add-rule"]')
      ?.click();
    expect(host.querySelector('select[data-role="filter-group-op"]')).not.toBeNull();
    expect(host.querySelectorAll('.loom-filter-row')).toHaveLength(2);
    host.remove();
  });

  it('suppresses the missing-value issue on a fresh rule until the row is touched', async () => {
    const onApply = vi.fn();
    const builder = createBuilder(undefined, { onApply });
    const host = mount(builder);
    host.querySelector<HTMLButtonElement>('[data-action="filter-add-rule"]')?.click();

    expect(host.querySelector('.loom-filter-issue')).toBeNull();

    host
      .querySelector<HTMLElement>('select[data-role="filter-field"]')
      ?.dispatchEvent(new Event('change', { bubbles: true }));
    expect(host.querySelector('.loom-filter-issue')).not.toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(onApply).not.toHaveBeenCalled();
    host.remove();
  });

  it('reveals the missing-value issue when focus leaves a fresh rule', async () => {
    const builder = createBuilder(undefined, {});
    const host = mount(builder);
    host.querySelector<HTMLButtonElement>('[data-action="filter-add-rule"]')?.click();
    expect(host.querySelector('.loom-filter-issue')).toBeNull();

    host
      .querySelector('select[data-role="filter-field"]')
      ?.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    await vi.waitFor(() => expect(host.querySelector('.loom-filter-issue')).not.toBeNull());
    host.remove();
  });

  it('collapses the root group back to a bare rule when one child remains', async () => {
    const onApply = vi.fn(async (_filter: FilterNode | undefined) => true);
    const initial: FilterNode = {
      kind: 'group',
      operator: 'and',
      children: [
        { kind: 'rule', fieldId: 'field_name', operator: 'is', value: 'a' },
        { kind: 'rule', fieldId: 'field_count', operator: 'greaterThan', value: 2 },
      ],
    };
    const builder = createBuilder(initial, { onApply });
    const host = mount(builder);
    host.querySelector<HTMLButtonElement>('[data-path="1"] [data-action="filter-remove"]')?.click();
    await waitForApply(onApply);
    expect(onApply.mock.calls[0]?.[0]).toEqual({
      kind: 'rule',
      fieldId: 'field_name',
      operator: 'is',
      value: 'a',
    });
    expect(host.querySelector('select[data-role="filter-group-op"]')).toBeNull();
    host.remove();
  });

  it('names rule and group remove buttons after their targets', () => {
    const initial: FilterNode = {
      kind: 'group',
      operator: 'and',
      children: [
        { kind: 'rule', fieldId: 'field_name', operator: 'is', value: 'a' },
        {
          kind: 'group',
          operator: 'or',
          children: [{ kind: 'rule', fieldId: 'field_count', operator: 'is', value: 1 }],
        },
      ],
    };
    const builder = createBuilder(initial, {});
    const host = mount(builder);
    const groupRemove = host.querySelector<HTMLElement>(
      '.loom-filter-group[data-path=""] > .loom-filter-group-head [data-action="filter-remove"]',
    );
    expect(groupRemove?.textContent).toBe('Remove group');
    const ruleRemove = host.querySelector<HTMLElement>(
      '.loom-filter-row > [data-action="filter-remove"]',
    );
    expect(ruleRemove?.textContent).toBe('Remove rule');
    host.remove();
  });

  describe('distinct Field values', () => {
    const page = (
      items: { value: string; display?: string; count: number }[],
      extra: Partial<DistinctValuesPage> = {},
    ): DistinctValuesPage => ({
      items,
      emptyCount: 0,
      hasMore: false,
      changeCursor: 'change_01',
      ...extra,
    });

    function openPicker(host: HTMLElement): void {
      host.querySelector<HTMLButtonElement>('button.loom-filter-value-pick')?.click();
    }

    function popover(): HTMLElement | null {
      return document.body.querySelector<HTMLElement>('.loom-filter-values');
    }

    it('picks a Server value with counts and applies it', async () => {
      const onApply = vi.fn(async (_filter: FilterNode | undefined) => true);
      const loadFieldValues = vi.fn(async () =>
        page([
          { value: 'opt_a', display: 'Alpha', count: 4 },
          { value: 'opt_b', display: 'Beta', count: 2 },
        ]),
      );
      const builder = createBuilder(
        { kind: 'rule', fieldId: 'field_status', operator: 'is', value: 'opt_a' },
        { onApply, host: document.body, loadFieldValues },
      );
      const host = mount(builder);

      const pick = host.querySelector<HTMLButtonElement>('button.loom-filter-value-pick');
      expect(pick?.textContent).toBe('Alpha');
      openPicker(host);

      await vi.waitFor(() => {
        expect(popover()?.querySelectorAll('.loom-filter-values-item')).toHaveLength(2);
      });
      expect(loadFieldValues).toHaveBeenCalledWith('field_status', {});
      expect(popover()?.textContent).toContain('Alpha');
      expect(popover()?.textContent).toContain('4');

      popover()?.querySelectorAll<HTMLButtonElement>('.loom-filter-values-item')[1]?.click();
      await waitForApply(onApply);
      expect(onApply.mock.calls[0]?.[0]).toEqual({
        kind: 'rule',
        fieldId: 'field_status',
        operator: 'is',
        value: 'opt_b',
      });
      host.remove();
      popover()?.remove();
    });

    it('debounces the search box and reloads with the term', async () => {
      const loadFieldValues = vi.fn(async (_fieldId: string, request: { search?: string }) =>
        page(request.search === 'alp' ? [{ value: 'opt_a', display: 'Alpha', count: 1 }] : []),
      );
      const builder = createBuilder(
        { kind: 'rule', fieldId: 'field_status', operator: 'is' },
        { host: document.body, loadFieldValues },
      );
      const host = mount(builder);
      openPicker(host);
      await vi.waitFor(() => expect(loadFieldValues).toHaveBeenCalledTimes(1));

      const search = popover()?.querySelector<HTMLInputElement>('.loom-filter-values-search');
      if (search === null || search === undefined) throw new Error('search missing');
      search.value = 'alp';
      search.dispatchEvent(new Event('input', { bubbles: true }));

      await vi.waitFor(
        () => {
          expect(loadFieldValues).toHaveBeenCalledWith('field_status', { search: 'alp' });
        },
        { timeout: 1000 },
      );
      host.remove();
      popover()?.remove();
    });

    it('appends the next page through Load more', async () => {
      const loadFieldValues = vi
        .fn()
        .mockResolvedValueOnce(
          page([{ value: 'opt_a', display: 'Alpha', count: 4 }], {
            hasMore: true,
            nextCursor: 'values_01',
          }),
        )
        .mockResolvedValueOnce(
          page([{ value: 'opt_b', display: 'Beta', count: 2 }], { hasMore: false }),
        );
      const builder = createBuilder(
        { kind: 'rule', fieldId: 'field_status', operator: 'is' },
        { host: document.body, loadFieldValues },
      );
      const host = mount(builder);
      openPicker(host);
      await vi.waitFor(() =>
        expect(popover()?.querySelectorAll('.loom-filter-values-item')).toHaveLength(1),
      );

      popover()?.querySelector<HTMLButtonElement>('[data-action="load-more"]')?.click();
      await vi.waitFor(() => {
        expect(loadFieldValues).toHaveBeenCalledWith('field_status', {
          cursor: 'values_01',
        });
        expect(popover()?.querySelectorAll('.loom-filter-values-item')).toHaveLength(2);
      });
      host.remove();
      popover()?.remove();
    });

    it('falls back to the local option list after a load error', async () => {
      const loadFieldValues = vi.fn(async () => {
        throw new Error('offline');
      });
      const builder = createBuilder(
        { kind: 'rule', fieldId: 'field_status', operator: 'is', value: 'opt_a' },
        { host: document.body, loadFieldValues },
      );
      const host = mount(builder);
      openPicker(host);
      await vi.waitFor(() =>
        expect(popover()?.querySelector('[data-status="filter.values.error"]')).not.toBeNull(),
      );

      popover()?.querySelector<HTMLButtonElement>('[data-action="use-local"]')?.click();
      await vi.waitFor(() => {
        expect(host.querySelector('select[data-role="filter-value"]')).not.toBeNull();
      });
      const select = host.querySelector<HTMLSelectElement>('select[data-role="filter-value"]');
      expect(select?.value).toBe('opt_a');
      host.remove();
    });

    it('marks a deleted option on the pick button', () => {
      const loadFieldValues = vi.fn(async () => page([]));
      const builder = createBuilder(
        { kind: 'rule', fieldId: 'field_status', operator: 'is', value: 'opt_old' },
        { host: document.body, loadFieldValues },
      );
      const host = mount(builder);
      const pick = host.querySelector<HTMLButtonElement>('button.loom-filter-value-pick');
      expect(pick?.textContent).toContain('Legacy');
      expect(pick?.textContent).toContain('(deleted)');
      host.remove();
    });
  });
});
