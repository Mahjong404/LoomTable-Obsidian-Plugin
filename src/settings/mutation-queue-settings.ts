import type {
  ConflictDetails,
  JsonValue,
  LoomTableClientErrorKind,
  MutationValue,
  UpdateRecordCommand,
} from '../client/loomtable-client';

export const MUTATION_QUEUE_SCHEMA_VERSION = 1 as const;
export const MAX_MUTATION_QUEUE_ENTRIES = 256 as const;
export const MAX_MUTATION_QUEUE_BYTES = 1024 * 1024 as const;

const MUTATION_ID_PATTERN = /^mut_[0-9A-HJKMNP-TV-Z]{26}$/;
const MAX_IDENTIFIER_LENGTH = 256;
const MAX_ERROR_CODE_LENGTH = 128;
const MAX_ERROR_MESSAGE_LENGTH = 512;
const MAX_REQUEST_ID_LENGTH = 256;
const MAX_ATTEMPTS = 1_000_000;
const ERROR_KINDS: readonly LoomTableClientErrorKind[] = [
  'authentication',
  'capability',
  'conflict',
  'cursor-expired',
  'forbidden',
  'invalid-response',
  'network',
  'not-found',
  'server',
  'timeout',
  'validation',
];

export type MutationQueueEntryState = 'queued' | 'sending' | 'error' | 'conflict';

export interface PersistedMutationRequest {
  readonly clientMutationId: string;
  readonly commands: readonly [UpdateRecordCommand];
}

export interface PersistedMutationQueueError {
  readonly kind: LoomTableClientErrorKind;
  readonly message: string;
  readonly code?: string;
  readonly httpStatus?: number;
  readonly requestId?: string;
}

export interface PersistedMutationQueueEntry {
  readonly tableId: string;
  readonly recordId: string;
  readonly clientMutationId: string;
  readonly request: PersistedMutationRequest;
  readonly expectedRevision: number;
  readonly state: MutationQueueEntryState;
  readonly attemptCount: number;
  readonly nextAttemptAt?: string;
  readonly lastError?: PersistedMutationQueueError;
  readonly conflict?: ConflictDetails;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface MutationQueueSettingsV1 {
  readonly schemaVersion: typeof MUTATION_QUEUE_SCHEMA_VERSION;
  readonly entries: readonly PersistedMutationQueueEntry[];
}

export const DEFAULT_MUTATION_QUEUE_SETTINGS: MutationQueueSettingsV1 = {
  schemaVersion: MUTATION_QUEUE_SCHEMA_VERSION,
  entries: [],
};

export interface MutationQueueStorePersistence {
  load(): Promise<unknown>;
  save(value: MutationQueueSettingsV1): Promise<void>;
}

export class MutationQueueSettingsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MutationQueueSettingsError';
  }
}

export class MutationQueueStore {
  readonly #persistence: MutationQueueStorePersistence | undefined;
  #state: MutationQueueSettingsV1;

  constructor(value: unknown = undefined, persistence?: MutationQueueStorePersistence) {
    this.#state = normalizeMutationQueueSettings(value);
    this.#persistence = persistence;
  }

  static async hydrate(persistence: MutationQueueStorePersistence): Promise<MutationQueueStore> {
    return new MutationQueueStore(await persistence.load(), persistence);
  }

