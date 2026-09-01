import {
  LoomTableClientError,
  type Attachment,
  type AttachmentRef,
  type InitializeAttachmentRequest,
  type LoomTableClient,
  type LoomTableRecord,
} from '../client/loomtable-client';
import type { Translator } from '../i18n';
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

export interface AttachmentReferenceMutationContext {
  readonly clientMutationId: string;
  readonly expectedRevision: number;
}

export type AttachmentReferenceUpdater = (
  recordId: string,
  fieldId: string,
  references: readonly AttachmentRef[],
  sourceRecord: LoomTableRecord,
  mutation: AttachmentReferenceMutationContext,
) => Promise<LoomTableRecord | undefined>;

export interface AttachmentAddHandler {
  (
    recordId: string,
    fieldId: string,
    sourceRecord: LoomTableRecord,
    maxCount: number,
  ): Promise<LoomTableRecord | null | undefined>;
  readonly retry?: AttachmentAddHandler;
}

export type AttachmentDetachHandler = (
  recordId: string,
  fieldId: string,
  attachmentId: string,
  sourceRecord: LoomTableRecord,
) => Promise<LoomTableRecord | undefined>;

export interface AttachmentAddCallbackOptions {
  readonly updateRecord: AttachmentReferenceUpdater;
  readonly getRecord?: (recordId: string) => Promise<LoomTableRecord>;
  readonly picker?: AttachmentFilePicker;
  readonly isOffline?: () => boolean;
  readonly idFactory?: () => string;
  readonly mutationIdFactory?: () => string;
}

export interface AttachmentDetachCallbackOptions {
  readonly updateRecord: AttachmentReferenceUpdater;
  readonly isOffline?: () => boolean;
  readonly idFactory?: () => string;
}

export class AttachmentRetryableError extends LoomTableClientError {
  readonly retryable = true;

  constructor(error: LoomTableClientError) {
    super(error.kind, error.details, { cause: error }, error.conflict);
  }
}

export function isAttachmentRetryable(error: unknown): error is AttachmentRetryableError {
  return error instanceof AttachmentRetryableError;
}

interface AttachmentAddAttempt {
  readonly key: string;
  readonly recordId: string;
  readonly fieldId: string;
  readonly maxCount: number;
  sourceRecord: LoomTableRecord;
  readonly request: InitializeAttachmentRequest;
  readonly idempotencyKey: string;
  readonly clientMutationId: string;
  readonly bytes: ArrayBuffer;
  readonly contentType?: string;
  attachment: Attachment | undefined;
  stage: 'initialize' | 'upload' | 'reference';
}

