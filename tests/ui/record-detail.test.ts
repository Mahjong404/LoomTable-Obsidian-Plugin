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
    expect(form.querySelector('[role="alert"]')?.textContent).toContain('Location');
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
      const trigger = container.querySelector<HTMLElement>('.loom-location-preview-trigger');
      expect(trigger).not.toBeNull();
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
    const onConflictAction = vi.fn();
    const onLocationEdit = vi
      .fn()
      .mockRejectedValue(new LoomTableClientError('conflict', { message: 'Revision conflict.' }));
    const conflict = {
      currentRevision: 2,
      currentValues: { field_location: { label: 'Server' } },
      submittedSet: { field_location: { label: 'Local' } },
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
