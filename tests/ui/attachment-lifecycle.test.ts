import { describe, expect, it, vi } from 'vitest';

import {
  LoomTableClientError,
  type Attachment,
  type LoomTableRecord,
} from '../../src/client/loomtable-client';
import {
  createAttachmentAddCallback,
  createAttachmentDetachCallback,
  isAttachmentRetryable,
  type AttachmentFilePicker,
  type AttachmentUploadFile,
} from '../../src/ui/attachment-upload';

describe('Attachment lifecycle seam', () => {
  it('detaches only the selected reference and preserves the remaining references', async () => {
    const updateRecord = vi.fn().mockResolvedValue(createRecord());
    const detach = createAttachmentDetachCallback({
      updateRecord,
      idFactory: () => 'mut_detach_01',
    });
    const source = createRecord({
      field_attachment: [
        { id: 'attachment_a', source: 'managed', filename: 'a.txt' },
        { id: 'attachment_b', source: 'vault', filename: 'b.txt' },
      ],
    });

    await expect(
      detach('record_01', 'field_attachment', 'attachment_a', source),
    ).resolves.toBeDefined();

    expect(updateRecord).toHaveBeenCalledWith(
      'record_01',
      'field_attachment',
      [{ id: 'attachment_b', source: 'vault', filename: 'b.txt' }],
      source,
      expect.objectContaining({
        clientMutationId: 'mut_detach_01',
        expectedRevision: source.revision,
      }),
    );
  });

  it('uses set with an empty array when detaching the last reference', async () => {
    const updateRecord = vi.fn().mockResolvedValue(createRecord({ field_attachment: [] }));
    const detach = createAttachmentDetachCallback({
      updateRecord,
      idFactory: () => 'mut_detach_02',
    });
    const source = createRecord({
      field_attachment: [{ id: 'attachment_a', source: 'managed', filename: 'a.txt' }],
    });

    await detach('record_01', 'field_attachment', 'attachment_a', source);

    expect(updateRecord.mock.calls[0]?.[2]).toEqual([]);
    expect(updateRecord.mock.calls[0]?.[2]).not.toBeUndefined();
  });

  it('does not mutate or request anything while offline', async () => {
    const updateRecord = vi.fn();
    const detach = createAttachmentDetachCallback({
      updateRecord,
      isOffline: () => true,
    });

    await expect(
      detach(
        'record_01',
        'field_attachment',
        'attachment_a',
        createRecord({
          field_attachment: [{ id: 'attachment_a', source: 'managed', filename: 'a.txt' }],
        }),
      ),
    ).rejects.toMatchObject({ kind: 'validation' });
    expect(updateRecord).not.toHaveBeenCalled();
  });

  it('reuses the same initialize idempotency key and metadata after an explicit retry', async () => {
    const file = uploadFile();
    const picker = {
      pick: vi.fn().mockResolvedValue(file),
    } satisfies AttachmentFilePicker;
    const pending = attachment('pending');
    const ready = attachment('ready');
    const initializeAttachment = vi
      .fn()
      .mockRejectedValueOnce(new LoomTableClientError('network', { message: 'temporary' }))
      .mockResolvedValueOnce(pending);
    const uploadAttachmentContent = vi.fn().mockResolvedValue(ready);
    const add = createAttachmentAddCallback(
      { initializeAttachment, uploadAttachmentContent },
      {
        picker,
        updateRecord: vi.fn().mockResolvedValue(createRecord()),
        idFactory: () => 'idem_attachment_01',
        mutationIdFactory: () => 'mut_record_01',
      },
    );

    let firstError: unknown;
    try {
      await add('record_01', 'field_attachment', createRecord(), 10);
    } catch (error) {
      firstError = error;
    }
    expect(isAttachmentRetryable(firstError)).toBe(true);
    const retry = add.retry;
    expect(retry).toBeDefined();

    await retry?.('record_01', 'field_attachment', createRecord(), 10);

    expect(initializeAttachment).toHaveBeenCalledTimes(2);
    expect(initializeAttachment.mock.calls[0]?.[0]).toEqual(
      initializeAttachment.mock.calls[1]?.[0],
    );
    expect(initializeAttachment.mock.calls[0]?.[1]).toBe('idem_attachment_01');
    expect(initializeAttachment.mock.calls[1]?.[1]).toBe('idem_attachment_01');
    expect(uploadAttachmentContent).toHaveBeenCalledWith(
      'attachment_pending',
      expect.any(ArrayBuffer),
      'text/plain',
    );
  });

  it('checks the attachment before explicitly retrying a failed upload and skips a ready upload', async () => {
    const file = uploadFile();
    const picker = {
      pick: vi.fn().mockResolvedValue(file),
    } satisfies AttachmentFilePicker;
    const pending = attachment('pending');
    const ready = attachment('ready');
    const uploadAttachmentContent = vi
      .fn()
      .mockRejectedValueOnce(new LoomTableClientError('network', { message: 'unknown' }));
    const getAttachment = vi.fn().mockResolvedValue(ready);
    const updateRecord = vi.fn().mockResolvedValue(createRecord());
    const add = createAttachmentAddCallback(
      {
        initializeAttachment: vi.fn().mockResolvedValue(pending),
        uploadAttachmentContent,
        getAttachment,
      },
      {
        picker,
        updateRecord,
        idFactory: () => 'idem_attachment_02',
      },
    );

    await expectRetryable(add('record_01', 'field_attachment', createRecord(), 10));
    await add.retry?.('record_01', 'field_attachment', createRecord(), 10);

    expect(getAttachment).toHaveBeenCalledWith('attachment_pending');
    expect(uploadAttachmentContent).toHaveBeenCalledTimes(1);
    expect(updateRecord).toHaveBeenCalledTimes(1);
  });

  it('allows one explicit retry for a still-pending upload with the same bytes', async () => {
    const file = uploadFile();
    const picker = {
      pick: vi.fn().mockResolvedValue(file),
    } satisfies AttachmentFilePicker;
    const pending = attachment('pending');
    const uploadAttachmentContent = vi
      .fn()
      .mockRejectedValueOnce(new LoomTableClientError('network', { message: 'temporary' }))
      .mockResolvedValueOnce(attachment('ready'));
    const add = createAttachmentAddCallback(
      {
        initializeAttachment: vi.fn().mockResolvedValue(pending),
        uploadAttachmentContent,
        getAttachment: vi.fn().mockResolvedValue(pending),
      },
      {
        picker,
        updateRecord: vi.fn().mockResolvedValue(createRecord()),
        idFactory: () => 'idem_attachment_03',
      },
    );

    await expectRetryable(add('record_01', 'field_attachment', createRecord(), 10));
    await add.retry?.('record_01', 'field_attachment', createRecord(), 10);

    expect(uploadAttachmentContent).toHaveBeenCalledTimes(2);
    expect(uploadAttachmentContent.mock.calls[0]?.[1]).toBe(
      uploadAttachmentContent.mock.calls[1]?.[1],
    );
  });

  it('does not blindly upload after an attachment lookup reports not found', async () => {
    const file = uploadFile();
    const picker = {
      pick: vi.fn().mockResolvedValue(file),
    } satisfies AttachmentFilePicker;
    const pending = attachment('pending');
    const uploadAttachmentContent = vi
      .fn()
      .mockRejectedValueOnce(new LoomTableClientError('network', { message: 'unknown' }));
    const getAttachment = vi.fn().mockRejectedValue(
      new LoomTableClientError('not-found', {
        message: 'missing',
        httpStatus: 404,
      }),
    );
    const add = createAttachmentAddCallback(
      {
        initializeAttachment: vi.fn().mockResolvedValue(pending),
        uploadAttachmentContent,
        getAttachment,
      },
      { picker, updateRecord: vi.fn(), idFactory: () => 'idem_attachment_04' },
    );

    await expectRetryable(add('record_01', 'field_attachment', createRecord(), 10));
    await expect(
      add.retry?.('record_01', 'field_attachment', createRecord(), 10),
    ).rejects.toMatchObject({
      kind: 'not-found',
    });

    expect(uploadAttachmentContent).toHaveBeenCalledTimes(1);
  });

  it('reads back an uncertain Record reference mutation before reusing its request', async () => {
    const file = uploadFile();
    const picker = {
      pick: vi.fn().mockResolvedValue(file),
    } satisfies AttachmentFilePicker;
    const pending = attachment('pending');
    const ready = attachment('ready');
    const updateRecord = vi
      .fn()
      .mockRejectedValueOnce(new LoomTableClientError('network', { message: 'unknown' }))
      .mockResolvedValueOnce(createRecord());
    const getRecord = vi.fn().mockResolvedValue(createRecord());
    const add = createAttachmentAddCallback(
      {
        initializeAttachment: vi.fn().mockResolvedValue(pending),
        uploadAttachmentContent: vi.fn().mockResolvedValue(ready),
      },
      {
        picker,
        updateRecord,
        getRecord,
        idFactory: () => 'idem_attachment_05',
        mutationIdFactory: () => 'mut_record_05',
      },
    );

    await expect(add('record_01', 'field_attachment', createRecord(), 10)).resolves.toBeDefined();

    expect(getRecord).toHaveBeenCalledWith('record_01');
    expect(updateRecord).toHaveBeenCalledTimes(2);
    expect(updateRecord.mock.calls[0]?.[4]).toEqual(updateRecord.mock.calls[1]?.[4]);
  });
});

async function expectRetryable(promise: Promise<unknown>): Promise<void> {
  let error: unknown;
  try {
    await promise;
  } catch (caught) {
    error = caught;
  }
  expect(isAttachmentRetryable(error)).toBe(true);
}

function uploadFile(): AttachmentUploadFile {
  const bytes = new Uint8Array([1, 2, 3]).buffer;
  return {
    name: 'folder/file.txt',
    type: 'text/plain',
    size: bytes.byteLength,
    arrayBuffer: vi.fn().mockResolvedValue(bytes),
  };
}

function attachment(status: 'pending' | 'ready'): Attachment {
  return {
    id: 'attachment_pending',
    source: 'managed',
    filename: 'file.txt',
    mimeType: 'text/plain',
    size: 3,
    status,
    revision: status === 'pending' ? 1 : 2,
    createdAt: '',
    updatedAt: '',
  };
}

function createRecord(values: Record<string, unknown> = {}, revision = 1): LoomTableRecord {
  return {
    id: 'record_01',
    tableId: 'table_01',
    revision,
    values: values as LoomTableRecord['values'],
    createdAt: '',
    updatedAt: '',
  };
}