export function createAttachmentAddCallback(
  client: Pick<LoomTableClient, 'initializeAttachment' | 'uploadAttachmentContent'> &
    Partial<Pick<LoomTableClient, 'getAttachment'>>,
  options: AttachmentAddCallbackOptions,
): AttachmentAddHandler {
  const picker = options.picker ?? createBrowserAttachmentFilePicker();
  const isOffline = options.isOffline ?? defaultIsOffline;
  const idFactory = options.idFactory ?? createMutationId;
  const mutationIdFactory = options.mutationIdFactory ?? createMutationId;
  const attempts = new Map<string, AttachmentAddAttempt>();

  const start: AttachmentAddHandler = async (recordId, fieldId, sourceRecord, maxCount) => {
    if (isOffline()) throw attachmentError('ATTACHMENT_OFFLINE');
    const current = readAttachmentReferences(sourceRecord.values[fieldId]);
    if (current === null) throw attachmentError('ATTACHMENT_REFERENCES_INVALID');
    if (!Number.isInteger(maxCount) || maxCount < 1 || current.length >= maxCount) {
      throw attachmentError('ATTACHMENT_LIMIT_REACHED');
    }

    const file = await picker.pick();
    if (file === null) return null;

    const bytes = await file.arrayBuffer();
    const contentType = file.type.trim();
    const request: InitializeAttachmentRequest = {
      source: 'managed',
      filename: sanitizeAttachmentFilename(file.name),
      ...(contentType === '' ? {} : { mimeType: contentType }),
      ...(Number.isFinite(file.size) && file.size >= 0 ? { size: file.size } : {}),
    };
    const attempt: AttachmentAddAttempt = {
      key: attemptKey(recordId, fieldId),
      recordId,
      fieldId,
      maxCount,
      sourceRecord,
      request,
      idempotencyKey: idFactory(),
      clientMutationId: mutationIdFactory(),
      bytes,
      ...(contentType === '' ? {} : { contentType }),
      attachment: undefined,
      stage: 'initialize',
    };
    attempts.set(attempt.key, attempt);
    return executeWithRetryState(attempt);
  };

  const retry: AttachmentAddHandler = async (recordId, fieldId, sourceRecord, maxCount) => {
    if (isOffline()) throw attachmentError('ATTACHMENT_OFFLINE');
    const key = attemptKey(recordId, fieldId);
    const attempt = attempts.get(key);
    if (attempt === undefined || attempt.maxCount !== maxCount) {
      throw attachmentError('ATTACHMENT_RETRY_UNAVAILABLE');
    }
    attempt.sourceRecord = sourceRecord;

    if (attempt.stage === 'upload') {
      const attachment = attempt.attachment;
      if (attachment === undefined || client.getAttachment === undefined) {
        attempts.delete(key);
        throw attachmentError('ATTACHMENT_RETRY_UNAVAILABLE');
      }
      let current: Attachment;
      try {
        current = await client.getAttachment(attachment.id);
      } catch (error) {
        attempts.delete(key);
        throw asClientError(error);
      }
      if (current.source !== 'managed' || current.id.trim() === '') {
        attempts.delete(key);
        throw attachmentError('ATTACHMENT_STATUS_INVALID');
      }
      if (current.status === 'ready') {
        attempt.attachment = current;
        attempt.stage = 'reference';
      } else if (current.status !== 'pending') {
        attempts.delete(key);
        throw attachmentError('ATTACHMENT_STATUS_INVALID');
      }
    }

    return executeWithRetryState(attempt);
  };

  async function executeWithRetryState(
    attempt: AttachmentAddAttempt,
  ): Promise<LoomTableRecord | null | undefined> {
    try {
      const result = await executeAttempt(attempt);
      attempts.delete(attempt.key);
      return result;
    } catch (error) {
      const clientError = asClientError(error);
      if (isRetryableStage(attempt, clientError)) {
        attempts.set(attempt.key, attempt);
        throw new AttachmentRetryableError(clientError);
      }
      attempts.delete(attempt.key);
      throw clientError;
    }
  }

  async function executeAttempt(
    attempt: AttachmentAddAttempt,
  ): Promise<LoomTableRecord | null | undefined> {
    if (attempt.stage === 'initialize') {
      const initialized = await client.initializeAttachment(
        attempt.request,
        attempt.idempotencyKey,
      );
      if (
        initialized.source !== 'managed' ||
        initialized.status !== 'pending' ||
        initialized.id.trim() === '' ||
        initialized.filename.trim() === ''
      ) {
        throw attachmentError('ATTACHMENT_INIT_RESPONSE_INVALID');
      }
      attempt.attachment = initialized;
      attempt.stage = 'upload';
    }

    if (attempt.stage === 'upload') {
      const initialized = attempt.attachment;
      if (initialized === undefined) throw attachmentError('ATTACHMENT_STATUS_INVALID');
      const uploaded = await client.uploadAttachmentContent(
        initialized.id,
        attempt.bytes,
        attempt.contentType,
      );
      if (
        uploaded.source !== 'managed' ||
        uploaded.status !== 'ready' ||
        uploaded.id.trim() === '' ||
        uploaded.filename.trim() === ''
      ) {
        throw attachmentError('ATTACHMENT_UPLOAD_RESPONSE_INVALID');
      }
      attempt.attachment = uploaded;
      attempt.stage = 'reference';
    }

    if (attempt.stage !== 'reference' || attempt.attachment === undefined) {
      throw attachmentError('ATTACHMENT_STATUS_INVALID');
    }
    const references = [
      ...(readAttachmentReferences(attempt.sourceRecord.values[attempt.fieldId]) ?? []),
      attachmentReference(attempt.attachment),
    ];
    return updateReference(attempt, references);
  }

  async function updateReference(
    attempt: AttachmentAddAttempt,
    references: readonly AttachmentRef[],
  ): Promise<LoomTableRecord | undefined> {
    const mutation: AttachmentReferenceMutationContext = {
      clientMutationId: attempt.clientMutationId,
      expectedRevision: attempt.sourceRecord.revision,
    };
    try {
      return await options.updateRecord(
        attempt.recordId,
        attempt.fieldId,
        references,
        attempt.sourceRecord,
        mutation,
      );
    } catch (error) {
      const clientError = asClientError(error);
      if (!isTransient(clientError) || options.getRecord === undefined) {
        throw clientError;
      }

      let current: LoomTableRecord;
      try {
        current = await options.getRecord(attempt.recordId);
      } catch {
        throw clientError;
      }
      const currentReferences = readAttachmentReferences(current.values[attempt.fieldId]);
      if (currentReferences === null) {
        throw attachmentError('ATTACHMENT_REFERENCE_READBACK_INVALID');
      }
      if (currentReferences.some((reference) => reference.id === attempt.attachment?.id)) {
        return current;
      }
      if (current.revision !== attempt.sourceRecord.revision) {
        throw attachmentReferenceConflict(attempt, current, references);
      }
      return options.updateRecord(
        attempt.recordId,
        attempt.fieldId,
        references,
        attempt.sourceRecord,
        mutation,
      );
    }
  }

  return Object.assign(start, { retry });
}

