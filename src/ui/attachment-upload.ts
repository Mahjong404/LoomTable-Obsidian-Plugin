import {
  LoomTableClientError,
  type Attachment,
  type AttachmentRef,
  type LoomTableClient,
  type LoomTableRecord,
} from '../client/loomtable-client';
import type { Translator } from '../i18n';
import type { MessageKey } from '../i18n/messages';
import { createMutationId } from './mutation-queue';

export interface AttachmentUploadFile {
  readonly name: string;
  readonly type: string;
  readonly size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface AttachmentFilePicker {
  pick(): Promise<AttachmentUploadFile | null>;
}

export type AttachmentReferenceUpdater = (
  recordId: string,
  fieldId: string,
  references: readonly AttachmentRef[],
  sourceRecord: LoomTableRecord,
) => Promise<LoomTableRecord | void>;

export type AttachmentAddHandler = (
  recordId: string,
  fieldId: string,
  sourceRecord: LoomTableRecord,
  maxCount: number,
) => Promise<LoomTableRecord | null | undefined>;

export interface AttachmentAddCallbackOptions {
  readonly updateRecord: AttachmentReferenceUpdater;
  readonly picker?: AttachmentFilePicker;
  readonly isOffline?: () => boolean;
  readonly idFactory?: () => string;
}

export function createAttachmentAddCallback(
  client: Pick<LoomTableClient, 'initializeAttachment' | 'uploadAttachmentContent'>,
  options: AttachmentAddCallbackOptions,
): AttachmentAddHandler {
  const picker = options.picker ?? createBrowserAttachmentFilePicker();
  const isOffline = options.isOffline ?? defaultIsOffline;
  const idFactory = options.idFactory ?? createMutationId;

  return async (recordId, fieldId, sourceRecord, maxCount) => {
    if (isOffline()) {
      throw attachmentError('ATTACHMENT_OFFLINE');
    }
    const current = readAttachmentReferences(sourceRecord.values[fieldId]);
    if (current === null) {
      throw attachmentError('ATTACHMENT_REFERENCES_INVALID');
    }
    if (!Number.isInteger(maxCount) || maxCount < 1 || current.length >= maxCount) {
      throw attachmentError('ATTACHMENT_LIMIT_REACHED');
    }

    const file = await picker.pick();
    if (file === null) return null;

    const mimeType = file.type.trim();
    const initialized = await client.initializeAttachment(
      {
        source: 'managed',
        filename: sanitizeAttachmentFilename(file.name),
        ...(mimeType === '' ? {} : { mimeType }),
        ...(Number.isFinite(file.size) && file.size >= 0 ? { size: file.size } : {}),
      },
      idFactory(),
    );
    if (
      initialized.source !== 'managed' ||
      initialized.status !== 'pending' ||
      initialized.id.trim() === '' ||
      initialized.filename.trim() === ''
    ) {
      throw attachmentError('ATTACHMENT_INIT_RESPONSE_INVALID');
    }

    const bytes = await file.arrayBuffer();
    const uploaded = await client.uploadAttachmentContent(
      initialized.id,
      bytes,
      mimeType === '' ? undefined : mimeType,
    );
    if (
      uploaded.source !== 'managed' ||
      uploaded.status !== 'ready' ||
      uploaded.id.trim() === '' ||
      uploaded.filename.trim() === ''
    ) {
      throw attachmentError('ATTACHMENT_UPLOAD_RESPONSE_INVALID');
    }

    const references = [...current, attachmentReference(uploaded)];
    return options.updateRecord(recordId, fieldId, references, sourceRecord);
  };
}

export function describeAttachmentUploadError(error: unknown, translate: Translator): string {
  const clientError = error instanceof LoomTableClientError ? error : null;
  const status = clientError?.details.httpStatus;
  if (status === 401 || clientError?.kind === 'authentication') {
    return translate('record.attachment.addAuth');
  }
  if (status === 403 || clientError?.kind === 'forbidden') {
    return translate('record.attachment.addForbidden');
  }
  if (status === 413) return translate('record.attachment.addTooLarge');
  if (status === 415) return translate('record.attachment.addUnsupported');
  if (status === 422 || clientError?.kind === 'validation') {
    return translate('record.attachment.addInvalid');
  }
  if (clientError?.kind === 'conflict') {
    return translate('record.attachment.addConflict');
  }
  if (clientError?.kind === 'capability') {
    return translate('record.attachment.addCapability');
  }
  if (clientError?.kind === 'network' || clientError?.kind === 'timeout') {
    return translate('record.attachment.addNetwork');
  }
  return translate('record.attachment.addServer');
}

export function readAttachmentReferences(value: unknown): readonly AttachmentRef[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return null;
  const references: AttachmentRef[] = [];
  for (const item of value) {
    if (!isAttachmentRefObject(item)) return null;
    references.push(toAttachmentReference(item));
  }
  return references;
}

function isAttachmentRefObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.id !== 'string' ||
    candidate.id.trim() === '' ||
    (candidate.source !== 'managed' && candidate.source !== 'vault') ||
    typeof candidate.filename !== 'string' ||
    candidate.filename.trim() === ''
  ) {
    return false;
  }
  for (const key of ['mimeType', 'storageKey', 'vaultPath', 'hash'] as const) {
    if (candidate[key] !== undefined && typeof candidate[key] !== 'string') return false;
  }
  for (const key of ['size', 'width', 'height'] as const) {
    if (
      candidate[key] !== undefined &&
      (typeof candidate[key] !== 'number' || !Number.isFinite(candidate[key]) || candidate[key] < 0)
    ) {
      return false;
    }
  }
  return true;
}

