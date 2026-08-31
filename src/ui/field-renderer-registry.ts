import type { Field, FieldBase, JsonValue, SelectFieldConfig } from '../client/loomtable-client';
import type { Translator } from '../i18n';
import { editorTextValue } from './field-value-editor';

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
      readonly status: 'available';
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

export type FieldChipState = 'value' | 'deleted';

export interface RenderedFieldChip {
  readonly state: FieldChipState;
  readonly text: string;
  readonly ariaLabel: string;
  readonly statusText?: string;
}

export interface RenderedFieldValue {
  readonly state: FieldDisplayState;
  readonly text: string;
  readonly ariaLabel: string;
  readonly chips?: readonly RenderedFieldChip[];
}

export interface FieldRenderContext {
  readonly translate: Translator;
}

export type FieldEditorElement = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

export interface FieldRendererRegistry {
  capability(field: Field): FieldCapability;
  render(
    field: Field,
    value: JsonValue | undefined,
    context: FieldRenderContext,
  ): RenderedFieldValue;
  createEditor(
    field: Field,
    value: JsonValue | undefined,
    context: FieldRenderContext,
  ): FieldEditorElement;
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
  multiSelect: { renderer: 'multiSelect', editor: { kind: 'multiSelect', status: 'available' } },
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
    createEditor(field, value, context) {
      return createFieldEditor(field, value, context);
    },
  };
}

export const defaultFieldRendererRegistry = createFieldRendererRegistry();

const UNAVAILABLE_OPTION_VALUE = '\u0000loomtable-option-unavailable';

export function createFieldEditor(
  field: Field,
  value: JsonValue | undefined,
  context: FieldRenderContext,
): FieldEditorElement {
  const editorKind = CAPABILITIES[field.type].editor.kind;
  if (editorKind === 'longText') {
    const editor = document.createElement('textarea');
    editor.value = editorTextValue(value, field);
    editor.setAttribute('aria-label', field.name);
    return editor;
  }
  if (field.type === 'select') {
    return createSelectEditor(field as SelectField, value, context.translate);
  }
  if (field.type === 'multiSelect') {
    return createMultiSelectEditor(field as MultiSelectField, value, context.translate);
  }
  if (editorKind === 'checkbox') {
    const editor = document.createElement('input');
    editor.type = 'checkbox';
    editor.checked = value === true;
    editor.setAttribute('aria-label', field.name);
    return editor;
  }
  const editor = document.createElement('input');
  editor.type =
    editorKind === 'number' || editorKind === 'date' || editorKind === 'url' ? editorKind : 'text';
  editor.value = editorTextValue(value, field);
  editor.setAttribute('aria-label', field.name);
  return editor;
}

function createSelectEditor(
  field: SelectField,
  value: JsonValue | undefined,
  translate: Translator,
): HTMLSelectElement {
  const editor = document.createElement('select');
  editor.setAttribute('aria-label', field.name);
  appendOption(editor, '', translate('common.emptyValue'), 'empty');
  for (const option of field.config.options) {
    appendOption(editor, option.id, option.name, 'value');
  }
  for (const option of field.config.deletedOptions) {
    appendOption(
      editor,
      option.id,
      `${option.name} (${translate('record.option.deleted')})`,
      'deleted',
    );
  }

  if (typeof value === 'string') {
    const selected = value.trim();
    if (selected !== '' && !hasOption(field, selected)) {
      appendOption(
        editor,
        UNAVAILABLE_OPTION_VALUE,
        translate('record.option.unavailable'),
        'unavailable',
      );
      editor.value = UNAVAILABLE_OPTION_VALUE;
    } else {
      editor.value = selected;
    }
  } else if (value !== undefined && value !== null) {
    appendOption(
      editor,
      UNAVAILABLE_OPTION_VALUE,
      translate('record.option.unavailable'),
      'unavailable',
    );
    editor.value = UNAVAILABLE_OPTION_VALUE;
  }
  return editor;
}

