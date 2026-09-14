import type { Field, JsonValue, MutationValue } from '../client/loomtable-client';
import type { Translator } from '../i18n';
import type { MessageKey } from '../i18n/messages';
import {
  defaultFieldRendererRegistry,
  type FieldEditorElement,
  type FieldRendererRegistry,
} from './field-renderer-registry';
import {
  describeFieldValueError,
  isEditableField,
  normalizeCellValue,
  normalizeLocationValue,
  type CellValueResult,
} from './field-value-editor';

import { ensureButtonLabels, labelContainer } from './a11y';
export interface RecordCreateFormOptions {
  readonly fields: readonly Field[];
  readonly translate: Translator;
  readonly registry?: FieldRendererRegistry;
  readonly offline?: boolean;
  readonly confirmDiscard?: (message: string) => boolean | Promise<boolean>;
  readonly onSubmit: (values: Readonly<Record<string, MutationValue>>) => void | Promise<void>;
  readonly onCancel: () => void;
}

export interface RecordCreateForm {
  readonly element: HTMLFormElement;
  setBusy(busy: boolean): void;
  showError(message: string, fieldId?: string): void;
}

interface FieldRow {
  readonly field: Field;
  readonly element: HTMLElement;
  readonly readValue: () => CellValueResult;
  readonly markInvalid: (invalid: boolean) => void;
  readonly focusControl: () => void;
  isTouched(): boolean;
}

export function createRecordCreateForm(options: RecordCreateFormOptions): RecordCreateForm {
  const translate = options.translate;
  const registry = options.registry ?? defaultFieldRendererRegistry;
  const confirmDiscard = options.confirmDiscard ?? ((message: string) => window.confirm(message));

  const root = document.createElement('form');
  root.className = 'loom-record-create';
  labelContainer(root, translate('record.create.title'));
  root.noValidate = true;
  root.dataset.busy = 'false';

  const fieldsHost = document.createElement('div');
  fieldsHost.className = 'loom-record-create-fields';
  root.append(fieldsHost);

  const rows: FieldRow[] = [];
  for (const field of options.fields) {
    const row = createFieldRow(field, options, registry, translate);
    fieldsHost.append(row.element);
    rows.push(row);
  }

  const error = document.createElement('div');
  error.className = 'loom-record-create-error';
  error.setAttribute('role', 'alert');
  error.setAttribute('aria-live', 'assertive');
  error.tabIndex = -1;
  error.hidden = true;
  root.append(error);

  const actions = document.createElement('div');
  actions.className = 'loom-record-create-actions';
  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'loom-record-create-submit loom-button';
  submit.textContent = translate('record.create.submit');
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'loom-record-create-cancel loom-button';
  cancel.textContent = translate('common.cancel');
  actions.append(submit, cancel);
  root.append(actions);

  if (options.offline === true) {
    submit.disabled = true;
    submit.title = translate('record.create.offline');
  }

  let busy = false;
  const setBusy = (value: boolean): void => {
    busy = value;
    root.dataset.busy = String(value);
    root.setAttribute('aria-busy', String(value));
    submit.disabled = value || options.offline === true;
    cancel.disabled = value;
  };

  root.addEventListener('submit', (event) => {
    event.preventDefault();
    if (busy || options.offline === true) return;

    const values: Record<string, MutationValue> = {};
    let firstInvalid: FieldRow | null = null;
    for (const row of rows) {
      row.markInvalid(false);
      if (!row.isTouched()) continue;
      const normalized = row.readValue();
      if (!normalized.ok) {
        row.markInvalid(true);
        const rowError = row.element.querySelector<HTMLElement>('.loom-record-create-field-error');
        if (rowError !== null) {
          rowError.textContent = describeFieldValueError(normalized.code, translate);
          rowError.hidden = false;
        }
        firstInvalid ??= row;
        continue;
      }
      values[row.field.id] = normalized.value;
    }
    if (firstInvalid !== null) {
      firstInvalid.focusControl();
      return;
    }

    error.hidden = true;
    setBusy(true);
    Promise.resolve(options.onSubmit(values))
      .catch((cause: unknown) => {
        const message =
          cause instanceof Error && cause.message.length > 0
            ? cause.message
            : translate('record.create.failed');
        error.textContent = message;
        error.hidden = false;
      })
      .finally(() => {
        if (root.isConnected) setBusy(false);
      });
  });

  cancel.addEventListener('click', () => {
    if (busy) return;
    if (!rows.some((row) => row.isTouched())) {
      options.onCancel();
      return;
    }
    void Promise.resolve(confirmDiscard(translate('record.create.discardConfirm'))).then(
      (confirmed) => {
        if (confirmed) options.onCancel();
      },
    );
  });

  return {
    element: root,
    setBusy,
    showError(message: string, fieldId?: string) {
      const target = fieldId === undefined ? null : rows.find((row) => row.field.id === fieldId);
      if (target !== null && target !== undefined) {
        target.markInvalid(true);
        const rowError = target.element.querySelector<HTMLElement>(
          '.loom-record-create-field-error',
        );
        if (rowError !== null) {
          rowError.textContent = message;
          rowError.hidden = false;
        }
        target.focusControl();
        return;
      }
      error.textContent = message;
      error.hidden = false;
      error.focus();
    },
  };
}

