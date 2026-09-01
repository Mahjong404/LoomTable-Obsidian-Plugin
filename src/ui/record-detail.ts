import type { Field, JsonValue, LocationValue, LoomTableRecord } from '../client/loomtable-client';
import type { Translator } from '../i18n';
import {
  describeFieldValueError,
  normalizeLocationValue,
  type LocationEditIntent,
} from './field-value-editor';
import {
  createRenderedFieldValueElement,
  defaultFieldRendererRegistry,
  type RenderedAttachment,
} from './field-renderer-registry';
import { confirmDangerousAction as showDangerousActionConfirmation } from './dangerous-action-confirmation';
import { isSafeAttachmentVaultPath } from './attachment-host';
import {
  describeAttachmentUploadError,
  isAttachmentRetryable,
  readAttachmentReferences,
  type AttachmentAddHandler,
  type AttachmentDetachHandler,
} from './attachment-upload';

const MAX_RENDERABLE_LATITUDE = 85.0511287798066;
type LocationPresentationState = 'located' | 'unlocated' | 'unrenderable';

export interface RecordDetailCallbacks {
  readonly onClose?: () => void;
  readonly onLocationEdit?: (
    recordId: string,
    fieldId: string,
    intent: LocationEditIntent,
    record?: LoomTableRecord,
  ) => void | LoomTableRecord | Promise<void | LoomTableRecord>;
  readonly onOpenLocationInMap?: (
    recordId: string,
    fieldId: string,
    location: LocationValue,
  ) => void | Promise<void>;
  readonly canOpenLocationInMap?: (fieldId: string) => boolean;
  readonly onCopyCoordinates?: (
    recordId: string,
    fieldId: string,
    coordinates: { readonly lat: number; readonly lng: number },
  ) => void | Promise<void>;
  readonly onAttachmentDownload?: (
    recordId: string,
    fieldId: string,
    attachment: RenderedAttachment,
  ) => void | Promise<void>;
  readonly onAttachmentOpen?: (
    recordId: string,
    fieldId: string,
    attachment: RenderedAttachment,
  ) => void | Promise<void>;
  readonly onAttachmentPreview?: (
    recordId: string,
    fieldId: string,
    attachment: RenderedAttachment,
  ) => void | Promise<void>;
  readonly onAttachmentAdd?: AttachmentAddHandler;
  readonly onAttachmentAddRetry?: AttachmentAddHandler;
  readonly onAttachmentDetach?: AttachmentDetachHandler;
  readonly getConflict?: (recordId: string) => RecordConflictView | undefined;
  readonly onConflictAction?: (
    recordId: string,
    action: 'use-server' | 'overwrite' | 'discard-all',
  ) => void | Promise<void>;
}

export interface RecordConflictView {
  readonly clientMutationId: string;
  readonly failedCommandIndex: number;
  readonly expectedRevision: number;
  readonly currentRevision: number;
  readonly currentValues: Readonly<Record<string, JsonValue>>;
  readonly submittedSet?: Readonly<Record<string, JsonValue>>;
  readonly submittedUnsetFieldIds?: readonly string[];
  readonly message: string;
}

export interface RecordDetailOptions {
  readonly translate: Translator;
  readonly fields: readonly Field[];
  readonly offline?: boolean;
  readonly returnFocus?: HTMLElement | null;
  readonly focusFallback?: () => HTMLElement | null;
  readonly confirmDiscard?: (message: string) => boolean;
  readonly confirmDangerousAction?: (
    message: string,
    host: HTMLElement,
    trigger?: HTMLElement,
  ) => Promise<boolean>;
  readonly callbacks?: RecordDetailCallbacks;
}

