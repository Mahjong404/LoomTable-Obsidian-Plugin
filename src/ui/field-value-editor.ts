import type { Field, JsonValue, MutationValue } from '../client/loomtable-client';

type SelectField = Field & {
  readonly type: 'select' | 'multiSelect';
  readonly config: {
    readonly options: readonly { readonly id: string }[];
    readonly deletedOptions: readonly { readonly id: string }[];
  };
};

export type EditableFieldType =
  'text' | 'longText' | 'number' | 'checkbox' | 'date' | 'url' | 'select' | 'multiSelect';

export interface CellValueSuccess {
  readonly ok: true;
  readonly value: MutationValue;
}

export interface CellValueFailure {
  readonly ok: false;
  readonly message: string;
}

export type CellValueResult = CellValueSuccess | CellValueFailure;

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
      return normalizeText(raw, 10_000, 'Text');
    case 'longText':
      return normalizeText(raw, 100_000, 'LongText');
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
      return { ok: false, message: `${field.type} cells are edited from Record details.` };
  }
}

export function editorTextValue(value: JsonValue | undefined, field: Field): string {
  if (value === undefined || value === null) return '';
  if (field.type === 'checkbox') return value === true ? 'true' : 'false';
  if (Array.isArray(value))
    return value.filter((item): item is string => typeof item === 'string').join(', ');
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

function normalizeText(raw: unknown, maxLength: number, label: string): CellValueResult {
  if (typeof raw !== 'string') return { ok: false, message: `${label} must be text.` };
  const value = raw.normalize('NFC');
  if (hasForbiddenControl(value)) {
    return { ok: false, message: `${label} contains unsupported control characters.` };
  }
  if ([...value].length > maxLength) {
    return { ok: false, message: `${label} is too long.` };
  }
  return { ok: true, value };
}

function normalizeNumber(raw: unknown): CellValueResult {
  if (typeof raw === 'number') {
    return Number.isFinite(raw)
      ? { ok: true, value: raw }
      : { ok: false, message: 'Number must be finite.' };
  }
  if (typeof raw !== 'string') return { ok: false, message: 'Number must be numeric.' };
  const text = raw.trim();
  if (text === '') return { ok: true, value: null };
  const value = Number(text);
  return Number.isFinite(value)
    ? { ok: true, value }
    : { ok: false, message: 'Number must be finite.' };
}

function normalizeCheckbox(raw: unknown): CellValueResult {
  if (typeof raw === 'boolean') return { ok: true, value: raw };
  if (raw === 'true' || raw === '1') return { ok: true, value: true };
  if (raw === 'false' || raw === '0') return { ok: true, value: false };
  return { ok: false, message: 'Checkbox must be true or false.' };
}

function normalizeDate(raw: unknown): CellValueResult {
  if (typeof raw !== 'string') return { ok: false, message: 'Date must use YYYY-MM-DD.' };
  const value = raw.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (match === null) return { ok: false, message: 'Date must use YYYY-MM-DD.' };
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return { ok: false, message: 'Date is not a valid Gregorian date.' };
  }
  return { ok: true, value };
}

function normalizeUrl(raw: unknown): CellValueResult {
  if (typeof raw !== 'string')
    return { ok: false, message: 'URL must be an absolute HTTP(S) URL.' };
  const value = raw.trim();
  if (value.length === 0) return { ok: true, value: null };
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('protocol');
    const normalized = url.toString();
    return normalized.length <= 2_048
      ? { ok: true, value: normalized }
      : { ok: false, message: 'URL is too long.' };
  } catch {
    return { ok: false, message: 'URL must be an absolute HTTP(S) URL.' };
  }
}

function normalizeSelect(field: SelectField, raw: unknown): CellValueResult {
  if (typeof raw !== 'string') return { ok: false, message: 'Select value must be an option.' };
  const value = raw.trim();
  if (value === '') return { ok: true, value: null };
  const valid = [...field.config.options, ...field.config.deletedOptions].some(
    (option) => option.id === value,
  );
  return valid ? { ok: true, value } : { ok: false, message: 'Select option is not valid.' };
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
    return { ok: false, message: 'Multi-select value must contain option IDs.' };
  }
  const validOptions = new Set([
    ...field.config.options.map((option) => option.id),
    ...field.config.deletedOptions.map((option) => option.id),
  ]);
  const normalized = values.map((value) => value.trim());
  if (normalized.some((value) => value === '' || !validOptions.has(value))) {
    return { ok: false, message: 'Multi-select contains an invalid option.' };
  }
  if (new Set(normalized).size !== normalized.length || normalized.length > 100) {
    return {
      ok: false,
      message: 'Multi-select options must be unique and contain at most 100 items.',
    };
  }
  return { ok: true, value: normalized };
}

function hasForbiddenControl(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) || code === 0x7f;
  });
}