function createMultiSelectEditor(
  field: MultiSelectField,
  value: JsonValue | undefined,
  translate: Translator,
): HTMLSelectElement {
  const editor = document.createElement('select');
  editor.multiple = true;
  editor.setAttribute('aria-multiselectable', 'true');
  editor.setAttribute('aria-label', field.name);
  for (const option of field.config.options) {
    appendOption(editor, option.id, option.name, 'value');
  }
  for (const option of field.config.deletedOptions) {
    appendOption(
      editor,
      option.id,
      `${option.name} (${translate('record.option.deleted')})`,
      'deleted',
    );
  }

  const selectedValues = Array.isArray(value)
    ? value
    : value === undefined || value === null
      ? []
      : null;
  let hasUnavailable = selectedValues === null;
  if (selectedValues !== null) {
    for (const item of selectedValues) {
      if (typeof item !== 'string' || !hasOption(field, item)) {
        hasUnavailable = true;
        continue;
      }
      const option = [...editor.options].find((candidate) => candidate.value === item);
      if (option !== undefined) option.selected = true;
    }
  }
  if (hasUnavailable) {
    const unavailable = appendOption(
      editor,
      UNAVAILABLE_OPTION_VALUE,
      translate('record.option.unavailable'),
      'unavailable',
    );
    unavailable.selected = true;
  }
  return editor;
}

function appendOption(
  select: HTMLSelectElement,
  value: string,
  text: string,
  state: 'empty' | 'value' | 'deleted' | 'unavailable',
): HTMLOptionElement {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = text;
  option.dataset.optionState = state;
  option.setAttribute('aria-label', text);
  if (state === 'unavailable') option.disabled = true;
  select.append(option);
  return option;
}

function hasOption(field: SelectField | MultiSelectField, id: string): boolean {
  return [...field.config.options, ...field.config.deletedOptions].some(
    (option) => option.id === id,
  );
}

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

export function createRenderedFieldValueElement(rendered: RenderedFieldValue): HTMLElement {
  const root = document.createElement('span');
  root.className = 'loom-field-value';
  root.dataset.valueState = rendered.state;
  if (rendered.chips === undefined) {
    root.setAttribute('aria-label', rendered.ariaLabel);
    root.textContent = rendered.text;
    return root;
  }

  const list = document.createElement('span');
  list.className = 'loom-field-value-chips';
  list.setAttribute('role', 'list');
  list.setAttribute('aria-label', rendered.ariaLabel);
  for (const chip of rendered.chips) {
    const element = document.createElement('span');
    element.className = 'loom-field-value-chip';
    element.dataset.chipState = chip.state;
    element.setAttribute('role', 'listitem');
    element.setAttribute('aria-label', chip.ariaLabel);
    element.append(document.createTextNode(chip.text));
    if (chip.statusText !== undefined) {
      const status = document.createElement('span');
      status.className = 'loom-field-value-chip-status';
      status.textContent = ` (${chip.statusText})`;
      element.append(status);
    }
    list.append(element, document.createTextNode(' '));
  }
  root.append(list);
  return root;
}

function renderMultiSelectValue(
  field: MultiSelectField,
  value: JsonValue,
  translate: Translator,
): RenderedFieldValue {
  if (!Array.isArray(value)) return optionUnavailable(translate);
  if (value.length === 0) return empty(translate);
  const labels: string[] = [];
  const chips: RenderedFieldChip[] = [];
  for (const item of value) {
    if (typeof item !== 'string') return optionUnavailable(translate);
    const option = findOption(field, item);
    if (option === null) return optionUnavailable(translate);
    const statusText = option.deleted ? translate('record.option.deleted') : undefined;
    const ariaLabel = statusText === undefined ? option.name : `${option.name} (${statusText})`;
    labels.push(ariaLabel);
    chips.push({
      state: option.deleted ? 'deleted' : 'value',
      text: option.name,
      ariaLabel,
      ...(statusText === undefined ? {} : { statusText }),
    });
  }
  return {
    state: 'value',
    text: labels.join(', '),
    ariaLabel: labels.join(', '),
    chips,
  };
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
