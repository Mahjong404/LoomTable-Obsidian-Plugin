import type { Field, JsonValue, LocationValue, LoomTableRecord } from '../client/loomtable-client';
import type { Translator } from '../i18n';
import { normalizeLocationValue, type LocationEditIntent } from './field-value-editor';

export interface RecordDetailCallbacks {
  readonly onClose?: () => void;
  readonly onLocationEdit?: (
    recordId: string,
    fieldId: string,
    intent: LocationEditIntent,
    record?: LoomTableRecord,
  ) => void | Promise<void>;
  readonly onOpenLocationInMap?: (
    recordId: string,
    fieldId: string,
    location: LocationValue,
  ) => void | Promise<void>;
  readonly onCopyCoordinates?: (
    recordId: string,
    fieldId: string,
    coordinates: { readonly lat: number; readonly lng: number },
  ) => void | Promise<void>;
  readonly getConflict?: (recordId: string) => RecordConflictView | undefined;
  readonly onConflictAction?: (
    recordId: string,
    action: 'use-server' | 'overwrite',
  ) => void | Promise<void>;
}

export interface RecordConflictView {
  readonly currentRevision: number;
  readonly currentValues: Readonly<Record<string, JsonValue>>;
  readonly submittedSet?: Readonly<Record<string, JsonValue>>;
  readonly message: string;
}

export interface RecordDetailOptions {
  readonly translate: Translator;
  readonly fields: readonly Field[];
  readonly offline?: boolean;
  readonly callbacks?: RecordDetailCallbacks;
}

export function createRecordDetail(
  record: LoomTableRecord,
  options: RecordDetailOptions,
): HTMLElement {
  const root = document.createElement('section');
  root.className = 'loom-record-detail';

  const header = document.createElement('div');
  header.className = 'loom-record-detail-header';
  header.append(createText('strong', `${options.translate('record.details')}: ${record.id}`));
  if (options.callbacks?.onClose !== undefined) {
    const close = button(options.translate('common.close'));
    close.setAttribute('aria-label', options.translate('common.close'));
    close.addEventListener('click', options.callbacks.onClose);
    header.append(close);
  }
  root.append(header);

  const fields = options.fields.length > 0 ? options.fields : fallbackFields(record);
  const values = document.createElement('dl');
  values.className = 'loom-record-fields';
  for (const field of fields) {
    values.append(...renderField(record, field, options));
  }
  root.append(values);
  return root;
}

function renderField(
  record: LoomTableRecord,
  field: Field,
  options: RecordDetailOptions,
): HTMLElement[] {
  const value = record.values[field.id];
  const label = createText('dt', field.name);
  label.dataset.fieldId = field.id;
  const body = document.createElement('dd');
  body.dataset.fieldId = field.id;

  if (field.type === 'location') {
    body.append(renderLocationValue(record, field, value, options));
  } else {
    body.textContent = formatValue(value, options.translate);
  }
  return [label, body];
}

function renderLocationValue(
  record: LoomTableRecord,
  field: Field,
  raw: JsonValue | undefined,
  options: RecordDetailOptions,
): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'loom-location-field';

  if (raw === undefined) {
    wrapper.append(createText('span', options.translate('record.field.unset')));
  } else if (raw === null) {
    wrapper.append(createText('span', options.translate('record.field.cleared')));
  } else if (isLocationValue(raw)) {
    const location = raw;
    const details = document.createElement('dl');
    details.className = 'loom-location-values';
    for (const [key, messageKey] of [
      ['label', 'record.location.label'],
      ['address', 'record.location.address'],
      ['provider', 'record.location.provider'],
      ['lat', 'record.location.lat'],
      ['lng', 'record.location.lng'],
      ['precision', 'record.location.precision'],
    ] as const) {
      const item = location[key];
      if (item === undefined) continue;
      const text =
        typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean'
          ? String(item)
          : JSON.stringify(item);
      details.append(createText('dt', options.translate(messageKey)), createText('dd', text));
    }
    wrapper.append(details);
    const coordinates = coordinatesFrom(location);
    if (coordinates !== null) {
      const open = button(options.translate('record.location.openMap'));
      open.classList.add('loom-location-open-map');
      open.addEventListener(
        'click',
        () => void options.callbacks?.onOpenLocationInMap?.(record.id, field.id, location),
      );
      const copy = button(options.translate('record.location.copy'));
      copy.classList.add('loom-location-copy');
      copy.setAttribute('aria-label', options.translate('record.location.copy'));
      copy.addEventListener('click', () => {
        void copyCoordinates(record, field, coordinates, copy, options);
      });
      wrapper.append(open, copy, createPreviewTrigger(coordinates, options.translate));
    }
  } else {
    wrapper.append(createText('span', formatValue(raw, options.translate)));
  }

  const edit = button(options.translate('record.location.edit'));
  edit.classList.add('loom-location-edit');
  edit.disabled = options.offline === true || options.callbacks?.onLocationEdit === undefined;
  edit.addEventListener('click', () => {
    if (options.callbacks?.onLocationEdit === undefined) return;
    const editor = createLocationEditor(record, field, raw, options);
    wrapper.replaceChildren(editor);
  });
  wrapper.append(edit);
  return wrapper;
}

