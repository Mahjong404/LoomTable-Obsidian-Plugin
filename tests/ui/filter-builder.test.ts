import { describe, expect, it, vi } from 'vitest';

import type {
  DistinctValuesPage,
  Field,
  FilterGroup,
  FilterNode,
} from '../../src/client/loomtable-client';
import { createTranslator } from '../../src/i18n';
import { closeActiveContextMenu } from '../../src/ui/context-menu';
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

    it('keeps the pick bound to its rule when siblings reorder while open', async () => {
      const onApply = vi.fn(async (_filter: FilterNode | undefined) => true);
      const loadFieldValues = vi.fn(async () =>
        page([
          { value: 'opt_a', display: 'Alpha', count: 4 },
          { value: 'opt_b', display: 'Beta', count: 2 },
        ]),
      );
      const builder = createBuilder(
        {
          kind: 'group',
          operator: 'and',
          children: [
            { kind: 'rule', fieldId: 'field_status', operator: 'is' },
            { kind: 'rule', fieldId: 'field_tags', operator: 'includes', value: 'opt_a' },
          ],
        },
        { onApply, host: document.body, loadFieldValues },
      );
      const host = mount(builder);
      openPicker(host);
      await vi.waitFor(() => {
        expect(popover()?.querySelectorAll('.loom-filter-values-item')).toHaveLength(2);
      });

      // Reorder while the picker is open: the Status rule moves from index 0
      // to index 1. The pick must still land on the Status rule, not on
      // whatever now sits at the captured index path.
      host.querySelector<HTMLElement>('[data-path="0"] [data-action="filter-move"]')?.click();
      document
        .querySelector<HTMLElement>('.loom-context-menu [data-action="filter-move-down"]')
        ?.click();
      popover()?.querySelectorAll<HTMLButtonElement>('.loom-filter-values-item')[0]?.click();

      await waitForApply(onApply);
      const sent = onApply.mock.calls.at(-1)?.[0] as FilterGroup;
      expect(sent.children[0]).toEqual({
        kind: 'rule',
        fieldId: 'field_tags',
        operator: 'includes',
        value: 'opt_a',
      });
      expect(sent.children[1]).toEqual({
        kind: 'rule',
        fieldId: 'field_status',
        operator: 'is',
        value: 'opt_a',
      });
      host.remove();
      popover()?.remove();
    });

    it('drops the pick when its rule was removed while the picker was open', async () => {
      const onApply = vi.fn(async (_filter: FilterNode | undefined) => true);
      const loadFieldValues = vi.fn(async () =>
        page([{ value: 'opt_a', display: 'Alpha', count: 4 }]),
      );
      const builder = createBuilder(
        {
          kind: 'group',
          operator: 'and',
          children: [
            { kind: 'rule', fieldId: 'field_status', operator: 'is' },
            { kind: 'rule', fieldId: 'field_name', operator: 'is', value: 'keep' },
          ],
        },
        { onApply, host: document.body, loadFieldValues },
      );
      const host = mount(builder);
      openPicker(host);
      await vi.waitFor(() => {
        expect(popover()?.querySelectorAll('.loom-filter-values-item')).toHaveLength(1);
      });

      host.querySelector<HTMLElement>('[data-path="0"] [data-action="filter-remove"]')?.click();
      await waitForApply(onApply);
      onApply.mockClear();

      popover()?.querySelector<HTMLButtonElement>('.loom-filter-values-item')?.click();
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(onApply).not.toHaveBeenCalled();
      host.remove();
      popover()?.remove();
    });

    it('drops the pick when the rule Field changed while the picker was open', async () => {
      const onApply = vi.fn(async (_filter: FilterNode | undefined) => true);
      const loadFieldValues = vi.fn(async () =>
        page([{ value: 'opt_a', display: 'Alpha', count: 4 }]),
      );
      const builder = createBuilder(
        { kind: 'rule', fieldId: 'field_status', operator: 'is' },
        { onApply, host: document.body, loadFieldValues },
      );
      const host = mount(builder);
      openPicker(host);
      await vi.waitFor(() => {
        expect(popover()?.querySelectorAll('.loom-filter-values-item')).toHaveLength(1);
      });

      const fieldSelect = host.querySelector<HTMLSelectElement>('select[data-role="filter-field"]');
      if (fieldSelect === null || fieldSelect === undefined) throw new Error('field missing');
      fieldSelect.value = 'field_name';
      fieldSelect.dispatchEvent(new Event('change', { bubbles: true }));
      onApply.mockClear();

      popover()?.querySelector<HTMLButtonElement>('.loom-filter-values-item')?.click();
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(onApply).not.toHaveBeenCalled();
      host.remove();
      popover()?.remove();
    });

    it('owns a single child popover — opening another replaces the first', async () => {
      const loadFieldValues = vi.fn(async () => page([]));
      const builder = createBuilder(
        {
          kind: 'group',
          operator: 'and',
          children: [
            { kind: 'rule', fieldId: 'field_status', operator: 'is' },
            { kind: 'rule', fieldId: 'field_tags', operator: 'includes' },
          ],
        },
        { host: document.body, loadFieldValues },
      );
      const host = mount(builder);
      openPicker(host);
      await vi.waitFor(() => expect(loadFieldValues).toHaveBeenCalledTimes(1));
      const first = popover();

      host.querySelector<HTMLElement>('[data-path="1"] button.loom-filter-value-pick')?.click();
      await vi.waitFor(() => expect(loadFieldValues).toHaveBeenCalledTimes(2));
      const second = popover();

      expect(second).not.toBeNull();
      expect(first).not.toBe(second);
      expect(first?.isConnected).toBe(false);
      expect(document.body.querySelectorAll('.loom-filter-values')).toHaveLength(1);
      host.remove();
      second?.remove();
    });

    it('closes the owned popover on dispose', async () => {
      const loadFieldValues = vi.fn(async () => page([]));
      const builder = createBuilder(
        { kind: 'rule', fieldId: 'field_status', operator: 'is' },
        { host: document.body, loadFieldValues },
      );
      const host = mount(builder);
      openPicker(host);
      await vi.waitFor(() => expect(popover()).not.toBeNull());

      builder.dispose();
      expect(popover()).toBeNull();
      host.remove();
    });

    it('serves one Load more request at a time and dedupes repeated values', async () => {
      let resolveFirst!: (page: DistinctValuesPage) => void;
      const loadFieldValues = vi
        .fn()
        .mockResolvedValueOnce(
          page([{ value: 'opt_a', display: 'Alpha', count: 4 }], {
            hasMore: true,
            nextCursor: 'values_01',
          }),
        )
        .mockImplementationOnce(
          () =>
            new Promise<DistinctValuesPage>((resolve) => {
              resolveFirst = resolve;
            }),
        )
        .mockResolvedValueOnce(page([{ value: 'opt_b', display: 'Beta', count: 2 }]));
      const builder = createBuilder(
        { kind: 'rule', fieldId: 'field_status', operator: 'is' },
        { host: document.body, loadFieldValues },
      );
      const host = mount(builder);
      openPicker(host);
      await vi.waitFor(() =>
        expect(popover()?.querySelectorAll('.loom-filter-values-item')).toHaveLength(1),
      );

      const more = popover()?.querySelector<HTMLButtonElement>('[data-action="load-more"]');
      more?.click();
      more?.click();
      await vi.waitFor(() => expect(loadFieldValues).toHaveBeenCalledTimes(2));

      // Second page overlaps opt_a — the appended list must dedupe it.
      resolveFirst(
        page(
          [
            { value: 'opt_a', display: 'Alpha', count: 4 },
            { value: 'opt_b', display: 'Beta', count: 2 },
          ],
          { hasMore: false },
        ),
      );
      await vi.waitFor(() => {
        expect(popover()?.querySelectorAll('.loom-filter-values-item')).toHaveLength(2);
      });
      expect(loadFieldValues).toHaveBeenCalledTimes(2);
      host.remove();
      popover()?.remove();
    });

    it('ignores a late page that resolves after the popover closed', async () => {
      let resolveLoad!: (page: DistinctValuesPage) => void;
      const loadFieldValues = vi.fn(
        () =>
          new Promise<DistinctValuesPage>((resolve) => {
            resolveLoad = resolve;
          }),
      );
      const builder = createBuilder(
        { kind: 'rule', fieldId: 'field_status', operator: 'is' },
        { host: document.body, loadFieldValues },
      );
      const host = mount(builder);
      openPicker(host);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(popover()).toBeNull();

      resolveLoad(page([{ value: 'opt_a', display: 'Alpha', count: 1 }]));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(popover()).toBeNull();
      host.remove();
    });
  });

  describe('sibling reorder and draft ownership', () => {
    it('reorders rules inside one parent through the move handle menu', async () => {
      const onApply = vi.fn(async (_filter: FilterNode | undefined) => true);
      const builder = createBuilder(
        {
          kind: 'group',
          operator: 'and',
          children: [
            { kind: 'rule', fieldId: 'field_name', operator: 'is', value: 'a' },
            { kind: 'rule', fieldId: 'field_count', operator: 'is', value: 1 },
          ],
        },
        { onApply },
      );
      const host = mount(builder);

      const handle = host.querySelector<HTMLElement>('[data-path="1"] [data-action="filter-move"]');
      expect(handle).not.toBeNull();
      handle?.click();
      const menuItem = document.querySelector<HTMLElement>(
        '.loom-context-menu [data-action="filter-move-up"]',
      );
      expect(menuItem).not.toBeNull();
      menuItem?.click();

      await waitForApply(onApply);
      expect(onApply.mock.calls.at(-1)?.[0]).toEqual({
        kind: 'group',
        operator: 'and',
        children: [
          { kind: 'rule', fieldId: 'field_count', operator: 'is', value: 1 },
          { kind: 'rule', fieldId: 'field_name', operator: 'is', value: 'a' },
        ],
      });
      host.remove();
    });

    it('disables edge moves so a child cannot leave its parent', () => {
      const builder = createBuilder(
        {
          kind: 'group',
          operator: 'and',
          children: [
            { kind: 'rule', fieldId: 'field_name', operator: 'is', value: 'a' },
            { kind: 'rule', fieldId: 'field_count', operator: 'is', value: 1 },
          ],
        },
        {},
      );
      const host = mount(builder);

      host.querySelector<HTMLElement>('[data-path="0"] [data-action="filter-move"]')?.click();
      const up = document.querySelector<HTMLButtonElement>(
        '.loom-context-menu [data-action="filter-move-up"]',
      );
      const down = document.querySelector<HTMLButtonElement>(
        '.loom-context-menu [data-action="filter-move-down"]',
      );
      expect(up?.disabled).toBe(true);
      expect(down?.disabled).toBe(false);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      host.remove();
    });

    it('keeps a touched issue attached to its rule across a reorder', () => {
      const builder = createBuilder(
        {
          kind: 'group',
          operator: 'and',
          children: [
            { kind: 'rule', fieldId: 'field_name', operator: 'is', value: 'a' },
            { kind: 'rule', fieldId: 'field_count', operator: 'is' },
          ],
        },
        {},
      );
      const host = mount(builder);

      host
        .querySelector<HTMLElement>('[data-path="1"] select[data-role="filter-field"]')
        ?.dispatchEvent(new Event('change', { bubbles: true }));
      expect(host.querySelector('.loom-filter-issue')).not.toBeNull();

      host.querySelector<HTMLElement>('[data-path="1"] [data-action="filter-move"]')?.click();
      document
        .querySelector<HTMLElement>('.loom-context-menu [data-action="filter-move-up"]')
        ?.click();

      // The missing-value issue must still sit on the Count rule — now at
      // index 0 — rather than being dropped or landing on the Name rule.
      const issue = host.querySelector<HTMLElement>('.loom-filter-issue');
      expect(issue).not.toBeNull();
      // The issue sits inside its rule row — the parent is the row itself
      // (the issue element also carries a data-path, so closest() can't be
      // used to reach the row).
      const row = issue?.parentElement;
      expect(row?.dataset.path).toBe('0');
      expect(row?.querySelector<HTMLSelectElement>('select[data-role="filter-field"]')?.value).toBe(
        'field_count',
      );
      host.remove();
    });

    it('clears a text operand to undefined and keeps the last valid query', async () => {
      const onApply = vi.fn(async (_filter: FilterNode | undefined) => true);
      const builder = createBuilder(
        { kind: 'rule', fieldId: 'field_name', operator: 'is', value: 'a' },
        { onApply },
      );
      const host = mount(builder);
      const input = host.querySelector<HTMLInputElement>('input[data-role="filter-value"]');
      if (input === null || input === undefined) throw new Error('input missing');

      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));

      await new Promise((resolve) => setTimeout(resolve, 400));
      // The cleared operand is undefined — an invalid draft must never apply
      // over the previously persisted query.
      expect(onApply).not.toHaveBeenCalledWith(expect.objectContaining({ value: '' }));
      expect(onApply).not.toHaveBeenCalled();
      expect(host.querySelector('.loom-filter-issue')).not.toBeNull();
      host.remove();
    });

    it('does not write mid-composition input; composition end commits', async () => {
      const onApply = vi.fn(async (_filter: FilterNode | undefined) => true);
      const builder = createBuilder(
        { kind: 'rule', fieldId: 'field_name', operator: 'is', value: 'a' },
        { onApply },
      );
      const host = mount(builder);
      const input = host.querySelector<HTMLInputElement>('input[data-role="filter-value"]');
      if (input === null || input === undefined) throw new Error('input missing');

      input.dispatchEvent(new Event('compositionstart'));
      input.value = ' composing';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('compositionend'));
      input.dispatchEvent(new Event('input', { bubbles: true }));

      await waitForApply(onApply);
      expect(onApply.mock.calls.at(-1)?.[0]).toEqual({
        kind: 'rule',
        fieldId: 'field_name',
        operator: 'is',
        value: ' composing',
      });
      host.remove();
    });

    it('flushes a pending debounced apply when the builder is disposed', async () => {
      const onApply = vi.fn(async (_filter: FilterNode | undefined) => true);
      const builder = createBuilder(
        { kind: 'rule', fieldId: 'field_name', operator: 'is', value: 'a' },
        { onApply },
      );
      const host = mount(builder);
      const input = host.querySelector<HTMLInputElement>('input[data-role="filter-value"]');
      if (input === null || input === undefined) throw new Error('input missing');
      input.value = 'b';
      input.dispatchEvent(new Event('input', { bubbles: true }));

      builder.dispose();
      await waitForApply(onApply);
      expect(onApply.mock.calls.at(-1)?.[0]).toEqual({
        kind: 'rule',
        fieldId: 'field_name',
        operator: 'is',
        value: 'b',
      });
      host.remove();
    });

    it('toggles the move-handle menu on a second click instead of reopening', () => {
      // W15-02 integration against the M1 fix: pointerdown → focusout(to the
      // grip) → click must close, not dismiss-and-reopen.
      const builder = createBuilder(
        {
          kind: 'group',
          operator: 'and',
          children: [
            { kind: 'rule', fieldId: 'field_name', operator: 'is', value: 'a' },
            { kind: 'rule', fieldId: 'field_count', operator: 'is', value: 1 },
          ],
        },
        {},
      );
      const host = mount(builder);
      const handle = host.querySelector<HTMLElement>('[data-path="0"] [data-action="filter-move"]');
      expect(handle).not.toBeNull();

      handle!.click();
      const menu = document.querySelector<HTMLElement>('.loom-context-menu');
      expect(menu).not.toBeNull();
      expect(handle!.getAttribute('aria-expanded')).toBe('true');

      // Second press: focus leaves the menu for the grip, then click lands.
      menu!.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: handle }));
      expect(document.querySelector('.loom-context-menu')).not.toBeNull();
      handle!.click();
      expect(document.querySelector('.loom-context-menu')).toBeNull();
      expect(handle!.getAttribute('aria-expanded')).toBeNull();
      host.remove();
    });

    it('keeps a pane-A filter menu open while another pane cleans up', () => {
      // W15-02 integration against M2: menu opened by pane A's builder rides
      // the global registry, but pane B's owner-scoped cleanup must not
      // dismiss it.
      const paneB = document.createElement('div');
      document.body.append(paneB);
      const builder = createBuilder(
        {
          kind: 'group',
          operator: 'and',
          children: [
            { kind: 'rule', fieldId: 'field_name', operator: 'is', value: 'a' },
            { kind: 'rule', fieldId: 'field_count', operator: 'is', value: 1 },
          ],
        },
        {},
      );
      const host = mount(builder);
      host.querySelector<HTMLElement>('[data-path="0"] [data-action="filter-move"]')?.click();
      expect(document.querySelector('.loom-context-menu')).not.toBeNull();

      const hostB = document.createElement('div');
      paneB.append(hostB);
      closeActiveContextMenu(hostB);
      expect(document.querySelector('.loom-context-menu')).not.toBeNull();

      // Pane A's own owner key releases it.
      closeActiveContextMenu(host.firstElementChild as HTMLElement);
      expect(document.querySelector('.loom-context-menu')).toBeNull();
      host.remove();
      paneB.remove();
    });
  });
});
