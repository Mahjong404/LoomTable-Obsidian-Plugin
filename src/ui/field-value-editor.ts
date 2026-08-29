import type { Field, JsonValue, LocationValue, MutationValue } from '../client/loomtable-client';
import type { Translator } from '../i18n';
import type { MessageKey } from '../i18n/messages';

type SelectField = Field & {
  readonly type: 'select' | 'multiSelect';
  readonly config: {
    readonly options: readonly { readonly id: string }[];
    readonly deletedOptions: readonly { readonly id: string }[];
  };
};

export type EditableFieldType =
  'text' | 'longText' | 'number' | 'checkbox' | 'date' | 'url' | 'select' | 'multiSelect';

export type FieldValueErrorCode =
  | 'FIELD_VALUE_COMPLEX_FIELD'
  | 'FIELD_VALUE_TEXT_TYPE'
  | 'FIELD_VALUE_TEXT_CONTROL'
  | 'FIELD_VALUE_TEXT_TOO_LONG'
  | 'FIELD_VALUE_LONG_TEXT_TYPE'
  | 'FIELD_VALUE_LONG_TEXT_CONTROL'
  | 'FIELD_VALUE_LONG_TEXT_TOO_LONG'
  | 'FIELD_VALUE_NUMBER_NOT_FINITE'
  | 'FIELD_VALUE_NUMBER_NOT_NUMERIC'
  | 'FIELD_VALUE_CHECKBOX_BOOLEAN'
  | 'FIELD_VALUE_DATE_FORMAT'
  | 'FIELD_VALUE_DATE_INVALID'
  | 'FIELD_VALUE_URL_ABSOLUTE'
  | 'FIELD_VALUE_URL_TOO_LONG'
  | 'FIELD_VALUE_SELECT_OPTION_TYPE'
  | 'FIELD_VALUE_SELECT_OPTION_INVALID'
  | 'FIELD_VALUE_MULTI_SELECT_TYPE'
  | 'FIELD_VALUE_MULTI_SELECT_INVALID'
  | 'FIELD_VALUE_MULTI_SELECT_LIMIT'
  | 'FIELD_VALUE_LOCATION_OBJECT'
  | 'FIELD_VALUE_LOCATION_UNSUPPORTED_MEMBER'
  | 'FIELD_VALUE_LOCATION_MEMBER_TYPE'
  | 'FIELD_VALUE_LOCATION_MEMBER_CONTROL'
  | 'FIELD_VALUE_LOCATION_COORDINATES_PAIR'
  | 'FIELD_VALUE_LOCATION_PRECISION_INVALID'
  | 'FIELD_VALUE_LOCATION_EMPTY'
  | 'FIELD_VALUE_LOCATION_PRECISION_ALONE'
  | 'FIELD_VALUE_LOCATION_LATITUDE_RANGE'
  | 'FIELD_VALUE_LOCATION_LONGITUDE_RANGE';

export interface CellValueSuccess {
  readonly ok: true;
  readonly value: MutationValue;
}

export interface CellValueFailure {
  readonly ok: false;
  readonly code: FieldValueErrorCode;
}

export type CellValueResult = CellValueSuccess | CellValueFailure;

export type LocationEditIntent =
  | { readonly kind: 'set'; readonly value: LocationValue }
  | { readonly kind: 'clear' }
  | { readonly kind: 'unset' };