export function createRecordDetail(
  record: LoomTableRecord,
  options: RecordDetailOptions,
): HTMLElement {
  const root = document.createElement('section');
  root.className = 'loom-record-detail';
  root.setAttribute('role', 'region');
  root.tabIndex = -1;
  const heading = createText('h2', options.translate('record.details') + ': ' + record.id);
  heading.id = nextRecordDetailId();
  root.setAttribute('aria-labelledby', heading.id);
  const returnFocus =
    options.returnFocus !== undefined
      ? options.returnFocus
      : typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

  const closeDetail = (): void => {
    const draft = root.querySelector<HTMLElement>('.loom-location-editor[data-dirty="true"]');
    if (
      draft !== null &&
      !confirmDiscard(options, options.translate('record.location.discardConfirm'))
    ) {
      return;
    }
    options.callbacks?.onClose?.();
    if (returnFocus?.isConnected) returnFocus.focus();
    else {
      const fallback = options.focusFallback?.();
      if (fallback?.isConnected) fallback.focus();
    }
  };

  const header = document.createElement('div');
  header.className = 'loom-record-detail-header';
  header.append(heading);
  if (options.callbacks?.onClose !== undefined) {
    const close = button(options.translate('common.close'));
    close.setAttribute('aria-label', options.translate('common.close'));
    close.addEventListener('click', closeDetail);
    header.append(close);
  }
  root.append(header);

  root.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    closeDetail();
  });

  const fields = options.fields.length > 0 ? options.fields : fallbackFields(record);
  const values = document.createElement('dl');
  values.className = 'loom-record-fields';
  const detailStatus = document.createElement('p');
  detailStatus.className = 'loom-record-detail-status';
  detailStatus.setAttribute('role', 'status');
  detailStatus.setAttribute('aria-live', 'polite');
  detailStatus.hidden = true;
  const announce = (message: string): void => {
    detailStatus.hidden = false;
    detailStatus.textContent = message;
  };
  let currentRecord = record;
  const renderValues = (nextRecord: LoomTableRecord): void => {
    currentRecord = nextRecord;
    values.replaceChildren(
      ...fields.flatMap((field) =>
        renderField(currentRecord, field, options, root, renderValues, announce),
      ),
    );
  };
  renderValues(record);
  root.append(detailStatus, values);
  const existingConflict = options.callbacks?.getConflict?.(record.id);
  if (existingConflict !== undefined) {
    root.append(renderConflict(record.id, existingConflict, options, root));
  }
  return root;
}

function renderField(
  record: LoomTableRecord,
  field: Field,
  options: RecordDetailOptions,
  detailRoot: HTMLElement,
  onRecordUpdated: (record: LoomTableRecord) => void,
  announce: (message: string) => void,
): HTMLElement[] {
  const value = record.values[field.id];
  const label = createText('dt', field.name);
  label.dataset.fieldId = field.id;
  const body = document.createElement('dd');
  body.dataset.fieldId = field.id;

  if (field.type === 'location') {
    body.append(renderLocationValue(record, field, value, options, detailRoot));
  } else {
    const displayValue = defaultFieldRendererRegistry.render(field, value, {
      translate: options.translate,
    });
    const onAttachmentDownload =
      field.type === 'attachment' && options.callbacks?.onAttachmentDownload !== undefined
        ? (attachment: RenderedAttachment): void | Promise<void> => {
            if (attachment.id === undefined) return;
            return options.callbacks?.onAttachmentDownload?.(record.id, field.id, attachment);
          }
        : undefined;
    const onAttachmentOpen =
      field.type === 'attachment' && options.callbacks?.onAttachmentOpen !== undefined
        ? (attachment: RenderedAttachment): void | Promise<void> => {
            if (attachment.id === undefined) return;
            return options.callbacks?.onAttachmentOpen?.(record.id, field.id, attachment);
          }
        : undefined;
    const onAttachmentPreview =
      field.type === 'attachment' && options.callbacks?.onAttachmentPreview !== undefined
        ? (attachment: RenderedAttachment): void | Promise<void> => {
            if (attachment.id === undefined) return;
            return options.callbacks?.onAttachmentPreview?.(record.id, field.id, attachment);
          }
        : undefined;
    const onAttachmentDetach =
      field.type === 'attachment' && options.callbacks?.onAttachmentDetach !== undefined
        ? async (attachment: RenderedAttachment): Promise<void> => {
            if (attachment.id === undefined) return;
            const trigger =
              typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
                ? document.activeElement
                : undefined;
            const confirmed = await requestDangerousConfirmation(
              options,
              detailRoot,
              options.translate('record.attachment.action.detachConfirm') +
                ' ' +
                (attachment.filename ?? attachment.statusText),
              trigger,
            );
            if (!confirmed) return;
            const updated = await options.callbacks?.onAttachmentDetach?.(
              record.id,
              field.id,
              attachment.id,
              record,
            );
            if (updated !== undefined) onRecordUpdated(updated);
            announce(options.translate('record.attachment.action.detached'));
          }
        : undefined;
    body.append(
      createRenderedFieldValueElement(displayValue, {
        translate: options.translate,
        attachmentDownloadDisabled: options.offline === true,
        attachmentOpenPreviewDisabled: options.offline === true,
        attachmentDetachDisabled: options.offline === true,
        ...(field.type === 'attachment'
          ? {
              canAttachmentOpen: (attachment: RenderedAttachment) =>
                attachment.source === 'vault' && isSafeAttachmentVaultPath(attachment.vaultPath),
              canAttachmentPreview: (attachment: RenderedAttachment) =>
                attachment.source === 'managed',
            }
          : {}),
        ...(onAttachmentDownload === undefined ? {} : { onAttachmentDownload }),
        ...(onAttachmentOpen === undefined ? {} : { onAttachmentOpen }),
        ...(onAttachmentPreview === undefined ? {} : { onAttachmentPreview }),
        ...(onAttachmentDetach === undefined ? {} : { onAttachmentDetach }),
      }),
    );
    body.setAttribute('aria-label', field.name + ': ' + displayValue.ariaLabel);
    body.dataset.valueState = displayValue.state;
    if (
      field.type === 'attachment' &&
      options.callbacks?.onAttachmentAdd !== undefined &&
      canAddAttachment(value, field.config.maxCount)
    ) {
      body.append(createAttachmentAddAction(record, field, options, onRecordUpdated, announce));
    }
  }
  return [label, body];
}

