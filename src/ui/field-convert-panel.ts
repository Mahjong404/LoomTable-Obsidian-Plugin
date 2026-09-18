import {
  LoomTableClientError,
  type ConversionMode,
  type ConversionPreview,
  type ConvertFieldRequest,
  type Field,
} from '../client/loomtable-client';
import type { Translator } from '../i18n';
import { createFieldTypeIcon } from './field-type-icon';
import { FIELD_TYPES } from './field-editor-panel';
import { createUiIcon } from './icons';

export interface FieldConverterOptions {
  readonly field: Field;
  readonly x: number;
  readonly y: number;
  readonly host: HTMLElement;
  readonly trigger?: HTMLElement;
  readonly translate: Translator;
  readonly onPreview: (fieldId: string, type: Field['type']) => Promise<ConversionPreview>;
  readonly onConvert: (fieldId: string, request: ConvertFieldRequest) => Promise<unknown>;
}

/**
 * Opens the two-step Field type conversion popover: pick a target type, review
 * the Server preview's per-mode statistics, then apply with the signed preview
 * token. Closes on success, Escape, outside pointerdown, or host scroll.
 */
export function openFieldConverter(options: FieldConverterOptions): () => void {
  const t = options.translate;
  const field = options.field;
  const panel = document.createElement('div');
  panel.className = 'loom-field-editor loom-convert-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', t('field.convert.title'));

  const title = document.createElement('div');
  title.className = 'loom-convert-title';
  title.textContent = `${field.name}: ${t(`field.type.${field.type}`)}`;
  panel.append(title);

  const body = document.createElement('div');
  body.className = 'loom-convert-body';
  panel.append(body);

  let closed = false;
  let previewToken: string | undefined;
  let selectedMode: ConversionMode | null = null;
  let selectedType: Field['type'] | null = null;
  let staleRetried = false;

  const renderTypes = (): void => {
    body.replaceChildren();
    const typeList = document.createElement('div');
    typeList.className = 'loom-field-editor-types';
    typeList.setAttribute('role', 'listbox');
    typeList.setAttribute('aria-label', t('field.type.label'));
    for (const candidate of FIELD_TYPES) {
      if (candidate === field.type) continue;
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'loom-field-editor-type clickable-icon';
      item.setAttribute('role', 'option');
      item.dataset.type = candidate;
      item.append(createFieldTypeIcon(candidate));
      const textWrap = document.createElement('span');
      textWrap.className = 'loom-field-editor-type-text';
      const label = document.createElement('span');
      label.className = 'loom-field-editor-type-name';
      label.textContent = t(`field.type.${candidate}`);
      const desc = document.createElement('span');
      desc.className = 'loom-field-editor-type-desc';
      desc.textContent = t(`field.type.${candidate}.desc`);
      textWrap.append(label, desc);
      item.append(textWrap);
      item.addEventListener('click', () => void preview(candidate));
      typeList.append(item);
    }
    body.append(typeList);
  };

  const renderStatus = (key: 'field.convert.loading' | 'field.convert.error'): void => {
    body.replaceChildren();
    const status = document.createElement('p');
    status.className = 'loom-convert-status';
    status.textContent = t(key);
    body.append(status);
  };

  const statChip = (label: string, count: number, tone: string): HTMLElement => {
    const chip = document.createElement('span');
    chip.className = 'loom-convert-stat';
    chip.dataset.tone = tone;
    chip.textContent = `${label} ${count}`;
    return chip;
  };

  const renderPreview = (type: Field['type'], preview: ConversionPreview): void => {
    body.replaceChildren();
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'loom-convert-back clickable-icon';
    back.setAttribute('aria-label', t('field.convert.back'));
    back.append(createUiIcon('nav-prev'));
    back.addEventListener('click', renderTypes);
    const heading = document.createElement('span');
    heading.className = 'loom-convert-heading';
    heading.textContent = `${t(`field.type.${field.type}`)} → ${t(`field.type.${type}`)}`;
    const head = document.createElement('div');
    head.className = 'loom-convert-head';
    head.append(back, heading);
    body.append(head);

    if (!preview.supported) {
      const note = document.createElement('p');
      note.className = 'loom-convert-status';
      note.textContent = preview.reason ?? t('field.convert.unsupported');
      body.append(note);
      return;
    }

    const modes = document.createElement('div');
    modes.className = 'loom-convert-modes';
    modes.setAttribute('role', 'listbox');
    for (const mode of preview.modes ?? []) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'loom-convert-mode clickable-icon';
      card.setAttribute('role', 'option');
      card.dataset.mode = mode.id;
      card.disabled = mode.disabled === true;
      const label = document.createElement('span');
      label.className = 'loom-convert-mode-name';
      label.textContent = mode.label;
      card.append(label);
      const stats = document.createElement('span');
      stats.className = 'loom-convert-stats';
      stats.append(
        statChip(t('field.convert.stat.ok'), mode.stats.ok, 'ok'),
        statChip(t('field.convert.stat.lossy'), mode.stats.lossy, 'lossy'),
        statChip(t('field.convert.stat.lost'), mode.stats.lost, 'lost'),
        statChip(t('field.convert.stat.empty'), mode.stats.empty, 'muted'),
      );
      if (mode.stats.newOptions !== undefined) {
        stats.append(statChip(t('field.convert.stat.newOptions'), mode.stats.newOptions, 'muted'));
      }
      card.append(stats);
      if (mode.reason !== undefined) {
        const reason = document.createElement('span');
        reason.className = 'loom-convert-mode-reason';
        reason.textContent = mode.reason;
        card.append(reason);
      }
      card.addEventListener('click', () => {
        if (mode.disabled === true) return;
        selectedMode = mode;
        modes
          .querySelectorAll('.loom-convert-mode')
          .forEach((el) => el.setAttribute('aria-selected', String(el === card)));
        apply.disabled = false;
        warning.hidden = mode.stats.lossy === 0 && mode.stats.lost === 0;
      });
      card.setAttribute('aria-selected', 'false');
      modes.append(card);
    }
    body.append(modes);

    const warning = document.createElement('p');
    warning.className = 'loom-convert-warning';
    warning.textContent = t('field.convert.warning');
    warning.hidden = true;
    body.append(warning);

    const apply = document.createElement('button');
    apply.type = 'button';
    apply.className = 'loom-button loom-convert-apply';
    apply.textContent = t('field.convert.apply');
    apply.disabled = true;
    apply.addEventListener('click', () => void convert(type));
    body.append(apply);
  };

  const preview = async (type: Field['type']): Promise<void> => {
    if (closed) return;
    selectedType = type;
    selectedMode = null;
    previewToken = undefined;
    staleRetried = false;
    renderStatus('field.convert.loading');
    try {
      const result = await options.onPreview(field.id, type);
      if (closed || selectedType !== type) return;
      previewToken = result.previewToken;
      renderPreview(type, result);
    } catch {
      if (!closed) renderStatus('field.convert.error');
    }
  };

  const convert = async (type: Field['type']): Promise<void> => {
    if (selectedMode === null || previewToken === undefined) return;
    const request: ConvertFieldRequest = {
      type,
      mode: selectedMode.id,
      expectedRevision: field.revision,
      previewToken,
    };
    try {
      await options.onConvert(field.id, request);
      close();
    } catch (error) {
      const code = error instanceof LoomTableClientError ? error.details.code : '';
      if ((code === 'INVALID_PREVIEW_TOKEN' || code === 'CONVERT_PREVIEW_STALE') && !staleRetried) {
        staleRetried = true;
        await preview(type);
        return;
      }
      if (!closed) renderStatus('field.convert.error');
    }
  };

  const close = (): void => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKeyDown, true);
    document.removeEventListener('pointerdown', onPointerDown, true);
    options.host.removeEventListener('scroll', onScroll, true);
    panel.remove();
  };

  const onScroll = (): void => close();
  const onPointerDown = (event: PointerEvent): void => {
    if (!panel.contains(event.target as Node)) close();
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  };

  renderTypes();

  const hostRect = options.host.getBoundingClientRect();
  panel.classList.add('loom-field-editor--measuring');
  options.host.append(panel);
  const panelRect = panel.getBoundingClientRect();
  const offsetX = options.x - hostRect.left + options.host.scrollLeft;
  const offsetY = options.y - hostRect.top + options.host.scrollTop;
  panel.style.left = `${Math.max(0, Math.min(offsetX, options.host.scrollWidth - panelRect.width - 4))}px`;
  panel.style.top = `${Math.max(0, Math.min(offsetY, options.host.scrollHeight - panelRect.height - 4))}px`;
  panel.classList.remove('loom-field-editor--measuring');

  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('pointerdown', onPointerDown, true);
  options.host.addEventListener('scroll', onScroll, true);
  return close;
}
