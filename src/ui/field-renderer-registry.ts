import type { Field, FieldBase, JsonValue, SelectFieldConfig } from '../client/loomtable-client';
import type { Translator } from '../i18n';

type SelectField = FieldBase & { readonly type: 'select'; readonly config: SelectFieldConfig };
type MultiSelectField = FieldBase & {
  readonly type: 'multiSelect';
  readonly config: SelectFieldConfig;
};

export type FieldType = Field['type'];

export type FieldEditorKind =
  'text' | 'longText' | 'number' | 'checkbox' | 'date' | 'url' | 'select' | 'multiSelect' | 'none';

export type FieldEditorCapability =
  | {
      readonly kind: Exclude<FieldEditorKind, 'none' | 'multiSelect'>;
      readonly status: 'available';
    }
  | {
      readonly kind: 'multiSelect';
      readonly status: 'deferred';
    }
  | {
      readonly kind: 'none';
      readonly status: 'unavailable';
    };

export interface FieldCapability {
  readonly renderer: FieldType;
  readonly editor: FieldEditorCapability;
}

export type FieldDisplayState =
  | 'value'
  | 'empty'
  | 'unset'
  | 'cleared'
  | 'located'
  | 'unlocated'
  | 'unrenderable'
  | 'unavailable';

export interface RenderedFieldValue {
  readonly state: FieldDisplayState;
  readonly text: string;
  readonly ariaLabel: string;
}

export interface FieldRenderContext {
  readonly translate: Translator;
}

export interface FieldRendererRegistry {
  capability(field: Field): FieldCapability;
  render(
    field: Field,
    value: JsonValue | undefined,
    context: FieldRenderContext,
  ): RenderedFieldValue;
}

const MAX_RENDERABLE_LATITUDE = 85.0511287798066;

const CAPABILITIES: { readonly [Type in FieldType]: FieldCapability } = {
  text: { renderer: 'text', editor: { kind: 'text', status: 'available' } },
  longText: { renderer: 'longText', editor: { kind: 'longText', status: 'available' } },
  number: { renderer: 'number', editor: { kind: 'number', status: 'available' } },
  checkbox: { renderer: 'checkbox', editor: { kind: 'checkbox', status: 'available' } },
  date: { renderer: 'date', editor: { kind: 'date', status: 'available' } },
  url: { renderer: 'url', editor: { kind: 'url', status: 'available' } },
  select: { renderer: 'select', editor: { kind: 'select', status: 'available' } },
  multiSelect: { renderer: 'multiSelect', editor: { kind: 'multiSelect', status: 'deferred' } },
  location: { renderer: 'location', editor: { kind: 'none', status: 'unavailable' } },
  attachment: { renderer: 'attachment', editor: { kind: 'none', status: 'unavailable' } },
};

export function createFieldRendererRegistry(): FieldRendererRegistry {
  return {
    capability(field) {
      return CAPABILITIES[field.type];
    },
    render(field, value, context) {
      return renderFieldValue(field, value, context.translate);
    },
  };
}

export const defaultFieldRendererRegistry = createFieldRendererRegistry();

export function renderFieldValue(
  field: Field,
  value: JsonValue | undefined,
  translate: Translator,
): RenderedFieldValue {
  if (value === undefined) return rendered('unset', translate('record.field.unset'));
  if (value === null) return rendered('cleared', translate('record.field.cleared'));

  switch (field.type) {
    case 'text':
    case 'longText':
      return renderText(value, translate);
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
        ? renderedValue(String(value))
        : unavailable(translate);
    case 'checkbox':
      if (typeof value !== 'boolean') return unavailable(translate);
      return renderedValue(
        value ? translate('grid.cell.checked') : translate('grid.cell.unchecked'),
      );
    case 'date':
      return typeof value === 'string' && value !== ''
        ? renderedValue(value)
        : unavailable(translate);
    case 'url':
      return typeof value === 'string' && value !== ''
        ? renderedValue(value)
        : unavailable(translate);
    case 'select':
      return renderSelectValue(field as SelectField, value, translate);
    case 'multiSelect':
      return renderMultiSelectValue(field as MultiSelectField, value, translate);
    case 'location':
      return renderLocationValue(value, translate);
    case 'attachment':
      return renderAttachmentValue(value, translate);
  }
}

function renderText(value: JsonValue, translate: Translator): RenderedFieldValue {
  return typeof value === 'string'
    ? renderedNaturalString(value, translate)
    : unavailable(translate);
}