const FIELD_VALUE_ERROR_MESSAGES: Record<FieldValueErrorCode, MessageKey> = {
  FIELD_VALUE_COMPLEX_FIELD: 'validation.fieldValue.complex',
  FIELD_VALUE_TEXT_TYPE: 'validation.fieldValue.textType',
  FIELD_VALUE_TEXT_CONTROL: 'validation.fieldValue.textControl',
  FIELD_VALUE_TEXT_TOO_LONG: 'validation.fieldValue.textTooLong',
  FIELD_VALUE_LONG_TEXT_TYPE: 'validation.fieldValue.longTextType',
  FIELD_VALUE_LONG_TEXT_CONTROL: 'validation.fieldValue.longTextControl',
  FIELD_VALUE_LONG_TEXT_TOO_LONG: 'validation.fieldValue.longTextTooLong',
  FIELD_VALUE_NUMBER_NOT_FINITE: 'validation.fieldValue.numberNotFinite',
  FIELD_VALUE_NUMBER_NOT_NUMERIC: 'validation.fieldValue.numberNotNumeric',
  FIELD_VALUE_CHECKBOX_BOOLEAN: 'validation.fieldValue.checkboxBoolean',
  FIELD_VALUE_DATE_FORMAT: 'validation.fieldValue.dateFormat',
  FIELD_VALUE_DATE_INVALID: 'validation.fieldValue.dateInvalid',
  FIELD_VALUE_URL_ABSOLUTE: 'validation.fieldValue.urlAbsolute',
  FIELD_VALUE_URL_TOO_LONG: 'validation.fieldValue.urlTooLong',
  FIELD_VALUE_SELECT_OPTION_TYPE: 'validation.fieldValue.selectOptionType',
  FIELD_VALUE_SELECT_OPTION_INVALID: 'validation.fieldValue.selectOptionInvalid',
  FIELD_VALUE_MULTI_SELECT_TYPE: 'validation.fieldValue.multiSelectType',
  FIELD_VALUE_MULTI_SELECT_INVALID: 'validation.fieldValue.multiSelectInvalid',
  FIELD_VALUE_MULTI_SELECT_LIMIT: 'validation.fieldValue.multiSelectLimit',
  FIELD_VALUE_LOCATION_OBJECT: 'validation.fieldValue.locationObject',
  FIELD_VALUE_LOCATION_UNSUPPORTED_MEMBER: 'validation.fieldValue.locationUnsupportedMember',
  FIELD_VALUE_LOCATION_MEMBER_TYPE: 'validation.fieldValue.locationMemberType',
  FIELD_VALUE_LOCATION_MEMBER_CONTROL: 'validation.fieldValue.locationMemberControl',
  FIELD_VALUE_LOCATION_COORDINATES_PAIR: 'validation.fieldValue.locationCoordinatesPair',
  FIELD_VALUE_LOCATION_PRECISION_INVALID: 'validation.fieldValue.locationPrecisionInvalid',
  FIELD_VALUE_LOCATION_EMPTY: 'validation.fieldValue.locationEmpty',
  FIELD_VALUE_LOCATION_PRECISION_ALONE: 'validation.fieldValue.locationPrecisionAlone',
  FIELD_VALUE_LOCATION_LATITUDE_RANGE: 'validation.fieldValue.locationLatitudeRange',
  FIELD_VALUE_LOCATION_LONGITUDE_RANGE: 'validation.fieldValue.locationLongitudeRange',
};

export function describeFieldValueError(code: FieldValueErrorCode, translate: Translator): string {
  return translate(FIELD_VALUE_ERROR_MESSAGES[code]);
}

const EDITABLE_TYPES = new Set<EditableFieldType>([
  'text',
  'longText',
  'number',
  'checkbox',
  'date',
  'url',
  'select',
  'multiSelect',
]);

export function isEditableField(
  field: Field,
): field is Field & { readonly type: EditableFieldType } {
  return EDITABLE_TYPES.has(field.type as EditableFieldType);
}

export function normalizeCellValue(field: Field, raw: unknown): CellValueResult {
  if (raw === null || raw === undefined) return { ok: true, value: null };

  switch (field.type) {
    case 'text':
      return normalizeText(raw, 10_000, 'text');
    case 'longText':
      return normalizeText(raw, 100_000, 'longText');
    case 'number':
      return normalizeNumber(raw);
    case 'checkbox':
      return normalizeCheckbox(raw);
    case 'date':
      return normalizeDate(raw);
    case 'url':
      return normalizeUrl(raw);
    case 'select':
      return normalizeSelect(field, raw);
    case 'multiSelect':
      return normalizeMultiSelect(field, raw);
    case 'attachment':
    case 'location':
      return { ok: false, code: 'FIELD_VALUE_COMPLEX_FIELD' };
  }
}