function createFieldRow(
  field: Field,
  options: RecordCreateFormOptions,
  registry: FieldRendererRegistry,
  translate: Translator,
): FieldRow {
  const wrapper = document.createElement('div');
  wrapper.className = 'loom-record-create-field';
  wrapper.dataset.fieldId = field.id;

  const label = document.createElement('label');
  label.className = 'loom-record-create-field-label';
  label.textContent = field.name;
  const labelId = `loom-create-label-${field.id}`;
  label.id = labelId;
  wrapper.append(label);

  const error = document.createElement('div');
  error.className = 'loom-record-create-field-error';
  error.setAttribute('role', 'alert');
  error.hidden = true;

  if (field.type === 'attachment') {
    const hint = document.createElement('span');
    hint.className = 'loom-record-create-field-hint';
    hint.textContent = translate('record.create.attachmentHint');
    wrapper.append(hint, error);
    return staticRow(field, wrapper);
  }

  if (field.type === 'location') {
    const editor = createLocationDraftEditor(translate);
    editor.element.setAttribute('aria-labelledby', labelId);
    wrapper.append(editor.element, error);
    return {
      field,
      element: wrapper,
      isTouched: () => editor.element.dataset.touched === 'true',
      readValue: () => {
        const normalized = normalizeLocationValue(editor.readDraft());
        if (!normalized.ok) {
          return normalized.code === 'FIELD_VALUE_LOCATION_EMPTY'
            ? { ok: true, value: null }
            : { ok: false, code: normalized.code };
        }
        return { ok: true, value: normalized.value };
      },
      markInvalid: (invalid) => markInvalid(wrapper, editor.element, invalid),
      focusControl: () => editor.focus(),
    };
  }

  if (!isEditableField(field)) {
    const unsupported = document.createElement('span');
    unsupported.className = 'loom-record-create-field-hint';
    unsupported.textContent = translate('record.value.unavailable');
    wrapper.append(unsupported, error);
    return staticRow(field, wrapper);
  }

  const editor = registry.createEditor(field, undefined, { translate });
  editor.setAttribute('aria-labelledby', labelId);
  error.id = fieldErrorId(field);
  editor.setAttribute('aria-describedby', error.id);
  let touched = false;
  const markTouched = (): void => {
    touched = true;
    wrapper.dataset.touched = 'true';
  };
  editor.addEventListener('input', markTouched);
  editor.addEventListener('change', markTouched);
  wrapper.append(editor, error);

  return {
    field,
    element: wrapper,
    isTouched: () => touched,
    readValue: () => normalizeCellValue(field, editorValue(editor)),
    markInvalid: (invalid) => markInvalid(wrapper, editor, invalid),
    focusControl: () => editor.focus(),
  };
}

