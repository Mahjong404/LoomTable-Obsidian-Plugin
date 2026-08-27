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

  it('renders the complete returned Record after a Location save', async () => {
    const container = document.createElement('div');
    const returnedRecord = createRecord({
      field_location: { label: 'Server value', lat: 3, lng: 4, precision: 'exact' },
    });
    returnedRecord.revision = 2;
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

  it('keeps the existing use-server and overwrite conflict actions in Location detail', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const onConflictAction = vi.fn();
    const onLocationEdit = vi
      .fn()
      .mockRejectedValue(new LoomTableClientError('conflict', { message: 'Revision conflict.' }));
    const conflict = {
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
        callbacks: {
          onLocationEdit,
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
    expect(document.activeElement).toBe(container.querySelector('.loom-record-conflict'));

    const buttons = container.querySelectorAll<HTMLButtonElement>('.loom-record-conflict button');
    buttons[0]?.click();
    buttons[1]?.click();
    expect(onConflictAction).toHaveBeenNthCalledWith(1, 'record_01', 'use-server');
    expect(onConflictAction).toHaveBeenNthCalledWith(2, 'record_01', 'overwrite');
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