function toAttachmentReference(value: Record<string, unknown>): AttachmentRef {
  return {
    id: value.id as string,
    source: value.source as 'managed' | 'vault',
    filename: value.filename as string,
    ...(value.mimeType === undefined ? {} : { mimeType: value.mimeType as string }),
    ...(value.size === undefined ? {} : { size: value.size as number }),
    ...(value.storageKey === undefined ? {} : { storageKey: value.storageKey as string }),
    ...(value.vaultPath === undefined ? {} : { vaultPath: value.vaultPath as string }),
    ...(value.hash === undefined ? {} : { hash: value.hash as string }),
    ...(value.width === undefined ? {} : { width: value.width as number }),
    ...(value.height === undefined ? {} : { height: value.height as number }),
  };
}

function attachmentReference(attachment: Attachment): AttachmentRef {
  return {
    id: attachment.id,
    source: attachment.source,
    filename: attachment.filename,
    ...(attachment.mimeType === undefined ? {} : { mimeType: attachment.mimeType }),
    ...(attachment.size === undefined ? {} : { size: attachment.size }),
    ...(attachment.width === undefined ? {} : { width: attachment.width }),
    ...(attachment.height === undefined ? {} : { height: attachment.height }),
  };
}

function attachmentError(code: string): LoomTableClientError {
  return new LoomTableClientError('validation', { code, message: code });
}

export function createBrowserAttachmentFilePicker(): AttachmentFilePicker {
  return {
    pick: () =>
      new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.hidden = true;
        let settled = false;
        const finish = (file: File | null): void => {
          if (settled) return;
          settled = true;
          input.removeEventListener('change', onChange);
          input.removeEventListener('cancel', onCancel);
          input.remove();
          resolve(file);
        };
        const onChange = (): void => {
          finish(input.files?.[0] ?? null);
        };
        const onCancel = (): void => {
          finish(null);
        };
        input.addEventListener('change', onChange);
        input.addEventListener('cancel', onCancel);
        document.body?.append(input);
        try {
          input.click();
        } catch {
          finish(null);
        }
      }),
  };
}

function sanitizeAttachmentFilename(filename: string): string {
  const safeFilename = Array.from(filename)
    .map((character) => (character === '/' || character === '\\' ? '_' : character))
    .filter((character) => {
      const code = character.charCodeAt(0);
      return !(code <= 0x1f || (code >= 0x7f && code <= 0x9f));
    })
    .join('')
    .trim();
  return safeFilename === '' ? 'attachment' : safeFilename;
}

function defaultIsOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}
