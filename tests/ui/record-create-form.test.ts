import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  type Field,
  type MutationValue,
  type SelectFieldConfig,
} from '../../src/client/loomtable-client';
import { createTranslator } from '../../src/i18n';
import {
  createRecordCreateForm,
  type RecordCreateFormOptions,
} from '../../src/ui/record-create-form';

describe('Record create form', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('renders active fields in order with every control starting Unset', () => {
    const { form } = mount({
      fields: [
        field('field_text', 'Name', 'text'),
        field('field_number', 'Amount', 'number'),
        selectField('field_select', 'Status', 'select'),
      ],
    });

    const rows = form.element.querySelectorAll('.loom-record-create-field');
    expect([...rows].map((row) => (row as HTMLElement).dataset.fieldId)).toEqual([
      'field_text',
      'field_number',
      'field_select',
    ]);
    expect(rows[0]?.textContent).toContain('Name');
    expect(
      form.element.querySelector<HTMLInputElement>('[data-field-id="field_text"] input')?.value,
    ).toBe('');
    expect(
      form.element.querySelector<HTMLSelectElement>('[data-field-id="field_select"] select')?.value,
    ).toBe('');
  });

  it('shows an add-after-create hint for Attachment fields without an editor', () => {
    const { form } = mount({ fields: [field('field_files', 'Files', 'attachment')] });

    const row = form.element.querySelector<HTMLElement>('[data-field-id="field_files"]');
    expect(row?.textContent).toContain('after creating');
    expect(row?.querySelector('input, select, textarea')).toBeNull();
  });

  it('submits an empty values object when nothing was touched', () => {
    const onSubmit = vi.fn();
    const { form } = mount({ fields: [field('field_text', 'Name', 'text')], onSubmit });

    submitForm(form.element);

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]?.[0]).toEqual({});
  });

  it('submits only touched fields and normalizes cleared controls to null', () => {
    const onSubmit = vi.fn();
    const { form } = mount({
      fields: [
        field('field_text', 'Name', 'text'),
        field('field_number', 'Amount', 'number'),
        selectField('field_select', 'Status', 'select'),
      ],
      onSubmit,
    });

    setInput(form.element, 'field_text', '  draft name  ');
    setInput(form.element, 'field_number', '12.5');
    // Touch the select then return it to empty: an explicit clear.
    const select = form.element.querySelector<HTMLSelectElement>(
      '[data-field-id="field_select"] select',
    );
    if (select === null) throw new Error('missing select');
    select.value = 'option_active';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    select.value = '';
    select.dispatchEvent(new Event('change', { bubbles: true }));

    submitForm(form.element);

    expect(onSubmit).toHaveBeenCalledWith({
      field_text: '  draft name  ',
      field_number: 12.5,
      field_select: null,
    });
  });

  it('reports a field error and blocks submit when a value fails validation', () => {
    const onSubmit = vi.fn();
    const { form: urlForm } = mount({
      fields: [field('field_url', 'Site', 'url')],
      onSubmit,
    });

    setInput(urlForm.element, 'field_url', 'not a url');
    submitForm(urlForm.element);

    expect(onSubmit).not.toHaveBeenCalled();
    const row = urlForm.element.querySelector<HTMLElement>('[data-field-id="field_url"]');
    expect(row?.dataset.invalid).toBe('true');
    expect(row?.querySelector('.loom-record-create-field-error')?.textContent).not.toBe('');
    // Draft is retained for correction.
    expect(
      urlForm.element.querySelector<HTMLInputElement>('[data-field-id="field_url"] input')?.value,
    ).toBe('not a url');
  });

  it('collects a normalized Location draft through the location editor', () => {
    const onSubmit = vi.fn();
    const { form } = mount({ fields: [field('field_place', 'Place', 'location')], onSubmit });

    const row = form.element.querySelector<HTMLElement>('[data-field-id="field_place"]');
    const input = (name: string) =>
      row?.querySelector<HTMLInputElement>(`input[data-loc-field="${name}"]`);
    if (row === null || input('lat') === null || input('lng') === null) {
      throw new Error('missing location draft inputs');
    }
    input('lat')!.value = '31.2';
    input('lat')!.dispatchEvent(new Event('input', { bubbles: true }));
    input('lng')!.value = '121.5';
    input('lng')!.dispatchEvent(new Event('input', { bubbles: true }));
    input('label')!.value = 'HQ';
    input('label')!.dispatchEvent(new Event('input', { bubbles: true }));

    submitForm(form.element);

    expect(onSubmit).toHaveBeenCalledWith({
      field_place: { label: 'HQ', lat: 31.2, lng: 121.5 },
    });
  });

  it('rejects a partially filled Location draft with a field error', () => {
    const onSubmit = vi.fn();
    const { form } = mount({ fields: [field('field_place', 'Place', 'location')], onSubmit });

    const input = form.element.querySelector<HTMLInputElement>(
      '[data-field-id="field_place"] input[data-loc-field="lat"]',
    );
    if (input === null) throw new Error('missing lat input');
    input.value = '31.2';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    submitForm(form.element);

    expect(onSubmit).not.toHaveBeenCalled();
    expect(
      form.element.querySelector<HTMLElement>('[data-field-id="field_place"]')?.dataset.invalid,
    ).toBe('true');
  });

  it('confirms before cancelling a dirty form and cancels clean forms directly', async () => {
    const confirmDiscard = vi.fn(() => true);
    const onCancel = vi.fn();
    const { form } = mount({
      fields: [field('field_text', 'Name', 'text')],
      confirmDiscard,
      onCancel,
    });

    cancelForm(form.element);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(confirmDiscard).not.toHaveBeenCalled();

    setInput(form.element, 'field_text', 'draft');
    cancelForm(form.element);
    expect(confirmDiscard).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(onCancel).toHaveBeenCalledTimes(2));
  });

  it('keeps the draft when the discard confirmation is declined', async () => {
    const confirmDiscard = vi.fn(() => false);
    const onCancel = vi.fn();
    const { form } = mount({
      fields: [field('field_text', 'Name', 'text')],
      confirmDiscard,
      onCancel,
    });

    setInput(form.element, 'field_text', 'draft');
    cancelForm(form.element);
    await vi.waitFor(() => expect(confirmDiscard).toHaveBeenCalledTimes(1));
    expect(onCancel).not.toHaveBeenCalled();
    expect(getInput(form.element, 'field_text')?.value).toBe('draft');
  });

  it('does not submit twice while busy and exposes a failure surface retaining the draft', async () => {
    let release: (() => void) | undefined;
    const onSubmit = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const { form } = mount({ fields: [field('field_text', 'Name', 'text')], onSubmit });

    setInput(form.element, 'field_text', 'draft');
    submitForm(form.element);
    submitForm(form.element);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(form.element.dataset.busy).toBe('true');

    release?.();
    await vi.waitFor(() => expect(form.element.dataset.busy).toBe('false'));
    form.showError('The Server rejected this Record.');
    expect(form.element.querySelector('.loom-record-create-error')?.textContent).toContain(
      'rejected',
    );
    expect(
      form.element.querySelector<HTMLInputElement>('[data-field-id="field_text"] input')?.value,
    ).toBe('draft');
  });

  it('disables submission while offline', () => {
    const { form } = mount({
      fields: [field('field_text', 'Name', 'text')],
      offline: true,
    });

    const submit = form.element.querySelector<HTMLButtonElement>('.loom-record-create-submit');
    expect(submit?.disabled).toBe(true);
    submitForm(form.element);
    expect(
      form.element.querySelector<HTMLElement>('[data-field-id="field_text"]')?.dataset.invalid,
    ).toBeUndefined();
  });
});

