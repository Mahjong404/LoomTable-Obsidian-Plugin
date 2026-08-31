import { describe, expect, it, vi } from 'vitest';

import type { Field, LoomTableRecord } from '../../src/client/loomtable-client';
import { createTranslator } from '../../src/i18n';
import { createRecordDetail } from '../../src/ui/record-detail';

describe('Record Detail Attachment Add', () => {
  it('shows a Detail-only accessible Add action and replaces the value from the returned Record', async () => {
    const field = attachmentField();
    const record = createRecord({ field_attachment: [] });
    const updated = createRecord({
      field_attachment: [
        { id: 'attachment_ready', source: 'managed', filename: 'photo.png', mimeType: 'image/png' },
      ],
    });
    const onAttachmentAdd = vi.fn().mockResolvedValue(updated);
    const detail = createRecordDetail(record, {
      fields: [field],
      translate: createTranslator('en'),
      callbacks: { onAttachmentAdd },
    });

    const add = detail.querySelector<HTMLButtonElement>('.loom-attachment-add-action');
    expect(add?.textContent).toBe('Add attachment');
    expect(add?.getAttribute('aria-live')).toBeNull();
    expect(add?.parentElement?.querySelector<HTMLElement>('[aria-live="polite"]')).not.toBeNull();

    add?.click();
    add?.click();

    await vi.waitFor(() => expect(onAttachmentAdd).toHaveBeenCalledTimes(1));
    expect(onAttachmentAdd).toHaveBeenCalledWith('record_01', 'field_attachment', record, 10);
    expect(detail.textContent).toContain('photo.png');
    expect(detail.querySelector('.loom-attachment-add-action')).not.toBeNull();
  });

  it('keeps cancellation visible and makes no mutation when the typed callback returns null', async () => {
    const onAttachmentAdd = vi.fn().mockResolvedValue(null);
    const detail = createRecordDetail(createRecord({ field_attachment: [] }), {
      fields: [attachmentField()],
      translate: createTranslator('en'),
      callbacks: { onAttachmentAdd },
    });

    detail.querySelector<HTMLButtonElement>('.loom-attachment-add-action')?.click();

    await vi.waitFor(() =>
      expect(detail.querySelector('.loom-attachment-add-action-status')?.textContent).toBe(
        'Add cancelled.',
      ),
    );
  });

  it('disables Add offline with a translated accessible explanation and no callback', () => {
    const onAttachmentAdd = vi.fn();
    const detail = createRecordDetail(createRecord({ field_attachment: [] }), {
      fields: [attachmentField()],
      translate: createTranslator('zh-CN'),
      offline: true,
      callbacks: { onAttachmentAdd },
    });

    const add = detail.querySelector<HTMLButtonElement>('.loom-attachment-add-action');
    expect(add?.disabled).toBe(true);
    expect(add?.getAttribute('aria-label')).toBe('当前离线；恢复连接后才能添加附件。');
    expect(detail.querySelector('.loom-attachment-add-action-status')?.textContent).toBe(
      '当前离线；恢复连接后才能添加附件。',
    );
    add?.click();
    expect(onAttachmentAdd).not.toHaveBeenCalled();
  });

  it('does not expose Add without a host callback or after the field count reaches maxCount', () => {
    const withoutCallback = createRecordDetail(createRecord({ field_attachment: [] }), {
      fields: [attachmentField()],
      translate: createTranslator('en'),
    });
    expect(withoutCallback.querySelector('.loom-attachment-add-action')).toBeNull();

    const atLimit = createRecordDetail(
      createRecord({
        field_attachment: Array.from({ length: 10 }, (_, index) => ({
          id: `attachment_${index}`,
          source: 'managed',
          filename: `file-${index}.txt`,
        })),
      }),
      {
        fields: [attachmentField()],
        translate: createTranslator('en'),
        callbacks: { onAttachmentAdd: vi.fn() },
      },
    );
    expect(atLimit.querySelector('.loom-attachment-add-action')).toBeNull();
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
