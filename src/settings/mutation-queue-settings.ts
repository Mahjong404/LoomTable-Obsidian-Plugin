import type {
  ConflictBody,
  ConflictDetails,
  JsonValue,
  LoomTableClientErrorKind,
  MutationValue,
  UpdateRecordCommand,
} from '../client/loomtable-client';

export const MUTATION_QUEUE_SCHEMA_VERSION = 1 as const;
export const MAX_MUTATION_QUEUE_ENTRIES = 256 as const;
export const MAX_MUTATION_QUEUE_BYTES = 1024 * 1024;

const MUTATION_ID_PATTERN = /^mut_[0-9A-HJKMNP-TV-Z]{26}$/;
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

export type MutationQueueEntryState =
  | 'queued'
  | 'sending'
  | 'auth-paused'
  | 'terminal'
  | 'error'
  | 'conflict';

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
    return normalizeMutationQueueSettings(this.#state, { recoverSending: false });
  }

  async replace(value: unknown): Promise<void> {
    const next = normalizeMutationQueueSettings(value, { recoverSending: false });
    if (this.#persistence !== undefined) await this.#persistence.save(next);
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

export function normalizeMutationQueueSettings(
  value: unknown,
  options: { readonly recoverSending?: boolean } = {},
): MutationQueueSettingsV1 {
  if (value === undefined || value === null) return { schemaVersion: 1, entries: [] };
  const recoverSending = options.recoverSending ?? true;

  const root = objectValue(value, 'mutationQueue');
  assertKeys(root, ['schemaVersion', 'entries'], 'mutationQueue');
  if (root.schemaVersion !== MUTATION_QUEUE_SCHEMA_VERSION) {
    fail('mutationQueue.schemaVersion', 'unsupported schema version');
  }
  if (!Array.isArray(root.entries)) fail('mutationQueue.entries', 'must be an array');
  if (root.entries.length > MAX_MUTATION_QUEUE_ENTRIES) {
    fail('mutationQueue.entries', 'entry count exceeds the supported limit');
  }

  const ids = new Set<string>();
  const entries = root.entries.map((candidate, index) => {
    const entry = parseEntry(
      candidate,
      'mutationQueue.entries[' + index + ']',
      recoverSending,
    );
    if (ids.has(entry.clientMutationId)) {
      fail(
        'mutationQueue.entries[' + index + '].clientMutationId',
        'must be unique within the queue',
      );
    }
    ids.add(entry.clientMutationId);
    return entry;
  });
  const normalized = { schemaVersion: MUTATION_QUEUE_SCHEMA_VERSION, entries };
  assertQueueSize(normalized);
  return normalized;
}

function parseEntry(
  value: unknown,
  path: string,
  recoverSending: boolean,
): PersistedMutationQueueEntry {
  const raw = objectValue(value, path);
  assertKeys(
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

  const tableId = identifier(raw.tableId, path + '.tableId');
  const recordId = identifier(raw.recordId, path + '.recordId');
  const clientMutationId = mutationId(raw.clientMutationId, path + '.clientMutationId');
  const request = parseRequest(raw.request, path + '.request');
  if (request.clientMutationId !== clientMutationId) {
    fail(path + '.request.clientMutationId', 'must match the entry clientMutationId');
  }
  const command = request.commands[0];
  if (command.recordId !== recordId) {
    fail(path + '.request.commands[0].recordId', 'must match the entry recordId');
  }

  const expectedRevision = integer(raw.expectedRevision, path + '.expectedRevision', 1);
  if (command.expectedRevision !== expectedRevision) {
    fail(path + '.expectedRevision', 'must match the request command revision');
  }

  const state = parseState(raw.state, path + '.state', recoverSending);
  const attemptCount = integer(raw.attemptCount, path + '.attemptCount', 0);
  const nextAttemptAt =
    raw.nextAttemptAt === undefined
      ? undefined
      : timestamp(raw.nextAttemptAt, path + '.nextAttemptAt');
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

  if (
    (state === 'error' || state === 'auth-paused' || state === 'terminal') &&
    lastError === undefined
  ) {
    fail(path + '.lastError', 'is required for an error entry');
  }
  if (state === 'conflict' && conflict === undefined) {
    fail(path + '.conflict', 'is required for a conflict entry');
  }
  if (state !== 'conflict' && conflict !== undefined) {
    fail(path + '.conflict', 'is only valid for a conflict entry');
  }

  return {
    tableId,
    recordId,
    clientMutationId,
    request,
    expectedRevision,
    state,
    attemptCount,
    ...(nextAttemptAt === undefined ? {} : { nextAttemptAt }),
    ...(lastError === undefined ? {} : { lastError }),
    ...(conflict === undefined ? {} : { conflict }),
    createdAt: timestamp(raw.createdAt, path + '.createdAt'),
    updatedAt: timestamp(raw.updatedAt, path + '.updatedAt'),
  };
}

function parseRequest(value: unknown, path: string): PersistedMutationRequest {
  const raw = objectValue(value, path);
  assertKeys(raw, ['clientMutationId', 'commands'], path);
  const clientMutationId = mutationId(raw.clientMutationId, path + '.clientMutationId');
  if (!Array.isArray(raw.commands) || raw.commands.length !== 1) {
    fail(path + '.commands', 'must contain exactly one updateRecord command');
  }
  const command = parseCommand(raw.commands[0], path + '.commands[0]');
  return { clientMutationId, commands: [command] };
}

function parseCommand(value: unknown, path: string): UpdateRecordCommand {
  const raw = objectValue(value, path);
  assertKeys(raw, ['kind', 'recordId', 'expectedRevision', 'set', 'unsetFieldIds'], path);
  if (raw.kind !== 'updateRecord') fail(path + '.kind', 'only updateRecord is supported');
  const recordId = identifier(raw.recordId, path + '.recordId');
  const expectedRevision = integer(raw.expectedRevision, path + '.expectedRevision', 1);
  const set = raw.set === undefined ? undefined : values(raw.set, path + '.set', true);
  const unsetFieldIds =
    raw.unsetFieldIds === undefined
      ? undefined
      : fieldIds(raw.unsetFieldIds, path + '.unsetFieldIds');
  if (set === undefined && unsetFieldIds === undefined) {
    fail(path, 'must contain set or unsetFieldIds');
  }
  if (set !== undefined && unsetFieldIds !== undefined) {
    const overlap = unsetFieldIds.find((fieldId) => Object.hasOwn(set, fieldId));
    if (overlap !== undefined) fail(path, 'set and unsetFieldIds overlap: ' + overlap);
  }
  return {
    kind: 'updateRecord',
    recordId,
    expectedRevision,
    ...(set === undefined ? {} : { set }),
    ...(unsetFieldIds === undefined ? {} : { unsetFieldIds }),
  };
}

function parseState(
  value: unknown,
  path: string,
  recoverSending: boolean,
): MutationQueueEntryState {
  if (value === 'sending' && recoverSending) return 'queued';
  if (
    value === 'queued' ||
    value === 'sending' ||
    value === 'auth-paused' ||
    value === 'terminal' ||
    value === 'error' ||
    value === 'conflict'
  ) {
    return value;
  }
  fail(path, 'must be queued, sending, auth-paused, terminal, error, or conflict');
}

function parseError(value: unknown, path: string): PersistedMutationQueueError {
  const raw = objectValue(value, path);
  assertKeys(raw, ['kind', 'message', 'code', 'httpStatus', 'requestId'], path);
  if (!isErrorKind(raw.kind)) fail(path + '.kind', 'unknown client error kind');
  const message = boundedString(raw.message, path + '.message', 512);
  const code = raw.code === undefined ? undefined : boundedString(raw.code, path + '.code', 128);
  const httpStatus =
    raw.httpStatus === undefined
      ? undefined
      : integer(raw.httpStatus, path + '.httpStatus', 100, 599);
  const requestId =
    raw.requestId === undefined
      ? undefined
      : boundedString(raw.requestId, path + '.requestId', 256);
  return {
    kind: raw.kind,
    message,
    ...(code === undefined ? {} : { code }),
    ...(httpStatus === undefined ? {} : { httpStatus }),
    ...(requestId === undefined ? {} : { requestId }),
  };
}

function parseConflict(
  value: unknown,
  path: string,
  recordId: string,
  expectedRevision: number,
  clientMutationId: string,
): ConflictDetails {
  const raw = objectValue(value, path);
  assertKeys(raw, ['clientMutationId', 'failedCommandIndex', 'conflicts'], path);
  if (raw.clientMutationId !== clientMutationId) {
    fail(path + '.clientMutationId', 'must match the entry clientMutationId');
  }
  const failedCommandIndex = integer(raw.failedCommandIndex, path + '.failedCommandIndex', 0, 0);
  if (!Array.isArray(raw.conflicts) || raw.conflicts.length === 0) {
    fail(path + '.conflicts', 'must contain at least one conflict');
  }
  return {
    clientMutationId,
    failedCommandIndex,
    conflicts: raw.conflicts.map((candidate, index) =>
      parseConflictBody(candidate, path + '.conflicts[' + index + ']', recordId, expectedRevision),
    ),
  };
}

function parseConflictBody(
  value: unknown,
  path: string,
  recordId: string,
  expectedRevision: number,
): ConflictBody {
  const raw = objectValue(value, path);
  assertKeys(
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
  if (raw.recordId !== recordId) fail(path + '.recordId', 'must match the entry recordId');
  if (raw.expectedRevision !== expectedRevision) {
    fail(path + '.expectedRevision', 'must match the entry expectedRevision');
  }
  const currentRevision = integer(raw.currentRevision, path + '.currentRevision', 1);
  const currentValues = values(raw.currentValues, path + '.currentValues', false);
  const submittedSet =
    raw.submittedSet === undefined
      ? undefined
      : values(raw.submittedSet, path + '.submittedSet', true);
  const submittedUnsetFieldIds =
    raw.submittedUnsetFieldIds === undefined
      ? undefined
      : fieldIds(raw.submittedUnsetFieldIds, path + '.submittedUnsetFieldIds');
  if (submittedSet !== undefined && submittedUnsetFieldIds !== undefined) {
    const overlap = submittedUnsetFieldIds.find((fieldId) => Object.hasOwn(submittedSet, fieldId));
    if (overlap !== undefined) fail(path, 'submitted set and unset overlap: ' + overlap);
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

function values(
  value: unknown,
  path: string,
  requireNonEmpty: boolean,
): Readonly<Record<string, MutationValue>> {
  const raw = objectValue(value, path);
  const entries = Object.entries(raw);
  if (requireNonEmpty && entries.length === 0) fail(path, 'must not be empty');
  return Object.fromEntries(
    entries.map(([fieldId, fieldValue]) => [
      identifier(fieldId, path + '.' + fieldId),
      jsonValue(fieldValue, path + '.' + fieldId),
    ]),
  );
}

function fieldIds(value: unknown, path: string): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) fail(path, 'must be a non-empty array');
  const ids = value.map((fieldId, index) => identifier(fieldId, path + '[' + index + ']'));
  if (new Set(ids).size !== ids.length) fail(path, 'must not contain duplicate field IDs');
  return ids;
}

function jsonValue(value: unknown, path: string, depth = 0): JsonValue {
  if (depth > 32) fail(path, 'is nested too deeply');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    return value.map((item, index) => jsonValue(item, path + '[' + index + ']', depth + 1));
  }
  if (isObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        jsonValue(item, path + '.' + key, depth + 1),
      ]),
    );
  }
  fail(path, 'must be a JSON value');
}