function mount(options: {
  readonly fields: readonly Field[];
  readonly onSubmit?: (values: Readonly<Record<string, MutationValue>>) => void | Promise<void>;
  readonly onCancel?: () => void;
  readonly confirmDiscard?: (message: string) => boolean;
  readonly offline?: boolean;
}): { form: ReturnType<typeof createRecordCreateForm> } {
  const formOptions: RecordCreateFormOptions = {
    fields: options.fields,
    translate: createTranslator('en'),
    ...(options.offline === undefined ? {} : { offline: options.offline }),
    ...(options.confirmDiscard === undefined ? {} : { confirmDiscard: options.confirmDiscard }),
    onSubmit: options.onSubmit ?? (() => undefined),
    onCancel: options.onCancel ?? (() => undefined),
  };
  const form = createRecordCreateForm(formOptions);
  document.body.append(form.element);
  return { form };
}

function submitForm(form: HTMLFormElement): void {
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

function cancelForm(form: HTMLFormElement): void {
  form.querySelector<HTMLButtonElement>('.loom-record-create-cancel')?.click();
}

function getInput(
  form: HTMLFormElement,
  fieldId: string,
): HTMLInputElement | HTMLTextAreaElement | null {
  return form.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    `[data-field-id="${fieldId}"] input, [data-field-id="${fieldId}"] textarea`,
  );
}

function setInput(form: HTMLFormElement, fieldId: string, value: string): void {
  const input = getInput(form, fieldId);
  if (input === null) throw new Error(`missing input for ${fieldId}`);
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function field(id: string, name: string, type: string): Field {
  return {
    id,
    tableId: 'table_01',
    name,
    position: 0,
    schemaVersion: 1,
    revision: 1,
    type,
    config: {},
  } as Field;
}

function selectField(id: string, name: string, type: 'select' | 'multiSelect'): Field {
  const config: SelectFieldConfig = {
    options: [{ id: 'option_active', name: 'Active option', color: '#00aaff' }],
    deletedOptions: [],
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
