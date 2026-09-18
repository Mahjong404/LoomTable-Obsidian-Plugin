import { describe, expect, it, vi } from 'vitest';

import type { Field, SortSpec } from '../../src/client/loomtable-client';
import { createTranslator } from '../../src/i18n';
import { SortPanel } from '../../src/ui/sort-panel';
import { MAX_SORT_FIELDS } from '../../src/ui/view-query-model';

function field(id: string, type: Field['type'], name = id): Field {
  return {
    id,
    tableId: 'table_01',
    name,
    position: 1,
    schemaVersion: 1,
    revision: 1,
    type,
    config: {},
  } as Field;
}

const FIELDS: readonly Field[] = [
  field('field_name', 'text', 'Name'),
  field('field_count', 'number', 'Count'),
  field('field_tags', 'multiSelect', 'Tags'),
  field('field_site', 'location', 'Site'),
];

function createPanel(
  initial: readonly SortSpec[],
  callbacks: {
    onApply?: (sort: readonly SortSpec[]) => void | Promise<unknown>;
  } = {},
) {
  return new SortPanel(initial, {
    fields: FIELDS,
    translate: createTranslator('en'),
    onApply: callbacks.onApply ?? vi.fn(),
  });
}

async function waitForApply(onApply: ReturnType<typeof vi.fn>): Promise<void> {
  await vi.waitFor(() => expect(onApply).toHaveBeenCalled(), { timeout: 1000 });
}

function mount(panel: SortPanel): HTMLElement {
  const host = document.createElement('div');
  document.body.append(host);
  host.append(panel.render());
  return host;
}

