import type {
  Field,
  NumberFormatConfig,
  SelectOptionColor,
  SelectOptionInput,
} from '../client/loomtable-client';
import type { Translator } from '../i18n';
import { getFocusableElements } from './dangerous-action-confirmation';
import { createFieldTypeIcon } from './field-type-icon';
import { createUiIcon } from './icons';
import { createLoomButton } from './loom-button';

export const FIELD_TYPES: readonly Field['type'][] = [
  'text',
  'longText',
  'number',
  'checkbox',
  'date',
  'select',
  'multiSelect',
  'url',
  'location',
  'attachment',
];

export const SELECT_OPTION_COLORS: readonly SelectOptionColor[] = [
  'gray',
  'red',
  'orange',
  'yellow',
  'green',
  'cyan',
  'blue',
  'purple',
  'pink',
];

export interface FieldEditorSubmit {
  readonly name: string;
  readonly type: Field['type'];
  readonly options?: readonly SelectOptionInput[];
  readonly maxCount?: number;
  readonly description?: string;
  readonly format?: NumberFormatConfig | null;
}

export interface FieldEditorOptions {
  readonly mode: 'create' | 'edit';
  readonly field?: Field;
  readonly defaultType?: Field['type'];
  readonly x: number;
  readonly y: number;
  readonly host: HTMLElement;
  readonly trigger?: HTMLElement;
  /** Resolves the focus target on close when `trigger` is gone (re-rendered). */
  readonly restoreFocusTarget?: () => HTMLElement | null;
  readonly translate: Translator;
  readonly onSubmit: (input: FieldEditorSubmit) => void | Promise<void>;
}

interface OptionDraft {
  readonly id?: string;
  name: string;
  color: SelectOptionColor;
  deleted: boolean;
}

/**
 * Opens the pointer-anchored field create/edit popover
 * coordinates. Create mode offers the ten-type picker; edit mode fixes the
 * type and exposes the type-specific config (select options, attachment
 * limit). Closes on submit, Escape, outside pointerdown, or host scroll.
 */
