import { describe, expect, it } from 'vitest';

import type { Field } from '../../src/client/loomtable-client';
import { createTranslator } from '../../src/i18n';
import {
  createFieldEditor,
  createFieldRendererRegistry,
  createRenderedFieldValueElement,
} from '../../src/ui/field-renderer-registry';

const registry = createFieldRendererRegistry();

describe('Field renderer registry', () => {
  it('keeps Unset, Cleared, and a natural empty Text value distinct', () => {
    const field = createField('text');
    const translate = createTranslator('en');

    expect(registry.render(field, undefined, { translate })).toMatchObject({
      state: 'unset',
      text: 'Unset',
      ariaLabel: 'Unset',
    });
    expect(registry.render(field, null, { translate })).toMatchObject({
      state: 'cleared',
      text: 'Cleared',
      ariaLabel: 'Cleared',
    });
    expect(registry.render(field, '', { translate })).toMatchObject({
      state: 'empty',
      text: 'Empty',
      ariaLabel: 'Empty',
    });
  });

  it('uses translated semantics for checkbox, Location, and natural empty MultiSelect', () => {
    const translate = createTranslator('zh-CN');
    const checkbox = createField('checkbox');
    const location = createField('location');
    const multiSelect = createField('multiSelect', {
      options: [{ id: 'option_1', name: 'One', color: '#000000' }],
      deletedOptions: [],
    });

    expect(registry.render(checkbox, true, { translate })).toMatchObject({
      state: 'value',
      text: '已选中',
      ariaLabel: '已选中',
    });
    expect(registry.render(location, { label: 'Office' }, { translate })).toMatchObject({
      state: 'unlocated',
      text: '未定位',
      ariaLabel: '未定位',
    });
    expect(registry.render(multiSelect, [], { translate })).toMatchObject({
      state: 'empty',
      text: '空',
      ariaLabel: '空',
    });
  });

  it('renders the existing scalar field types without weakening URL safety', () => {
    const translate = createTranslator('en');
    expect(registry.render(createField('longText'), 'A longer note', { translate }).text).toBe(
      'A longer note',
    );
    expect(registry.render(createField('number'), 42, { translate }).text).toBe('42');
    expect(registry.render(createField('date'), '2026-08-31', { translate }).text).toBe(
      '2026-08-31',
    );
    expect(registry.render(createField('date'), '', { translate })).toMatchObject({
      state: 'unavailable',
      text: 'Value unavailable',
    });
    expect(registry.render(createField('url'), 'https://example.com', { translate }).text).toBe(
      'https://example.com',
    );
    expect(registry.render(createField('url'), '', { translate })).toMatchObject({
      state: 'unavailable',
      text: 'Value unavailable',
      ariaLabel: 'Value unavailable',
    });
  });

  it('renders option names and structured attachment metadata without raw IDs or JSON', () => {
    const translate = createTranslator('en');
    const select = createField('select', {
      options: [{ id: 'option_1', name: 'One', color: '#000000' }],
      deletedOptions: [
        { id: 'option_old', name: 'Old', color: '#000000', deletedAt: '2026-01-01' },
      ],
    });
    const multiSelect = createField('multiSelect', select.config);
    const attachment = createField('attachment', { maxCount: 10 });

    expect(registry.render(select, 'option_1', { translate }).text).toBe('One');
    expect(registry.render(multiSelect, ['option_old', 'option_1'], { translate }).text).toBe(
      'Old (Deleted option), One',
    );
    const renderedAttachment = registry.render(
      attachment,
      [
        {
          id: 'attachment_1',
          source: 'vault',
          filename: 'notes.md',
          mimeType: 'text/markdown',
          size: 2048,
        },
      ],
      { translate },
    );
    expect(renderedAttachment.text).toBe('notes.md · Type: text/markdown · Size: 2 KB');
    expect(renderedAttachment.text).not.toContain('attachment_1');
    expect(renderedAttachment.text).not.toContain('{');
  });

  it('publishes MultiSelect values as semantic chips instead of a comma string', () => {
    const translate = createTranslator('en');
    const field = createField('multiSelect', {
      options: [{ id: 'option_1', name: 'One', color: '#000000' }],
      deletedOptions: [
        { id: 'option_old', name: 'Old', color: '#000000', deletedAt: '2026-01-01' },
      ],
    });

    expect(registry.render(field, ['option_old', 'option_1'], { translate })).toMatchObject({
      state: 'value',
      chips: [
        { state: 'deleted', text: 'Old', ariaLabel: 'Old (Deleted option)' },
        { state: 'value', text: 'One', ariaLabel: 'One' },
      ],
    });

    expect(registry.render(field, ['unknown-option'], { translate })).toMatchObject({
      state: 'unavailable',
      text: 'Option unavailable',
      ariaLabel: 'Option unavailable',
    });
    expect(registry.render(field, ['unknown-option'], { translate }).chips).toBeUndefined();
  });

  it('renders chip state, deleted status, and accessible labels in structured DOM', () => {
    const translate = createTranslator('en');
    const field = createField('multiSelect', {
      options: [{ id: 'option_1', name: 'One', color: '#000000' }],
      deletedOptions: [
        { id: 'option_old', name: 'Old', color: '#000000', deletedAt: '2026-01-01' },
      ],
    });
    const element = createRenderedFieldValueElement(
      registry.render(field, ['option_old', 'option_1'], { translate }),
    );

    expect(element.dataset.valueState).toBe('value');
    expect(element.querySelector('[role="list"]')?.getAttribute('aria-label')).toBe(
      'Old (Deleted option), One',
    );
    expect(
      [...element.querySelectorAll<HTMLElement>('[role="listitem"]')].map((chip) => ({
        text: chip.textContent,
        state: chip.dataset.chipState,
        ariaLabel: chip.getAttribute('aria-label'),
      })),
    ).toEqual([
      { text: 'Old (Deleted option)', state: 'deleted', ariaLabel: 'Old (Deleted option)' },
      { text: 'One', state: 'value', ariaLabel: 'One' },
    ]);
  });

  it('creates native Select and MultiSelect editors with retained deleted and safe unknown options', () => {
    const translate = createTranslator('en');
    const select = createField('select', {
      options: [{ id: 'option_1', name: 'One', color: '#000000' }],
      deletedOptions: [
        { id: 'option_old', name: 'Old', color: '#000000', deletedAt: '2026-01-01' },
      ],
    });
    const selectEditor = createFieldEditor(select, 'option_old', { translate });

    expect(selectEditor.tagName).toBe('SELECT');
    expect((selectEditor as HTMLSelectElement).multiple).toBe(false);
    expect(
      [...selectEditor.querySelectorAll('option')].map((option) => option.textContent),
    ).toEqual(['Empty', 'One', 'Old (Deleted option)']);
    expect((selectEditor as HTMLSelectElement).value).toBe('option_old');
    expect(
      selectEditor.querySelector<HTMLOptionElement>('option[data-option-state="deleted"]')
        ?.disabled,
    ).toBe(false);

    const multiSelect = createField('multiSelect', select.config);
    const multiEditor = createFieldEditor(multiSelect, ['option_old', 'option_1'], { translate });
    const selectedValues = [...(multiEditor as HTMLSelectElement).selectedOptions].map(
      (option) => option.value,
    );

    expect(multiEditor.tagName).toBe('SELECT');
    expect((multiEditor as HTMLSelectElement).multiple).toBe(true);
    expect(multiEditor.getAttribute('aria-multiselectable')).toBe('true');
    expect(selectedValues).toEqual(['option_1', 'option_old']);
    expect(multiEditor.querySelectorAll('input')).toHaveLength(0);

    const unknownEditor = createFieldEditor(multiSelect, ['missing'], { translate });
    const unknownOption = unknownEditor.querySelector<HTMLOptionElement>(
      'option[data-option-state="unavailable"]',
    );
    expect(unknownOption?.textContent).toBe('Option unavailable');
    expect(unknownOption?.selected).toBe(true);
    expect(unknownOption?.textContent).not.toContain('missing');
  });

  it('publishes editing capability for the implemented Select and MultiSelect seam', () => {
    for (const type of [
      'text',
      'longText',
      'number',
      'checkbox',
      'date',
      'url',
      'select',
      'multiSelect',
      'location',
      'attachment',
    ] as const) {
      expect(registry.capability(createField(type)).renderer).toBe(type);
    }
    expect(registry.capability(createField('text')).editor).toEqual({
      kind: 'text',
      status: 'available',
    });
    expect(registry.capability(createField('select')).editor).toEqual({
      kind: 'select',
      status: 'available',
    });
    expect(registry.capability(createField('multiSelect')).editor).toEqual({
      kind: 'multiSelect',
      status: 'available',
    });
    expect(registry.capability(createField('location')).editor).toEqual({
      kind: 'none',
      status: 'unavailable',
    });
    expect(registry.capability(createField('attachment')).editor).toEqual({
      kind: 'none',
      status: 'unavailable',
    });
  });
});

function createField(type: Field['type'], config: Field['config'] = {}): Field {
  return {
    id: 'field_1',
    tableId: 'table_1',
    name: 'Field',
    position: 0,
    schemaVersion: 1,
    revision: 1,
    type,
    config,
  } as Field;
}
