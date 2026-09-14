import type { Field, JsonValue } from '../client/loomtable-client';
import { normalizeCellValue, type CellValueResult } from './field-value-editor';

export interface GridClipboardHost {
  readonly writeText: (text: string) => Promise<void>;
  readonly readText: () => Promise<string>;
}

type SelectOption = { readonly id: string; readonly name: string };

function selectOptions(field: Field): readonly SelectOption[] {
  if (field.type !== 'select' && field.type !== 'multiSelect') return [];
  const config = field.config as {
    readonly options?: readonly SelectOption[];
    readonly deletedOptions?: readonly SelectOption[];
  };
  return [...(config.options ?? []), ...(config.deletedOptions ?? [])];
}

function optionName(field: Field, id: string): string {
  return selectOptions(field).find((option) => option.id === id)?.name ?? id;
}

function resolveOptionId(field: Field, raw: string): string | null {
  const options = selectOptions(field);
  const trimmed = raw.trim();
  const byId = options.find((option) => option.id === trimmed);
  if (byId !== undefined) return byId.id;
  const byName = options.filter((option) => option.name === trimmed);
  return byName.length === 1 ? byName[0]!.id : null;
}

export function serializeCellForClipboard(
  field: Field,
  value: JsonValue | undefined,
): string | null {
  if (value === undefined || value === null) return '';
  switch (field.type) {
    case 'text':
    case 'longText':
    case 'url':
    case 'date':
      return typeof value === 'string' ? value : null;
    case 'number':
      return typeof value === 'number' ? String(value) : null;
    case 'checkbox':
      return value === true ? 'true' : 'false';
    case 'select':
      return typeof value === 'string' ? optionName(field, value) : null;
    case 'multiSelect':
      if (!Array.isArray(value)) return null;
      return value
        .filter((entry): entry is string => typeof entry === 'string')
        .map((id) => optionName(field, id))
        .join(', ');
    case 'location':
    case 'attachment':
      return null;
  }
}

export function parseClipboardValue(field: Field, text: string): CellValueResult {
  const trimmed = text.trim();
  if (trimmed === '') return { ok: true, value: null };
  if (field.type === 'select') {
    const optionId = resolveOptionId(field, trimmed);
    if (optionId === null) return { ok: false, code: 'FIELD_VALUE_SELECT_OPTION_INVALID' };
    return normalizeCellValue(field, optionId);
  }
  if (field.type === 'multiSelect') {
    const ids: string[] = [];
    for (const part of trimmed.split(',')) {
      const optionId = resolveOptionId(field, part);
      if (optionId === null) return { ok: false, code: 'FIELD_VALUE_MULTI_SELECT_INVALID' };
      ids.push(optionId);
    }
    return normalizeCellValue(field, ids);
  }
  return normalizeCellValue(field, trimmed);
}