function staticRow(field: Field, wrapper: HTMLElement): FieldRow {
  return {
    field,
    element: wrapper,
    isTouched: () => false,
    readValue: () => ({ ok: true, value: null }),
    markInvalid: () => undefined,
    focusControl: () => wrapper.focus(),
  };
}

function markInvalid(wrapper: HTMLElement, control: HTMLElement, invalid: boolean): void {
  wrapper.dataset.invalid = String(invalid);
  control.setAttribute('aria-invalid', String(invalid));
  if (invalid) return;
  const error = wrapper.querySelector<HTMLElement>('.loom-record-create-field-error');
  if (error !== null) {
    error.textContent = '';
    error.hidden = true;
  }
}

function fieldErrorId(field: Field): string {
  return `loom-create-error-${field.id}`;
}

function editorValue(editor: FieldEditorElement): JsonValue {
  if (editor instanceof HTMLInputElement && editor.type === 'checkbox') return editor.checked;
  if (editor instanceof HTMLSelectElement && editor.multiple) {
    return [...editor.selectedOptions].map((option) => option.value);
  }
  return editor.value;
}

interface LocationDraftEditor {
  readonly element: HTMLElement;
  readDraft(): Record<string, unknown>;
  focus(): void;
}

function createLocationDraftEditor(translate: Translator): LocationDraftEditor {
  const root = document.createElement('div');
  root.className = 'loom-record-create-location';
  root.dataset.touched = 'false';

  const entries: [keyof Omit<LocationDraftShape, 'precision'>, MessageKey][] = [
    ['label', 'record.location.label'],
    ['address', 'record.location.address'],
    ['provider', 'record.location.provider'],
    ['lat', 'record.location.lat'],
    ['lng', 'record.location.lng'],
  ];
  const inputs = new Map<keyof LocationDraftShape, HTMLInputElement>();
  for (const [key, messageKey] of entries) {
    const wrapper = document.createElement('label');
    wrapper.className = 'loom-record-create-location-field';
    const text = document.createElement('span');
    text.textContent = translate(messageKey);
    const input = document.createElement('input');
    input.dataset.locField = key;
    input.type = key === 'lat' || key === 'lng' ? 'number' : 'text';
    if (input.type === 'number') input.step = 'any';
    input.setAttribute('aria-label', translate(messageKey));
    input.addEventListener('input', () => {
      root.dataset.touched = 'true';
    });
    inputs.set(key, input);
    wrapper.append(text, input);
    root.append(wrapper);
  }
  const precision = document.createElement('select');
  precision.dataset.locField = 'precision';
  precision.setAttribute('aria-label', translate('record.location.precision'));
  const empty = document.createElement('option');
  empty.value = '';
  empty.textContent = translate('record.location.precision.none');
  precision.append(empty);
  const precisionLabels: Record<'exact' | 'rooftop' | 'approximate', MessageKey> = {
    exact: 'record.location.precision.exact',
    rooftop: 'record.location.precision.rooftop',
    approximate: 'record.location.precision.approximate',
  };
  for (const value of ['exact', 'rooftop', 'approximate'] as const) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = translate(precisionLabels[value]);
    precision.append(option);
  }
  precision.addEventListener('change', () => {
    root.dataset.touched = 'true';
  });
  const precisionWrapper = document.createElement('label');
  precisionWrapper.className = 'loom-record-create-location-field';
  const precisionText = document.createElement('span');
  precisionText.textContent = translate('record.location.precision');
  precisionWrapper.append(precisionText, precision);
  root.append(precisionWrapper);

  ensureButtonLabels(root);
  return {
    element: root,
    readDraft() {
      const draft: Record<string, unknown> = {};
      for (const [key, input] of inputs) {
        const value = input.value.trim();
        if (value !== '') draft[key] = value;
      }
      if (precision.value !== '') draft.precision = precision.value;
      return draft;
    },
    focus() {
      inputs.get('label')?.focus();
    },
  };
}

type LocationDraftShape = {
  readonly label: string;
  readonly address: string;
  readonly provider: string;
  readonly lat: string;
  readonly lng: string;
  readonly precision: string;
};