function renderSelectValue(
  field: SelectField,
  value: JsonValue,
  translate: Translator,
): RenderedFieldValue {
  if (typeof value !== 'string') return optionUnavailable(translate);
  const option = findOption(field, value);
  if (option === null) return optionUnavailable(translate);
  return renderedValue(
    option.deleted ? `${option.name} (${translate('record.option.deleted')})` : option.name,
  );
}

function renderMultiSelectValue(
  field: MultiSelectField,
  value: JsonValue,
  translate: Translator,
): RenderedFieldValue {
  if (!Array.isArray(value)) return optionUnavailable(translate);
  if (value.length === 0) return empty(translate);
  const labels: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') return optionUnavailable(translate);
    const option = findOption(field, item);
    if (option === null) return optionUnavailable(translate);
    labels.push(
      option.deleted ? `${option.name} (${translate('record.option.deleted')})` : option.name,
    );
  }
  return renderedValue(labels.join(', '));
}

function findOption(
  field: SelectField | MultiSelectField,
  id: string,
): { readonly name: string; readonly deleted: boolean } | null {
  const active = field.config.options.find((option) => option.id === id);
  if (active !== undefined) return { name: active.name, deleted: false };
  const deleted = field.config.deletedOptions.find((option) => option.id === id);
  return deleted === undefined ? null : { name: deleted.name, deleted: true };
}

function renderLocationValue(value: JsonValue, translate: Translator): RenderedFieldValue {
  if (!isJsonObject(value)) return unavailable(translate);
  const lat = value.lat;
  const lng = value.lng;
  if (
    typeof lat !== 'number' ||
    typeof lng !== 'number' ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180
  ) {
    return rendered('unlocated', translate('record.location.unlocated'));
  }
  if (Math.abs(lat) > MAX_RENDERABLE_LATITUDE || Math.abs(lng) > 180) {
    return rendered('unrenderable', translate('record.location.unrenderable'));
  }
  const label = firstNonEmptyString(value.label, value.address);
  return rendered('located', label ?? `${lat}, ${lng}`);
}

function renderAttachmentValue(value: JsonValue, translate: Translator): RenderedFieldValue {
  if (!isJsonArray(value)) return unavailable(translate);
  if (value.length === 0) return empty(translate);
  const attachments = value
    .map((item) => formatAttachment(item, translate))
    .filter((item): item is string => item !== null);
  return attachments.length === value.length
    ? renderedValue(attachments.join(', '))
    : unavailable(translate);
}

function formatAttachment(value: JsonValue, translate: Translator): string | null {
  if (!isJsonObject(value) || typeof value.filename !== 'string' || value.filename === '') {
    return null;
  }
  const parts = [value.filename];
  if (typeof value.mimeType === 'string' && value.mimeType !== '') {
    parts.push(`${translate('record.attachment.type')}: ${value.mimeType}`);
  }
  if (typeof value.size === 'number' && Number.isFinite(value.size) && value.size >= 0) {
    parts.push(`${translate('record.attachment.size')}: ${formatAttachmentSize(value.size)}`);
  }
  return parts.join(' · ');
}

function formatAttachmentSize(size: number): string {
  const units = ['B', 'KB', 'MB', 'GB'] as const;
  let value = size;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const formatted = Number.isInteger(value) ? String(value) : value.toFixed(1);
  return `${formatted} ${units[unitIndex]}`;
}

function renderedNaturalString(value: string, translate: Translator): RenderedFieldValue {
  return value === '' ? empty(translate) : renderedValue(value);
}

function renderedValue(text: string): RenderedFieldValue {
  return { state: 'value', text, ariaLabel: text };
}

function rendered(state: FieldDisplayState, text: string): RenderedFieldValue {
  return { state, text, ariaLabel: text };
}

function empty(translate: Translator): RenderedFieldValue {
  return rendered('empty', translate('common.emptyValue'));
}

function unavailable(translate: Translator): RenderedFieldValue {
  return rendered('unavailable', translate('record.value.unavailable'));
}

function optionUnavailable(translate: Translator): RenderedFieldValue {
  return rendered('unavailable', translate('record.option.unavailable'));
}

function firstNonEmptyString(...values: (JsonValue | undefined)[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim() !== '') return value;
  }
  return null;
}

function isJsonObject(value: JsonValue): value is Readonly<Record<string, JsonValue>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isJsonArray(value: JsonValue): value is readonly JsonValue[] {
  return Array.isArray(value);
}
