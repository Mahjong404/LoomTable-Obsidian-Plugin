import { describe, expect, it, vi } from 'vitest';

import {
  LoomTableClientError,
  type Attachment,
  type LoomTableRecord,
} from '../../src/client/loomtable-client';
import { createTranslator } from '../../src/i18n';
import {
  createAttachmentAddCallback,
  describeAttachmentUploadError,
  type AttachmentFilePicker,
  type AttachmentUploadFile,
} from '../../src/ui/attachment-upload';

describe('Attachment Add/Upload seam', () => {
  it('treats file-picker cancellation as a no-op before any Server request', async () => {
    const picker = { pick: vi.fn().mockResolvedValue(null) } satisfies AttachmentFilePicker;
    const client = {
      initializeAttachment: vi.fn(),
      uploadAttachmentContent: vi.fn(),
    };
    const updateRecord = vi.fn();
    const add = createAttachmentAddCallback(client, {
      picker,
      updateRecord,
      idFactory: () => 'mut_init',
    });

    await expect(add('record_01', 'field_attachment', createRecord(), 10)).resolves.toBeNull();

    expect(picker.pick).toHaveBeenCalledTimes(1);
    expect(client.initializeAttachment).not.toHaveBeenCalled();
    expect(client.uploadAttachmentContent).not.toHaveBeenCalled();
    expect(updateRecord).not.toHaveBeenCalled();
  });

  it('does not open a picker or request anything while offline', async () => {
    const picker = { pick: vi.fn() } satisfies AttachmentFilePicker;
    const client = {
      initializeAttachment: vi.fn(),
      uploadAttachmentContent: vi.fn(),
    };
    const add = createAttachmentAddCallback(client, {
      picker,
      updateRecord: vi.fn(),
      isOffline: () => true,
    });

    await expect(add('record_01', 'field_attachment', createRecord(), 10)).rejects.toMatchObject({
      kind: 'validation',
    });
    expect(picker.pick).not.toHaveBeenCalled();
    expect(client.initializeAttachment).not.toHaveBeenCalled();
  });

  it('initializes, uploads, and queues the returned AttachmentRef without leaking Attachment metadata', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]).buffer;
    const file: AttachmentUploadFile = {
      name: 'folder/photo.png',
      type: 'image/png',
      size: bytes.byteLength,
      arrayBuffer: vi.fn().mockResolvedValue(bytes),
    };
    const picker = { pick: vi.fn().mockResolvedValue(file) } satisfies AttachmentFilePicker;
    const initialized: Attachment = {
      id: 'attachment_pending',
      source: 'managed',
      filename: 'photo.png',
      mimeType: 'image/png',
      size: 4,
      status: 'pending',
      revision: 1,
      createdAt: '',
      updatedAt: '',
    };
    const uploaded: Attachment = {
      ...initialized,
      status: 'ready',
      storageKey: 'managed/internal-key',
      hash: 'internal-hash',
      revision: 2,
    };
    const authoritative = createRecord({
      field_attachment: [{ id: 'attachment_ready', source: 'managed', filename: 'photo.png' }],
    });
    const updateRecord = vi.fn().mockResolvedValue(authoritative);
    const client = {
      initializeAttachment: vi.fn().mockResolvedValue(initialized),
      uploadAttachmentContent: vi.fn().mockResolvedValue(uploaded),
    };
    const add = createAttachmentAddCallback(client, {
      picker,
      updateRecord,
      idFactory: () => 'mut_init',
    });
    const source = createRecord();

    await expect(add('record_01', 'field_attachment', source, 10)).resolves.toBe(authoritative);

    expect(client.initializeAttachment).toHaveBeenCalledWith(
      {
        source: 'managed',
        filename: 'folder_photo.png',
        mimeType: 'image/png',
        size: 4,
      },
      'mut_init',
    );
    expect(client.uploadAttachmentContent).toHaveBeenCalledWith(
      'attachment_pending',
      bytes,
      'image/png',
    );
    expect(updateRecord).toHaveBeenCalledWith(
      'record_01',
      'field_attachment',
      [
        {
          id: 'attachment_pending',
          source: 'managed',
          filename: 'photo.png',
          mimeType: 'image/png',
          size: 4,
        },
      ],
      source,
      expect.objectContaining({
        clientMutationId: /.+/,
        expectedRevision: 1,
      }),
    );
    expect(updateRecord.mock.calls[0]?.[2]).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ status: 'ready', revision: 2 })]),
    );
  });

  it('rejects invalid existing references before creating a new one', async () => {
    const client = {
      initializeAttachment: vi.fn(),
      uploadAttachmentContent: vi.fn(),
    };
    const add = createAttachmentAddCallback(client, {
      picker: { pick: vi.fn() },
      updateRecord: vi.fn(),
    });

    await expect(
      add(
        'record_01',
        'field_attachment',
        createRecord({ field_attachment: [{ id: 'missing' }] }),
        10,
      ),
    ).rejects.toMatchObject({ kind: 'validation' });
    expect(client.initializeAttachment).not.toHaveBeenCalled();
  });

  it('maps published error classes and statuses to bounded translated summaries', () => {
    const translate = createTranslator('en');
    expect(
      describeAttachmentUploadError(
        new LoomTableClientError('authentication', { message: 'secret', httpStatus: 401 }),
        translate,
      ),
    ).toBe('Authentication is required to add an attachment. Check Connection Settings.');
    expect(
      describeAttachmentUploadError(
        new LoomTableClientError('forbidden', { message: 'raw', httpStatus: 403 }),
        translate,
      ),
    ).toBe('You do not have permission to add an attachment.');
    expect(
      describeAttachmentUploadError(
        new LoomTableClientError('server', { message: 'raw', httpStatus: 413 }),
        translate,
      ),
    ).toBe('This attachment is too large.');
    expect(
      describeAttachmentUploadError(
        new LoomTableClientError('server', { message: 'raw', httpStatus: 415 }),
        translate,
      ),
    ).toBe('This attachment type is not supported.');
    expect(
      describeAttachmentUploadError(
        new LoomTableClientError('validation', { message: 'raw', httpStatus: 422 }),
        translate,
      ),
    ).toBe('The attachment or Record value was rejected. Check the file and try again.');
    expect(
      describeAttachmentUploadError(
        new LoomTableClientError('network', { message: 'raw' }),
        translate,
      ),
    ).toBe('The attachment could not be uploaded. Reconnect and try again.');
    expect(
      describeAttachmentUploadError(
        new LoomTableClientError('server', { message: 'raw', httpStatus: 500 }),
        translate,
      ),
    ).toBe('The Server could not add this attachment. Try again later.');
  });
});

function createRecord(values: Record<string, unknown> = {}): LoomTableRecord {
  return {
    id: 'record_01',
    tableId: 'table_01',
    revision: 1,
    values: values as LoomTableRecord['values'],
    createdAt: '',
    updatedAt: '',
  };
}
