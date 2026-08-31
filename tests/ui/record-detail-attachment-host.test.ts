import { describe, expect, it, vi } from 'vitest';

import type { Field, JsonValue, LoomTableRecord } from '../../src/client/loomtable-client';
import { createTranslator } from '../../src/i18n';
import { createRecordDetail } from '../../src/ui/record-detail';

describe('Record Detail attachment host action eligibility', () => {
  it('offers managed Preview but no Open action', () => {
    const detail = createRecordDetail(
      createRecord([
        {
          id: 'managed_1',
          source: 'managed',
          filename: 'report.pdf',
          status: 'ready',
        },
      ]),
      {
        fields: [attachmentField()],
        translate: createTranslator('en'),
        callbacks: {
          onAttachmentOpen: vi.fn(),
          onAttachmentPreview: vi.fn(),
        },
      },
    );

    expect(detail.querySelector('.loom-attachment-open-action')).toBeNull();
    expect(detail.querySelector('.loom-attachment-preview-action')).not.toBeNull();
  });

  it('offers Vault Open only when the record exposes an explicit safe path', () => {
    const detail = createRecordDetail(
      createRecord([
        {
          id: 'vault_1',
          source: 'vault',
          filename: 'report.pdf',
          vaultPath: 'attachments/report.pdf',
          status: 'ready',
        },
      ]),
      {
        fields: [attachmentField()],
        translate: createTranslator('en'),
        callbacks: {
          onAttachmentOpen: vi.fn(),
          onAttachmentPreview: vi.fn(),
        },
      },
    );

    expect(detail.querySelector('.loom-attachment-open-action')).not.toBeNull();
    expect(detail.querySelector('.loom-attachment-preview-action')).toBeNull();
  });

  it('does not expose actions for a Vault reference with an unsafe path', () => {
    const detail = createRecordDetail(
      createRecord([
        {
          id: 'vault_unsafe',
          source: 'vault',
          filename: 'report.pdf',
          vaultPath: '../report.pdf',
          status: 'ready',
        },
      ]),
      {
        fields: [attachmentField()],
        translate: createTranslator('en'),
        callbacks: {
          onAttachmentOpen: vi.fn(),
          onAttachmentPreview: vi.fn(),
        },
      },
    );

    expect(detail.querySelector('.loom-attachment-open-action')).toBeNull();
    expect(detail.querySelector('.loom-attachment-preview-action')).toBeNull();
  });

  it('keeps compact Grid or Map rendering non-interactive', () => {
    const detail = createRecordDetail(
      createRecord([
        {
          id: 'managed_1',
          source: 'managed',
          filename: 'report.pdf',
          status: 'ready',
        },
      ]),
      {
        fields: [attachmentField()],
        translate: createTranslator('en'),
        callbacks: {
          onAttachmentOpen: vi.fn(),
          onAttachmentPreview: vi.fn(),
        },
      },
    );
    const compact = detail.querySelector('.loom-attachment-summary');

    expect(compact).toBeNull();
    expect(detail.querySelector('.loom-attachment-card button')).not.toBeNull();
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
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    values: { field_attachment: value },
  };
}

