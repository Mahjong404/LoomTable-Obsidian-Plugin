import type { Field, SelectOptionColor, SelectOptionInput } from '../client/loomtable-client';
import type { Translator } from '../i18n';
import { createFieldTypeIcon } from './field-type-icon';
import { createUiIcon } from './icons';

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
}

export interface FieldEditorOptions {
  readonly mode: 'create' | 'edit';
  readonly field?: Field;
  readonly defaultType?: Field['type'];
  readonly x: number;
  readonly y: number;
  readonly host: HTMLElement;
  readonly trigger?: HTMLElement;
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
 * Opens the duowei-style field create/edit popover anchored at pointer
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

  let type: Field['type'] = options.field?.type ?? options.defaultType ?? 'text';
  const configHost = document.createElement('div');
  configHost.className = 'loom-field-editor-config';

  if (options.mode === 'create') {
    const typeList = document.createElement('div');
    typeList.className = 'loom-field-editor-types';
    typeList.setAttribute('role', 'listbox');
    typeList.setAttribute('aria-label', t('field.type.label'));
    for (const candidate of FIELD_TYPES) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'loom-field-editor-type clickable-icon';
      item.setAttribute('role', 'option');
      item.dataset.type = candidate;
      item.setAttribute('aria-selected', String(candidate === type));
      item.append(createFieldTypeIcon(candidate));
      const label = document.createElement('span');
      label.textContent = t(`field.type.${candidate}`);
      item.append(label);
      item.addEventListener('click', () => {
        type = candidate;
        typeList
          .querySelectorAll('.loom-field-editor-type')
          .forEach((el) => el.setAttribute('aria-selected', String(el === item)));
        renderConfig();
      });
      typeList.append(item);
    }
    panel.append(typeList);
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

  const renderConfig = (): void => {
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
      panel.querySelector('.loom-field-editor-palette')?.remove();
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
          palette.remove();
          renderRows();
        });
        palette.append(choice);
      }
      anchor.after(palette);
      const dismiss = (event: PointerEvent): void => {
        if (!palette.contains(event.target as Node) && event.target !== anchor) {
          palette.remove();
          document.removeEventListener('pointerdown', dismiss, true);
        }
      };
      document.addEventListener('pointerdown', dismiss, true);
    };

    renderRows();
    editor.append(list);
    return editor;
  };

  const submit = document.createElement('button');
  submit.type = 'button';
  submit.className = 'loom-field-editor-submit loom-button-primary';
  submit.textContent = t(options.mode === 'create' ? 'field.submit.create' : 'field.submit.save');

  const close = (): void => {
    panel.remove();
    options.host.removeEventListener('scroll', onScroll);
    document.removeEventListener('pointerdown', onPointerDown, true);
    document.removeEventListener('keydown', onKeyDown, true);
    options.trigger?.focus();
  };

  const doSubmit = async (): Promise<void> => {
    const name = nameInput.value.trim();
    if (name === '') {
      nameInput.focus();
      return;
    }
    const input: FieldEditorSubmit = {
      name,
      type,
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
    close();
    await options.onSubmit(input);
  };

  submit.addEventListener('click', () => void doSubmit());
  panel.append(submit);

  const onScroll = (): void => close();
  const onPointerDown = (event: PointerEvent): void => {
    if (!panel.contains(event.target as Node)) close();
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
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
  options.host.addEventListener('scroll', onScroll);
  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('keydown', onKeyDown, true);
  nameInput.focus();
  nameInput.select();
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
