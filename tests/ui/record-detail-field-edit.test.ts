import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  LoomTableClientError,
  type Field,
  type JsonValue,
  type LoomTableRecord,
  type SelectFieldConfig,
} from '../../src/client/loomtable-client';
import { createTranslator } from '../../src/i18n';
import { createRecordDetail } from '../../src/ui/record-detail';

describe('Record Detail scalar field editing', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('edits Text, Long Text, Number, Checkbox, and Date through one typed seam', async () => {
    const container = document.createElement('div');
    const fields = [
      createField('field_text', 'Text', 'text'),
      createField('field_long', 'Long Text', 'longText'),
      createField('field_number', 'Number', 'number'),
      createField('field_checkbox', 'Checkbox', 'checkbox'),
      createField('field_date', 'Date', 'date'),
    ];
    const initial = createRecord({
      field_text: 'old text',
      field_long: 'old long text',
      field_number: 1,
      field_checkbox: false,
      field_date: '2026-01-02',
    });
    const onFieldEdit = vi.fn(
      async (
        _recordId: string,
        fieldId: string,
        value: JsonValue,
        sourceRecord: LoomTableRecord,
      ): Promise<LoomTableRecord> => ({
        ...sourceRecord,
        revision: sourceRecord.revision + 1,
        values: { ...sourceRecord.values, [fieldId]: value },
      }),
    );
    const detail = createRecordDetail(initial, {
      fields,
      translate: createTranslator('en'),
      callbacks: { onFieldEdit },
    });
    container.append(detail);
    document.body.append(container);

    const edits: readonly [string, string | boolean][] = [
      ['field_text', 'new text'],
      ['field_long', 'new long text'],
      ['field_number', '42'],
      ['field_checkbox', true],
      ['field_date', '2026-02-03'],
    ];
    for (const [index, [fieldId, value]] of edits.entries()) {
      detail
        .querySelector<HTMLButtonElement>(`.loom-record-field-edit[data-field-id="${fieldId}"]`)
        ?.click();
      const editor = detail.querySelector<HTMLInputElement | HTMLTextAreaElement>(
        `.loom-record-field-editor[data-field-id="${fieldId}"] input, .loom-record-field-editor[data-field-id="${fieldId}"] textarea`,
      );
      expect(editor).not.toBeNull();
      if (editor === null) return;
      if (editor instanceof HTMLInputElement && editor.type === 'checkbox')
        editor.checked = value === true;
      else editor.value = String(value);
      editor.dispatchEvent(new Event('input', { bubbles: true }));
      const form = detail.querySelector<HTMLFormElement>(
        `.loom-record-field-editor[data-field-id="${fieldId}"]`,
      );
      expect(form).not.toBeNull();
      form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await vi.waitFor(() => expect(onFieldEdit).toHaveBeenCalledTimes(index + 1));
    }

    expect(onFieldEdit.mock.calls.map((call) => call[1])).toEqual([
      'field_text',
      'field_long',
      'field_number',
      'field_checkbox',
      'field_date',
    ]);
    expect(onFieldEdit.mock.calls.map((call) => call[2])).toEqual([
      'new text',
      'new long text',
      42,
      true,
      '2026-02-03',
    ]);
    expect(detail.textContent).toContain('2026-02-03');
  });

  it('edits URL, Select, and MultiSelect through the shared Detail editor seam', async () => {
    const container = document.createElement('div');
    const fields = [
      createField('field_url', 'URL', 'url'),
      createSelectField('field_select', 'Select', 'select'),
      createSelectField('field_multi', 'MultiSelect', 'multiSelect'),
    ];
    const initial = createRecord({
      field_url: 'https://example.com/old',
      field_select: 'option_deleted',
      field_multi: ['option_active', 'option_deleted'],
    });
    const onFieldEdit = vi.fn(
      async (
        _recordId: string,
        fieldId: string,
        value: JsonValue,
        sourceRecord: LoomTableRecord,
      ): Promise<LoomTableRecord> => ({
        ...sourceRecord,
        revision: sourceRecord.revision + 1,
        values: { ...sourceRecord.values, [fieldId]: value },
      }),
    );
    const detail = createRecordDetail(initial, {
      fields,
      translate: createTranslator('en'),
      callbacks: { onFieldEdit },
    });
    container.append(detail);
    document.body.append(container);

    detail
      .querySelector<HTMLButtonElement>('.loom-record-field-edit[data-field-id="field_url"]')
      ?.click();
    const urlEditor = detail.querySelector<HTMLInputElement>(
      '.loom-record-field-editor[data-field-id="field_url"] input[type="url"]',
    );
    const urlForm = detail.querySelector<HTMLFormElement>(
      '.loom-record-field-editor[data-field-id="field_url"]',
    );
    expect(urlEditor).not.toBeNull();
    expect(urlForm).not.toBeNull();
    if (urlEditor === null || urlForm === null) return;
    urlEditor.value = 'javascript:alert(1)';
    urlForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(onFieldEdit).not.toHaveBeenCalled();
    expect(urlEditor.getAttribute('aria-invalid')).toBe('true');

    urlEditor.value = 'https://example.com/new';
    urlEditor.dispatchEvent(new Event('input', { bubbles: true }));
    urlForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(onFieldEdit).toHaveBeenCalledTimes(1));
    expect(onFieldEdit.mock.calls[0]?.[2]).toBe('https://example.com/new');

    detail
      .querySelector<HTMLButtonElement>('.loom-record-field-edit[data-field-id="field_select"]')
      ?.click();
    const selectEditor = detail.querySelector<HTMLSelectElement>(
      '.loom-record-field-editor[data-field-id="field_select"] select:not([multiple])',
    );
    const selectForm = detail.querySelector<HTMLFormElement>(
      '.loom-record-field-editor[data-field-id="field_select"]',
    );
    expect(selectEditor).not.toBeNull();
    expect(selectForm).not.toBeNull();
    if (selectEditor === null || selectForm === null) return;
    expect(selectEditor.value).toBe('option_deleted');
    expect(selectEditor.textContent).toContain('Deleted option');
    selectEditor.value = 'option_active';
    selectEditor.dispatchEvent(new Event('change', { bubbles: true }));
    selectForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(onFieldEdit).toHaveBeenCalledTimes(2));
    expect(onFieldEdit.mock.calls[1]?.[2]).toBe('option_active');

    detail
      .querySelector<HTMLButtonElement>('.loom-record-field-edit[data-field-id="field_multi"]')
      ?.click();
    const multiEditor = detail.querySelector<HTMLSelectElement>(
      '.loom-record-field-editor[data-field-id="field_multi"] select[multiple]',
    );
    const multiForm = detail.querySelector<HTMLFormElement>(
      '.loom-record-field-editor[data-field-id="field_multi"]',
    );
    expect(multiEditor).not.toBeNull();
    expect(multiForm).not.toBeNull();
    if (multiEditor === null || multiForm === null) return;
    expect([...multiEditor.selectedOptions].map((option) => option.value)).toEqual([
      'option_active',
      'option_deleted',
    ]);
    for (const option of multiEditor.options) option.selected = option.value === 'option_active';
    multiEditor.dispatchEvent(new Event('change', { bubbles: true }));
    multiForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(onFieldEdit).toHaveBeenCalledTimes(3));
    expect(onFieldEdit.mock.calls[2]?.[2]).toEqual(['option_active']);
  });

  it('keeps unavailable Select and MultiSelect options safe in Detail editing', () => {
    const container = document.createElement('div');
    const onFieldEdit = vi.fn();
    const detail = createRecordDetail(
      createRecord({ field_select: 'foreign_option', field_multi: ['foreign_option'] }),
      {
        fields: [
          createSelectField('field_select', 'Select', 'select'),
          createSelectField('field_multi', 'MultiSelect', 'multiSelect'),
        ],
        translate: createTranslator('en'),
        callbacks: { onFieldEdit },
      },
    );
    container.append(detail);
    document.body.append(container);

    detail
      .querySelector<HTMLButtonElement>('.loom-record-field-edit[data-field-id="field_select"]')
      ?.click();
    const selectEditor = detail.querySelector<HTMLSelectElement>(
      '.loom-record-field-editor[data-field-id="field_select"] select',
    );
    expect(selectEditor?.selectedOptions[0]?.dataset.optionState).toBe('unavailable');
    expect(selectEditor?.selectedOptions[0]?.textContent).not.toContain('foreign_option');
    const selectForm = detail.querySelector<HTMLFormElement>(
      '.loom-record-field-editor[data-field-id="field_select"]',
    );
    selectForm?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(onFieldEdit).not.toHaveBeenCalled();
    expect(selectEditor?.getAttribute('aria-invalid')).toBe('true');

    detail
      .querySelector<HTMLButtonElement>('.loom-record-field-edit[data-field-id="field_multi"]')
      ?.click();
    const multiEditor = detail.querySelector<HTMLSelectElement>(
      '.loom-record-field-editor[data-field-id="field_multi"] select[multiple]',
    );
    expect(multiEditor?.selectedOptions[0]?.dataset.optionState).toBe('unavailable');
    expect(multiEditor?.selectedOptions[0]?.textContent).not.toContain('foreign_option');
  });

  it('keeps a scalar draft on validation failure and restores the editor focus', () => {
    const container = document.createElement('div');
    const onFieldEdit = vi.fn();
    const detail = createRecordDetail(createRecord({ field_date: '2026-01-02' }), {
      fields: [createField('field_date', 'Date', 'date')],
      translate: createTranslator('en'),
      callbacks: { onFieldEdit },
    });
    container.append(detail);
    document.body.append(container);

    detail.querySelector<HTMLButtonElement>('.loom-record-field-edit')?.click();
    const editor = detail.querySelector<HTMLInputElement>('.loom-record-field-editor input');
    const form = detail.querySelector<HTMLFormElement>('.loom-record-field-editor');
    expect(editor).not.toBeNull();
    expect(form).not.toBeNull();
    if (editor === null || form === null) return;
    editor.value = '2026-02-30';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    expect(onFieldEdit).not.toHaveBeenCalled();
    expect(editor.getAttribute('aria-invalid')).toBe('true');
    expect(editor.getAttribute('aria-describedby')).toBeTruthy();
    expect(detail.querySelector<HTMLElement>('.loom-record-field-error')?.textContent).toContain(
      'Date',
    );
    expect(document.activeElement).toBe(editor);
  });

  it('cancels a changed draft with Escape without submitting it', () => {
    const container = document.createElement('div');
    const confirmDiscard = vi.fn().mockReturnValue(true);
    const onFieldEdit = vi.fn();
    const detail = createRecordDetail(createRecord({ field_text: 'old' }), {
      fields: [createField('field_text', 'Text', 'text')],
      translate: createTranslator('en'),
      confirmDiscard,
      callbacks: { onFieldEdit },
    });
    container.append(detail);
    document.body.append(container);

    detail.querySelector<HTMLButtonElement>('.loom-record-field-edit')?.click();
    const editor = detail.querySelector<HTMLInputElement>('.loom-record-field-editor input');
    const form = detail.querySelector<HTMLFormElement>('.loom-record-field-editor');
    expect(editor).not.toBeNull();
    expect(form).not.toBeNull();
    if (editor === null || form === null) return;
    editor.value = 'draft';
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(confirmDiscard).toHaveBeenCalledWith('Discard unsaved changes to this field?');
    expect(onFieldEdit).not.toHaveBeenCalled();
    expect(detail.querySelector('.loom-record-field-editor')).toBeNull();
    expect(document.activeElement).toBe(
      detail.querySelector<HTMLButtonElement>('.loom-record-field-edit'),
    );
  });

  it('does not allow offline editing', () => {
    const container = document.createElement('div');
    const onFieldEdit = vi.fn();
    const detail = createRecordDetail(createRecord({ field_text: 'old' }), {
      fields: [createField('field_text', 'Text', 'text')],
      translate: createTranslator('en'),
      offline: true,
      callbacks: { onFieldEdit },
    });
    container.append(detail);
    document.body.append(container);

    const edit = detail.querySelector<HTMLButtonElement>('.loom-record-field-edit');
    expect(edit?.disabled).toBe(true);
    expect(edit?.getAttribute('aria-label')).toContain('Offline');
    edit?.click();
    expect(detail.querySelector('.loom-record-field-editor')).toBeNull();
    expect(onFieldEdit).not.toHaveBeenCalled();
  });

  it('submits once on Enter and disables the editor while saving', async () => {
    const container = document.createElement('div');
    let resolveSave: ((record: LoomTableRecord) => void) | undefined;
    const pending = new Promise<LoomTableRecord>((resolve) => {
      resolveSave = resolve;
    });
    const returnedRecord = { ...createRecord({ field_text: 'saved' }), revision: 2 };
    const onFieldEdit = vi.fn(
      (
        _recordId: string,
        _fieldId: string,
        _value: JsonValue,
        _sourceRecord: LoomTableRecord,
      ): Promise<LoomTableRecord> => pending,
    );
    const detail = createRecordDetail(createRecord({ field_text: 'old' }), {
      fields: [createField('field_text', 'Text', 'text')],
      translate: createTranslator('en'),
      callbacks: { onFieldEdit },
    });
    container.append(detail);
    document.body.append(container);

    detail.querySelector<HTMLButtonElement>('.loom-record-field-edit')?.click();
    const editor = detail.querySelector<HTMLInputElement>('.loom-record-field-editor input');
    const form = detail.querySelector<HTMLFormElement>('.loom-record-field-editor');
    expect(editor).not.toBeNull();
    expect(form).not.toBeNull();
    if (editor === null || form === null) return;
    editor.value = 'saved';
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(onFieldEdit).toHaveBeenCalledTimes(1);
    expect(form.dataset.saving).toBe('true');
    expect(form.getAttribute('aria-busy')).toBe('true');
    expect(editor.disabled).toBe(true);
    resolveSave?.(returnedRecord);

    await vi.waitFor(() => {
      expect(document.activeElement).toBe(
        detail.querySelector<HTMLButtonElement>('.loom-record-field-edit'),
      );
    });
    expect(detail.textContent).toContain('saved');
    expect(detail.querySelector('.loom-record-detail-status')?.textContent).toContain(
      'Field saved.',
    );
  });

  it('shows the conflict surface without announcing a saved field', async () => {
    const container = document.createElement('div');
    const conflict = {
      clientMutationId: 'mut_0123456789ABCDEFGHJKMNPQRS',
      failedCommandIndex: 0,
      expectedRevision: 1,
      currentRevision: 2,
      currentValues: { field_text: 'server' },
      submittedSet: { field_text: 'local' },
      submittedUnsetFieldIds: [],
      message: 'Revision conflict.',
    };
    const onFieldEdit = vi
      .fn()
      .mockRejectedValue(new LoomTableClientError('conflict', { message: conflict.message }));
    const detail = createRecordDetail(createRecord({ field_text: 'old' }), {
      fields: [createField('field_text', 'Text', 'text')],
      translate: createTranslator('en'),
      callbacks: { onFieldEdit, getConflict: () => conflict },
    });
    container.append(detail);
    document.body.append(container);

    detail.querySelector<HTMLButtonElement>('.loom-record-field-edit')?.click();
    const editor = detail.querySelector<HTMLInputElement>('.loom-record-field-editor input');
    const form = detail.querySelector<HTMLFormElement>('.loom-record-field-editor');
    expect(editor).not.toBeNull();
    expect(form).not.toBeNull();
    if (editor === null || form === null) return;
    editor.value = 'local';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    await vi.waitFor(() => expect(detail.querySelector('.loom-record-conflict')).not.toBeNull());
    expect(detail.querySelector('.loom-record-detail-status')?.textContent).not.toContain(
      'Field saved.',
    );
    expect(document.activeElement).toBe(detail.querySelector('.loom-record-conflict'));
  });

  it('keeps the local intent and focuses the editor after a save error', async () => {
    const container = document.createElement('div');
    const onFieldEdit = vi
      .fn()
      .mockRejectedValue(new LoomTableClientError('network', { message: 'raw server detail' }));
    const detail = createRecordDetail(createRecord({ field_text: 'old' }), {
      fields: [createField('field_text', 'Text', 'text')],
      translate: createTranslator('zh-CN'),
      callbacks: { onFieldEdit },
    });
    container.append(detail);
    document.body.append(container);

    detail.querySelector<HTMLButtonElement>('.loom-record-field-edit')?.click();
    const editor = detail.querySelector<HTMLInputElement>('.loom-record-field-editor input');
    const form = detail.querySelector<HTMLFormElement>('.loom-record-field-editor');
    expect(editor).not.toBeNull();
    expect(form).not.toBeNull();
    if (editor === null || form === null) return;
    editor.value = 'intent';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    await vi.waitFor(() => expect(onFieldEdit).toHaveBeenCalledTimes(1));
    expect(editor.value).toBe('intent');
    expect(detail.querySelector('.loom-record-field-error')?.textContent).toContain('保存失败');
    expect(detail.querySelector('.loom-record-field-error')?.textContent).not.toContain(
      'raw server detail',
    );
    expect(document.activeElement).toBe(editor);
    expect(detail.querySelector('.loom-record-detail-status')?.textContent).not.toContain(
      '字段已保存',
    );
  });
});

function createField(
  id: string,
  name: string,
  type: 'text' | 'longText' | 'number' | 'checkbox' | 'date' | 'url',
): Field {
  return {
    id,
    tableId: 'table_01',
    name,
    position: 0,
    schemaVersion: 1,
    revision: 1,
    type,
    config: {},
  };
}

function createSelectField(id: string, name: string, type: 'select' | 'multiSelect'): Field {
  const config: SelectFieldConfig = {
    options: [{ id: 'option_active', name: 'Active option', color: '#00aaff' }],
    deletedOptions: [
      {
        id: 'option_deleted',
        name: 'Deleted option',
        color: '#888888',
        deletedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
  };
  return {
    id,
    tableId: 'table_01',
    name,
    position: 0,
    schemaVersion: 1,
    revision: 1,
    type,
    config,
  };
}

function createRecord(values: Record<string, unknown>): LoomTableRecord {
  return {
    id: 'record_01',
    tableId: 'table_01',
    revision: 1,
    values: values as LoomTableRecord['values'],
    createdAt: '',
    updatedAt: '',
  };
}