function renderLocationValue(
  record: LoomTableRecord,
  field: Field,
  raw: JsonValue | undefined,
  options: RecordDetailOptions,
  detailRoot: HTMLElement,
): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'loom-location-field';

  if (raw === undefined) {
    wrapper.dataset.locationState = 'unset';
    wrapper.append(createLocationStatus('unset', options.translate('record.field.unset')));
  } else if (raw === null) {
    wrapper.dataset.locationState = 'cleared';
    wrapper.append(createLocationStatus('cleared', options.translate('record.field.cleared')));
  } else if (isLocationValue(raw)) {
    const location = raw;
    const coordinates = coordinatesFrom(location);
    const renderedLocation = defaultFieldRendererRegistry.render(field, raw, {
      translate: options.translate,
    });
    const state: LocationPresentationState =
      renderedLocation.state === 'located' ||
      renderedLocation.state === 'unlocated' ||
      renderedLocation.state === 'unrenderable'
        ? renderedLocation.state
        : locationPresentationState(coordinates);
    wrapper.dataset.locationState = state;
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
        key === 'precision' && typeof item === 'string'
          ? formatPrecision(item, options.translate)
          : typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean'
            ? String(item)
            : options.translate('record.value.unavailable');
      details.append(createText('dt', options.translate(messageKey)), createText('dd', text));
    }
    wrapper.append(details, createLocationStatus(state, locationStatusText(state, options)));
    if (coordinates !== null) {
      const canOpen = options.callbacks?.canOpenLocationInMap?.(field.id);
      if (
        state === 'located' &&
        options.callbacks?.onOpenLocationInMap !== undefined &&
        canOpen !== false
      ) {
        const open = button(options.translate('record.location.openMap'));
        open.classList.add('loom-location-open-map');
        open.addEventListener(
          'click',
          () => void options.callbacks?.onOpenLocationInMap?.(record.id, field.id, location),
        );
        wrapper.append(open);
      } else if (canOpen === false) {
        const unavailable = createText('span', options.translate('record.location.mapUnavailable'));
        unavailable.className = 'loom-location-map-unavailable';
        unavailable.setAttribute('role', 'status');
        wrapper.append(unavailable);
      }
      const copy = button(options.translate('record.location.copy'));
      copy.classList.add('loom-location-copy');
      copy.setAttribute('aria-label', options.translate('record.location.copy'));
      copy.addEventListener('click', () => {
        void copyCoordinates(record, field, coordinates, copy, options);
      });
      wrapper.append(copy, createPreviewTrigger(coordinates, options.translate));
    }
  } else {
    const displayValue = defaultFieldRendererRegistry.render(field, raw, {
      translate: options.translate,
    });
    wrapper.append(createText('span', displayValue.text));
  }

  const edit = button(options.translate('record.location.edit'));
  edit.classList.add('loom-location-edit');
  edit.disabled = options.offline === true || options.callbacks?.onLocationEdit === undefined;
  edit.addEventListener('click', () => {
    if (options.callbacks?.onLocationEdit === undefined) return;
    const editor = createLocationEditor(record, field, raw, options, detailRoot);
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
    buttonElement.setAttribute('aria-live', 'polite');
  } catch {
    buttonElement.textContent = options.translate('record.location.copyFailed');
    buttonElement.setAttribute('aria-live', 'assertive');
  }
}