export function normalizeLocationValue(raw: unknown): CellValueResult {
  if (raw === null) return { ok: true, value: null };
  if (!isPlainObject(raw)) return { ok: false, code: 'FIELD_VALUE_LOCATION_OBJECT' };

  const allowedKeys = new Set(['label', 'address', 'provider', 'lat', 'lng', 'precision']);
  if (Object.keys(raw).some((key) => !allowedKeys.has(key))) {
    return { ok: false, code: 'FIELD_VALUE_LOCATION_UNSUPPORTED_MEMBER' };
  }

  const result: Record<string, JsonValue> = {};
  for (const key of ['label', 'address', 'provider'] as const) {
    const value = raw[key];
    if (value === undefined) continue;
    if (typeof value !== 'string') {
      return { ok: false, code: 'FIELD_VALUE_LOCATION_MEMBER_TYPE' };
    }
    const normalized = value.trim().normalize('NFC');
    if (hasForbiddenControl(normalized)) {
      return { ok: false, code: 'FIELD_VALUE_LOCATION_MEMBER_CONTROL' };
    }
    if (normalized !== '') result[key] = normalized;
  }

  const lat = normalizeCoordinate(raw.lat, 'latitude');
  const lng = normalizeCoordinate(raw.lng, 'longitude');
  if (!lat.ok) return lat;
  if (!lng.ok) return lng;
  if ((lat.value === undefined) !== (lng.value === undefined)) {
    return { ok: false, code: 'FIELD_VALUE_LOCATION_COORDINATES_PAIR' };
  }
  if (lat.value !== undefined && lng.value !== undefined) {
    result.lat = lat.value;
    result.lng = lng.value;
  }

  if (raw.precision !== undefined) {
    if (
      raw.precision !== 'exact' &&
      raw.precision !== 'rooftop' &&
      raw.precision !== 'approximate'
    ) {
      return { ok: false, code: 'FIELD_VALUE_LOCATION_PRECISION_INVALID' };
    }
    result.precision = raw.precision;
  }

  if (Object.keys(result).length === 0) {
    return { ok: false, code: 'FIELD_VALUE_LOCATION_EMPTY' };
  }
  if (result.precision !== undefined && Object.keys(result).length === 1) {
    return { ok: false, code: 'FIELD_VALUE_LOCATION_PRECISION_ALONE' };
  }
  return { ok: true, value: result as LocationValue };
}

export function editorTextValue(value: JsonValue | undefined, field: Field): string {
  if (value === undefined || value === null) return '';
  if (field.type === 'checkbox') return value === true ? 'true' : 'false';
  if (Array.isArray(value))
    return value.filter((item): item is string => typeof item === 'string').join(', ');
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

function normalizeText(
  raw: unknown,
  maxLength: number,
  type: 'text' | 'longText',
): CellValueResult {
  const messages =
    type === 'text'
      ? {
          type: 'FIELD_VALUE_TEXT_TYPE' as const,
          control: 'FIELD_VALUE_TEXT_CONTROL' as const,
          tooLong: 'FIELD_VALUE_TEXT_TOO_LONG' as const,
        }
      : {
          type: 'FIELD_VALUE_LONG_TEXT_TYPE' as const,
          control: 'FIELD_VALUE_LONG_TEXT_CONTROL' as const,
          tooLong: 'FIELD_VALUE_LONG_TEXT_TOO_LONG' as const,
        };
  if (typeof raw !== 'string') return { ok: false, code: messages.type };
  const value = raw.normalize('NFC');
  if (hasForbiddenControl(value)) return { ok: false, code: messages.control };
  if ([...value].length > maxLength) return { ok: false, code: messages.tooLong };
  return { ok: true, value };
}

function normalizeNumber(raw: unknown): CellValueResult {
  if (typeof raw === 'number') {
    return Number.isFinite(raw)
      ? { ok: true, value: raw }
      : { ok: false, code: 'FIELD_VALUE_NUMBER_NOT_FINITE' };
  }
  if (typeof raw !== 'string') return { ok: false, code: 'FIELD_VALUE_NUMBER_NOT_NUMERIC' };
  const text = raw.trim();
  if (text === '') return { ok: true, value: null };
  const value = Number(text);
  return Number.isFinite(value)
    ? { ok: true, value }
    : { ok: false, code: 'FIELD_VALUE_NUMBER_NOT_FINITE' };
}

function normalizeCheckbox(raw: unknown): CellValueResult {
  if (typeof raw === 'boolean') return { ok: true, value: raw };
  if (raw === 'true' || raw === '1') return { ok: true, value: true };
  if (raw === 'false' || raw === '0') return { ok: true, value: false };
  return { ok: false, code: 'FIELD_VALUE_CHECKBOX_BOOLEAN' };
}

function normalizeDate(raw: unknown): CellValueResult {
  if (typeof raw !== 'string') return { ok: false, code: 'FIELD_VALUE_DATE_FORMAT' };
  const value = raw.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (match === null) return { ok: false, code: 'FIELD_VALUE_DATE_FORMAT' };
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return { ok: false, code: 'FIELD_VALUE_DATE_INVALID' };
  }
  return { ok: true, value };
}

