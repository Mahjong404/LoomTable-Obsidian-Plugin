import { describe, expect, it } from 'vitest';

import type { Field } from '../../src/client/loomtable-client';
import { createTranslator } from '../../src/i18n';
import { createFieldRendererRegistry } from '../../src/ui/field-renderer-registry';

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

  it('publishes editing capability without pretending MultiSelect chips are implemented', () => {
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
      status: 'deferred',
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
