import { describe, expect, it } from 'vitest';

import type { Field } from '../../src/client/loomtable-client';
import {
  describeFieldValueError,
  isEditableField,
  normalizeCellValue,
  normalizeLocationValue,
  type FieldValueErrorCode,
} from '../../src/ui/field-value-editor';

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

  it('normalizes a closed Location object and preserves a valid unrenderable latitude', () => {
    expect(
      normalizeLocationValue({
        label: '  Cafe\u0301 ',
        address: '  Shanghai ',
        lat: '90',
        lng: '-180',
        precision: 'exact',
      }),
    ).toEqual({
      ok: true,
      value: {
        label: 'Café',
        address: 'Shanghai',
        lat: 90,
        lng: -180,
        precision: 'exact',
      },
    });
  });

  it.each([
    [{ precision: 'exact' }, 'FIELD_VALUE_LOCATION_PRECISION_ALONE'],
    [{ lat: 1 }, 'FIELD_VALUE_LOCATION_COORDINATES_PAIR'],
    [{ lat: 91, lng: 0 }, 'FIELD_VALUE_LOCATION_LATITUDE_RANGE'],
    [{ label: 'ok', extra: 'nope' }, 'FIELD_VALUE_LOCATION_UNSUPPORTED_MEMBER'],
  ] as const)('returns a stable code for invalid Location input %j', (raw, code) => {
    const result = normalizeLocationValue(raw);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(code);
  });

  it.each([
    [
      'FIELD_VALUE_COMPLEX_FIELD',
      'This field is edited from Record details.',
      '此字段请在 Record 详情中编辑。',
    ],
    ['FIELD_VALUE_TEXT_TYPE', 'Text value must be text.', 'Text 值必须是文本。'],
    [
      'FIELD_VALUE_TEXT_CONTROL',
      'Text contains unsupported control characters.',
      '文本包含不支持的控制字符。',
    ],
    ['FIELD_VALUE_TEXT_TOO_LONG', 'Text is too long.', '文本过长。'],
    ['FIELD_VALUE_LONG_TEXT_TYPE', 'Long text value must be text.', '长文本值必须是文本。'],
    [
      'FIELD_VALUE_LONG_TEXT_CONTROL',
      'Long text contains unsupported control characters.',
      '长文本包含不支持的控制字符。',
    ],
    ['FIELD_VALUE_LONG_TEXT_TOO_LONG', 'Long text is too long.', '长文本过长。'],
    ['FIELD_VALUE_NUMBER_NOT_FINITE', 'Number must be finite.', '数字必须是有限值。'],
    ['FIELD_VALUE_NUMBER_NOT_NUMERIC', 'Number must be numeric.', '数字必须是数值。'],
    [
      'FIELD_VALUE_CHECKBOX_BOOLEAN',
      'Checkbox must be true or false.',
      '复选框必须为 true 或 false。',
    ],
    ['FIELD_VALUE_DATE_FORMAT', 'Date must use YYYY-MM-DD.', '日期必须使用 YYYY-MM-DD。'],
    ['FIELD_VALUE_DATE_INVALID', 'Date is not a valid Gregorian date.', '日期不是有效的公历日期。'],
    [
      'FIELD_VALUE_URL_ABSOLUTE',
      'URL must be an absolute HTTP(S) URL.',
      'URL 必须是绝对 HTTP(S) 地址。',
    ],
    ['FIELD_VALUE_URL_TOO_LONG', 'URL is too long.', 'URL 过长。'],
    ['FIELD_VALUE_SELECT_OPTION_TYPE', 'Select value must be an option.', 'Select 值必须是选项。'],
    ['FIELD_VALUE_SELECT_OPTION_INVALID', 'Select option is not valid.', 'Select 选项无效。'],
    [
      'FIELD_VALUE_MULTI_SELECT_TYPE',
      'Multi-select value must contain option IDs.',
      'Multi-select 值必须包含选项 ID。',
    ],
    [
      'FIELD_VALUE_MULTI_SELECT_INVALID',
      'Multi-select contains an invalid option.',
      'Multi-select 包含无效选项。',
    ],
    [
      'FIELD_VALUE_MULTI_SELECT_LIMIT',
      'Multi-select options must be unique and contain at most 100 items.',
      'Multi-select 选项必须唯一，且最多包含 100 项。',
    ],
    [
      'FIELD_VALUE_LOCATION_OBJECT',
      'Location must be an object or cleared.',
      'Location 必须是对象或已清除。',
    ],
    [
      'FIELD_VALUE_LOCATION_UNSUPPORTED_MEMBER',
      'Location contains an unsupported member.',
      'Location 包含不支持的成员。',
    ],
    [
      'FIELD_VALUE_LOCATION_MEMBER_TYPE',
      'Location member must be text.',
      'Location 成员必须是文本。',
    ],
    [
      'FIELD_VALUE_LOCATION_MEMBER_CONTROL',
      'Location contains unsupported control characters.',
      'Location 包含不支持的控制字符。',
    ],
    [
      'FIELD_VALUE_LOCATION_COORDINATES_PAIR',
      'Location latitude and longitude must be provided together.',
      'Location 的纬度和经度必须同时提供。',
    ],
    [
      'FIELD_VALUE_LOCATION_PRECISION_INVALID',
      'Location precision is not valid.',
      'Location 精度无效。',
    ],
    [
      'FIELD_VALUE_LOCATION_EMPTY',
      'Location needs a name, address, provider, or coordinates.',
      'Location 需要名称、地址、提供方或坐标。',
    ],
    [
      'FIELD_VALUE_LOCATION_PRECISION_ALONE',
      'Location precision needs another Location member.',
      'Location 精度还需要其他成员。',
    ],
    [
      'FIELD_VALUE_LOCATION_LATITUDE_RANGE',
      'Location latitude must be between -90 and 90.',
      'Location 纬度必须介于 -90 和 90 之间。',
    ],
    [
      'FIELD_VALUE_LOCATION_LONGITUDE_RANGE',
      'Location longitude must be between -180 and 180.',
      'Location 经度必须介于 -180 和 180 之间。',
    ],
  ] as const satisfies readonly [FieldValueErrorCode, string, string][])(
    'localizes %s without changing its stable code',
    (code, english, chinese) => {
      expect(describeFieldValueError(code, createTranslator('en'))).toBe(english);
      expect(describeFieldValueError(code, createTranslator('zh-CN'))).toBe(chinese);
      expect(chinese).not.toBe(english);
    },
  );

  it('keeps explicit clear distinct from an Unset editor intent', () => {
    expect(normalizeLocationValue(null)).toEqual({ ok: true, value: null });
    expect(normalizeLocationValue(undefined)).toMatchObject({ ok: false });
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

