import { describe, expect, it, vi } from 'vitest';

import type { Field, GridViewConfig } from '../../src/client/loomtable-client';
import { createTranslator } from '../../src/i18n';
import { DisplayPanel } from '../../src/ui/display-panel';
import type { GridDisplayPatch } from '../../src/ui/grid-display';

function field(id: string, name: string, position: number): Field {
  return {
    id,
    tableId: 'table_01',
    name,
    position,
    schemaVersion: 1,
    revision: 1,
    type: 'text',
    config: {},
  };
}

const FIELDS: readonly Field[] = [
  field('field_a', 'Alpha', 0),
  field('field_b', 'Beta', 1),
  field('field_c', 'Gamma', 2),
];

function config(overrides: Partial<GridViewConfig> = {}): GridViewConfig {
  return {
    projection: [],
    columnOrder: [],
    columnWidths: {},
    frozenFieldIds: [],
    rowHeight: 'standard',
    sort: [],
    ...overrides,
  };
}

function createPanel(
  viewConfig: GridViewConfig,
  callbacks: {
    onApply?: (patch: GridDisplayPatch) => void | Promise<unknown>;
    onInvalidate?: () => void;
  } = {},
) {
  return new DisplayPanel(viewConfig, {
    fields: FIELDS,
    translate: createTranslator('en'),
    onApply: callbacks.onApply ?? vi.fn(),
    ...(callbacks.onInvalidate === undefined ? {} : { onInvalidate: callbacks.onInvalidate }),
  });
}

async function waitForApply(onApply: ReturnType<typeof vi.fn>): Promise<void> {
  await vi.waitFor(() => expect(onApply).toHaveBeenCalled(), { timeout: 1000 });
}

function mount(panel: DisplayPanel): HTMLElement {
  const host = document.createElement('div');
  document.body.append(host);
  host.append(panel.render());
  return host;
}

function rows(host: HTMLElement): HTMLElement[] {
  return [...host.querySelectorAll<HTMLElement>('li[data-field-id]')];
}