function createLocationEditor(
  record: LoomTableRecord,
  field: Field,
  raw: JsonValue | undefined,
  options: RecordDetailOptions,
  detailRoot: HTMLElement,
): HTMLElement {
  const root = document.createElement('form');
  root.className = 'loom-location-editor';
  root.setAttribute('aria-label', options.translate('record.location.edit'));
  root.dataset.dirty = 'false';

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
  emptyPrecision.textContent = options.translate('record.location.precision.none');
  precision.append(emptyPrecision);
  for (const [value, messageKey] of [
    ['exact', 'record.location.precision.exact'],
    ['rooftop', 'record.location.precision.rooftop'],
    ['approximate', 'record.location.precision.approximate'],
  ] as const) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = options.translate(messageKey);
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

  const error = document.createElement('div');
  error.className = 'loom-location-editor-error';
  error.id = nextLocationEditorErrorId();
  error.setAttribute('role', 'alert');
  error.setAttribute('aria-live', 'assertive');
  error.tabIndex = -1;
  error.hidden = true;
  const controls = [label.input, address.input, provider.input, lat.input, lng.input, precision];
  for (const control of controls) {
    control.setAttribute('aria-describedby', error.id);
    control.setAttribute('aria-invalid', 'false');
  }
  root.append(error);

  const actions = document.createElement('div');
  actions.className = 'loom-location-editor-actions';
  const save = button(options.translate('common.save'));
  save.type = 'submit';
  const clear = button(options.translate('record.location.clear'));
  const unset = button(options.translate('record.location.unset'));
  const cancel = button(options.translate('common.cancel'));
  actions.append(save, clear, unset, cancel);
  root.append(actions);

  let saving = false;
  const setSaving = (value: boolean): void => {
    saving = value;
    root.dataset.saving = String(value);
    root.setAttribute('aria-busy', String(value));
    for (const action of [save, clear, unset, cancel]) action.disabled = value;
  };
  const submit = async (intent: LocationEditIntent): Promise<void> => {
    if (saving) return;
    setSaving(true);
    try {
      const updatedRecord = await options.callbacks?.onLocationEdit?.(
        record.id,
        field.id,
        intent,
        record,
      );
      const nextRecord = updatedRecord instanceof Object ? updatedRecord : record;
      const nextValue =
        updatedRecord instanceof Object
          ? updatedRecord.values[field.id]
          : intent.kind === 'unset'
            ? undefined
            : intent.kind === 'clear'
              ? null
              : intent.value;
      const next = renderLocationValue(nextRecord, field, nextValue, options, detailRoot);
      root.replaceWith(next);
      next.querySelector<HTMLButtonElement>('.loom-location-edit')?.focus();
    } catch (cause) {
      showLocationError(error, controls, options, undefined, undefined, false);
      if (cause instanceof Error) {
        error.append(renderDiagnostic(options.translate('common.openDiagnostics'), cause.message));
      }
      const conflict = options.callbacks?.getConflict?.(record.id);
      if (conflict !== undefined) {
        detailRoot.querySelector('.loom-record-conflict')?.remove();
        const conflictBox = renderConflict(record.id, conflict, options, detailRoot);
        detailRoot.append(conflictBox);
        conflictBox.focus();
      } else {
        error.focus();
      }
    } finally {
      if (root.isConnected) setSaving(false);
    }
  };
  const confirmAndSubmit = (
    intent: LocationEditIntent,
    message: string,
    trigger: HTMLButtonElement,
  ): void => {
    if (saving) return;
    trigger.focus();
    void requestDangerousConfirmation(options, root, message, trigger).then((confirmed) => {
      if (confirmed) void submit(intent);
    });
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
      showLocationError(
        error,
        controls,
        options,
        describeFieldValueError(normalized.code, options.translate),
        normalized.code,
      );
      controls[0]?.focus();
      return;
    }
    void submit({ kind: 'set', value: normalized.value as LocationValue });
  });
  clear.addEventListener('click', (event) => {
    event.preventDefault();
    confirmAndSubmit({ kind: 'clear' }, options.translate('record.location.clearConfirm'), clear);
  });
  unset.addEventListener('click', (event) => {
    event.preventDefault();
    confirmAndSubmit({ kind: 'unset' }, options.translate('record.location.unsetConfirm'), unset);
  });
  root.addEventListener('input', () => {
    root.dataset.dirty = 'true';
    clearLocationError(error, controls);
  });
  root.addEventListener('change', () => {
    root.dataset.dirty = 'true';
    clearLocationError(error, controls);
  });
  cancel.addEventListener('click', (event) => {
    event.preventDefault();
    if (
      root.dataset.dirty === 'true' &&
      !confirmDiscard(options, options.translate('record.location.discardConfirm'))
    ) {
      return;
    }
    const next = renderLocationValue(record, field, raw, options, detailRoot);
    root.replaceWith(next);
    next.querySelector<HTMLButtonElement>('.loom-location-edit')?.focus();
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
  detailRoot: HTMLElement,
): HTMLElement {
  const box = document.createElement('section');
  box.className = 'loom-record-conflict';
  box.setAttribute('role', 'region');
  box.setAttribute('aria-live', 'polite');
  box.setAttribute('aria-atomic', 'true');
  box.setAttribute('aria-label', options.translate('record.conflictRegion'));
  box.tabIndex = -1;
  const heading = createText('h3', options.translate('record.conflict'));
  box.append(heading);
  box.append(createText('p', options.translate('record.serverValue')));
  const serverValues = document.createElement('pre');
  serverValues.className = 'loom-record-conflict-server';
  serverValues.setAttribute('aria-label', options.translate('record.serverValue'));
  serverValues.textContent = JSON.stringify(
    {
      recordId,
      clientMutationId: conflict.clientMutationId,
      failedCommandIndex: conflict.failedCommandIndex,
      expectedRevision: conflict.expectedRevision,
      currentRevision: conflict.currentRevision,
      currentValues: conflict.currentValues,
    },
    null,
    2,
  );
  box.append(serverValues);
  box.append(createText('p', options.translate('record.localIntent')));
  const localIntent = document.createElement('pre');
  localIntent.className = 'loom-record-conflict-local';
  localIntent.setAttribute('aria-label', options.translate('record.localIntent'));
  localIntent.textContent = JSON.stringify(
    {
      submittedSet: conflict.submittedSet,
      submittedUnsetFieldIds: conflict.submittedUnsetFieldIds,
    },
    null,
    2,
  );
  box.append(localIntent);
  box.append(
    renderDiagnostic(
      options.translate('common.openDiagnostics'),
      JSON.stringify({ message: conflict.message }, null, 2),
    ),
  );
  const actions = document.createElement('div');
  actions.className = 'loom-record-conflict-actions';
  const useServer = button(options.translate('record.useServer'));
  const overwrite = button(options.translate('record.overwrite'));
  overwrite.classList.add('loom-button-danger');
  overwrite.dataset.variant = 'danger';
  const invoke = (action: 'use-server' | 'overwrite' | 'discard-all'): void => {
    const restoreFocus = (): void => detailRoot.focus();
    try {
      const result = options.callbacks?.onConflictAction?.(recordId, action);
      if (result instanceof Promise) {
        void result.catch(() => undefined).finally(restoreFocus);
      } else {
        restoreFocus();
      }
    } catch {
      restoreFocus();
    }
  };
  useServer.addEventListener('click', () => invoke('use-server'));
  overwrite.addEventListener('click', () => {
    void requestDangerousConfirmation(
      options,
      box,
      options.translate('record.overwriteConfirm'),
      overwrite,
    ).then((confirmed) => {
      if (confirmed) invoke('overwrite');
    });
  });
  const discardAll = button(options.translate('record.discardAll'));
  discardAll.addEventListener('click', () => {
    if (!confirmDiscard(options, options.translate('record.discardAllConfirm'))) return;
    invoke('discard-all');
  });
  actions.append(useServer, overwrite, discardAll);
  box.append(actions);
  return box;
}

function createPreviewTrigger(
  coordinates: { readonly lat: number; readonly lng: number },
  translate: Translator,
): HTMLElement {
  const wrapper = document.createElement('button');
  wrapper.type = 'button';
  wrapper.className = 'loom-location-preview-trigger loom-button';
  wrapper.textContent = translate('record.location.previewHint');
  wrapper.setAttribute('aria-label', translate('record.location.previewHint'));
  wrapper.title = translate('record.location.previewHint');
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
    element.textContent =
      translate('record.location.preview') +
      ': ' +
      coordinates.lat +
      ', ' +
      coordinates.lng +
      ' · ' +
      translate('record.location.attribution');
    wrapper.append(element);
  };
  wrapper.addEventListener('click', preview);
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
  return wrapper;
}