export function openFieldEditor(options: FieldEditorOptions): () => void {
  const t = options.translate;
  const panel = document.createElement('div');
  panel.className = 'loom-field-editor';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute(
    'aria-label',
    t(options.mode === 'create' ? 'field.create.title' : 'field.edit.title'),
  );

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'loom-field-editor-name';
  nameInput.placeholder = t('field.name.placeholder');
  nameInput.setAttribute('aria-label', t('field.name.label'));
  nameInput.value = options.field?.name ?? '';
  panel.append(nameInput);

  const descInput = document.createElement('input');
  descInput.type = 'text';
  descInput.className = 'loom-field-editor-name loom-field-editor-desc';
  descInput.placeholder = t('field.desc.placeholder');
  descInput.setAttribute('aria-label', t('field.desc.label'));
  descInput.value = options.field?.description ?? '';
  panel.append(descInput);

  let type: Field['type'] = options.field?.type ?? options.defaultType ?? 'text';
  const configHost = document.createElement('div');
  configHost.className = 'loom-field-editor-config';

  if (options.mode === 'create') {
    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'loom-field-editor-type-search';
    search.placeholder = t('field.type.search');
    search.setAttribute('aria-label', t('field.type.search'));
    panel.append(search);
    const typeList = document.createElement('div');
    typeList.className = 'loom-field-editor-types';
    typeList.setAttribute('role', 'listbox');
    typeList.setAttribute('aria-label', t('field.type.label'));
    const emptyNote = document.createElement('p');
    emptyNote.className = 'loom-field-editor-type-empty';
    emptyNote.textContent = t('field.type.search.empty');
    emptyNote.hidden = true;
    for (const candidate of FIELD_TYPES) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'loom-field-editor-type clickable-icon';
      item.setAttribute('role', 'option');
      item.dataset.type = candidate;
      item.setAttribute('aria-selected', String(candidate === type));
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
      item.addEventListener('click', () => {
        type = candidate;
        typeList
          .querySelectorAll('.loom-field-editor-type')
          .forEach((el) => el.setAttribute('aria-selected', String(el === item)));
        renderConfig();
      });
      typeList.append(item);
    }
    search.addEventListener('input', () => {
      const query = search.value.trim().toLowerCase();
      let visible = 0;
      for (const item of typeList.querySelectorAll<HTMLElement>('.loom-field-editor-type')) {
        const match = query === '' || (item.textContent ?? '').toLowerCase().includes(query);
        item.hidden = !match;
        if (match) visible += 1;
      }
      emptyNote.hidden = visible > 0;
    });
    panel.append(typeList, emptyNote);
  } else {
    const typeRow = document.createElement('div');
    typeRow.className = 'loom-field-editor-type-fixed';
    typeRow.append(createFieldTypeIcon(type));
    const label = document.createElement('span');
    label.textContent = t(`field.type.${type}`);
    typeRow.append(label);
    panel.append(typeRow);
  }

  panel.append(configHost);

  const optionDrafts: OptionDraft[] = initialOptionDrafts(options.field);
  let maxCount = options.field?.type === 'attachment' ? options.field.config.maxCount : 10;
  // The palette is an owned child of this editor: the parent holds its
  // disposer so choice, replacement, close and owner unload all release
  // the capture listener, never just the detached DOM.
  let paletteDismiss: (() => void) | null = null;
  const dismissPalette = (): void => {
    paletteDismiss?.();
  };

  const renderConfig = (): void => {
    dismissPalette();
    configHost.replaceChildren();
    if (type === 'select' || type === 'multiSelect') {
      configHost.append(createOptionsEditor());
    } else if (type === 'attachment') {
      const row = document.createElement('label');
      row.className = 'loom-field-editor-maxcount';
      const label = document.createElement('span');
      label.textContent = t('field.attachment.maxCount');
      const input = document.createElement('input');
      input.type = 'number';
      input.min = '1';
      input.max = '100';
      input.value = String(maxCount);
      input.addEventListener('input', () => {
        const value = Number.parseInt(input.value, 10);
        if (Number.isFinite(value)) maxCount = Math.max(1, Math.min(100, value));
      });
      row.append(label, input);
      configHost.append(row);
    }
  };

  const createOptionsEditor = (): HTMLElement => {
    const editor = document.createElement('div');
    editor.className = 'loom-field-editor-options';
    const heading = document.createElement('div');
    heading.className = 'loom-field-editor-options-label';
    heading.textContent = t('field.options.label');
    editor.append(heading);
    const list = document.createElement('div');
    list.className = 'loom-field-editor-option-list';

    const renderRows = (): void => {
      // Rebuilding the rows detaches a mounted palette — release its
      // document listener through the owned disposer before dropping DOM.
      dismissPalette();
      list.replaceChildren();
      optionDrafts.forEach((draft, index) => {
        if (draft.deleted) return;
        const row = document.createElement('div');
        row.className = 'loom-field-editor-option-row';
        const swatch = document.createElement('button');
        swatch.type = 'button';
        swatch.className = 'loom-field-editor-swatch clickable-icon';
        swatch.dataset.color = draft.color;
        swatch.setAttribute('aria-label', t('field.option.color'));
        swatch.addEventListener('click', () => openPalette(swatch, index));
        const input = document.createElement('input');
        input.type = 'text';
        input.value = draft.name;
        input.placeholder = t('field.option.name.placeholder');
        input.setAttribute('aria-label', t('field.option.name.placeholder'));
        input.addEventListener('input', () => {
          draft.name = input.value;
        });
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'loom-field-editor-option-remove clickable-icon';
        remove.setAttribute('aria-label', t('field.option.remove'));
        remove.append(createUiIcon('menu-clear'));
        remove.addEventListener('click', () => {
          draft.deleted = true;
          renderRows();
        });
        row.append(swatch, input, remove);
        list.append(row);
      });
      const addRow = document.createElement('button');
      addRow.type = 'button';
      addRow.className = 'loom-field-editor-option-add clickable-icon';
      addRow.append(createUiIcon('view-add'));
      const addLabel = document.createElement('span');
      addLabel.textContent = t('field.option.add');
      addRow.append(addLabel);
      addRow.addEventListener('click', () => {
        optionDrafts.push({
          name: '',
          color: nextOptionColor(optionDrafts.length),
          deleted: false,
        });
        renderRows();
        list
          .querySelectorAll<HTMLInputElement>('.loom-field-editor-option-row input')
          .item(list.querySelectorAll('.loom-field-editor-option-row').length - 1)
          ?.focus();
      });
      list.append(addRow);
    };

    const openPalette = (anchor: HTMLButtonElement, index: number): void => {
      dismissPalette();
      const palette = document.createElement('div');
      palette.className = 'loom-field-editor-palette';
      palette.setAttribute('role', 'listbox');
      palette.setAttribute('aria-label', t('field.option.color'));
      for (const color of SELECT_OPTION_COLORS) {
        const choice = document.createElement('button');
        choice.type = 'button';
        choice.className = 'loom-field-editor-swatch clickable-icon';
        choice.dataset.color = color;
        choice.setAttribute('aria-label', t(`field.color.${color}`));
        choice.addEventListener('click', () => {
          const target = optionDrafts[index];
          if (target !== undefined) target.color = color;
          dismissPalette();
          renderRows();
        });
        palette.append(choice);
      }
      anchor.after(palette);
      const dismiss = (event: PointerEvent): void => {
        if (!palette.contains(event.target as Node) && event.target !== anchor) {
          dismissPalette();
        }
      };
      paletteDismiss = () => {
        // The palette rides inside the option row; a rows rebuild detaches
        // it without a remove() call, so the listener must be dropped
        // unconditionally — isConnected early-returns would leak it.
        palette.remove();
        document.removeEventListener('pointerdown', dismiss, true);
        paletteDismiss = null;
      };
      document.addEventListener('pointerdown', dismiss, true);
    };

    renderRows();
    editor.append(list);
    return editor;
  };

  const errorEl = document.createElement('p');
  errorEl.className = 'loom-field-editor-error';
  errorEl.setAttribute('role', 'alert');
  errorEl.hidden = true;
  panel.append(errorEl);

  const submitControl = createLoomButton({
    label: t(options.mode === 'create' ? 'field.submit.create' : 'field.submit.save'),
    variant: 'primary',
    size: 'default',
    reserveBusySpace: true,
    onActivate: () => void doSubmit(),
  });
  const submit = submitControl.element;
  submit.classList.add('loom-field-editor-submit');

  const showError = (message: string): void => {
    errorEl.textContent = message;
    errorEl.hidden = false;
  };
  const clearError = (): void => {
    errorEl.textContent = '';
    errorEl.hidden = true;
  };
  nameInput.addEventListener('input', () => {
    nameInput.removeAttribute('aria-invalid');
    clearError();
  });

  let closed = false;
  const restoreFocus = (): void => {
    const connectedTrigger =
      options.trigger !== undefined && options.trigger.isConnected ? options.trigger : null;
    (connectedTrigger ?? options.restoreFocusTarget?.() ?? null)?.focus();
  };
  // Explicit closes (Escape, a successful submit) return focus to the
  // invoking trigger; external dismissal — outside pointerdown, scroll, a
  // disconnected owner, or the owner's handle — never steals the user's
  // new focus target.
  const close = (returnFocus = false): void => {
    if (closed) return;
    closed = true;
    observer.disconnect();
    dismissPalette();
    submitControl.dispose();
    panel.remove();
    options.host.removeEventListener('scroll', onScroll);
    document.removeEventListener('pointerdown', onPointerDown, true);
    document.removeEventListener('keydown', onKeyDown, true);
    if (focusTimer !== null) window.clearTimeout(focusTimer);
    focusTimer = null;
    if (returnFocus) restoreFocus();
  };
  // Owner unload (view switch, map swap, pane teardown) must release every
  // document listener and the palette — the editor cannot keep trapping
  // Tab or focus after its host leaves the document.
  const observer = new MutationObserver(() => {
    if (!options.host.isConnected) close();
  });

  // While a submit is in flight the draft is locked: every mutable control
  // is disabled so a still-pending write cannot be overtaken by edits that
  // a late success would silently discard. Failure restores the controls.
  const lockedControls: Array<
    HTMLInputElement | HTMLSelectElement | HTMLButtonElement | HTMLTextAreaElement
  > = [];
  const lockDraft = (): void => {
    lockedControls.length = 0;
    for (const el of panel.querySelectorAll<
      HTMLInputElement | HTMLSelectElement | HTMLButtonElement | HTMLTextAreaElement
    >('input, select, button, textarea')) {
      if (el.disabled) continue;
      el.disabled = true;
      lockedControls.push(el);
    }
  };
  const unlockDraft = (): void => {
    for (const el of lockedControls) el.disabled = false;
    lockedControls.length = 0;
  };

  let submitting = false;
  const doSubmit = async (): Promise<void> => {
    if (submitting || closed) return;
    const name = nameInput.value.trim();
    if (name === '') {
      nameInput.setAttribute('aria-invalid', 'true');
      showError(t('field.name.required'));
      nameInput.focus();
      return;
    }
    const input: FieldEditorSubmit = {
      name,
      type,
      description: descInput.value.trim(),
      ...(type === 'select' || type === 'multiSelect'
        ? {
            options: optionDrafts
              .filter((draft) => !draft.deleted && draft.name.trim() !== '')
              .map((draft) => ({
                ...(draft.id === undefined ? {} : { id: draft.id }),
                name: draft.name.trim(),
                color: draft.color,
              })),
          }
        : {}),
      ...(type === 'attachment' ? { maxCount } : {}),
    };
    // The dialog owns the draft until the write resolves: it stays open and
    // inert to re-entry while in flight, and a rejected outcome keeps the
    // draft with the failure surfaced instead of silently closing.
    submitting = true;
    clearError();
    dismissPalette();
    lockDraft();
    panel.dataset.submitting = 'true';
    submitControl.update({ busy: true });
    try {
      await options.onSubmit(input);
    } catch {
      if (closed) return;
      submitting = false;
      delete panel.dataset.submitting;
      unlockDraft();
      submitControl.update({ busy: false });
      // Consumer/transport errors are diagnostics, not localized UI copy.
      // Keep the draft and retry path without exposing arbitrary internals.
      showError(t('field.submit.failed'));
      return;
    }
    close(true);
  };

  panel.append(submit);

  const onScroll = (): void => close();
  const onPointerDown = (event: PointerEvent): void => {
    if (!panel.contains(event.target as Node)) close();
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
      return;
    }
    if (event.key === 'Tab') {
      // Dialog semantics: Tab/Shift+Tab cycle inside the panel and must not
      // leak into the grid behind it.
      event.preventDefault();
      const focusable = getFocusableElements(panel);
      if (focusable.length === 0) return;
      const active = document.activeElement;
      const index = active instanceof HTMLElement ? focusable.indexOf(active) : -1;
      const next =
        event.shiftKey === true
          ? index <= 0
            ? focusable.length - 1
            : index - 1
          : index === -1 || index === focusable.length - 1
            ? 0
            : index + 1;
      focusable[next]?.focus();
      return;
    }
    if (event.key === 'Enter' && event.target === nameInput) {
      event.preventDefault();
      void doSubmit();
    }
  };

  const hostRect = options.host.getBoundingClientRect();
  panel.classList.add('loom-field-editor--measuring');
  options.host.append(panel);
  const panelRect = panel.getBoundingClientRect();
  const offsetX = options.x - hostRect.left + options.host.scrollLeft;
  const offsetY = options.y - hostRect.top + options.host.scrollTop;
  panel.style.left = `${Math.max(0, Math.min(offsetX, options.host.scrollWidth - panelRect.width - 4))}px`;
  panel.style.top = `${Math.max(0, Math.min(offsetY, options.host.scrollHeight - panelRect.height - 4))}px`;
  panel.classList.remove('loom-field-editor--measuring');

  renderConfig();
  observer.observe(options.host.ownerDocument.documentElement, {
    childList: true,
    subtree: true,
  });
  options.host.addEventListener('scroll', onScroll);
  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('keydown', onKeyDown, true);
  // Focus is deferred past the opening click's dispatch: opening the editor
  // re-renders the grid, which detaches the clicked trigger mid-dispatch, and
  // the browser then resets focus to <body> — undoing a synchronous focus().
  // Browsers additionally swallow focus() calls made while the click gesture
  // is still settling, so retry briefly until the input actually holds focus.
  // Retries stop when the panel closed (e.g. outside click) or focus already
  // lives inside it, so a deliberate click-away is never overridden.
  let focusAttempts = 0;
  let focusTimer: number | null = null;
  const focusName = (): void => {
    if (closed || !panel.isConnected) return;
    const active = document.activeElement;
    if (active instanceof Node && panel.contains(active)) return;
    nameInput.focus();
    if (document.activeElement === nameInput) {
      nameInput.select();
      return;
    }
    focusAttempts += 1;
    if (focusAttempts < 12) focusTimer = window.setTimeout(focusName, 50);
  };
  focusTimer = window.setTimeout(focusName, 0);
  return close;
}

function initialOptionDrafts(field: Field | undefined): OptionDraft[] {
  if (field === undefined || (field.type !== 'select' && field.type !== 'multiSelect')) {
    return [];
  }
  return field.config.options.map((option) => ({
    id: option.id,
    name: option.name,
    color: option.color as SelectOptionColor,
    deleted: false,
  }));
}

function nextOptionColor(index: number): SelectOptionColor {
  return SELECT_OPTION_COLORS[index % SELECT_OPTION_COLORS.length] ?? 'gray';
}