function mutationId(value: unknown, path: string): string {
  const id = boundedString(value, path, 30);
  if (!MUTATION_ID_PATTERN.test(id)) fail(path, 'must match the Server mutation ID format');
  return id;
}

function identifier(value: unknown, path: string): string {
  const id = boundedString(value, path, 256);
  if (id.length === 0 || id.trim() !== id) fail(path, 'must be a non-empty identifier');
  return id;
}

function timestamp(value: unknown, path: string): string {
  const result = boundedString(value, path, 64);
  if (!Number.isFinite(Date.parse(result))) fail(path, 'must be an ISO timestamp');
  return result;
}

function boundedString(value: unknown, path: string, maxLength: number): string {
  if (typeof value !== 'string' || value.length > maxLength) {
    fail(path, 'must be a string of at most ' + maxLength + ' characters');
  }
  return value;
}

function integer(value: unknown, path: string, min: number, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    fail(path, 'must be an integer between ' + min + ' and ' + max);
  }
  return value;
}

function objectValue(value: unknown, path: string): Record<string, unknown> {
  if (!isObject(value)) fail(path, 'must be an object');
  return value;
}

function assertKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail(path + '.' + key, 'unknown property');
  }
}

function assertQueueSize(value: MutationQueueSettingsV1): void {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) fail('mutationQueue', 'could not be serialized');
  if (new TextEncoder().encode(serialized).byteLength > MAX_MUTATION_QUEUE_BYTES) {
    fail('mutationQueue', 'serialized size exceeds the supported limit');
  }
}

function isErrorKind(value: unknown): value is LoomTableClientErrorKind {
  return typeof value === 'string' && ERROR_KINDS.includes(value as LoomTableClientErrorKind);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(path: string, message: string): never {
  throw new MutationQueueSettingsError('Invalid ' + path + ': ' + message);
}