let recordDetailId = 0;
let locationEditorErrorId = 0;

function nextRecordDetailId(): string {
  recordDetailId += 1;
  return 'loom-record-detail-heading-' + String(recordDetailId);
}

function nextLocationEditorErrorId(): string {
  locationEditorErrorId += 1;
  return 'loom-location-editor-error-' + String(locationEditorErrorId);
}

function requestDangerousConfirmation(
  options: RecordDetailOptions,
  host: HTMLElement,
  message: string,
  trigger?: HTMLElement,
): Promise<boolean> {
  return (
    options.confirmDangerousAction?.(message, host, trigger) ??
    showDangerousActionConfirmation(host, message, options.translate, trigger)
  );
}

function confirmDiscard(options: RecordDetailOptions, message: string): boolean {
  if (options.confirmDiscard !== undefined) return options.confirmDiscard(message);
  if (typeof window === 'undefined' || typeof window.confirm !== 'function') return false;
  try {
    return window.confirm(message);
  } catch {
    return false;
  }
}

function showLocationError(
  error: HTMLElement,
  controls: readonly HTMLElement[],
  options: RecordDetailOptions,
  message = options.translate('record.location.invalid'),
  code?: string,
  markInvalid = true,
): void {
  error.hidden = false;
  error.textContent = message;
  if (code === undefined) delete error.dataset.errorCode;
  else error.dataset.errorCode = code;
  for (const control of controls) {
    control.setAttribute('aria-invalid', String(markInvalid));
  }
}