describe('DisplayPanel', () => {
  it('expands an empty projection into an explicit visible list', async () => {
    const onApply = vi.fn(async (_patch: GridDisplayPatch) => true);
    const panel = createPanel(config(), { onApply });
    const host = mount(panel);

    expect(rows(host)).toHaveLength(3);
    host
      .querySelector<HTMLButtonElement>(
        'li[data-field-id="field_b"] [data-action="display-move-up"]',
      )
      ?.click();
    await waitForApply(onApply);
    const patch = onApply.mock.calls.at(-1)?.[0];
    expect(patch?.projection).toEqual(['field_b', 'field_a', 'field_c']);
    expect(patch?.columnOrder).toEqual(['field_b', 'field_a', 'field_c']);
    host.remove();
  });

  it('reorders rows with explicit up/down buttons', async () => {
    const onApply = vi.fn(async (_patch: GridDisplayPatch) => true);
    const panel = createPanel(config(), { onApply });
    const host = mount(panel);

    host
      .querySelector<HTMLButtonElement>(
        'li[data-field-id="field_b"] [data-action="display-move-up"]',
      )
      ?.click();
    expect(rows(host).map((row) => row.dataset.fieldId)).toEqual(['field_b', 'field_a', 'field_c']);

    await waitForApply(onApply);
    expect(onApply.mock.calls.at(-1)?.[0]?.columnOrder).toEqual(['field_b', 'field_a', 'field_c']);
    host.remove();
  });

  it('never applies when every Field is hidden and reports the issue', async () => {
    const onApply = vi.fn(async (_patch: GridDisplayPatch) => true);
    const panel = createPanel(config(), { onApply });
    const host = mount(panel);

    for (const fieldId of ['field_a', 'field_b', 'field_c']) {
      host
        .querySelector<HTMLInputElement>(
          `li[data-field-id="${fieldId}"] input[data-role="display-visible"]`,
        )
        ?.click();
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(onApply).not.toHaveBeenCalled();
    expect(host.querySelector('.loom-display-issue')).not.toBeNull();
    host.remove();
  });

  it('validates width input without silently truncating invalid values', async () => {
    const onApply = vi.fn(async (_patch: GridDisplayPatch) => true);
    const panel = createPanel(config(), { onApply });
    const host = mount(panel);

    const width = host.querySelector<HTMLInputElement>(
      'li[data-field-id="field_a"] input[data-role="display-width"]',
    );
    if (width === null) throw new Error('width input missing');
    width.value = '40';
    width.dispatchEvent(new Event('input', { bubbles: true }));

    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(onApply).not.toHaveBeenCalled();
    const invalidWidth = host.querySelector<HTMLInputElement>(
      'li[data-field-id="field_a"] input[data-role="display-width"]',
    );
    expect(invalidWidth?.getAttribute('aria-invalid')).toBe('true');

    invalidWidth!.value = '220';
    invalidWidth!.dispatchEvent(new Event('input', { bubbles: true }));
    await waitForApply(onApply);
    expect(onApply.mock.calls.at(-1)?.[0]?.columnWidths).toEqual({ field_a: 220 });
    host.remove();
  });

  it('drops the width key when the input is cleared', async () => {
    const onApply = vi.fn(async (_patch: GridDisplayPatch) => true);
    const panel = createPanel(config({ columnWidths: { field_a: 260 } }), { onApply });
    const host = mount(panel);

    const width = host.querySelector<HTMLInputElement>(
      'li[data-field-id="field_a"] input[data-role="display-width"]',
    );
    if (width === null) throw new Error('width input missing');
    expect(width.value).toBe('260');
    width.value = '';
    width.dispatchEvent(new Event('input', { bubbles: true }));

    await waitForApply(onApply);
    expect(onApply.mock.calls.at(-1)?.[0]?.columnWidths).toEqual({});
    host.remove();
  });

  it('hides a frozen Field by removing it from frozenFieldIds', async () => {
    const onApply = vi.fn(async (_patch: GridDisplayPatch) => true);
    const panel = createPanel(config({ frozenFieldIds: ['field_a'] }), { onApply });
    const host = mount(panel);

    const visibleToggle = host.querySelector<HTMLInputElement>(
      'li[data-field-id="field_a"] input[data-role="display-visible"]',
    );
    visibleToggle?.click();

    const frozenToggle = host.querySelector<HTMLInputElement>(
      'li[data-field-id="field_a"] input[data-role="display-frozen"]',
    );
    expect(frozenToggle?.disabled).toBe(true);

    await waitForApply(onApply);
    const patch = onApply.mock.calls.at(-1)?.[0];
    expect(patch?.frozenFieldIds).toEqual([]);
    expect(patch?.projection).toEqual(['field_b', 'field_c']);
    host.remove();
  });

  it('applies the chosen row height', async () => {
    const onApply = vi.fn(async (_patch: GridDisplayPatch) => true);
    const panel = createPanel(config(), { onApply });
    const host = mount(panel);

    const radio = host.querySelector<HTMLInputElement>(
      'input[data-role="display-row-height"][value="compact"]',
    );
    radio?.click();
    await waitForApply(onApply);
    expect(onApply.mock.calls.at(-1)?.[0]?.rowHeight).toBe('compact');
    host.remove();
  });

  it('recovers through onInvalidate when the root detaches before a rerender', async () => {
    const onInvalidate = vi.fn();
    const panel = createPanel(config(), { onInvalidate });
    const host = document.createElement('div');
    document.body.append(host);
    const root = panel.render();
    host.append(root);

    root.remove();
    root.querySelector<HTMLButtonElement>('[data-action="display-move-down"]')?.click();
    expect(onInvalidate).toHaveBeenCalled();
    host.remove();
  });
});
