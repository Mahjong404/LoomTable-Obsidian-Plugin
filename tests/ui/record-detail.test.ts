import { describe, expect, it, vi } from 'vitest';

import {
  LoomTableClientError,
  type Field,
  type LoomTableRecord,
} from '../../src/client/loomtable-client';
import { createTranslator } from '../../src/i18n';
import { createRecordDetail } from '../../src/ui/record-detail';

describe('Record Detail Location seam', () => {
  it('distinguishes an Unset Location from an explicitly cleared Location', () => {
    const container = document.createElement('div');
    const record = createRecord({ field_unset: undefined, field_cleared: null });
    container.append(
      createRecordDetail(record, {
        fields: [
          createField('field_unset', 'Unset Location'),
          createField('field_cleared', 'Cleared Location'),
        ],
        translate: createTranslator('en'),
      }),
    );

    const values = [...container.querySelectorAll<HTMLElement>('.loom-record-fields dd')].map(
      (element) => element.textContent,
    );
    expect(values[0]).toContain('Unset');
    expect(values[1]).toContain('Cleared');
  });

  it('distinguishes located, unlocated, unrenderable, cleared, and unset Location states', () => {
    const container = document.createElement('div');
    container.append(
      createRecordDetail(
        createRecord({
          field_located: { lat: 31.2304, lng: 121.4737 },
          field_unlocated: { label: 'No coordinates' },
          field_unrenderable: { lat: 90, lng: 0 },
          field_cleared: null,
          field_unset: undefined,
        }),
        {
          fields: [
            createField('field_located', 'Located'),
            createField('field_unlocated', 'Unlocated'),
            createField('field_unrenderable', 'Unrenderable'),
            createField('field_cleared', 'Cleared'),
            createField('field_unset', 'Unset'),
          ],
          translate: createTranslator('en'),
          callbacks: {
            canOpenLocationInMap: () => true,
            onOpenLocationInMap: vi.fn(),
          },
        },
      ),
    );

    const fields = [...container.querySelectorAll<HTMLElement>('.loom-location-field')];
    expect(fields.map((field) => field.dataset.locationState)).toEqual([
      'located',
      'unlocated',
      'unrenderable',
      'cleared',
      'unset',
    ]);
    expect(fields[0]?.querySelector('.loom-location-status')?.textContent).toBe('Located');
    expect(fields[1]?.querySelector('.loom-location-status')?.textContent).toBe('Unlocated');
    expect(fields[2]?.querySelector('.loom-location-status')?.textContent).toBe(
      'Not renderable at this Map scale',
    );
    expect(fields[3]?.textContent).toContain('Cleared');
    expect(fields[4]?.textContent).toContain('Unset');
    expect(fields[0]?.querySelector('.loom-location-open-map')).not.toBeNull();
    expect(fields[1]?.querySelector('.loom-location-open-map')).toBeNull();
    expect(fields[2]?.querySelector('.loom-location-open-map')).toBeNull();
  });

  it('allows legal decimal WGS84 coordinates in the Location editor', () => {
    const container = document.createElement('div');
    container.append(
      createRecordDetail(createRecord({}), {
        fields: [createField('field_location', 'Location')],
        translate: createTranslator('en'),
        callbacks: { onLocationEdit: vi.fn() },
      }),
    );

    container.querySelector<HTMLButtonElement>('.loom-location-edit')?.click();
    const form = container.querySelector<HTMLFormElement>('.loom-location-editor');
    expect(form).not.toBeNull();
    if (form === null) return;

    const latitude = form.querySelector<HTMLInputElement>('input[aria-label="Latitude"]');
    const longitude = form.querySelector<HTMLInputElement>('input[aria-label="Longitude"]');
    expect(latitude).not.toBeNull();
    expect(longitude).not.toBeNull();
    if (latitude === null || longitude === null) return;

    expect(latitude.step).toBe('any');
    expect(latitude.min).toBe('-90');
    expect(latitude.max).toBe('90');
    expect(longitude.step).toBe('any');
    expect(longitude.min).toBe('-180');
    expect(longitude.max).toBe('180');

    latitude.value = '31.2304';
    longitude.value = '121.4737';
    expect(latitude.checkValidity()).toBe(true);
    expect(longitude.checkValidity()).toBe(true);
  });

  it('names the detail region and protects a dirty Location draft', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const confirmDiscard = vi.fn().mockReturnValue(false);
    const onClose = vi.fn();
    const detail = createRecordDetail(createRecord({}), {
      fields: [createField('field_location', 'Location')],
      translate: createTranslator('en'),
      confirmDiscard,
      callbacks: { onClose, onLocationEdit: vi.fn() },
    });
    container.append(detail);

    expect(detail.getAttribute('role')).toBe('region');
    expect(detail.querySelector('h2')?.id).toBe(detail.getAttribute('aria-labelledby'));

    container.querySelector<HTMLButtonElement>('.loom-location-edit')?.click();
    const label = container.querySelector<HTMLInputElement>(
      '.loom-location-editor input[aria-label="Label"]',
    );
    expect(label).not.toBeNull();
    if (label === null) return;
    label.value = 'Changed';
    label.dispatchEvent(new Event('input', { bubbles: true }));

    container.querySelector<HTMLButtonElement>('.loom-location-editor button:last-child')?.click();
    expect(container.querySelector('.loom-location-editor')).not.toBeNull();
    expect(confirmDiscard).toHaveBeenCalledTimes(1);

    container.querySelector<HTMLButtonElement>('.loom-record-detail-header button')?.click();
    expect(onClose).not.toHaveBeenCalled();
    expect(confirmDiscard).toHaveBeenCalledTimes(2);

    confirmDiscard.mockReturnValue(true);
    container.querySelector<HTMLButtonElement>('.loom-location-editor button:last-child')?.click();
    expect(container.querySelector('.loom-location-editor')).toBeNull();
    expect(document.activeElement).toBe(
      container.querySelector<HTMLButtonElement>('.loom-location-edit'),
    );
  });

  it('returns focus to a stable fallback when the invoking control is gone', () => {
    const trigger = document.createElement('button');
    const fallback = document.createElement('button');
    document.body.append(trigger, fallback);
    trigger.focus();
    const container = document.createElement('div');
    const onClose = vi.fn();
    const detail = createRecordDetail(createRecord({}), {
      fields: [createField('field_location', 'Location')],
      translate: createTranslator('en'),
      returnFocus: trigger,
      focusFallback: () => fallback,
      callbacks: { onClose },
    });
    container.append(detail);
    trigger.remove();

    detail.querySelector<HTMLButtonElement>('.loom-record-detail-header button')?.click();

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(fallback);
    container.remove();
    fallback.remove();
  });

  it('prevalidates Location form values before calling the mutation seam', async () => {
    const container = document.createElement('div');
    const onLocationEdit = vi.fn().mockResolvedValue(undefined);
    const record = createRecord({});
    container.append(
      createRecordDetail(record, {
        fields: [createField('field_location', 'Location')],
        translate: createTranslator('en'),
        callbacks: { onLocationEdit },
      }),
    );

    container.querySelector<HTMLButtonElement>('.loom-location-edit')?.click();
    const form = container.querySelector<HTMLFormElement>('.loom-location-editor');
    expect(form).not.toBeNull();
    if (form === null) return;

    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    const error = form.querySelector<HTMLElement>('[role="alert"]');
    expect(error?.textContent).toContain('Location');
    expect(error?.hidden).toBe(false);
    expect(error?.id).toBeTruthy();
    expect(
      [...form.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select')].every(
        (control) => control.getAttribute('aria-invalid') === 'true',
      ),
    ).toBe(true);
    expect(onLocationEdit).not.toHaveBeenCalled();

    const input = (label: string): HTMLInputElement =>
      form.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`) as HTMLInputElement;
    input('Label').value = ' New label ';
    input('Latitude').value = '90';
    input('Longitude').value = '-180';
    form.querySelector<HTMLSelectElement>('select[aria-label="Precision"]')!.value = 'exact';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(onLocationEdit).toHaveBeenCalledTimes(1));
    expect(onLocationEdit).toHaveBeenCalledWith(
      'record_01',
      'field_location',
      {
        kind: 'set',
        value: { label: 'New label', lat: 90, lng: -180, precision: 'exact' },
      },
      record,
    );
  });

  it('focuses the Location error target and clears stale invalid state when editing resumes', () => {
    const container = document.createElement('div');
    document.body.append(container);
    container.append(
      createRecordDetail(createRecord({}), {
        fields: [createField('field_location', 'Location')],
        translate: createTranslator('en'),
        callbacks: { onLocationEdit: vi.fn() },
      }),
    );

    container.querySelector<HTMLButtonElement>('.loom-location-edit')?.click();
    const form = container.querySelector<HTMLFormElement>('.loom-location-editor');
    expect(form).not.toBeNull();
    if (form === null) return;
    const label = form.querySelector<HTMLInputElement>('input[aria-label="Label"]');
    const error = form.querySelector<HTMLElement>('.loom-location-editor-error');
    expect(label).not.toBeNull();
    expect(error).not.toBeNull();
    if (label === null || error === null) return;

    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    expect(document.activeElement).toBe(label);
    expect(label.getAttribute('aria-describedby')).toBe(error.id);
    expect(label.getAttribute('aria-invalid')).toBe('true');
    label.value = 'A place';
    label.dispatchEvent(new Event('input', { bubbles: true }));

    expect(error.hidden).toBe(true);
    expect(label.getAttribute('aria-invalid')).toBe('false');
  });

  it('uses a unique error association for each Location editor', () => {
    const container = document.createElement('div');
    container.append(
      createRecordDetail(createRecord({}), {
        fields: [createField('field_location', 'Location')],
        translate: createTranslator('en'),
        callbacks: { onLocationEdit: vi.fn() },
      }),
      createRecordDetail(createRecord({}), {
        fields: [createField('field_location', 'Location')],
        translate: createTranslator('en'),
        callbacks: { onLocationEdit: vi.fn() },
      }),
    );
    container.querySelectorAll<HTMLButtonElement>('.loom-location-edit').forEach((edit) => {
      edit.click();
    });

    const errors = [...container.querySelectorAll<HTMLElement>('.loom-location-editor-error')];
    expect(errors).toHaveLength(2);
    expect(errors[0]?.id).not.toBe(errors[1]?.id);
    for (const form of container.querySelectorAll<HTMLFormElement>('.loom-location-editor')) {
      const errorId = form.querySelector<HTMLElement>('.loom-location-editor-error')?.id;
      expect(errorId).toBeTruthy();
      expect(
        [...form.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select')].every(
          (control) => control.getAttribute('aria-describedby') === errorId,
        ),
      ).toBe(true);
    }
  });

  it('focuses a Location submission error while keeping raw details disclosed', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const onLocationEdit = vi
      .fn()
      .mockRejectedValue(new LoomTableClientError('network', { message: 'raw network detail' }));
    container.append(
      createRecordDetail(createRecord({ field_location: { label: 'Current' } }), {
        fields: [createField('field_location', 'Location')],
        translate: createTranslator('en'),
        callbacks: { onLocationEdit },
      }),
    );

    container.querySelector<HTMLButtonElement>('.loom-location-edit')?.click();
    const form = container.querySelector<HTMLFormElement>('.loom-location-editor');
    expect(form).not.toBeNull();
    if (form === null) return;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    await vi.waitFor(() => expect(onLocationEdit).toHaveBeenCalledTimes(1));
    const error = form.querySelector<HTMLElement>('.loom-location-editor-error');
    expect(error?.hidden).toBe(false);
    expect(error?.firstChild?.textContent).not.toContain('raw network detail');
    expect(error?.querySelector('.loom-diagnostic pre')?.textContent).toContain(
      'raw network detail',
    );
    expect(document.activeElement).toBe(error);
    expect(
      [...form.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select')].every(
        (control) => control.getAttribute('aria-invalid') === 'false',
      ),
    ).toBe(true);
    container.remove();
  });

  it('renders the localized Location validation diagnostic and stable code', () => {
    const container = document.createElement('div');
    container.append(
      createRecordDetail(createRecord({}), {
        fields: [createField('field_location', 'Location')],
        translate: createTranslator('zh-CN'),
        callbacks: { onLocationEdit: vi.fn() },
      }),
    );

    container.querySelector<HTMLButtonElement>('.loom-location-edit')?.click();
    const form = container.querySelector<HTMLFormElement>('.loom-location-editor');
    expect(form).not.toBeNull();
    if (form === null) return;

    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    const error = form.querySelector<HTMLElement>('.loom-location-editor-error');
    expect(error?.textContent).toBe('Location 需要名称、地址、提供方或坐标。');
    expect(error?.dataset.errorCode).toBe('FIELD_VALUE_LOCATION_EMPTY');
  });

  it('requires confirmation before Location clear/unset and keeps cancel side-effect free', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const onLocationEdit = vi.fn().mockResolvedValue(undefined);
    container.append(
      createRecordDetail(createRecord({ field_location: { label: 'Local' } }), {
        fields: [createField('field_location', 'Location')],
        translate: createTranslator('en'),
        callbacks: { onLocationEdit },
      }),
    );

    container.querySelector<HTMLButtonElement>('.loom-location-edit')?.click();
    const form = container.querySelector<HTMLFormElement>('.loom-location-editor');
    expect(form).not.toBeNull();
    if (form === null) return;
    const actions = form.querySelectorAll<HTMLButtonElement>('button');
    actions[1]?.focus();
    actions[1]?.click();
    await vi.waitFor(() => {
      const dialog = container.querySelector<HTMLElement>('[role="alertdialog"]');
      expect(dialog?.getAttribute('role')).toBe('alertdialog');
      expect(dialog?.getAttribute('aria-modal')).toBe('true');
      expect(document.activeElement).toBe(
        dialog?.querySelector<HTMLButtonElement>('[data-action="cancel"]'),
      );
    });
    const dialog = container.querySelector<HTMLElement>('[role="alertdialog"]');
    expect(dialog).not.toBeNull();
    dialog?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onLocationEdit).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(actions[1]);

    actions[2]?.focus();
    actions[2]?.click();
    const confirmDialog = container.querySelector<HTMLElement>('[role="alertdialog"]');
    expect(confirmDialog).not.toBeNull();
    const confirmButton =
      confirmDialog?.querySelector<HTMLButtonElement>('[data-action="confirm"]');
    expect(confirmButton?.classList.contains('loom-button-danger')).toBe(true);
    expect(confirmButton?.dataset.variant).toBe('danger');
    expect(confirmButton?.classList.contains('mod-warning')).toBe(false);
    confirmButton?.click();
    await vi.waitFor(() =>
      expect(onLocationEdit).toHaveBeenCalledWith(
        'record_01',
        'field_location',
        { kind: 'unset' },
        expect.anything(),
      ),
    );
  });

  it('hides Open in Map and explains the required configuration when no matching Map View exists', () => {
    const container = document.createElement('div');
    container.append(
      createRecordDetail(createRecord({ field_location: { lat: 12, lng: 34 } }), {
        fields: [createField('field_location', 'Location')],
        translate: createTranslator('en'),
        callbacks: {
          canOpenLocationInMap: () => false,
          onOpenLocationInMap: vi.fn(),
        },
      }),
    );

    expect(container.querySelector('.loom-location-open-map')).toBeNull();
    expect(container.querySelector('.loom-location-map-unavailable')?.textContent).toContain(
      'No Map View is configured',
    );
  });

  it('renders the complete returned Record after a Location save', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const returnedRecord = {
      ...createRecord({
        field_location: { label: 'Server value', lat: 3, lng: 4, precision: 'exact' },
      }),
      revision: 2,
    };
    const onLocationEdit = vi.fn().mockResolvedValue(returnedRecord);
    container.append(
      createRecordDetail(createRecord({ field_location: { label: 'Local value' } }), {
        fields: [createField('field_location', 'Location')],
        translate: createTranslator('en'),
        callbacks: { onLocationEdit },
      }),
    );

    container.querySelector<HTMLButtonElement>('.loom-location-edit')?.click();
    const form = container.querySelector<HTMLFormElement>('.loom-location-editor');
    expect(form).not.toBeNull();
    if (form === null) return;
    form.querySelector<HTMLInputElement>('input[aria-label="Label"]')!.value = 'Local intent';
    form.dispatchEvent(new Event('input', { bubbles: true }));
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    await vi.waitFor(() => expect(onLocationEdit).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(container.querySelector('.loom-location-editor')).toBeNull());
    expect(document.activeElement).toBe(
      container.querySelector<HTMLButtonElement>('.loom-location-edit'),
    );
    expect(container.querySelector('.loom-location-values')?.textContent).toContain('Server value');
    expect(container.querySelector('.loom-location-values')?.textContent).toContain('3');
    expect(container.querySelector('.loom-location-values')?.textContent).toContain('4');
  });

  it('exposes Open in Map and a modifier-key preview without a write callback', async () => {
    vi.useFakeTimers();
    try {
      const container = document.createElement('div');
      const onOpenLocationInMap = vi.fn();
      const onCopyCoordinates = vi.fn();
      const onLocationEdit = vi.fn();
      const record = createRecord({ field_location: { lat: 12, lng: 34 } });
      container.append(
        createRecordDetail(record, {
          fields: [createField('field_location', 'Location')],
          translate: createTranslator('en'),
          callbacks: { onOpenLocationInMap, onCopyCoordinates, onLocationEdit },
        }),
      );

      container.querySelector<HTMLButtonElement>('.loom-location-open-map')?.click();
      expect(onOpenLocationInMap).toHaveBeenCalledWith('record_01', 'field_location', {
        lat: 12,
        lng: 34,
      });
      container.querySelector<HTMLButtonElement>('.loom-location-copy')?.click();
      await vi.waitFor(() =>
        expect(onCopyCoordinates).toHaveBeenCalledWith('record_01', 'field_location', {
          lat: 12,
          lng: 34,
        }),
      );
      const trigger = container.querySelector<HTMLButtonElement>('.loom-location-preview-trigger');
      expect(trigger).not.toBeNull();
      expect(trigger?.tagName).toBe('BUTTON');
      expect(trigger?.getAttribute('aria-label')).toBe('Ctrl/Cmd-hover to preview');
      trigger?.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, ctrlKey: true }));
      await vi.advanceTimersByTimeAsync(180);
      expect(container.querySelector('.loom-location-preview')?.textContent).toContain('12, 34');
      expect(onLocationEdit).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('disables Location editing while offline', () => {
    const container = document.createElement('div');
    container.append(
      createRecordDetail(createRecord({ field_location: { lat: 1, lng: 2 } }), {
        fields: [createField('field_location', 'Location')],
        translate: createTranslator('en'),
        offline: true,
        callbacks: { onLocationEdit: vi.fn() },
      }),
    );

    expect(container.querySelector<HTMLButtonElement>('.loom-location-edit')?.disabled).toBe(true);
  });

  it('renders an existing durable conflict in the detail view', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const detail = createRecordDetail(createRecord({ field_location: { label: 'Local value' } }), {
      fields: [createField('field_location', 'Location')],
      translate: createTranslator('en'),
      callbacks: {
        getConflict: () => ({
          clientMutationId: 'mut_0123456789ABCDEFGHJKMNPQRS',
          failedCommandIndex: 0,
          expectedRevision: 1,
          currentRevision: 2,
          currentValues: { field_location: { label: 'Server value' } },
          submittedSet: { field_location: { label: 'Local value' } },
          submittedUnsetFieldIds: ['field_archived'],
          message: 'Revision conflict.',
        }),
      },
    });
    container.append(detail);

    expect(detail.querySelector('.loom-record-conflict')).not.toBeNull();
    expect(detail.querySelector('.loom-record-conflict-server')?.textContent).toContain(
      'Server value',
    );
    expect(detail.querySelector('.loom-record-conflict-server')?.textContent).toContain(
      'mut_0123456789ABCDEFGHJKMNPQRS',
    );
    expect(detail.querySelector('.loom-record-conflict-local')?.textContent).toContain(
      'field_archived',
    );
  });

  it('keeps the existing use-server and overwrite conflict actions in Location detail', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const onConflictAction = vi.fn();
    const onClose = vi.fn();
    const onLocationEdit = vi
      .fn()
      .mockRejectedValue(new LoomTableClientError('conflict', { message: 'Revision conflict.' }));
    const conflict = {
      clientMutationId: 'mut_0123456789ABCDEFGHJKMNPQRS',
      failedCommandIndex: 0,
      expectedRevision: 1,
      currentRevision: 2,
      currentValues: { field_location: { label: 'Server' } },
      submittedSet: { field_location: { label: 'Local' } },
      submittedUnsetFieldIds: ['field_archived'],
      message: 'Revision conflict.',
    };
    container.append(
      createRecordDetail(createRecord({ field_location: { label: 'Local' } }), {
        fields: [createField('field_location', 'Location')],
        translate: createTranslator('en'),
        confirmDiscard: vi.fn().mockReturnValue(true),
        callbacks: {
          onLocationEdit,
          onClose,
          getConflict: () => conflict,
          onConflictAction,
        },
      }),
    );
    container.querySelector<HTMLButtonElement>('.loom-location-edit')?.click();
    const form = container.querySelector<HTMLFormElement>('.loom-location-editor');
    if (form === null) return;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(container.querySelector('.loom-record-conflict')).not.toBeNull());

    expect(container.querySelector('.loom-record-conflict')?.getAttribute('role')).toBe('region');
    expect(container.querySelector('.loom-record-conflict')?.getAttribute('aria-label')).toBe(
      'Record conflict',
    );
    expect(container.querySelector('.loom-record-conflict-local')?.textContent).toContain(
      'field_archived',
    );
    expect(container.querySelector('.loom-record-conflict-server')?.textContent).toContain(
      'mut_0123456789ABCDEFGHJKMNPQRS',
    );
    expect(container.querySelector('.loom-record-conflict-server')?.textContent).toContain(
      'failedCommandIndex',
    );
    expect(container.querySelector('.loom-record-conflict')?.getAttribute('aria-live')).toBe(
      'polite',
    );
    expect(document.activeElement).toBe(container.querySelector('.loom-record-conflict'));

    const buttons = container.querySelectorAll<HTMLButtonElement>('.loom-record-conflict button');
    expect(buttons[1]?.classList.contains('loom-button-danger')).toBe(true);
    expect(buttons[1]?.dataset.variant).toBe('danger');
    expect(buttons[1]?.classList.contains('mod-warning')).toBe(false);
    buttons[0]?.click();
    buttons[1]?.click();
    container
      .querySelector<HTMLElement>('[role="alertdialog"]')
      ?.querySelector<HTMLButtonElement>('[data-action="confirm"]')
      ?.click();
    await vi.waitFor(() =>
      expect(onConflictAction).toHaveBeenNthCalledWith(2, 'record_01', 'overwrite'),
    );
    expect(onConflictAction).toHaveBeenNthCalledWith(1, 'record_01', 'use-server');

    container.querySelector<HTMLButtonElement>('.loom-record-detail-header button')?.click();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConflictAction).toHaveBeenCalledTimes(2);

    buttons[2]?.click();
    expect(onConflictAction).toHaveBeenNthCalledWith(3, 'record_01', 'discard-all');
  });

  it('returns focus to the Detail region after a Location conflict action', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const onLocationEdit = vi
      .fn()
      .mockRejectedValue(new LoomTableClientError('conflict', { message: 'Revision conflict.' }));
    const onConflictAction = vi.fn().mockResolvedValue(undefined);
    const conflict = {
      clientMutationId: 'mut_0123456789ABCDEFGHJKMNPQRS',
      failedCommandIndex: 0,
      expectedRevision: 1,
      currentRevision: 2,
      currentValues: { field_location: { label: 'Server' } },
      submittedSet: { field_location: { label: 'Local' } },
      submittedUnsetFieldIds: [],
      message: 'Revision conflict.',
    };
    const detail = createRecordDetail(createRecord({ field_location: { label: 'Local' } }), {
      fields: [createField('field_location', 'Location')],
      translate: createTranslator('en'),
      callbacks: {
        onLocationEdit,
        getConflict: () => conflict,
        onConflictAction,
      },
    });
    container.append(detail);

    detail.querySelector<HTMLButtonElement>('.loom-location-edit')?.click();
    const form = detail.querySelector<HTMLFormElement>('.loom-location-editor');
    expect(form).not.toBeNull();
    if (form === null) return;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(detail.querySelector('.loom-record-conflict')).not.toBeNull());
    const useServer = detail.querySelector<HTMLButtonElement>(
      '.loom-record-conflict button:first-child',
    );
    useServer?.click();

    await vi.waitFor(() =>
      expect(onConflictAction).toHaveBeenCalledWith('record_01', 'use-server'),
    );
    await vi.waitFor(() => expect(document.activeElement).toBe(detail));
    expect(detail.querySelector('.loom-record-conflict')?.parentElement).toBe(detail);
    container.remove();
  });
});

function createField(id: string, name: string): Field {
  return {
    id,
    tableId: 'table_01',
    name,
    position: 0,
    schemaVersion: 1,
    revision: 1,
    type: 'location',
    config: {},
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