function normalizeUrl(raw: unknown): CellValueResult {
  if (typeof raw !== 'string') return { ok: false, code: 'FIELD_VALUE_URL_ABSOLUTE' };
  const value = raw.trim();
  if (value.length === 0) return { ok: true, value: null };
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('protocol');
    const normalized = url.toString();
    return normalized.length <= 2_048
      ? { ok: true, value: normalized }
      : { ok: false, code: 'FIELD_VALUE_URL_TOO_LONG' };
  } catch {
    return { ok: false, code: 'FIELD_VALUE_URL_ABSOLUTE' };
  }
}

function normalizeSelect(field: SelectField, raw: unknown): CellValueResult {
  if (typeof raw !== 'string') return { ok: false, code: 'FIELD_VALUE_SELECT_OPTION_TYPE' };
  const value = raw.trim();
  if (value === '') return { ok: true, value: null };
  const valid = [...field.config.options, ...field.config.deletedOptions].some(
    (option) => option.id === value,
  );
  return valid ? { ok: true, value } : { ok: false, code: 'FIELD_VALUE_SELECT_OPTION_INVALID' };
}

function normalizeMultiSelect(field: SelectField, raw: unknown): CellValueResult {
  const values = Array.isArray(raw)
    ? raw
    : typeof raw === 'string'
      ? raw
          .split(',')
          .map((value) => value.trim())
          .filter((value) => value !== '')
      : null;
  if (values === null || !values.every((value): value is string => typeof value === 'string')) {
    return { ok: false, code: 'FIELD_VALUE_MULTI_SELECT_TYPE' };
  }
  const validOptions = new Set([
    ...field.config.options.map((option) => option.id),
    ...field.config.deletedOptions.map((option) => option.id),
  ]);
  const normalized = values.map((value) => value.trim());
  if (normalized.some((value) => value === '' || !validOptions.has(value))) {
    return { ok: false, code: 'FIELD_VALUE_MULTI_SELECT_INVALID' };
  }
  if (new Set(normalized).size !== normalized.length || normalized.length > 100) {
    return { ok: false, code: 'FIELD_VALUE_MULTI_SELECT_LIMIT' };
  }
  return { ok: true, value: normalized };
}

function hasForbiddenControl(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) || code === 0x7f;
  });
}

function normalizeCoordinate(
  raw: unknown,
  label: 'latitude' | 'longitude',
):
  | { readonly ok: true; readonly value: number | undefined }
  | {
      readonly ok: false;
      readonly code: 'FIELD_VALUE_LOCATION_LATITUDE_RANGE' | 'FIELD_VALUE_LOCATION_LONGITUDE_RANGE';
    } {
  if (raw === undefined || raw === '') return { ok: true, value: undefined };
  const value =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string' && raw.trim() !== ''
        ? Number(raw)
        : NaN;
  const maximum = label === 'latitude' ? 90 : 180;
  if (!Number.isFinite(value) || value < -maximum || value > maximum) {
    return {
      ok: false,
      code:
        label === 'latitude'
          ? 'FIELD_VALUE_LOCATION_LATITUDE_RANGE'
          : 'FIELD_VALUE_LOCATION_LONGITUDE_RANGE',
    };
  }
  return { ok: true, value };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