  getSnapshot(): MutationQueueSettingsV1 {
    return normalizeMutationQueueSettings(this.#state);
  }

  async replace(value: unknown): Promise<void> {
    const next = normalizeMutationQueueSettings(value);
    if (this.#persistence !== undefined) {
      await this.#persistence.save(next);
    }
    this.#state = next;
  }

  async persist(): Promise<void> {
    if (this.#persistence === undefined) {
      throw new MutationQueueSettingsError(
        'A persistence adapter is required to save the mutation queue.',
      );
    }
    await this.#persistence.save(this.getSnapshot());
  }
}

export function normalizeMutationQueueSettings(value: unknown): MutationQueueSettingsV1 {
  if (value === undefined || value === null) {
    return cloneDefaultSettings();
  }

  const raw = expectRecord(value, 'mutationQueue');
  assertOnlyKeys(raw, ['schemaVersion', 'entries'], 'mutationQueue');
  if (raw.schemaVersion !== MUTATION_QUEUE_SCHEMA_VERSION) {
    invalid('mutationQueue.schemaVersion', 'unsupported schema version');
  }
  if (!Array.isArray(raw.entries)) {
    invalid('mutationQueue.entries', 'must be an array');
  }
  if (raw.entries.length > MAX_MUTATION_QUEUE_ENTRIES) {
    invalid('mutationQueue.entries', 'entry count exceeds the supported limit');
  }

  const ids = new Set<string>();
  const entries = raw.entries.map((candidate, index) => {
    const entry = parseEntry(candidate, 'mutationQueue.entries[' + index + ']');
    if (ids.has(entry.clientMutationId)) {
      invalid(
        'mutationQueue.entries[' + index + '].clientMutationId',
        'must be unique within the queue',
      );
    }
    ids.add(entry.clientMutationId);
    return entry;
  });
  const normalized: MutationQueueSettingsV1 = {
    schemaVersion: MUTATION_QUEUE_SCHEMA_VERSION,
    entries,
  };
  assertQueueSize(normalized);
  return normalized;
}

function parseEntry(value: unknown, path: string): PersistedMutationQueueEntry {
  const raw = expectRecord(value, path);
  assertOnlyKeys(
    raw,
    [
      'tableId',
      'recordId',
      'clientMutationId',
      'request',
      'expectedRevision',
      'state',
      'attemptCount',
      'nextAttemptAt',
      'lastError',
      'conflict',
      'createdAt',
      'updatedAt',
    ],
    path,
  );

  const tableId = expectIdentifier(raw.tableId, path + '.tableId');
  const recordId = expectIdentifier(raw.recordId, path + '.recordId');
  const clientMutationId = expectMutationId(raw.clientMutationId, path + '.clientMutationId');
  const request = parseRequest(raw.request, path + '.request');
  if (request.clientMutationId !== clientMutationId) {
    invalid(path + '.request.clientMutationId', 'must match the entry clientMutationId');
  }
  const command = request.commands[0];
  if (command.recordId !== recordId) {
    invalid(path + '.request.commands[0].recordId', 'must match the entry recordId');
  }

  const expectedRevision = expectInteger(
    raw.expectedRevision,
    path + '.expectedRevision',
    1,
    MAX_ATTEMPTS,
  );
  if (command.expectedRevision !== expectedRevision) {
    invalid(path + '.expectedRevision', 'must match the request command revision');
  }

  const rawState = parseState(raw.state, path + '.state');
  const attemptCount = expectInteger(raw.attemptCount, path + '.attemptCount', 0, MAX_ATTEMPTS);
  const createdAt = expectTimestamp(raw.createdAt, path + '.createdAt');
  const updatedAt = expectTimestamp(raw.updatedAt, path + '.updatedAt');
  const nextAttemptAt =
    raw.nextAttemptAt === undefined
      ? undefined
      : expectTimestamp(raw.nextAttemptAt, path + '.nextAttemptAt');
  const lastError =
    raw.lastError === undefined ? undefined : parseError(raw.lastError, path + '.lastError');
  const conflict =
    raw.conflict === undefined
      ? undefined
      : parseConflict(
          raw.conflict,
          path + '.conflict',
          recordId,
          expectedRevision,
          clientMutationId,
        );

  if (rawState === 'error' && lastError === undefined) {
    invalid(path + '.lastError', 'is required for an error entry');
  }
  if (rawState === 'conflict' && conflict === undefined) {
    invalid(path + '.conflict', 'is required for a conflict entry');
  }
  if (rawState !== 'conflict' && conflict !== undefined) {
    invalid(path + '.conflict', 'is only valid for a conflict entry');
  }

  return {
    tableId,
    recordId,
    clientMutationId,
    request,
    expectedRevision,
    state: rawState,
    attemptCount,
    ...(nextAttemptAt === undefined ? {} : { nextAttemptAt }),
    ...(lastError === undefined ? {} : { lastError }),
    ...(conflict === undefined ? {} : { conflict }),
    createdAt,
    updatedAt,
  };
}

function parseRequest(value: unknown, path: string): PersistedMutationRequest {
  const raw = expectRecord(value, path);
  assertOnlyKeys(raw, ['clientMutationId', 'commands'], path);
  const clientMutationId = expectMutationId(raw.clientMutationId, path + '.clientMutationId');
  if (!Array.isArray(raw.commands) || raw.commands.length !== 1) {
    invalid(path + '.commands', 'must contain exactly one updateRecord command');
  }
  const command = parseUpdateCommand(raw.commands[0], path + '.commands[0]');
  return { clientMutationId, commands: [command] };
}

function parseUpdateCommand(value: unknown, path: string): UpdateRecordCommand {
  const raw = expectRecord(value, path);
  assertOnlyKeys(raw, ['kind', 'recordId', 'expectedRevision', 'set', 'unsetFieldIds'], path);
  if (raw.kind !== 'updateRecord') {
    invalid(path + '.kind', 'only updateRecord is supported by this queue slice');
  }
  const recordId = expectIdentifier(raw.recordId, path + '.recordId');
  const expectedRevision = expectInteger(
    raw.expectedRevision,
    path + '.expectedRevision',
    1,
    MAX_ATTEMPTS,
  );
  const set = raw.set === undefined ? undefined : parseValueMap(raw.set, path + '.set');
  const unsetFieldIds =
    raw.unsetFieldIds === undefined
      ? undefined
      : parseUnsetFieldIds(raw.unsetFieldIds, path + '.unsetFieldIds');

  if (set === undefined && unsetFieldIds === undefined) {
    invalid(path, 'must contain set or unsetFieldIds');
  }
  if (set !== undefined && unsetFieldIds !== undefined) {
    const overlap = unsetFieldIds.find((fieldId) =>
      Object.prototype.hasOwnProperty.call(set, fieldId),
    );
    if (overlap !== undefined) {
      invalid(path, 'set and unsetFieldIds cannot target the same field: ' + overlap);
    }
  }

  return {
    kind: 'updateRecord',
    recordId,
    expectedRevision,
    ...(set === undefined ? {} : { set }),
    ...(unsetFieldIds === undefined ? {} : { unsetFieldIds }),
  };
}

function parseConflict(
  value: unknown,
  path: string,
  recordId: string,
  expectedRevision: number,
  clientMutationId: string,
): ConflictDetails {
  const raw = expectRecord(value, path);
  assertOnlyKeys(raw, ['clientMutationId', 'failedCommandIndex', 'conflicts'], path);
  if (raw.clientMutationId !== clientMutationId) {
    invalid(path + '.clientMutationId', 'must match the entry clientMutationId');
  }
  const failedCommandIndex = expectInteger(
    raw.failedCommandIndex,
    path + '.failedCommandIndex',
    0,
    0,
  );
  if (!Array.isArray(raw.conflicts) || raw.conflicts.length === 0) {
    invalid(path + '.conflicts', 'must contain at least one conflict');
  }
  const conflicts = raw.conflicts.map((candidate, index) =>
    parseConflictBody(
      candidate,
      path + '.conflicts[' + index + ']',
      recordId,
      expectedRevision,
    ),
  );
  return { clientMutationId, failedCommandIndex, conflicts };
}

function parseConflictBody(
  value: unknown,
  path: string,
  recordId: string,
  expectedRevision: number,
): ConflictDetails['conflicts'][number] {
  const raw = expectRecord(value, path);
  assertOnlyKeys(
    raw,
    [
      'recordId',
      'expectedRevision',
      'currentRevision',
      'currentValues',
      'submittedSet',
      'submittedUnsetFieldIds',
    ],
    path,
  );
  if (raw.recordId !== recordId) {
    invalid(path + '.recordId', 'must match the entry recordId');
  }
  if (raw.expectedRevision !== expectedRevision) {
    invalid(path + '.expectedRevision', 'must match the entry expectedRevision');
  }
  const currentRevision = expectInteger(
    raw.currentRevision,
    path + '.currentRevision',
    1,
    MAX_ATTEMPTS,
  );
  const currentValues = parseValueMap(raw.currentValues, path + '.currentValues');
  const submittedSet =
    raw.submittedSet === undefined
      ? undefined
      : parseValueMap(raw.submittedSet, path + '.submittedSet');
  const submittedUnsetFieldIds =
    raw.submittedUnsetFieldIds === undefined
      ? undefined
      : parseUnsetFieldIds(raw.submittedUnsetFieldIds, path + '.submittedUnsetFieldIds');

  if (submittedSet !== undefined && submittedUnsetFieldIds !== undefined) {
    const overlap = submittedUnsetFieldIds.find((fieldId) =>
      Object.prototype.hasOwnProperty.call(submittedSet, fieldId),
    );
    if (overlap !== undefined) {
      invalid(path, 'submitted set and unset cannot target the same field: ' + overlap);
    }
  }

  return {
    recordId,
    expectedRevision,
    currentRevision,
    currentValues,
    ...(submittedSet === undefined ? {} : { submittedSet }),
    ...(submittedUnsetFieldIds === undefined ? {} : { submittedUnsetFieldIds }),
  };
}

function parseError(value: unknown, path: string): PersistedMutationQueueError {
  const raw = expectRecord(value, path);
  assertOnlyKeys(raw, ['kind', 'message', 'code', 'httpStatus', 'requestId'], path);
  if (!isErrorKind(raw.kind)) invalid(path + '.kind', 'unknown client error kind');
  const message = expectBoundedString(raw.message, path + '.message', MAX_ERROR_MESSAGE_LENGTH);
  const code =
    raw.code === undefined
      ? undefined
      : expectBoundedString(raw.code, path + '.code', MAX_ERROR_CODE_LENGTH);
  const httpStatus =
    raw.httpStatus === undefined
      ? undefined
      : expectInteger(raw.httpStatus, path + '.httpStatus', 400, 599);
  const requestId =
    raw.requestId === undefined
      ? undefined
      : expectBoundedString(raw.requestId, path + '.requestId', MAX_REQUEST_ID_LENGTH);
  return {
    kind: raw.kind,
    message,
    ...(code === undefined ? {} : { code }),
    ...(httpStatus === undefined ? {} : { httpStatus }),
    ...(requestId === undefined ? {} : { requestId }),
  };
}

function parseValueMap(value: unknown, path: string): Readonly<Record<string, MutationValue>> {
  const raw = expectRecord(value, path);
  const entries = Object.entries(raw);
  if (entries.length === 0) invalid(path, 'must not be empty');
  const parsed = entries.map(([fieldId, fieldValue]) => {
    const normalizedFieldId = expectIdentifier(fieldId, path + '.' + fieldId);
    return [normalizedFieldId, parseJsonValue(fieldValue, path + '.' + normalizedFieldId)] as const;
  });
  return Object.fromEntries(parsed) as Readonly<Record<string, MutationValue>>;
}

function parseUnsetFieldIds(value: unknown, path: string): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) {
    invalid(path, 'must be a non-empty array');
  }
  const ids = value.map((fieldId, index) => expectIdentifier(fieldId, path + '[' + index + ']'));
  if (new Set(ids).size !== ids.length) invalid(path, 'must not contain duplicate field IDs');
  return ids;
}

