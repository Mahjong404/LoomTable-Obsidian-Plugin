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

    container
      .querySelector<HTMLButtonElement>(
        '.loom-record-detail-header button[data-action="detail-close"]',
      )
      ?.click();
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

    detail
      .querySelector<HTMLButtonElement>(
        '.loom-record-detail-header button[data-action="detail-close"]',
      )
      ?.click();

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
    const container = document.createElement('div');
    const onOpenLocationInMap = vi.fn();
    const onCopyCoordinates = vi.fn();
    const onLocationEdit = vi.fn();
    const locationPreview = {
      preview: vi.fn(),
      scheduleHover: vi.fn(),
      endHover: vi.fn(),
      close: vi.fn(),
    };
    const record = createRecord({ field_location: { lat: 12, lng: 34 } });
    container.append(
      createRecordDetail(record, {
        fields: [createField('field_location', 'Location')],
        translate: createTranslator('en'),
        callbacks: { onOpenLocationInMap, onCopyCoordinates, onLocationEdit },
        locationPreview,
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
    trigger?.click();
    expect(locationPreview.preview).toHaveBeenCalledWith(
      expect.objectContaining({
        recordId: 'record_01',
        fieldId: 'field_location',
        coordinates: { lat: 12, lng: 34 },
        mode: 'button',
      }),
    );
    trigger?.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, ctrlKey: true }));
    expect(locationPreview.scheduleHover).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'hover' }),
    );
    trigger?.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    expect(locationPreview.endHover).toHaveBeenCalled();
    trigger?.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    expect(onLocationEdit).not.toHaveBeenCalled();
  });

  it('hides the map preview trigger for unrenderable or unlocated locations', () => {
    const container = document.createElement('div');
    const locationPreview = {
      preview: vi.fn(),
      scheduleHover: vi.fn(),
      endHover: vi.fn(),
      close: vi.fn(),
    };
    container.append(
      createRecordDetail(createRecord({ field_location: { lat: 90, lng: 34 } }), {
        fields: [createField('field_location', 'Location')],
        translate: createTranslator('en'),
        locationPreview,
      }),
    );
    expect(container.querySelector('.loom-location-preview-trigger')).toBeNull();
    expect(container.querySelector('.loom-location-copy')).not.toBeNull();

    container.append(
      createRecordDetail(createRecord({ field_location: { label: 'No pair' } }), {
        fields: [createField('field_location', 'Location')],
        translate: createTranslator('en'),
        locationPreview,
      }),
    );
    expect(container.querySelectorAll('.loom-location-preview-trigger')).toHaveLength(0);
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
    const conflictBox = container.querySelector('.loom-record-conflict');
    const conflictLabelId = conflictBox?.getAttribute('aria-labelledby');
    expect(
      conflictLabelId ? container.querySelector('#' + conflictLabelId)?.textContent : null,
    ).toBe('Record conflict');
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

    container
      .querySelector<HTMLButtonElement>(
        '.loom-record-detail-header button[data-action="detail-close"]',
      )
      ?.click();
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

  it('uses the shared renderer for Detail values and accessible natural-empty semantics', () => {
    const container = document.createElement('div');
    const textField = { ...createField('field_text', 'Text'), type: 'text' } as Field;
    const checkboxField = {
      ...createField('field_checkbox', 'Checkbox'),
      type: 'checkbox',
    } as Field;
    const attachmentField: Field = {
      ...createField('field_attachment', 'Attachment'),
      type: 'attachment',
      config: { maxCount: 10 },
    };

    container.append(
      createRecordDetail(
        createRecord({
          field_text: '',
          field_checkbox: true,
          field_attachment: [
            {
              id: 'attachment_1',
              source: 'vault',
              filename: 'notes.md',
              mimeType: 'text/markdown',
              size: 2048,
            },
          ],
        }),
        {
          fields: [textField, checkboxField, attachmentField],
          translate: createTranslator('en'),
        },
      ),
    );

    const text = container.querySelector<HTMLElement>(
      '.loom-record-fields dd[data-field-id="field_text"]',
    );
    const checkbox = container.querySelector<HTMLElement>(
      '.loom-record-fields dd[data-field-id="field_checkbox"]',
    );
    const attachment = container.querySelector<HTMLElement>(
      '.loom-record-fields dd[data-field-id="field_attachment"]',
    );
    expect(text?.textContent).toBe('Empty');
    expect(text?.dataset.valueState).toBe('empty');
    expect(checkbox?.textContent).toBe('Checked');
    expect(attachment?.textContent).toBe(
      'notes.md · Source: Vault · Type: text/markdown · Size: 2 KB · Ready',
    );
    expect(attachment?.textContent).not.toContain('{');
  });

  it('exposes only a typed attachment download action and keeps failures translated', async () => {
    const container = document.createElement('div');
    const attachmentField: Field = {
      ...createField('field_attachment', 'Attachment'),
      type: 'attachment',
      config: { maxCount: 10 },
    };
    const record = createRecord({
      field_attachment: [{ id: 'attachment_1', source: 'managed', filename: 'notes.md' }],
    });
    const onAttachmentDownload = vi.fn().mockRejectedValue(new Error('secret path'));

    const detail = createRecordDetail(record, {
      fields: [attachmentField],
      translate: createTranslator('en'),
      callbacks: {
        onAttachmentDownload,
      },
    });
    container.append(detail);

    const download = detail.querySelector<HTMLButtonElement>('.loom-attachment-action');
    expect(download?.getAttribute('aria-label')).toBe('Download notes.md');
    download?.click();
    download?.click();
    await vi.waitFor(() => expect(onAttachmentDownload).toHaveBeenCalledTimes(1));
    expect(onAttachmentDownload).toHaveBeenCalledWith(
      'record_01',
      'field_attachment',
      expect.objectContaining({ id: 'attachment_1', filename: 'notes.md' }),
    );
    await vi.waitFor(() =>
      expect(detail.querySelector('.loom-attachment-action-status')?.textContent).toBe(
        'Download failed. Check the attachment and try again.',
      ),
    );

    const withoutCallback = createRecordDetail(record, {
      fields: [attachmentField],
      translate: createTranslator('en'),
    });
    expect(withoutCallback.querySelector('.loom-attachment-action')).toBeNull();
  });

  it('forwards typed Open and Preview callbacks from Record Detail', async () => {
    const attachmentField: Field = {
      ...createField('field_attachment', 'Attachment'),
      type: 'attachment',
      config: { maxCount: 10 },
    };
    const record = createRecord({
      field_attachment: [
        {
          id: 'attachment_vault',
          source: 'vault',
          filename: 'notes.md',
          vaultPath: 'attachments/notes.md',
        },
        { id: 'attachment_managed', source: 'managed', filename: 'preview.pdf' },
      ],
    });
    const onAttachmentOpen = vi.fn();
    const onAttachmentPreview = vi.fn();
    const detail = createRecordDetail(record, {
      fields: [attachmentField],
      translate: createTranslator('en'),
      callbacks: { onAttachmentOpen, onAttachmentPreview },
    });

    const open = detail.querySelector<HTMLButtonElement>('.loom-attachment-open-action');
    const preview = detail.querySelector<HTMLButtonElement>('.loom-attachment-preview-action');
    expect(open).not.toBeNull();
    expect(preview).not.toBeNull();
    open?.click();
    preview?.click();
    await vi.waitFor(() => expect(onAttachmentOpen).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(onAttachmentPreview).toHaveBeenCalledTimes(1));
    expect(onAttachmentOpen).toHaveBeenCalledWith(
      'record_01',
      'field_attachment',
      expect.objectContaining({
        id: 'attachment_vault',
        filename: 'notes.md',
        source: 'vault',
        vaultPath: 'attachments/notes.md',
      }),
    );
    expect(onAttachmentPreview).toHaveBeenCalledWith(
      'record_01',
      'field_attachment',
      expect.objectContaining({
        id: 'attachment_managed',
        filename: 'preview.pdf',
        source: 'managed',
      }),
    );
  });

  it('disables attachment download with an accessible offline explanation', () => {
    const attachmentField: Field = {
      ...createField('field_attachment', 'Attachment'),
      type: 'attachment',
      config: { maxCount: 10 },
    };
    const onAttachmentDownload = vi.fn();
    const detail = createRecordDetail(
      createRecord({
        field_attachment: [{ id: 'attachment_1', source: 'managed', filename: 'notes.md' }],
      }),
      {
        fields: [attachmentField],
        translate: createTranslator('zh-CN'),
        offline: true,
        callbacks: { onAttachmentDownload },
      },
    );

    const download = detail.querySelector<HTMLButtonElement>('.loom-attachment-action');
    expect(download).not.toBeNull();
    expect(download?.disabled).toBe(true);
    expect(download?.getAttribute('aria-label')).toBe('当前离线；恢复连接后才能下载。');
    expect(detail.querySelector('.loom-attachment-action-status')?.textContent).toBe(
      '当前离线；恢复连接后才能下载。',
    );
    download?.click();
    expect(onAttachmentDownload).not.toHaveBeenCalled();
  });

  it('keeps an explicit Vault download available while offline', () => {
    const attachmentField: Field = {
      ...createField('field_attachment', 'Attachment'),
      type: 'attachment',
      config: { maxCount: 10 },
    };
    const onAttachmentDownload = vi.fn();
    const detail = createRecordDetail(
      createRecord({
        field_attachment: [
          {
            id: 'attachment_1',
            source: 'vault',
            filename: 'notes.md',
            vaultPath: 'attachments/notes.md',
          },
        ],
      }),
      {
        fields: [attachmentField],
        translate: createTranslator('en'),
        offline: true,
        callbacks: { onAttachmentDownload },
      },
    );

    const download = detail.querySelector<HTMLButtonElement>('.loom-attachment-action');
    expect(download?.disabled).toBe(false);
    download?.click();
    expect(onAttachmentDownload).toHaveBeenCalledTimes(1);
  });

  it('renders Select and MultiSelect option names consistently as accessible values', () => {
    const container = document.createElement('div');
    const multiSelectField: Field = {
      ...createField('field_multi', 'Tags'),
      type: 'multiSelect',
      config: {
        options: [{ id: 'option_1', name: 'One', color: '#000000' }],
        deletedOptions: [
          { id: 'option_old', name: 'Old', color: '#000000', deletedAt: '2026-01-01' },
        ],
      },
    };
    container.append(
      createRecordDetail(createRecord({ field_multi: ['option_old', 'option_1'] }), {
        fields: [multiSelectField],
        translate: createTranslator('en'),
      }),
    );

    const value = container.querySelector<HTMLElement>('dd[data-field-id="field_multi"]');
    expect(value?.querySelector('.loom-field-value-chips')).not.toBeNull();
    expect(
      [...(value?.querySelectorAll<HTMLElement>('[role="listitem"]') ?? [])].map(
        (chip) => chip.textContent,
      ),
    ).toEqual(['Old (Deleted option)', 'One']);
    expect(value?.textContent).not.toContain('option_old');
  });

  it('renders a safe URL as a link and keeps an unsafe URL unavailable', () => {
    const container = document.createElement('div');
    const urlField: Field = { ...createField('field_url', 'Website'), type: 'url', config: {} };
    container.append(
      createRecordDetail(
        createRecord({
          field_url: 'https://example.com/docs',
          field_unsafe: 'javascript:alert(1)',
        }),
        {
          fields: [urlField, { ...urlField, id: 'field_unsafe', name: 'Unsafe' }],
          translate: createTranslator('en'),
        },
      ),
    );

    const safe = container.querySelector<HTMLElement>('dd[data-field-id="field_url"]');
    const unsafe = container.querySelector<HTMLElement>('dd[data-field-id="field_unsafe"]');
    expect(safe?.querySelector<HTMLAnchorElement>('.loom-field-value-link')?.href).toBe(
      'https://example.com/docs',
    );
    expect(unsafe?.querySelector('.loom-field-value-link')).toBeNull();
    expect(unsafe?.textContent).toContain('Value unavailable');
    expect(unsafe?.textContent).not.toContain('javascript:alert(1)');
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

describe('Record Detail navigation', () => {
  function textField(id: string, name: string): Field {
    return {
      id,
      tableId: 'table_01',
      name,
      position: 0,
      schemaVersion: 1,
      revision: 1,
      type: 'text',
      config: {},
    };
  }

  it('titles the Detail from the primary Field value with an untitled fallback', () => {
    const titled = createRecordDetail(createRecord({ field_name: 'Alpha' }), {
      fields: [textField('field_name', 'Name')],
      primaryFieldId: 'field_name',
      translate: createTranslator('en'),
    });
    expect(titled.querySelector('h2')?.textContent).toContain('Alpha');

    const untitled = createRecordDetail(createRecord({ field_name: '' }), {
      fields: [textField('field_name', 'Name')],
      primaryFieldId: 'field_name',
      translate: createTranslator('en'),
    });
    expect(untitled.querySelector('h2')?.textContent).toContain('Untitled Record');
  });

  it('disables Previous at the boundary and navigates along the seam', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const second = { ...createRecord({ field_name: 'Two' }), id: 'record_02' };
    const navigation = {
      canNavigate: (recordId: string, direction: -1 | 1) =>
        direction < 0 ? recordId === 'record_02' : recordId === 'record_01',
      onNavigate: vi.fn(async (recordId: string, direction: -1 | 1) =>
        recordId === 'record_01' && direction === 1 ? second : null,
      ),
    };
    const detail = createRecordDetail(createRecord({ field_name: 'One' }), {
      fields: [textField('field_name', 'Name')],
      primaryFieldId: 'field_name',
      navigation,
      translate: createTranslator('en'),
    });
    container.append(detail);

    const previous = detail.querySelector<HTMLButtonElement>('[data-action="detail-previous"]');
    const next = detail.querySelector<HTMLButtonElement>('[data-action="detail-next"]');
    expect(previous?.disabled).toBe(true);
    expect(next?.disabled).toBe(false);

    next?.click();
    await vi.waitFor(() => expect(detail.querySelector('h2')?.textContent).toContain('Two'));
    expect(navigation.onNavigate).toHaveBeenCalledWith('record_01', 1);
    expect(previous?.disabled).toBe(false);
    expect(next?.disabled).toBe(true);
    container.remove();
  });

  it('confirms before navigating away from an unsubmitted draft', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const onNavigate = vi.fn(async () => ({ ...createRecord({}), id: 'record_02' }));
    const confirmDiscard = vi.fn(() => false);
    const detail = createRecordDetail(createRecord({ field_name: 'One' }), {
      fields: [textField('field_name', 'Name')],
      primaryFieldId: 'field_name',
      navigation: { canNavigate: () => true, onNavigate },
      confirmDiscard,
      translate: createTranslator('en'),
      callbacks: { onFieldEdit: vi.fn() },
    });
    container.append(detail);

    detail
      .querySelector<HTMLButtonElement>('.loom-record-field-editable[data-field-id="field_name"]')
      ?.click();
    const editor = detail.querySelector<HTMLInputElement>(
      '.loom-record-field-editor[data-field-id="field_name"] input',
    );
    expect(editor).not.toBeNull();
    if (editor === null) return;
    editor.value = 'draft';
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    expect(detail.querySelector('.loom-record-field-editor[data-dirty="true"]')).not.toBeNull();

    detail.querySelector<HTMLButtonElement>('[data-action="detail-next"]')?.click();
    await Promise.resolve();
    expect(confirmDiscard).toHaveBeenCalled();
    expect(onNavigate).not.toHaveBeenCalled();
    expect(detail.querySelector('.loom-record-field-editor')).not.toBeNull();
    container.remove();
  });

  it('closes the location preview when the record navigates or the detail closes', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const locationPreview = {
      preview: vi.fn(),
      scheduleHover: vi.fn(),
      endHover: vi.fn(),
      close: vi.fn(),
    };
    const second = {
      ...createRecord({ field_location: { lat: 5, lng: 6 } }),
      id: 'record_02',
    };
    const onClose = vi.fn(() => detail.remove());
    const detail = createRecordDetail(createRecord({ field_location: { lat: 12, lng: 34 } }), {
      fields: [createField('field_location', 'Location')],
      translate: createTranslator('en'),
      locationPreview,
      navigation: {
        canNavigate: () => true,
        onNavigate: vi.fn(async () => second),
      },
      callbacks: { onClose },
    });
    container.append(detail);
    locationPreview.close.mockClear();

    detail.querySelector<HTMLButtonElement>('[data-action="detail-next"]')?.click();
    await vi.waitFor(() => expect(locationPreview.close).toHaveBeenCalled());

    locationPreview.close.mockClear();
    const close = [...detail.querySelectorAll<HTMLButtonElement>('button')].find(
      (candidate) => candidate.getAttribute('aria-label') === 'Close',
    );
    close?.click();
    expect(locationPreview.close).toHaveBeenCalled();
    container.remove();
  });
});

describe('Record Detail delete', () => {
  function textField(id: string, name: string): Field {
    return {
      id,
      tableId: 'table_01',
      name,
      position: 0,
      schemaVersion: 1,
      revision: 1,
      type: 'text',
      config: {},
    };
  }

  it('confirms before deleting and closes the Detail after a successful delete', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const onDeleteRecord = vi.fn(async () => undefined);
    let detail: HTMLElement;
    const onClose = vi.fn(() => detail?.remove());
    detail = createRecordDetail(createRecord({ field_name: 'One' }), {
      fields: [textField('field_name', 'Name')],
      translate: createTranslator('en'),
      confirmDangerousAction: async () => true,
      callbacks: { onDeleteRecord, onClose },
    });
    container.append(detail);

    detail.querySelector<HTMLButtonElement>('[data-action="detail-menu"]')?.click();
    detail.querySelector<HTMLButtonElement>('[data-action="detail-delete"]')?.click();
    await vi.waitFor(() =>
      expect(onDeleteRecord).toHaveBeenCalledWith(
        'record_01',
        expect.objectContaining({ id: 'record_01' }),
      ),
    );
    await vi.waitFor(() => expect(detail.isConnected).toBe(false));
    expect(onClose).toHaveBeenCalledTimes(1);
    container.remove();
  });

  it('keeps the Detail open when the delete fails', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const onDeleteRecord = vi.fn(async () => {
      throw new Error('delete failed');
    });
    const detail = createRecordDetail(createRecord({ field_name: 'One' }), {
      fields: [textField('field_name', 'Name')],
      translate: createTranslator('en'),
      callbacks: { onDeleteRecord },
    });
    container.append(detail);

    detail.querySelector<HTMLButtonElement>('[data-action="detail-menu"]')?.click();
    detail.querySelector<HTMLButtonElement>('[data-action="detail-delete"]')?.click();
    await vi.waitFor(() => expect(onDeleteRecord).toHaveBeenCalled());
    await Promise.resolve();
    await Promise.resolve();
    expect(detail.isConnected).toBe(true);
    container.remove();
  });

  it('omits the delete action without the callback', () => {
    const detail = createRecordDetail(createRecord({ field_name: 'One' }), {
      fields: [textField('field_name', 'Name')],
      translate: createTranslator('en'),
    });
    detail.querySelector<HTMLButtonElement>('[data-action="detail-menu"]')?.click();
    expect(detail.querySelector('[data-action="detail-copy-id"]')).not.toBeNull();
    expect(detail.querySelector('[data-action="detail-delete"]')).toBeNull();
  });
});

