import { describe, expect, it, vi } from 'vitest';

import type { Field, JsonValue, LoomTableRecord } from '../../src/client/loomtable-client';
import { createTranslator } from '../../src/i18n';
import { createAttachmentAddCallback } from '../../src/ui/attachment-upload';
import { createRecordDetail } from '../../src/ui/record-detail';

describe('Record Detail attachment lifecycle actions', () => {
  it('confirms Detach with the attachment name and leaves data untouched on Cancel', async () => {
    const onDetach = vi.fn().mockResolvedValue(undefined);
    const confirmDangerousAction = vi.fn().mockResolvedValue(false);
    const detail = createRecordDetail(
      createRecord([
        {
          id: 'attachment_a',
          source: 'managed',
          filename: 'report.pdf',
          status: 'ready',
        },
      ]),
      {
        fields: [attachmentField()],
        translate: createTranslator('en'),
        confirmDangerousAction,
        callbacks: { onAttachmentDetach: onDetach },
      },
    );

    const action = detail.querySelector<HTMLButtonElement>('.loom-attachment-detach-action');
    expect(action).not.toBeNull();
    action?.click();
    await vi.waitFor(() => expect(confirmDangerousAction).toHaveBeenCalledTimes(1));

    expect(confirmDangerousAction.mock.calls[0]?.[0]).toContain('report.pdf');
    expect(onDetach).not.toHaveBeenCalled();
  });

  it('passes the selected reference to Detach only after explicit confirmation', async () => {
    const onDetach = vi.fn().mockResolvedValue(undefined);
    const confirmDangerousAction = vi.fn().mockResolvedValue(true);
    const record = createRecord([
      {
        id: 'attachment_a',
        source: 'managed',
        filename: 'report.pdf',
        status: 'ready',
      },
    ]);
    const detail = createRecordDetail(record, {
      fields: [attachmentField()],
      translate: createTranslator('en'),
      confirmDangerousAction,
      callbacks: { onAttachmentDetach: onDetach },
    });

    detail.querySelector<HTMLButtonElement>('.loom-attachment-detach-action')?.click();
    await vi.waitFor(() => expect(onDetach).toHaveBeenCalledTimes(1));

    expect(onDetach).toHaveBeenCalledWith('record_01', 'field_attachment', 'attachment_a', record);
  });

  it('keeps Detach disabled and understandable while offline', () => {
    const detail = createRecordDetail(
      createRecord([
        {
          id: 'attachment_a',
          source: 'managed',
          filename: 'report.pdf',
          status: 'ready',
        },
      ]),
      {
        fields: [attachmentField()],
        translate: createTranslator('en'),
        offline: true,
        callbacks: { onAttachmentDetach: vi.fn() },
      },
    );

    const action = detail.querySelector<HTMLButtonElement>('.loom-attachment-detach-action');
    expect(action?.disabled).toBe(true);
    expect(action?.getAttribute('aria-label')).toContain('Offline');
  });

  it('shows a Retry action only after a retryable upload failure', async () => {
    const file = {
      name: 'report.pdf',
      type: 'application/pdf',
      size: 1,
      arrayBuffer: vi.fn().mockResolvedValue(new Uint8Array([1]).buffer),
    } satisfies AttachmentUploadFile;
    const add = createAttachmentAddCallback(
      {
        initializeAttachment: vi
          .fn()
          .mockRejectedValue(new LoomTableClientError('network', { message: 'temporary' })),
        uploadAttachmentContent: vi.fn(),
      },
      {
        picker: { pick: vi.fn().mockResolvedValue(file) },
        updateRecord: vi.fn(),
        idFactory: () => 'idem_detail_01',
      },
    );
    const detail = createRecordDetail(createRecord([]), {
      fields: [attachmentField()],
      translate: createTranslator('en'),
      callbacks: {
        onAttachmentAdd: add,
        onAttachmentAddRetry: add.retry,
      },
    });

    detail.querySelector<HTMLButtonElement>('.loom-attachment-add-action')?.click();
    await vi.waitFor(() =>
      expect(detail.querySelector('.loom-attachment-add-retry-action')).not.toBeNull(),
    );
    expect(detail.querySelector('.loom-attachment-add-retry-action')?.textContent).toContain(
      'Retry',
    );
  });
});

function attachmentField(): Field {
  return {
    id: 'field_attachment',
    tableId: 'table_01',
    name: 'Attachments',
    position: 0,
    schemaVersion: 1,
    revision: 1,
    type: 'attachment',
    config: { maxCount: 10 },
  };
}

function createRecord(value: JsonValue): LoomTableRecord {
  return {
    id: 'record_01',
    tableId: 'table_01',
    revision: 1,
    createdAt: '',
    updatedAt: '',
    values: { field_attachment: value },
  };
}