function parseJsonValue(value: unknown, path: string): JsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) invalid(path, 'must be a finite JSON number');
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => parseJsonValue(item, path + '[' + index + ']'));
  }
  if (isRecord(value)) {
    const parsed = Object.entries(value).map(
      ([key, item]) => [key, parseJsonValue(item, path + '.' + key)] as const,
    );
    return Object.fromEntries(parsed) as { readonly [key: string]: JsonValue };
  }
  invalid(path, 'must be a JSON value');
}

function parseState(value: unknown, path: string): MutationQueueEntryState {
  if (value === 'sending') return 'queued';
  if (value === 'queued' || value === 'error' || value === 'conflict') return value;
  invalid(path, 'must be queued, sending, error, or conflict');
}

function expectMutationId(value: unknown, path: string): string {
  const mutationId = expectBoundedString(value, path, 30);
  if (!MUTATION_ID_PATTERN.test(mutationId)) {
    invalid(path, 'must match the Server mutation ID format');
  }
  return mutationId;
}

function expectIdentifier(value: unknown, path: string): string {
  const identifier = expectBoundedString(value, path, MAX_IDENTIFIER_LENGTH);
  if (identifier.trim() !== identifier) invalid(path, 'must not have surrounding whitespace');
  return identifier;
}

function expectTimestamp(value: unknown, path: string): string {
  const timestamp = expectBoundedString(value, path, 64);
  if (!Number.isFinite(Date.parse(timestamp))) invalid(path, 'must be an ISO timestamp');
  return timestamp;
}

