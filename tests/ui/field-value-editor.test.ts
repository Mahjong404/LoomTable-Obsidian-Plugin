import { describe, expect, it } from 'vitest';

import type { Field } from '../../src/client/loomtable-client';
import { isEditableField, normalizeCellValue } from '../../src/ui/field-value-editor';

describe('field value normalization', () => {
  it('normalizes Unicode text and rejects control characters', () => {
    const field = textField('text');

    expect(normalizeCellValue(field, 'e\u0301')).toEqual({ ok: true, value: 'é' });
    expect(normalizeCellValue(field, 'bad\u0000value')).toMatchObject({ ok: false });
  });

  it.each([
    ['number', '12.5', 12.5],
    ['date', '2026-02-28', '2026-02-28'],
    ['url', 'https://example.com/path', 'https://example.com/path'],
  ] as const)('normalizes a valid %s value', (type, raw, value) => {
    expect(normalizeCellValue(textField(type), raw)).toEqual({ ok: true, value });
  });

  it('rejects invalid numbers, dates, and URLs before mutation', () => {
    expect(normalizeCellValue(textField('number'), 'not-a-number')).toMatchObject({ ok: false });
    expect(normalizeCellValue(textField('date'), '2026-02-31')).toMatchObject({ ok: false });
    expect(normalizeCellValue(textField('url'), 'ftp://example.com')).toMatchObject({ ok: false });
  });

  it('validates select options and marks complex fields read-only', () => {
    const field = selectField();
    expect(normalizeCellValue(field, 'option_01')).toEqual({ ok: true, value: 'option_01' });
    expect(normalizeCellValue(field, 'missing')).toMatchObject({ ok: false });
    expect(isEditableField(textField('location'))).toBe(false);
  });
});

function textField(type: Field['type']): Field {
  if (type === 'select' || type === 'multiSelect') return selectField(type);
  return {
    id: `field_${type}`,
    tableId: 'table_01',
    name: type,
    position: 0,
    schemaVersion: 1,
    revision: 1,
    type,
    config: {},
  } as Field;
}

function selectField(type: 'select' | 'multiSelect' = 'select'): Field {
  return {
    id: `field_${type}`,
    tableId: 'table_01',
    name: type,
    position: 0,
    schemaVersion: 1,
    revision: 1,
    type,
    config: {
      options: [{ id: 'option_01', name: 'One', color: '#fff' }],
      deletedOptions: [],
    },
  };
}