export function createAttachmentDetachCallback(
  options: AttachmentDetachCallbackOptions,
): AttachmentDetachHandler {
  const isOffline = options.isOffline ?? defaultIsOffline;
  const idFactory = options.idFactory ?? createMutationId;

  return async (recordId, fieldId, attachmentId, sourceRecord) => {
    if (isOffline()) throw attachmentError('ATTACHMENT_OFFLINE');
    const current = readAttachmentReferences(sourceRecord.values[fieldId]);
    if (current === null) throw attachmentError('ATTACHMENT_REFERENCES_INVALID');
    const references = current.filter((reference) => reference.id !== attachmentId);
    if (references.length === current.length) {
      throw attachmentError('ATTACHMENT_REFERENCE_NOT_FOUND');
    }
    return options.updateRecord(recordId, fieldId, references, sourceRecord, {
      clientMutationId: idFactory(),
      expectedRevision: sourceRecord.revision,
    });
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

function attachmentReferenceConflict(
  attempt: AttachmentAddAttempt,
  current: LoomTableRecord,
  references: readonly AttachmentRef[],
): LoomTableClientError {
  return new LoomTableClientError(
    'conflict',
    {
      code: 'CONFLICT',
      message: 'The Record changed while adding this attachment.',
    },
    undefined,
    {
      clientMutationId: attempt.clientMutationId,
      failedCommandIndex: 0,
      conflicts: [
        {
          recordId: attempt.recordId,
          expectedRevision: attempt.sourceRecord.revision,
          currentRevision: current.revision,
          currentValues: current.values,
          submittedSet: { [attempt.fieldId]: references },
        },
      ],
    },
  );
}

function isRetryableStage(attempt: AttachmentAddAttempt, error: LoomTableClientError): boolean {
  if (attempt.stage === 'initialize' || attempt.stage === 'reference') {
    return isTransient(error);
  }
  return isTransient(error) || error.details.code === 'ATTACHMENT_UPLOAD_RESPONSE_INVALID';
}

function isTransient(error: LoomTableClientError): boolean {
  return error.kind === 'network' || error.kind === 'timeout';
}

function asClientError(error: unknown): LoomTableClientError {
  return error instanceof LoomTableClientError
    ? error
    : new LoomTableClientError('server', {
        message: 'The attachment operation failed.',
      });
}

function attachmentError(code: string): LoomTableClientError {
  return new LoomTableClientError('validation', { code, message: code });
}

function attemptKey(recordId: string, fieldId: string): string {
  return recordId + '\u0000' + fieldId;
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