function expectBoundedString(value: unknown, path: string, maxLength: number): string {
  if (typeof value !== 'string' || value.length > maxLength) {
    invalid(path, 'must be a string of at most ' + maxLength + ' characters');
  }
  return value;
}

function expectInteger(value: unknown, path: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    invalid(path, 'must be an integer between ' + min + ' and ' + max);
  }
  return value;
}

function expectRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) invalid(path, 'must be an object');
  return value;
}

function assertOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) invalid(path + '.' + key, 'unknown property');
  }
}

function assertQueueSize(value: MutationQueueSettingsV1): void {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    invalid('mutationQueue', 'could not be serialized');
  }
  const byteLength = new TextEncoder().encode(serialized).byteLength;
  if (byteLength > MAX_MUTATION_QUEUE_BYTES) {
    invalid('mutationQueue', 'serialized size exceeds the supported limit');
  }
}

function cloneDefaultSettings(): MutationQueueSettingsV1 {
  return { schemaVersion: MUTATION_QUEUE_SCHEMA_VERSION, entries: [] };
}

function isErrorKind(value: unknown): value is LoomTableClientErrorKind {
  return typeof value === 'string' && ERROR_KINDS.includes(value as LoomTableClientErrorKind);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalid(path: string, reason: string): never {
  throw new MutationQueueSettingsError('Invalid ' + path + ': ' + reason);
}