describe('Record Detail presentation', () => {
  it('toggles the modal presentation through the expand action', () => {
    const container = document.createElement('div');
    container.className = 'loom-detail-host';
    document.body.append(container);
    const detail = createRecordDetail(createRecord({ field_a: 'A' }), {
      fields: [createField('field_a', 'A')],
      translate: createTranslator('en'),
      callbacks: { onClose: vi.fn() },
    });
    container.append(detail);

    const expand = detail.querySelector<HTMLButtonElement>('.loom-record-detail-expand');
    const close = detail.querySelector<HTMLButtonElement>('[data-action="detail-close"]');
    expand?.click();
    expect(container.classList.contains('is-modal')).toBe(true);
    expect(expand?.getAttribute('aria-pressed')).toBe('true');
    // collapse affordance must not look like a second close button
    expect(expand?.innerHTML).not.toBe(close?.innerHTML);
    expect(
      detail.querySelectorAll('.loom-record-detail-header [data-action="detail-close"]'),
    ).toHaveLength(1);
    expand?.click();
    expect(container.classList.contains('is-modal')).toBe(false);
    container.remove();
  });

  it('orders the primary field first and marks it', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const detail = createRecordDetail(createRecord({ field_a: 'Alpha', field_b: 'Beta' }), {
      fields: [createField('field_b', 'B'), createField('field_a', 'A')],
      primaryFieldId: 'field_a',
      translate: createTranslator('en'),
    });
    container.append(detail);

    const labels = [...detail.querySelectorAll<HTMLElement>('.loom-record-fields dt')];
    expect(labels[0]?.dataset.fieldId).toBe('field_a');
    expect(labels[0]?.dataset.primary).toBe('true');
    expect(labels[1]?.dataset.primary).toBeUndefined();
    container.remove();
  });
});

describe('Record Detail field list', () => {
  it('lists empty Fields as editable rows alongside filled Fields', () => {
    const container = document.createElement('div');
    container.append(
      createRecordDetail(createRecord({ field_filled: 'Value', field_empty: null }), {
        fields: [createField('field_filled', 'Filled'), createField('field_empty', 'Empty')],
        translate: createTranslator('en'),
      }),
    );

    expect(container.querySelector('.loom-record-fields-empty')).toBeNull();
    const mainLabels = [
      ...container.querySelectorAll<HTMLElement>('.loom-record-detail > dl.loom-record-fields dt'),
    ].map((dt) => dt.textContent);
    expect(mainLabels).toEqual(['Filled', 'Empty']);
  });
});