describe('SortPanel', () => {
  it('lists sortable Fields only and applies the draft order', async () => {
    const onApply = vi.fn(async (_sort: readonly SortSpec[]) => true);
    const panel = createPanel([], { onApply });
    const host = mount(panel);

    const addSelect = host.querySelector<HTMLSelectElement>(
      'select[data-role="sort-field-choice"]',
    );
    const optionValues = [...(addSelect?.options ?? [])].map((option) => option.value);
    expect(optionValues).toContain('field_name');
    expect(optionValues).not.toContain('field_tags');
    expect(optionValues).not.toContain('field_site');

    addSelect!.value = 'field_count';
    host.querySelector<HTMLButtonElement>('[data-action="sort-add"]')?.click();
    await waitForApply(onApply);
    expect(onApply.mock.calls[0]?.[0]).toEqual([
      { fieldId: 'field_count', direction: 'asc', nulls: 'last' },
    ] as const);
    host.remove();
  });

  it('reorders, flips direction/nulls and removes entries', async () => {
    const onApply = vi.fn(async (_sort: readonly SortSpec[]) => true);
    const panel = createPanel(
      [
        { fieldId: 'field_name', direction: 'asc', nulls: 'last' },
        { fieldId: 'field_count', direction: 'desc', nulls: 'last' },
      ],
      { onApply },
    );
    const host = mount(panel);

    host
      .querySelector<HTMLButtonElement>('li[data-sort-index="1"] [data-action="sort-up"]')
      ?.click();
    let rows = [...host.querySelectorAll<HTMLElement>('li[data-sort-index]')];
    expect(rows[0]?.querySelector<HTMLSelectElement>('[data-role="sort-field"]')?.value).toBe(
      'field_count',
    );

    const direction = rows[0]?.querySelector<HTMLSelectElement>('[data-role="sort-direction"]');
    direction!.value = 'asc';
    direction?.dispatchEvent(new Event('change', { bubbles: true }));
    const nulls = rows[0]?.querySelector<HTMLSelectElement>('[data-role="sort-nulls"]');
    nulls!.value = 'first';
    nulls?.dispatchEvent(new Event('change', { bubbles: true }));

    host
      .querySelector<HTMLButtonElement>('li[data-sort-index="1"] [data-action="sort-remove"]')
      ?.click();
    rows = [...host.querySelectorAll<HTMLElement>('li[data-sort-index]')];
    expect(rows).toHaveLength(1);

    await waitForApply(onApply);
    expect(onApply.mock.calls.at(-1)?.[0]).toEqual([
      { fieldId: 'field_count', direction: 'asc', nulls: 'first' },
    ]);
    host.remove();
  });

  it('caps the draft at the contract Field budget and forbids duplicates', async () => {
    const full = Array.from({ length: MAX_SORT_FIELDS }, (_, index) => ({
      fieldId: `field_extra_${index}`,
      direction: 'asc' as const,
      nulls: 'last' as const,
    }));
    const fields = [...FIELDS, ...full.map((sort) => field(sort.fieldId, 'text'))];
    const panel = new SortPanel(full, {
      fields,
      translate: createTranslator('en'),
      onApply: vi.fn(),
    });
    const host = mount(panel);
    expect(host.querySelector<HTMLButtonElement>('[data-action="sort-add"]')?.disabled).toBe(true);

    const panel2 = createPanel([{ fieldId: 'field_name', direction: 'asc', nulls: 'last' }]);
    const host2 = mount(panel2);
    const addSelect = host2.querySelector<HTMLSelectElement>(
      'select[data-role="sort-field-choice"]',
    );
    const values = [...(addSelect?.options ?? [])].map((option) => option.value);
    expect(values).not.toContain('field_name');
    host.remove();
    host2.remove();
  });

  it('applies an empty list to clear the saved sort', async () => {
    const onApply = vi.fn(async () => true);
    const panel = createPanel([{ fieldId: 'field_name', direction: 'asc', nulls: 'last' }], {
      onApply,
    });
    const host = mount(panel);
    host
      .querySelector<HTMLButtonElement>('li[data-sort-index="0"] [data-action="sort-remove"]')
      ?.click();
    await waitForApply(onApply);
    expect(onApply).toHaveBeenCalledWith([]);
    host.remove();
  });

  it('recovers through onInvalidate when the root detaches before a rerender', () => {
    const onInvalidate = vi.fn();
    const panel = new SortPanel([], {
      fields: FIELDS,
      translate: createTranslator('en'),
      onApply: vi.fn(),
      onInvalidate,
    });
    const host = document.createElement('div');
    document.body.append(host);
    const root = panel.render();
    host.append(root);

    root.remove();
    root.querySelector<HTMLButtonElement>('[data-action="sort-add"]')?.click();

    expect(onInvalidate).toHaveBeenCalled();
    const rebuilt = panel.render();
    host.append(rebuilt);
    expect(rebuilt.querySelector('li[data-sort-index="0"]')).not.toBeNull();
    host.remove();
  });

  it('shows the manual-sort toggle only when wired and reports changes', () => {
    const withoutToggle = createPanel([]);
    const host = mount(withoutToggle);
    expect(host.querySelector('[data-role="sort-manual"]')).toBeNull();
    host.remove();

    const onManualSortChange = vi.fn();
    const panel = new SortPanel([], {
      fields: FIELDS,
      translate: createTranslator('en'),
      onApply: vi.fn(),
      manualSort: true,
      onManualSortChange,
    });
    const host2 = mount(panel);
    const toggle = host2.querySelector<HTMLInputElement>('[data-role="sort-manual"]');
    expect(toggle?.checked).toBe(true);
    expect(host2.textContent).toContain('Drag row headers');

    toggle!.checked = false;
    toggle?.dispatchEvent(new Event('change', { bubbles: true }));
    expect(onManualSortChange).toHaveBeenCalledWith(false);
    host2.remove();
  });

  it('explains that an explicit sort overrides manual order', () => {
    const panel = new SortPanel([{ fieldId: 'field_name', direction: 'asc', nulls: 'last' }], {
      fields: FIELDS,
      translate: createTranslator('en'),
      onApply: vi.fn(),
      manualSort: true,
      onManualSortChange: vi.fn(),
    });
    const host = mount(panel);
    expect(host.textContent).toContain('overrides the manual order');
    host.remove();
  });
});