async function copyCoordinates(
  record: LoomTableRecord,
  field: Field,
  coordinates: { readonly lat: number; readonly lng: number },
  buttonElement: HTMLButtonElement,
  options: RecordDetailOptions,
): Promise<void> {
  try {
    if (options.callbacks?.onCopyCoordinates !== undefined) {
      await options.callbacks.onCopyCoordinates(record.id, field.id, coordinates);
    } else if (navigator.clipboard?.writeText !== undefined) {
      await navigator.clipboard.writeText(`${coordinates.lat}, ${coordinates.lng}`);
    } else {
      throw new Error(options.translate('record.location.copyUnavailable'));
    }
    buttonElement.textContent = options.translate('record.location.copied');
  } catch (cause) {
    buttonElement.textContent = cause instanceof Error ? cause.message : String(cause);
  }
}

function createLocationEditor(
  record: LoomTableRecord,
  field: Field,
  raw: JsonValue | undefined,
  options: RecordDetailOptions,
): HTMLElement {
  const root = document.createElement('form');
  root.className = 'loom-location-editor';
  root.setAttribute('aria-label', options.translate('record.location.edit'));

  const location = raw !== undefined && isLocationValue(raw) ? raw : {};
  const label = inputField(
    options.translate('record.location.label'),
    'text',
    textInputValue(location.label),
  );
  const address = inputField(
    options.translate('record.location.address'),
    'text',
    textInputValue(location.address),
  );
  const provider = inputField(
    options.translate('record.location.provider'),
    'text',
    textInputValue(location.provider),
  );
  const lat = inputField(
    options.translate('record.location.lat'),
    'number',
    numberInputValue(location.lat),
  );
  lat.input.step = 'any';
  lat.input.min = '-90';
  lat.input.max = '90';
  const lng = inputField(
    options.translate('record.location.lng'),
    'number',
    numberInputValue(location.lng),
  );
  lng.input.step = 'any';
  lng.input.min = '-180';
  lng.input.max = '180';
  const precision = document.createElement('select');
  precision.name = 'precision';
  precision.setAttribute('aria-label', options.translate('record.location.precision'));
  const emptyPrecision = document.createElement('option');
  emptyPrecision.value = '';
  emptyPrecision.textContent = '—';
  precision.append(emptyPrecision);
  for (const value of ['exact', 'rooftop', 'approximate'] as const) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    option.selected = location.precision === value;
    precision.append(option);
  }
  root.append(
    label.wrapper,
    address.wrapper,
    provider.wrapper,
    lat.wrapper,
    lng.wrapper,
    fieldWrapper(options.translate('record.location.precision'), precision),
  );

  const error = document.createElement('p');
  error.className = 'loom-location-editor-error';
  error.setAttribute('role', 'alert');
  root.append(error);

  const actions = document.createElement('div');
  actions.className = 'loom-location-editor-actions';
  const save = button(options.translate('common.save'));
  save.type = 'submit';
  const clear = button(options.translate('record.location.clear'));
  const unset = button(options.translate('record.location.unset'));
  const cancel = button(options.translate('common.close'));
  actions.append(save, clear, unset, cancel);
  root.append(actions);

  const submit = async (intent: LocationEditIntent): Promise<void> => {
    try {
      await options.callbacks?.onLocationEdit?.(record.id, field.id, intent, record);
      const nextValue =
        intent.kind === 'unset' ? undefined : intent.kind === 'clear' ? null : intent.value;
      root.replaceWith(renderLocationValue(record, field, nextValue, options));
    } catch (cause) {
      error.textContent = cause instanceof Error ? cause.message : String(cause);
      const conflict = options.callbacks?.getConflict?.(record.id);
      if (conflict !== undefined) {
        root.querySelector('.loom-record-conflict')?.remove();
        root.append(renderConflict(record.id, conflict, options));
      }
    }
  };
  root.addEventListener('submit', (event) => {
    event.preventDefault();
    const candidate: Record<string, unknown> = {};
    addText(candidate, 'label', label.input.value);
    addText(candidate, 'address', address.input.value);
    addText(candidate, 'provider', provider.input.value);
    addNumber(candidate, 'lat', lat.input.value);
    addNumber(candidate, 'lng', lng.input.value);
    if (precision.value !== '') candidate.precision = precision.value;
    const normalized = normalizeLocationValue(candidate);
    if (!normalized.ok) {
      error.textContent = normalized.message;
      return;
    }
    void submit({ kind: 'set', value: normalized.value as LocationValue });
  });
  clear.addEventListener('click', () => void submit({ kind: 'clear' }));
  unset.addEventListener('click', () => void submit({ kind: 'unset' }));
  cancel.addEventListener('click', (event) => {
    event.preventDefault();
    root.replaceWith(renderLocationValue(record, field, raw, options));
  });
  if (options.offline === true) {
    for (const action of [save, clear, unset]) action.disabled = true;
  }
  return root;
}