function clearLocationError(error: HTMLElement, controls: readonly HTMLElement[]): void {
  error.hidden = true;
  error.replaceChildren();
  delete error.dataset.errorCode;
  for (const control of controls) control.setAttribute('aria-invalid', 'false');
}

function renderDiagnostic(label: string, details: string): HTMLElement {
  const wrapper = document.createElement('details');
  wrapper.className = 'loom-diagnostic';
  const summary = document.createElement('summary');
  summary.textContent = label;
  const pre = document.createElement('pre');
  pre.textContent = details;
  wrapper.append(summary, pre);
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
  return typeof value.lat === 'number' &&
    Number.isFinite(value.lat) &&
    value.lat >= -90 &&
    value.lat <= 90 &&
    typeof value.lng === 'number' &&
    Number.isFinite(value.lng) &&
    value.lng >= -180 &&
    value.lng <= 180
    ? { lat: value.lat, lng: value.lng }
    : null;
}

function locationPresentationState(
  coordinates: { readonly lat: number; readonly lng: number } | null,
): LocationPresentationState {
  if (coordinates === null) return 'unlocated';
  return Math.abs(coordinates.lat) > MAX_RENDERABLE_LATITUDE ? 'unrenderable' : 'located';
}

function locationStatusText(
  state: LocationPresentationState,
  options: RecordDetailOptions,
): string {
  if (state === 'located') return options.translate('record.location.located');
  if (state === 'unrenderable') return options.translate('record.location.unrenderable');
  return options.translate('record.location.unlocated');
}

function createLocationStatus(
  state: LocationPresentationState | 'cleared' | 'unset',
  text: string,
): HTMLElement {
  const status = createText('span', text);
  status.className = 'loom-location-status';
  status.dataset.state = state;
  return status;
}

