import { describe, expect, it } from 'vitest';

import type { Field } from '../../src/client/loomtable-client';
import { parseClipboardValue, serializeCellForClipboard } from '../../src/ui/grid-clipboard';

function field(id: string, type: Field['type']): Field {
  return {
    id,
    tableId: 'table_01',
    name: id,
    position: 0,
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

describe('serializeCellForClipboard', () => {
  it('serializes scalar and Select values to text', () => {
    expect(serializeCellForClipboard(field('f', 'text'), 'hello')).toBe('hello');
    expect(serializeCellForClipboard(field('f', 'number'), 42)).toBe('42');
    expect(serializeCellForClipboard(field('f', 'checkbox'), true)).toBe('true');
    expect(serializeCellForClipboard(field('f', 'date'), '2026-01-01')).toBe('2026-01-01');
    expect(serializeCellForClipboard(field('f', 'select'), 'opt_a')).toBe('Alpha');
    expect(serializeCellForClipboard(field('f', 'select'), 'opt_old')).toBe('Legacy');
    expect(serializeCellForClipboard(field('f', 'multiSelect'), ['opt_a', 'opt_b'])).toBe(
      'Alpha, Beta',
    );
  });

  it('returns null for complex fields and empty for missing values', () => {
    expect(serializeCellForClipboard(field('f', 'location'), { lat: 1, lng: 2 })).toBeNull();
    expect(serializeCellForClipboard(field('f', 'attachment'), [])).toBeNull();
    expect(serializeCellForClipboard(field('f', 'text'), undefined)).toBe('');
    expect(serializeCellForClipboard(field('f', 'text'), null)).toBe('');
  });
});

describe('parseClipboardValue', () => {
  it('parses scalars through the shared cell normalizer', () => {
    expect(parseClipboardValue(field('f', 'text'), ' abc ')).toEqual({ ok: true, value: 'abc' });
    expect(parseClipboardValue(field('f', 'number'), '12.5')).toEqual({ ok: true, value: 12.5 });
    expect(parseClipboardValue(field('f', 'checkbox'), 'true')).toEqual({ ok: true, value: true });
    expect(parseClipboardValue(field('f', 'number'), 'abc').ok).toBe(false);
  });

  it('resolves Select options by name or id and rejects unknown values', () => {
    expect(parseClipboardValue(field('f', 'select'), 'Alpha')).toEqual({
      ok: true,
      value: 'opt_a',
    });
    expect(parseClipboardValue(field('f', 'select'), 'opt_b')).toEqual({
      ok: true,
      value: 'opt_b',
    });
    expect(parseClipboardValue(field('f', 'select'), 'Legacy')).toEqual({
      ok: true,
      value: 'opt_old',
    });
    expect(parseClipboardValue(field('f', 'select'), 'Nope').ok).toBe(false);
  });

  it('resolves MultiSelect lists by name and rejects unknown members', () => {
    expect(parseClipboardValue(field('f', 'multiSelect'), 'Alpha, Beta')).toEqual({
      ok: true,
      value: ['opt_a', 'opt_b'],
    });
    expect(parseClipboardValue(field('f', 'multiSelect'), 'Alpha, Nope').ok).toBe(false);
  });

  it('rejects complex fields and arbitrary JSON', () => {
    expect(parseClipboardValue(field('f', 'location'), '{"lat":1}')).toEqual({
      ok: false,
      code: 'FIELD_VALUE_COMPLEX_FIELD',
    });
    expect(parseClipboardValue(field('f', 'attachment'), '[]')).toEqual({
      ok: false,
      code: 'FIELD_VALUE_COMPLEX_FIELD',
    });
  });

  it('clears the cell when pasting an empty value', () => {
    expect(parseClipboardValue(field('f', 'text'), '   ')).toEqual({ ok: true, value: null });
  });
});