function renderConflict(
  recordId: string,
  conflict: RecordConflictView,
  options: RecordDetailOptions,
): HTMLElement {
  const box = document.createElement('section');
  box.className = 'loom-record-conflict';
  box.append(
    createText('strong', options.translate('record.conflict')),
    createText('p', conflict.message),
  );
  const values = document.createElement('pre');
  values.textContent = JSON.stringify(
    {
      currentRevision: conflict.currentRevision,
      currentValues: conflict.currentValues,
      submittedSet: conflict.submittedSet,
    },
    null,
    2,
  );
  box.append(values);
  const actions = document.createElement('div');
  actions.className = 'loom-record-conflict-actions';
  const useServer = button(options.translate('record.useServer'));
  const overwrite = button(options.translate('record.overwrite'));
  overwrite.classList.add('mod-warning');
  useServer.addEventListener(
    'click',
    () => void options.callbacks?.onConflictAction?.(recordId, 'use-server'),
  );
  overwrite.addEventListener(
    'click',
    () => void options.callbacks?.onConflictAction?.(recordId, 'overwrite'),
  );
  actions.append(useServer, overwrite);
  box.append(actions);
  return box;
}

function createPreviewTrigger(
  coordinates: { readonly lat: number; readonly lng: number },
  translate: Translator,
): HTMLElement {
  const wrapper = document.createElement('span');
  wrapper.className = 'loom-location-preview-trigger';
  wrapper.textContent = translate('record.location.previewHint');
  let timer: number | null = null;
  const clear = (): void => {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
    wrapper.querySelector('.loom-location-preview')?.remove();
  };
  const preview = (): void => {
    if (wrapper.querySelector('.loom-location-preview') !== null) return;
    const element = document.createElement('span');
    element.className = 'loom-location-preview';
    element.dataset.lat = String(coordinates.lat);
    element.dataset.lng = String(coordinates.lng);
    element.setAttribute('role', 'status');
    element.textContent = `${translate('record.location.preview')}: ${coordinates.lat}, ${coordinates.lng} · ${translate('record.location.attribution')}`;
    wrapper.append(element);
  };
  wrapper.addEventListener('mousemove', (event) => {
    const mouse = event;
    if (!mouse.ctrlKey && !mouse.metaKey) {
      clear();
      return;
    }
    if (timer !== null) return;
    timer = window.setTimeout(() => {
      timer = null;
      preview();
    }, 180);
  });
  wrapper.addEventListener('mouseleave', clear);
  wrapper.addEventListener('keydown', (event) => {
    const keyboard = event;
    if (keyboard.key === 'Enter' && (keyboard.ctrlKey || keyboard.metaKey)) preview();
  });
  wrapper.tabIndex = 0;
  return wrapper;
}

function inputField(
  labelText: string,
  type: 'text' | 'number',
  value: string | number | undefined,
): { readonly wrapper: HTMLElement; readonly input: HTMLInputElement } {
  const input = document.createElement('input');
  input.type = type;
  input.value = value === undefined ? '' : String(value);
  input.name = labelText;
  input.setAttribute('aria-label', labelText);
  return { wrapper: fieldWrapper(labelText, input), input };
}

function fieldWrapper(labelText: string, input: HTMLElement): HTMLElement {
  const wrapper = document.createElement('label');
  wrapper.className = 'loom-location-editor-field';
  wrapper.append(createText('span', labelText), input);
  return wrapper;
}

function addText(target: Record<string, unknown>, key: string, value: string): void {
  if (value.trim() !== '') target[key] = value;
}

function addNumber(target: Record<string, unknown>, key: string, value: string): void {
  if (value.trim() !== '') target[key] = Number(value);
}

function textInputValue(value: JsonValue | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function numberInputValue(value: JsonValue | undefined): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function coordinatesFrom(
  value: Readonly<Record<string, JsonValue>>,
): { readonly lat: number; readonly lng: number } | null {
  return typeof value.lat === 'number' && typeof value.lng === 'number'
    ? { lat: value.lat, lng: value.lng }
    : null;
}

function isLocationValue(value: JsonValue): value is Readonly<Record<string, JsonValue>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatValue(value: JsonValue | undefined, translate: Translator): string {
  if (value === undefined) return translate('record.field.unset');
  if (value === null) return translate('record.field.cleared');
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value);
}

function fallbackFields(record: LoomTableRecord): readonly Field[] {
  return Object.keys(record.values).map((id, position) => ({
    id,
    tableId: record.tableId,
    name: id,
    position,
    schemaVersion: 1,
    revision: 1,
    type: 'text',
    config: {},
  }));
}

function button(label: string): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = 'loom-button';
  element.textContent = label;
  return element;
}

function createText<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.textContent = text;
  return element;
}