function isLocationValue(value: JsonValue): value is Readonly<Record<string, JsonValue>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatPrecision(value: string, translate: Translator): string {
  if (value === 'exact') return translate('record.location.precision.exact');
  if (value === 'rooftop') return translate('record.location.precision.rooftop');
  if (value === 'approximate') return translate('record.location.precision.approximate');
  return translate('record.value.unavailable');
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

function canAddAttachment(value: JsonValue | undefined, maxCount: number): boolean {
  const references = readAttachmentReferences(value);
  return references !== null && Number.isInteger(maxCount) && maxCount > references.length;
}

function createAttachmentAddAction(
  record: LoomTableRecord,
  field: Extract<Field, { readonly type: 'attachment' }>,
  options: RecordDetailOptions,
  onRecordUpdated: (record: LoomTableRecord) => void,
  announce: (message: string) => void,
): HTMLElement {
  const group = document.createElement('span');
  group.className = 'loom-attachment-add-action-group';
  const action = button(options.translate('record.attachment.action.add'));
  action.classList.add('loom-attachment-add-action');
  const status = document.createElement('span');
  status.className = 'loom-attachment-add-action-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const statusId = nextAttachmentAddStatusId();
  status.id = statusId;
  action.setAttribute('aria-describedby', statusId);

  const offline = options.offline === true;
  let retryAction: HTMLButtonElement | null = null;
  let busy = false;

  const setIdle = (): void => {
    action.disabled = offline;
    action.removeAttribute('aria-busy');
    action.textContent = options.translate('record.attachment.action.add');
    action.setAttribute(
      'aria-label',
      offline
        ? options.translate('record.attachment.action.offlineAdd')
        : options.translate('record.attachment.action.add'),
    );
    if (retryAction !== null) {
      retryAction.disabled = offline;
      retryAction.removeAttribute('aria-busy');
      retryAction.textContent = options.translate('record.attachment.action.retry');
      retryAction.setAttribute(
        'aria-label',
        options.translate('record.attachment.action.retry'),
      );
    }
  };

  const removeRetryAction = (): void => {
    retryAction?.remove();
    retryAction = null;
  };

  const ensureRetryAction = (): void => {
    if (retryAction !== null || options.callbacks?.onAttachmentAddRetry === undefined) return;
    retryAction = button(options.translate('record.attachment.action.retry'));
    retryAction.classList.add('loom-attachment-add-retry-action');
    retryAction.setAttribute('aria-describedby', statusId);
    retryAction.addEventListener('click', () => {
      void run(true);
    });
    group.append(document.createTextNode(' '), retryAction);
  };

  const run = async (retry: boolean): Promise<void> => {
    const handler = retry
      ? options.callbacks?.onAttachmentAddRetry
      : options.callbacks?.onAttachmentAdd;
    const trigger = retry ? retryAction : action;
    if (
      busy ||
      offline ||
      handler === undefined ||
      trigger === null ||
      trigger.disabled
    ) {
      return;
    }
    busy = true;
    action.disabled = true;
    retryAction?.setAttribute('aria-busy', 'true');
    trigger.disabled = true;
    trigger.setAttribute('aria-busy', 'true');
    const pendingLabel = options.translate(
      retry
        ? 'record.attachment.action.retrying'
        : 'record.attachment.action.adding',
    );
    trigger.textContent = pendingLabel;
    trigger.setAttribute('aria-label', pendingLabel);
    status.textContent = pendingLabel;
    try {
      const updated = await handler(record.id, field.id, record, field.config.maxCount);
      if (updated === null) {
        status.textContent = options.translate('record.attachment.action.addCancelled');
        return;
      }
      if (updated !== undefined) onRecordUpdated(updated);
      removeRetryAction();
      announce(options.translate('record.attachment.action.added'));
    } catch (error) {
      status.textContent = describeAttachmentUploadError(error, options.translate);
      if (isAttachmentRetryable(error)) ensureRetryAction();
      else removeRetryAction();
    } finally {
      busy = false;
      setIdle();
      if (trigger.isConnected && !trigger.disabled) trigger.focus();
      else if (action.isConnected && !action.disabled) action.focus();
    }
  };

  action.disabled = offline;
  action.setAttribute(
    'aria-label',
    offline
      ? options.translate('record.attachment.action.offlineAdd')
      : options.translate('record.attachment.action.add'),
  );
  if (offline) status.textContent = options.translate('record.attachment.action.offlineAdd');
  action.addEventListener('click', () => {
    void run(false);
  });
  group.append(action, document.createTextNode(' '), status);
  return group;
}
let attachmentAddStatusId = 0;

function nextAttachmentAddStatusId(): string {
  attachmentAddStatusId += 1;
  return 'loom-attachment-add-status-' + String(attachmentAddStatusId);
}
