import {
  LoomTableClientError,
  type AggregateFn,
  type AggregateValue,
  type Base,
  type ConflictBody,
  type ConflictDetails,
  type CreateFieldRequest,
  type CreateViewRequest,
  type Field,
  type FieldConfigInput,
  type SelectOptionInput,
  type AttachmentRef,
  type Change,
  type ChangeKind,
  type ConversionPreview,
  type ConversionResult,
  type DistinctValuesPage,
  type ConvertFieldRequest,
  type FilterNode,
  type GridViewConfig,
  type LoomTableClient,
  type LoomTableClientErrorDetails,
  type LoomTableRecord,
  type MutationRequest,
  type MutationResult,
  type MutationValue,
  type NumberFormatConfig,
  type QueryRequest,
  type QueryResult,
  type SortSpec,
  type Table,
  type UpdateRecordCommand,
  type View,
  type Workspace,
} from '../client/loomtable-client';
import {
  describeFieldValueError,
  normalizeCellValue,
  normalizeLocationValue,
  type LocationEditIntent,
} from './field-value-editor';
import { MutationQueue, createMutationId, type MutationQueueSnapshot } from './mutation-queue';
import type {
  DurableMutationQueuePort,
  MutationQueueRecordSnapshot,
  MutationQueueRecordState,
  MutationQueueSchedulerEvent,
} from './mutation-queue-scheduler';
import type { PersistedMutationQueueError } from '../settings/mutation-queue-settings';
import { createTranslator, type Translator } from '../i18n';
import type { ViewSaveStatus } from './save-status';
import { UndoHistory, type UndoEntryMeta } from './undo-history';
import {
  findBrokenViewFieldIds,
  repairGridConfigForFieldType,
  repairViewConfig,
  type ViewConfigRepairInput,
} from './view-config-repair';
import {
  MAX_SEARCH_CODE_POINTS,
  MAX_SORT_FIELDS,
  isSortableField,
  validateFilterDraft,
} from './view-query-model';
import { validateDisplayPatch, type GridDisplayPatch } from './grid-display';
import {
  ViewWriteCoordinator,
  type PendingViewCreateIntent,
  type PendingViewCreateStore,
  type ViewCopyOutcome,
  type ViewCreateInput,
  type ViewCreateOutcome,
  type ViewUpdatePatch,
  type ViewWriteClient,
  type ViewWriteIssue,
  type ViewWriteOutcome,
} from './view-write-coordinator';

export const DEFAULT_GRID_PAGE_SIZE = 100;

export type GridStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'empty'
  | 'offline'
  | 'authentication'
  | 'forbidden'
  | 'network'
  | 'server-error';

export type GridPhase = 'idle' | 'navigation' | 'query';

export type GridEmptyReason = 'workspace' | 'base' | 'table' | 'view' | 'records' | 'no-match';

export type GridEditStatus = 'queued' | 'saving' | 'conflict' | 'error' | 'terminal';

export interface GridConflict extends ConflictBody {
  readonly clientMutationId: string;
  readonly failedCommandIndex: number;
  readonly message: string;
}

export interface GridEditDraft {
  readonly recordId: string;
  readonly fieldId: string;
  readonly rawValue: unknown;
}

export interface GridState {
  readonly status: GridStatus;
  readonly phase: GridPhase;
  readonly workspaces: readonly Workspace[];
  readonly bases: readonly Base[];
  readonly tables: readonly Table[];
  readonly views: readonly View[];
  readonly fields: readonly Field[];
  readonly selectedWorkspaceId: string | null;
  readonly selectedBaseId: string | null;
  readonly selectedTableId: string | null;
  readonly selectedViewId: string | null;
  readonly records: readonly LoomTableRecord[];
  readonly hasMore: boolean;
  readonly nextCursor: string | null;
  readonly changeCursor: string | null;
  readonly totalCount: number | null;
  readonly unfilteredTotal: number | null;
  readonly search: string;
  readonly emptyReason: GridEmptyReason | null;
  readonly error: LoomTableClientErrorDetails | null;
  readonly editStatuses: Readonly<Record<string, GridEditStatus>>;
  readonly conflicts: readonly GridConflict[];
  readonly editError: LoomTableClientErrorDetails | null;
  readonly editDrafts: readonly GridEditDraft[];
  readonly editErrorRecordId: string | null;
  readonly saveStatus: ViewSaveStatus;
  readonly pendingViewIntents: readonly PendingViewCreateIntent[];
  readonly deletedViews: readonly View[];
  readonly deletedViewsStatus: 'idle' | 'loading' | 'ready' | 'error';
  readonly deletedViewsError: LoomTableClientErrorDetails | null;
  readonly viewWritePending: readonly string[];
  readonly viewWriteIssues: Readonly<Record<string, ViewWriteIssue>>;
  readonly recordCreateOps: readonly RecordCreateOp[];
  readonly deletedRecords: readonly LoomTableRecord[];
  readonly deletedRecordsStatus: 'idle' | 'loading' | 'ready' | 'error';
  readonly deletedRecordsNextCursor: string | null;
  readonly deletedRecordsHasMore: boolean;
  readonly deletedRecordsError: LoomTableClientErrorDetails | null;
  readonly lastDeletedRecord: LoomTableRecord | null;
  readonly serverHistory: readonly Change[];
  readonly serverHistoryStatus: 'idle' | 'loading' | 'ready' | 'error';
  readonly serverHistoryNextCursor: string | null;
  readonly serverHistoryHasMore: boolean;
  readonly serverHistoryError: LoomTableClientErrorDetails | null;
  readonly historyEntries: readonly UndoEntryMeta[];
  readonly canUndo?: boolean;
  readonly canRedo?: boolean;
  readonly fieldAggregations: Readonly<Record<string, AggregateFn>>;
  readonly aggregateResults: Readonly<
    Record<string, Readonly<Record<string, AggregateValue>>>
  > | null;
  readonly aggregateStatus: 'idle' | 'loading' | 'ready' | 'error';
}

export type RecordDeleteGate = 'ok' | 'draft' | 'pending' | 'offline' | 'unavailable';

export type RecordRestoreOutcome =
  | { readonly status: 'restored'; readonly record: LoomTableRecord }
  | { readonly status: 'already-active'; readonly record: LoomTableRecord };

export interface RecordCreateOp {
  readonly operationId: string;
  readonly tableId: string;
  readonly state: MutationQueueRecordState;
  readonly lastError?: PersistedMutationQueueError;
  readonly createdRecord?: LoomTableRecord;
}

export type GridDataSource = Pick<
  LoomTableClient,
  'listWorkspaces' | 'listBases' | 'listTables' | 'listFields' | 'listViews' | 'query'
> &
  Partial<
    Pick<
      LoomTableClient,
      | 'getRecord'
      | 'mutate'
      | 'getView'
      | 'createView'
      | 'updateView'
      | 'deleteView'
      | 'restoreView'
      | 'createField'
      | 'updateField'
      | 'deleteField'
      | 'restoreField'
      | 'pullHistory'
      | 'previewFieldConversion'
      | 'convertField'
      | 'duplicateRecord'
      | 'moveRecord'
      | 'queryFieldValues'
      | 'aggregateRecords'
    >
  >;

export interface GridViewControllerOptions {
  readonly pageSize?: number;
  readonly isOffline?: () => boolean;
  readonly mutationQueue?: DurableMutationQueuePort;
  readonly mutationIdFactory?: () => string;
  readonly mutationNetworkAttempts?: number;
  readonly translate?: Translator;
  readonly onNonGridViewSelected?: (view: View, state: GridState) => void | Promise<void>;
  readonly viewIntents?: PendingViewCreateStore;
}

export interface GridEditOptions {
  readonly unset?: boolean;
  readonly attachmentReferences?: readonly AttachmentRef[];
  readonly clientMutationId?: string;
}

export type GridStateListener = (state: GridState) => void;

interface ControllerQueueSnapshot {
  readonly state: 'idle' | 'queued' | 'saving' | 'conflict' | 'error' | 'terminal';
  readonly pending: number;
  readonly error?: LoomTableClientError;
  readonly conflict?: ConflictDetails;
}

interface GridSelection {
  readonly workspaceId?: string;
  readonly baseId?: string;
  readonly tableId?: string;
  readonly viewId?: string;
}

type ViewWriteRun = (view: View, writes: ViewWriteCoordinator) => Promise<ViewWriteOutcome>;

interface ViewWriteRetry {
  readonly view: View;
  readonly run: ViewWriteRun;
}

interface ViewWriteFailure {
  readonly status: 'failed';
  readonly kind: LoomTableClientError['kind'];
  readonly error: LoomTableClientErrorDetails;
}

function viewWriteFailed(kind: LoomTableClientError['kind'], message: string): ViewWriteFailure {
  return { status: 'failed', kind, error: { message } };
}

export interface FieldSubmitInput {
  readonly name: string;
  readonly type: Field['type'];
  readonly options?: readonly SelectOptionInput[];
  readonly maxCount?: number;
  readonly description?: string;
}

export type FieldWriteOutcome =
  { readonly status: 'written'; readonly field: Field } | ViewWriteFailure;

function fieldWriteFailed(kind: LoomTableClientError['kind'], message: string): ViewWriteFailure {
  return { status: 'failed', kind, error: { message } };
}

function isFieldWriteClient(
  client: GridDataSource,
): client is GridDataSource &
  Required<Pick<LoomTableClient, 'createField' | 'updateField' | 'deleteField' | 'restoreField'>> {
  return (
    typeof client.createField === 'function' &&
    typeof client.updateField === 'function' &&
    typeof client.deleteField === 'function' &&
    typeof client.restoreField === 'function'
  );
}

function fieldConfigFromInput(input: FieldSubmitInput): FieldConfigInput | null {
  if (input.type === 'select' || input.type === 'multiSelect') {
    return {
      options: (input.options ?? [])
        .filter((option) => option.name.trim() !== '')
        .map((option) => ({
          ...(option.id === undefined ? {} : { id: option.id }),
          name: option.name.trim(),
          color: option.color,
        })),
    };
  }
  if (input.type === 'attachment') {
    const maxCount = input.maxCount ?? 10;
    if (!Number.isInteger(maxCount) || maxCount < 1 || maxCount > 100) return null;
    return { maxCount };
  }
  return {};
}

function fieldUpdateConfigFromInput(
  field: Field,
  input: {
    readonly options?: readonly SelectOptionInput[];
    readonly maxCount?: number;
    readonly format?: NumberFormatConfig | null;
  },
): FieldConfigInput | undefined | null {
  if (field.type === 'number') {
    if (input.format === undefined) return undefined;
    if (input.format === null) return {};
    const format = input.format;
    if (
      (format.decimals !== undefined &&
        (!Number.isInteger(format.decimals) || format.decimals < 0 || format.decimals > 10)) ||
      (format.currency !== undefined && !/^[A-Z]{3}$/.test(format.currency))
    ) {
      return null;
    }
    return { format: { ...format } };
  }
  if (field.type === 'select' || field.type === 'multiSelect') {
    if (input.options === undefined) return undefined;
    return {
      options: input.options
        .filter((option) => option.name.trim() !== '')
        .map((option) => ({
          ...(option.id === undefined ? {} : { id: option.id }),
          name: option.name.trim(),
          color: option.color,
        })),
    };
  }
  if (field.type === 'attachment') {
    if (input.maxCount === undefined) return undefined;
    if (!Number.isInteger(input.maxCount) || input.maxCount < 1 || input.maxCount > 100) {
      return null;
    }
    return { maxCount: input.maxCount };
  }
  return undefined;
}

function gridViewMentionsField(view: GridView, fieldId: string): boolean {
  const config = view.config;
  return (
    config.projection.includes(fieldId) ||
    config.columnOrder.includes(fieldId) ||
    config.frozenFieldIds.includes(fieldId) ||
    fieldId in config.columnWidths ||
    config.sort.some((sort) => sort.fieldId === fieldId) ||
    filterMentionsField(config.filter, fieldId)
  );
}

function filterMentionsField(filter: FilterNode | undefined, fieldId: string): boolean {
  if (filter === undefined) return false;
  if (filter.kind === 'rule') return filter.fieldId === fieldId;
  return filter.children.some((child) => filterMentionsField(child, fieldId));
}

const INITIAL_STATE: GridState = {
  status: 'idle',
  phase: 'idle',
  workspaces: [],
  bases: [],
  tables: [],
  views: [],
  fields: [],
  selectedWorkspaceId: null,
  selectedBaseId: null,
  selectedTableId: null,
  selectedViewId: null,
  records: [],
  hasMore: false,
  nextCursor: null,
  changeCursor: null,
  totalCount: null,
  unfilteredTotal: null,
  search: '',
  emptyReason: null,
  error: null,
  editStatuses: {},
  conflicts: [],
  editError: null,
  editDrafts: [],
  editErrorRecordId: null,
  saveStatus: 'saved',
  pendingViewIntents: [],
  deletedViews: [],
  deletedViewsStatus: 'idle',
  deletedViewsError: null,
  viewWritePending: [],
  viewWriteIssues: {},
  recordCreateOps: [],
  deletedRecords: [],
  deletedRecordsStatus: 'idle',
  deletedRecordsNextCursor: null,
  deletedRecordsHasMore: false,
  deletedRecordsError: null,
  lastDeletedRecord: null,
  serverHistory: [],
  serverHistoryStatus: 'idle',
  serverHistoryNextCursor: null,
  serverHistoryHasMore: false,
  serverHistoryError: null,
  historyEntries: [],
  fieldAggregations: {},
  aggregateResults: null,
  aggregateStatus: 'idle',
};

export class GridViewController {
  readonly #client: GridDataSource;
  readonly #pageSize: number;
  readonly #isOffline: () => boolean;
  readonly #translate: Translator;
  readonly #listeners = new Set<GridStateListener>();
  readonly #queue: MutationQueue | null;
  readonly #durableQueue: DurableMutationQueuePort | null;
  readonly #history = new UndoHistory();
  readonly #mutationIdFactory: () => string;
  readonly #viewWrites: ViewWriteCoordinator | null;
  readonly #onNonGridViewSelected: GridViewControllerOptions['onNonGridViewSelected'];
  #queueUnsubscribe: (() => void) | null = null;
  readonly #authoritativeRecords = new Map<string, LoomTableRecord>();
  readonly #optimisticRecords = new Map<string, LoomTableRecord>();
  readonly #conflicts = new Map<string, GridConflict>();
  readonly #dirtyRecords = new Set<string>();
  readonly #viewWriteBases = new Map<string, View>();
  readonly #viewWriteRetries = new Map<string, ViewWriteRetry>();
  readonly #viewWriteIssues = new Map<string, ViewWriteIssue>();
  readonly #viewWritePending = new Set<string>();
  #state: GridState = INITIAL_STATE;
  #selection: GridSelection = {};
  #requestToken = 0;
  #loadingMoreToken: number | null = null;
  #aggregateToken = 0;
  #searchTerm = '';
  #searchViewId: string | null = null;

  constructor(client: GridDataSource, options: GridViewControllerOptions = {}) {
    this.#client = client;
    this.#pageSize = normalizePageSize(options.pageSize ?? DEFAULT_GRID_PAGE_SIZE);
    this.#isOffline = options.isOffline ?? defaultOfflineCheck;
    this.#translate = options.translate ?? createTranslator('en');
    this.#onNonGridViewSelected = options.onNonGridViewSelected;
    this.#durableQueue = options.mutationQueue ?? null;
    this.#mutationIdFactory = options.mutationIdFactory ?? createMutationId;
    this.#viewWrites = isViewWriteClient(client)
      ? new ViewWriteCoordinator(client, {
          ...(options.viewIntents === undefined ? {} : { intents: options.viewIntents }),
          ...(options.mutationIdFactory === undefined
            ? {}
            : { mutationIdFactory: options.mutationIdFactory }),
        })
      : null;
    const mutate = client.mutate?.bind(client);
    this.#queue =
      this.#durableQueue !== null || mutate === undefined
        ? null
        : new MutationQueue(
            { mutate },
            {
              ...(options.mutationIdFactory === undefined
                ? {}
                : { idFactory: options.mutationIdFactory }),
              ...(options.mutationNetworkAttempts === undefined
                ? {}
                : { maxNetworkAttempts: options.mutationNetworkAttempts }),
              onApplied: (recordId, result) => this.#handleMutationApplied(recordId, result),
            },
          );
    if (this.#durableQueue !== null) {
      this.#queueUnsubscribe = this.#durableQueue.subscribe((event) =>
        this.#handleDurableQueueEvent(event),
      );
    } else if (this.#queue !== null) {
      this.#queueUnsubscribe = this.#queue.subscribe((recordId, snapshot) =>
        this.#handleLegacyQueueSnapshot(recordId, snapshot),
      );
    }
  }

  get state(): GridState {
    return this.#state;
  }

  getConflict(recordId: string): GridConflict | undefined {
    return this.#conflicts.get(recordId);
  }

  async getRecordForDetail(record: LoomTableRecord): Promise<LoomTableRecord> {
    const view = this.#state.views.find((candidate) => candidate.id === this.#state.selectedViewId);
    const fields = this.#state.fields;
    const hasAllFieldValues =
      fields.length > 0 &&
      fields.every((field) => Object.prototype.hasOwnProperty.call(record.values, field.id));
    const projectionIsComplete =
      view?.type === 'grid' &&
      (view.config.projection.length === 0 ||
        fields.every((field) => view.config.projection.includes(field.id)));
    if (
      this.#isOffline() ||
      hasAllFieldValues ||
      projectionIsComplete ||
      this.#client.getRecord === undefined
    ) {
      return record;
    }
    return this.#client.getRecord(record.id);
  }

  canNavigateRecord(recordId: string, direction: -1 | 1): boolean {
    const index = this.#state.records.findIndex((record) => record.id === recordId);
    if (index < 0) return false;
    if (direction < 0) return index > 0;
    return index < this.#state.records.length - 1 || this.#state.hasMore;
  }

  async navigateRecord(recordId: string, direction: -1 | 1): Promise<LoomTableRecord | null> {
    let index = this.#state.records.findIndex((record) => record.id === recordId);
    if (index < 0) return null;
    if (index + direction >= this.#state.records.length && this.#state.hasMore) {
      await this.loadNextPage();
      index = this.#state.records.findIndex((record) => record.id === recordId);
      if (index < 0) return null;
    }
    return this.#state.records[index + direction] ?? null;
  }

  subscribe(listener: GridStateListener): () => void {
    this.#listeners.add(listener);
    listener(this.#state);
    return () => this.#listeners.delete(listener);
  }

  dispose(): void {
    ++this.#requestToken;
    this.#queueUnsubscribe?.();
    this.#queueUnsubscribe = null;
    this.#listeners.clear();
  }

  async editCell(
    recordId: string,
    fieldId: string,
    rawValue: unknown,
    options: GridEditOptions = {},
    sourceRecord?: LoomTableRecord,
  ): Promise<LoomTableRecord> {
    const field = this.#state.fields.find((candidate) => candidate.id === fieldId);
    const stateRecord = this.#state.records.find((candidate) => candidate.id === recordId);
    const record =
      sourceRecord?.id === recordId &&
      (stateRecord === undefined || sourceRecord.revision >= stateRecord.revision)
        ? sourceRecord
        : stateRecord;
    const tableId = this.#state.selectedTableId;
    if (field === undefined || record === undefined || tableId === null) {
      throw this.#publishEditFailure('The selected Grid Cell is no longer available.');
    }
    const editDraft: GridEditDraft = { recordId, fieldId, rawValue };
    const offline = this.#isOffline();
    if (offline || this.#state.status !== 'ready') {
      throw this.#publishEditFailure(
        offline || this.#state.status === 'offline'
          ? 'Grid editing is unavailable while offline.'
          : 'Grid editing is unavailable until the Grid is ready.',
        undefined,
        editDraft,
      );
    }
    const normalized =
      options.attachmentReferences !== undefined && field.type === 'attachment'
        ? { ok: true as const, value: options.attachmentReferences as unknown as MutationValue }
        : options.unset
          ? { ok: true as const, value: null }
          : field.type === 'location'
            ? normalizeLocationValue(rawValue)
            : normalizeCellValue(field, rawValue);
    if (!normalized.ok) {
      throw this.#publishEditFailure(
        describeFieldValueError(normalized.code, this.#translate),
        normalized.code,
        editDraft,
      );
    }
    if (this.#queue === null && this.#durableQueue === null) {
      throw this.#publishEditFailure(
        'Record editing is unavailable for this connection.',
        undefined,
        editDraft,
      );
    }

    const value = normalized.value;
    const cachedAuthoritative = this.#authoritativeRecords.get(recordId);
    const authoritative =
      cachedAuthoritative === undefined || record.revision >= cachedAuthoritative.revision
        ? record
        : cachedAuthoritative;
    const durablePendingBefore = this.#durableQueue?.getRecordSnapshot(recordId).pending ?? 0;
    const preEditDisplay = record;
    const editStatuses = { ...this.#state.editStatuses };
    delete editStatuses[recordId];
    this.#dirtyRecords.add(recordId);
    const optimistic = options.unset
      ? withoutCellValue(record, fieldId)
      : withCellValue(record, fieldId, value);
    this.#optimisticRecords.set(recordId, optimistic);
    this.#publish({
      records: replaceRecord(this.#state.records, optimistic),
      editStatuses,
      editError: null,
      editErrorRecordId:
        this.#state.editErrorRecordId === recordId ? null : this.#state.editErrorRecordId,
      editDrafts: upsertEditDraft(this.#state.editDrafts, editDraft),
      saveStatus: 'dirty',
    });

    const job = {
      tableId,
      recordId,
      initialRevision: authoritative.revision,
      ...(options.clientMutationId === undefined
        ? {}
        : { clientMutationId: options.clientMutationId }),
      buildCommand: (expectedRevision: number): UpdateRecordCommand =>
        options.unset
          ? {
              kind: 'updateRecord',
              recordId,
              expectedRevision,
              unsetFieldIds: [fieldId],
            }
          : {
              kind: 'updateRecord',
              recordId,
              expectedRevision,
              set: { [fieldId]: value },
            },
    };
    try {
      let result: MutationResult;
      if (this.#durableQueue !== null) {
        const request: MutationRequest = {
          clientMutationId: options.clientMutationId ?? this.#mutationIdFactory(),
          commands: [job.buildCommand(authoritative.revision)],
        };
        result = await this.#durableQueue.enqueue(tableId, request);
      } else {
        result = await this.#queue!.enqueue(job);
      }
      const updated = result.results.find((item) => item.index === 0)?.record;
      if (updated === undefined) {
        throw new LoomTableClientError('invalid-response', {
          message: 'The mutation response did not include the updated Record.',
        });
      }
      if (!this.#history.isApplying) {
        const hadBefore = fieldId in authoritative.values;
        const beforeValue = authoritative.values[fieldId];
        const afterUnset = options.unset === true;
        const fieldName = this.#state.fields.find((field) => field.id === fieldId)?.name;
        this.#history.push({
          meta: {
            kind: 'edit',
            recordId,
            fieldId,
            ...(fieldName !== undefined ? { fieldName } : {}),
            before: hadBefore ? beforeValue : undefined,
            after: afterUnset ? undefined : value,
            recordTitle: this.#recordTitle(authoritative),
            at: new Date().toISOString(),
          },
          undo: async () => {
            await this.editCell(
              recordId,
              fieldId,
              hadBefore ? beforeValue : undefined,
              hadBefore ? {} : { unset: true },
            );
          },
          redo: async () => {
            await this.editCell(recordId, fieldId, value, afterUnset ? { unset: true } : {});
          },
        });
        this.#publishHistory();
      }
      return updated;
    } catch (error) {
      const durablePendingAfter = this.#durableQueue?.getRecordSnapshot(recordId).pending ?? 0;
      const isConflict = error instanceof LoomTableClientError && error.kind === 'conflict';
      const rejectedBeforeEntry =
        this.#durableQueue !== null && durablePendingAfter === durablePendingBefore && !isConflict;
      if (rejectedBeforeEntry) {
        const clientError = asClientError(error);
        if (durablePendingBefore === 0) this.#dirtyRecords.delete(recordId);
        this.#optimisticRecords.set(recordId, preEditDisplay);
        this.#publish({
          records: replaceRecord(this.#state.records, preEditDisplay),
          editStatuses: { ...this.#state.editStatuses, [recordId]: 'error' },
          editError: clientError.details,
          editErrorRecordId: recordId,
          editDrafts: upsertEditDraft(this.#state.editDrafts, editDraft),
          saveStatus: this.#isOffline() ? 'offline-readonly' : 'error',
        });
      } else if (!isConflict) {
        const fallback = this.#authoritativeRecords.get(recordId) ?? record;
        this.#optimisticRecords.set(recordId, fallback);
        this.#publish({
          records: replaceRecord(this.#state.records, fallback),
          editError: asClientError(error).details,
          editErrorRecordId: recordId,
          editDrafts: upsertEditDraft(this.#state.editDrafts, editDraft),
        });
      }
      throw error;
    }
  }

  async editLocation(
    recordId: string,
    fieldId: string,
    intent: LocationEditIntent,
    sourceRecord?: LoomTableRecord,
  ): Promise<LoomTableRecord | undefined> {
    if (intent.kind === 'unset') {
      await this.editCell(recordId, fieldId, undefined, { unset: true }, sourceRecord);
    } else {
      await this.editCell(
        recordId,
        fieldId,
        intent.kind === 'clear' ? null : intent.value,
        {},
        sourceRecord,
      );
    }
    return this.#state.records.find((candidate) => candidate.id === recordId);
  }

  get supportsRecordCreate(): boolean {
    return this.#durableQueue !== null;
  }

  get supportsRecordLifecycle(): boolean {
    return this.#durableQueue !== null;
  }

  async createRecord(values: Readonly<Record<string, MutationValue>>): Promise<LoomTableRecord> {
    const tableId = this.#state.selectedTableId;
    if (tableId === null) {
      throw new LoomTableClientError('validation', {
        message: 'A Table must be selected before creating a Record.',
      });
    }
    if (this.#isOffline()) {
      throw new LoomTableClientError('validation', {
        message: 'Record creation is unavailable while offline.',
      });
    }
    if (this.#durableQueue === null) {
      throw new LoomTableClientError('validation', {
        message: 'Record creation requires the durable mutation queue.',
      });
    }

    const clientMutationId = this.#mutationIdFactory();
    const result = await this.#durableQueue.enqueue(tableId, {
      clientMutationId,
      commands: [{ kind: 'createRecord', values: { ...values } }],
    });
    const record = result.results.find((item) => item.index === 0)?.record;
    if (record === undefined) {
      throw new LoomTableClientError('invalid-response', {
        message: 'The mutation response did not include the created Record.',
      });
    }
    if (!this.#history.isApplying) {
      const recordId = record.id;
      const seed = { ...values };
      this.#history.push({
        meta: {
          kind: 'create',
          recordId,
          recordTitle: this.#recordTitle(record),
          at: new Date().toISOString(),
        },
        undo: async () => {
          await this.deleteRecord(recordId);
        },
        redo: async () => {
          await this.createRecord(seed);
        },
      });
      this.#publishHistory();
    }
    return record;
  }

  retryRecordCreate(operationId: string): Promise<void> {
    return this.#durableQueue?.retryOperation(operationId) ?? Promise.resolve();
  }

  async discardRecordCreate(operationId: string): Promise<void> {
    await this.#durableQueue?.discardOperation(operationId);
    this.#removeCreateOp(operationId);
  }

  dismissRecordCreate(operationId: string): void {
    this.#removeCreateOp(operationId);
  }

  canDeleteRecord(recordId: string): RecordDeleteGate {
    if (this.#isOffline() || this.#state.status === 'offline') return 'offline';
    if (this.#durableQueue === null) return 'unavailable';
    if (this.#state.editDrafts.some((draft) => draft.recordId === recordId)) return 'draft';
    const status = this.#state.editStatuses[recordId];
    if (
      (status !== undefined && status !== 'terminal') ||
      this.#state.conflicts.some((conflict) => conflict.recordId === recordId)
    ) {
      return 'pending';
    }
    return 'ok';
  }

  async deleteRecord(
    recordId: string,
    options?: { readonly discardDraft?: boolean },
  ): Promise<LoomTableRecord> {
    const gate = this.canDeleteRecord(recordId);
    if (gate === 'draft' && options?.discardDraft !== true) {
      throw this.#publishEditFailure(this.#translate('record.delete.blocked.draft'));
    }
    if (gate !== 'ok' && gate !== 'draft') {
      throw this.#publishEditFailure(this.#translate(`record.delete.blocked.${gate}` as const));
    }
    const tableId = this.#state.selectedTableId;
    const queue = this.#durableQueue;
    if (tableId === null || queue === null) {
      throw this.#publishEditFailure(this.#translate('record.delete.blocked.unavailable'));
    }
    const record =
      this.#authoritativeRecords.get(recordId) ??
      this.#state.records.find((candidate) => candidate.id === recordId);
    if (record === undefined || record.deletedAt !== undefined) {
      throw new LoomTableClientError('validation', {
        message: 'The Record is unavailable for deletion.',
      });
    }
    if (gate === 'draft') {
      this.#publish({
        editDrafts: removeEditDraftsForRecord(this.#state.editDrafts, recordId),
      });
    }
    // Clear stale terminal entries so a retried delete is not stuck behind a
    // failed lane head; in-flight ops were already rejected by the gate above.
    await queue.discardAllForRecord(recordId);
    const result = await queue.enqueue(tableId, {
      clientMutationId: this.#mutationIdFactory(),
      commands: [{ kind: 'deleteRecord', recordId, expectedRevision: record.revision }],
    });
    const deleted = result.results.find((item) => item.index === 0)?.record;
    if (deleted === undefined) {
      throw new LoomTableClientError('invalid-response', {
        message: 'The mutation response did not include the deleted Record.',
      });
    }
    if (!this.#history.isApplying) {
      this.#history.push({
        meta: {
          kind: 'delete',
          recordId,
          recordTitle: this.#recordTitle(deleted),
          at: new Date().toISOString(),
        },
        undo: async () => {
          await this.restoreRecord(recordId);
        },
        redo: async () => {
          await this.deleteRecord(recordId);
        },
      });
      this.#publishHistory();
    }
    return deleted;
  }

  async duplicateRecord(recordId: string): Promise<LoomTableRecord> {
    const duplicateRecord = this.#client.duplicateRecord?.bind(this.#client);
    const tableId = this.#state.selectedTableId;
    if (duplicateRecord === undefined || tableId === null) {
      throw this.#publishEditFailure(this.#translate('record.duplicate.blocked.unavailable'));
    }
    if (this.#isOffline() || this.#state.status === 'offline') {
      throw this.#publishEditFailure(this.#translate('record.duplicate.blocked.offline'));
    }
    const result = await duplicateRecord(tableId, recordId);
    const view = this.#state.views.find((candidate) => candidate.id === this.#state.selectedViewId);
    if (view !== undefined && isGridView(view)) {
      await this.#reloadSelectedViewQuery(view);
    }
    return result.record;
  }

  async insertRecordBelow(recordId: string): Promise<LoomTableRecord> {
    const created = await this.createRecord({});
    try {
      await this.moveRecord(created.id, { afterRecordId: recordId });
    } catch {
      // The Record was created at the end of the manual order; a failed
      // move leaves it there where undo history can still remove it.
    }
    return created;
  }

  async queryFieldValues(
    fieldId: string,
    request: { search?: string; cursor?: string } = {},
  ): Promise<DistinctValuesPage> {
    const queryFieldValues = this.#client.queryFieldValues?.bind(this.#client);
    const tableId = this.#state.selectedTableId;
    if (queryFieldValues === undefined || tableId === null) {
      throw new LoomTableClientError('validation', {
        message: 'Distinct values are unavailable for this connection.',
      });
    }
    const view = this.#state.views.find((candidate) => candidate.id === this.#state.selectedViewId);
    const filter = view?.type === 'grid' ? view.config.filter : undefined;
    return queryFieldValues(tableId, fieldId, {
      ...(filter === undefined ? {} : { filter }),
      ...(request.search === undefined ? {} : { search: request.search }),
      ...(request.cursor === undefined ? {} : { cursor: request.cursor }),
    });
  }

  setFieldAggregation(fieldId: string, fn: AggregateFn | undefined): void {
    const selections = { ...this.#state.fieldAggregations };
    if (fn === undefined) delete selections[fieldId];
    else selections[fieldId] = fn;
    this.#publish({ fieldAggregations: selections });
    this.#refreshAggregates();
  }

  #refreshAggregates(): void {
    const aggregateRecords = this.#client.aggregateRecords?.bind(this.#client);
    const tableId = this.#state.selectedTableId;
    const selections = this.#state.fieldAggregations;
    const fieldIds = Object.keys(selections);
    if (aggregateRecords === undefined || tableId === null || fieldIds.length === 0) {
      ++this.#aggregateToken;
      this.#publish({ aggregateResults: null, aggregateStatus: 'idle' });
      return;
    }
    const view = this.#state.views.find((candidate) => candidate.id === this.#state.selectedViewId);
    const filter = view?.type === 'grid' ? view.config.filter : undefined;
    const fns = [...new Set(Object.values(selections))];
    const token = ++this.#aggregateToken;
    this.#publish({ aggregateStatus: 'loading' });
    void aggregateRecords(tableId, {
      fieldIds,
      fns,
      ...(filter === undefined ? {} : { filter }),
    })
      .then((result) => {
        if (token !== this.#aggregateToken) return;
        this.#publish({ aggregateResults: result.results, aggregateStatus: 'ready' });
      })
      .catch(() => {
        if (token !== this.#aggregateToken) return;
        this.#publish({ aggregateStatus: 'error' });
      });
  }

  async restoreRecord(recordId: string): Promise<RecordRestoreOutcome> {
    const tableId = this.#state.selectedTableId;
    const queue = this.#durableQueue;
    const getRecord = this.#client.getRecord?.bind(this.#client);
    if (tableId === null || queue === null || getRecord === undefined) {
      throw this.#publishEditFailure(this.#translate('record.delete.blocked.unavailable'));
    }
    if (this.#isOffline()) {
      throw this.#publishEditFailure(this.#translate('record.delete.blocked.offline'));
    }
    const current = await getRecord(recordId);
    if (current.deletedAt === undefined) {
      this.#authoritativeRecords.set(recordId, current);
      this.#clearDeleteNotice(recordId);
      this.#publish({
        deletedRecords: this.#state.deletedRecords.filter((record) => record.id !== recordId),
      });
      return { status: 'already-active', record: current };
    }
    await queue.discardAllForRecord(recordId);
    const result = await queue.enqueue(tableId, {
      clientMutationId: this.#mutationIdFactory(),
      commands: [
        {
          kind: 'restoreRecord',
          recordId,
          expectedRevision: current.revision,
        },
      ],
    });
    const restored = result.results.find((item) => item.index === 0)?.record;
    if (restored === undefined) {
      throw new LoomTableClientError('invalid-response', {
        message: 'The mutation response did not include the restored Record.',
      });
    }
    this.#clearDeleteNotice(recordId);
    this.#publish({
      deletedRecords: this.#state.deletedRecords.filter((record) => record.id !== recordId),
    });
    this.#reloadDeletedRecordsIfLoaded();
    this.#reloadServerHistoryIfLoaded();
    this.#refreshAggregates();
    if (!this.#history.isApplying) {
      this.#history.push({
        meta: {
          kind: 'restore',
          recordId,
          recordTitle: this.#recordTitle(restored),
          at: new Date().toISOString(),
        },
        undo: async () => {
          await this.deleteRecord(recordId);
        },
        redo: async () => {
          await this.restoreRecord(recordId);
        },
      });
      this.#publishHistory();
    }
    return { status: 'restored', record: restored };
  }

  get canUndo(): boolean {
    return this.#history.canUndo;
  }

  get canRedo(): boolean {
    return this.#history.canRedo;
  }

  async undo(): Promise<void> {
    if (await this.#history.undo()) this.#publishHistory();
  }

  async undoUntil(index: number): Promise<void> {
    await this.#history.undoUntil(index);
    this.#publishHistory();
  }

  async redo(): Promise<void> {
    if (await this.#history.redo()) this.#publishHistory();
  }

  #publishHistory(): void {
    this.#publish({
      canUndo: this.#history.canUndo,
      canRedo: this.#history.canRedo,
      historyEntries: this.#history.entries,
    });
  }

  #recordTitle(record: LoomTableRecord): string {
    const table = this.#state.tables.find((candidate) => candidate.id === record.tableId);
    const value = table === undefined ? undefined : record.values[table.primaryFieldId];
    if (typeof value === 'string' && value.trim() !== '') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return this.#translate('grid.untitledRecord');
  }

  async undoDelete(): Promise<RecordRestoreOutcome | null> {
    const record = this.#state.lastDeletedRecord;
    if (record === null) return null;
    return this.restoreRecord(record.id);
  }

  dismissDeleteNotice(): void {
    this.#publish({ lastDeletedRecord: null });
  }

  async loadDeletedRecords(options?: {
    readonly pageSize?: number;
    readonly cursor?: string;
  }): Promise<void> {
    const tableId = this.#state.selectedTableId;
    if (tableId === null) return;
    this.#publish({ deletedRecordsStatus: 'loading', deletedRecordsError: null });
    try {
      const result = await this.#client.query({
        tableId,
        lifecycle: 'deleted',
        limit: options?.pageSize ?? this.#pageSize,
        ...(options?.cursor === undefined ? {} : { cursor: options.cursor }),
      });
      this.#publish({
        deletedRecords:
          options?.cursor === undefined
            ? [...result.items]
            : [...this.#state.deletedRecords, ...result.items],
        deletedRecordsStatus: 'ready',
        deletedRecordsNextCursor: result.nextCursor ?? null,
        deletedRecordsHasMore: result.hasMore,
      });
    } catch (error) {
      this.#publish({
        deletedRecordsStatus: 'error',
        deletedRecordsError: asClientError(error).details,
      });
    }
  }

  async loadMoreDeletedRecords(): Promise<void> {
    const cursor = this.#state.deletedRecordsNextCursor;
    if (cursor === null || !this.#state.deletedRecordsHasMore) return;
    await this.loadDeletedRecords({ cursor });
  }

  async loadServerHistory(options?: {
    readonly kind?: ChangeKind;
    readonly cursor?: string;
  }): Promise<void> {
    const tableId = this.#state.selectedTableId;
    if (tableId === null || this.#client.pullHistory === undefined) return;
    this.#publish({ serverHistoryStatus: 'loading', serverHistoryError: null });
    try {
      const result = await this.#client.pullHistory(tableId, {
        limit: this.#pageSize,
        ...(options?.kind === undefined ? {} : { kind: options.kind }),
        ...(options?.cursor === undefined ? {} : { cursor: options.cursor }),
      });
      this.#publish({
        serverHistory:
          options?.cursor === undefined
            ? [...result.items]
            : [...this.#state.serverHistory, ...result.items],
        serverHistoryStatus: 'ready',
        serverHistoryNextCursor: result.nextCursor ?? null,
        serverHistoryHasMore: result.hasMore,
      });
    } catch (error) {
      this.#publish({
        serverHistoryStatus: 'error',
        serverHistoryError: asClientError(error).details,
      });
    }
  }

  async loadMoreServerHistory(kind?: ChangeKind): Promise<void> {
    const cursor = this.#state.serverHistoryNextCursor;
    if (cursor === null || !this.#state.serverHistoryHasMore) return;
    await this.loadServerHistory({
      ...(kind === undefined ? {} : { kind }),
      cursor,
    });
  }

  #reloadServerHistoryIfLoaded(): void {
    if (this.#state.serverHistoryStatus !== 'idle') {
      void this.loadServerHistory();
    }
  }

  #clearDeleteNotice(recordId: string): void {
    if (this.#state.lastDeletedRecord?.id === recordId) {
      this.#publish({ lastDeletedRecord: null });
    }
  }

  #reloadDeletedRecordsIfLoaded(): void {
    if (this.#state.deletedRecordsStatus !== 'idle') {
      void this.loadDeletedRecords();
    }
  }

  resolveConflict(recordId: string, action: 'use-server' | 'overwrite' | 'discard-all'): void {
    const conflict = this.#conflicts.get(recordId);
    const tableId = this.#state.selectedTableId;
    if (conflict === undefined || tableId === null) return;

    const current = this.#recordFromConflict(recordId, conflict);
    const display =
      action === 'overwrite'
        ? withValues(current, conflict.submittedSet ?? {}, conflict.submittedUnsetFieldIds)
        : current;
    const authoritativeBefore = this.#authoritativeRecords.get(recordId);
    const complete = (): void => {
      const authoritativeAfter = this.#authoritativeRecords.get(recordId);
      if (
        action !== 'discard-all' &&
        this.#pendingFor(recordId) === 0 &&
        authoritativeAfter !== undefined &&
        authoritativeAfter !== authoritativeBefore &&
        authoritativeAfter.revision >= current.revision
      ) {
        return;
      }
      this.#authoritativeRecords.set(recordId, current);
      this.#optimisticRecords.set(recordId, display);
      if (action === 'discard-all' || this.#pendingFor(recordId) === 0) {
        this.#dirtyRecords.delete(recordId);
      }
      this.#conflicts.delete(recordId);
      const conflicts = [...this.#conflicts.values()];
      const nextState = { ...this.#state, conflicts };
      this.#publish({
        records: replaceRecord(this.#state.records, display),
        conflicts,
        editError: null,
        saveStatus: gridSaveStatus(nextState, this.#isOffline(), this.#dirtyRecords.size > 0),
      });
    };

    if (this.#durableQueue !== null) {
      const recovery =
        action === 'discard-all'
          ? this.#durableQueue.discardAllForRecord(recordId)
          : this.#durableQueue.resolveConflict(
              recordId,
              action === 'overwrite' ? 'overwrite' : 'adopt-server',
            );
      void recovery
        .then(() => {
          const queueState = this.#durableQueue?.getRecordSnapshot(recordId).state;
          if (
            queueState === 'auth-paused' ||
            queueState === 'conflict' ||
            queueState === 'error' ||
            queueState === 'terminal'
          ) {
            return;
          }
          complete();
        })
        .catch((error: unknown) => {
          const clientError = asClientError(error);
          this.#publish({
            editError: clientError.details,
            saveStatus: this.#isOffline() ? 'offline-readonly' : 'error',
          });
        });
      return;
    }

    if (this.#queue === null) return;
    complete();
    if (action === 'discard-all') {
      this.#queue.discardPending(recordId);
    } else {
      this.#queue.resolveConflict(
        recordId,
        action === 'overwrite' ? 'retry' : 'discard',
        current.revision,
      );
    }
  }

  retryEdit(recordId: string): void {
    if (this.#queue === null) return;
    this.#publish({ editError: null });
    this.#queue.retryError(recordId);
  }

  async load(options?: { preserveRecords?: boolean }): Promise<void> {
    const requestToken = ++this.#requestToken;
    const preserveRecords = options?.preserveRecords === true;
    if (!preserveRecords) this.#history.clear();
    this.#publish({
      status: 'loading',
      phase: 'navigation',
      emptyReason: null,
      error: null,
      hasMore: preserveRecords ? this.#state.hasMore : false,
      nextCursor: preserveRecords ? this.#state.nextCursor : null,
      totalCount: preserveRecords ? this.#state.totalCount : null,
      unfilteredTotal: preserveRecords ? this.#state.unfilteredTotal : null,
      ...(preserveRecords ? {} : { canUndo: false, canRedo: false, historyEntries: [] }),
    });

    try {
      const workspaces = await this.#client.listWorkspaces();
      if (!this.#isCurrent(requestToken)) return;
      const workspace = chooseResource(workspaces, this.#selection.workspaceId);
      if (workspace === null) {
        this.#publishEmpty('workspace', {
          workspaces,
          bases: [],
          tables: [],
          views: [],
          fields: [],
          selectedWorkspaceId: null,
          selectedBaseId: null,
          selectedTableId: null,
          selectedViewId: null,
        });
        return;
      }

      const bases = await this.#client.listBases(workspace.id);
      if (!this.#isCurrent(requestToken)) return;
      const base = chooseResource(bases, this.#selection.baseId);
      if (base === null) {
        this.#publishEmpty('base', {
          workspaces,
          bases,
          tables: [],
          views: [],
          fields: [],
          selectedWorkspaceId: workspace.id,
          selectedBaseId: null,
          selectedTableId: null,
          selectedViewId: null,
        });
        return;
      }

      const tables = await this.#client.listTables(base.id);
      if (!this.#isCurrent(requestToken)) return;
      const table = chooseResource(tables, this.#selection.tableId);
      if (table === null) {
        this.#publishEmpty('table', {
          workspaces,
          bases,
          tables,
          views: [],
          fields: [],
          selectedWorkspaceId: workspace.id,
          selectedBaseId: base.id,
          selectedTableId: null,
          selectedViewId: null,
        });
        return;
      }

      const [views, fields] = await Promise.all([
        this.#client.listViews(table.id),
        this.#client.listFields(table.id),
      ]);
      if (!this.#isCurrent(requestToken)) return;
      const gridViews = views.filter(isGridView);
      const view = chooseResource(gridViews, this.#selection.viewId);
      if (view === null) {
        this.#publishEmpty('view', {
          workspaces,
          bases,
          tables,
          views,
          fields,
          selectedWorkspaceId: workspace.id,
          selectedBaseId: base.id,
          selectedTableId: table.id,
          selectedViewId: null,
        });
        return;
      }

      this.#selection = {
        workspaceId: workspace.id,
        baseId: base.id,
        tableId: table.id,
        viewId: view.id,
      };
      if (this.#searchViewId !== view.id) {
        this.#searchTerm = '';
        this.#searchViewId = view.id;
      }
      this.#publish({
        status: 'loading',
        phase: 'query',
        workspaces,
        bases,
        tables,
        views,
        fields,
        selectedWorkspaceId: workspace.id,
        selectedBaseId: base.id,
        selectedTableId: table.id,
        selectedViewId: view.id,
        // Refresh keeps the loaded rows visible while the query re-runs;
        // clearing them here flashes the full-Grid loading placeholder.
        records: preserveRecords ? this.#state.records : [],
        hasMore: preserveRecords ? this.#state.hasMore : false,
        nextCursor: preserveRecords ? this.#state.nextCursor : null,
        changeCursor: preserveRecords ? this.#state.changeCursor : null,
        totalCount: preserveRecords ? this.#state.totalCount : null,
        unfilteredTotal: preserveRecords ? this.#state.unfilteredTotal : null,
        emptyReason: null,
        error: null,
        deletedViews: [],
        deletedViewsStatus: 'idle',
        deletedViewsError: null,
        // Keep create ops for the re-selected Table so a pending create
        // resurfaces after navigation; other Tables' ops are dropped.
        recordCreateOps: this.#state.recordCreateOps.filter((op) => op.tableId === table.id),
        deletedRecords: [],
        deletedRecordsStatus: 'idle',
        deletedRecordsNextCursor: null,
        deletedRecordsHasMore: false,
        deletedRecordsError: null,
        serverHistory: [],
        serverHistoryStatus: 'idle',
        serverHistoryNextCursor: null,
        serverHistoryHasMore: false,
        serverHistoryError: null,
        lastDeletedRecord:
          this.#state.lastDeletedRecord?.tableId === table.id
            ? this.#state.lastDeletedRecord
            : null,
      });
      await this.#loadQuery(requestToken, table.id, view, undefined, true);
    } catch (error) {
      this.#publishError(requestToken, error);
    }
  }

  async refresh(): Promise<void> {
    // Re-run the full selection pipeline so a View deleted elsewhere falls back
    // correctly, but keep the current rows mounted to avoid a loading flash.
    await this.load({ preserveRecords: true });
  }

  applyExternalMutation(record: LoomTableRecord, changeCursor?: string): void {
    if (record.tableId !== this.#state.selectedTableId) return;
    this.#authoritativeRecords.set(record.id, record);
    if (this.#pendingFor(record.id) === 0) {
      this.#optimisticRecords.set(record.id, record);
    }
    const cursorPatch = changeCursor === undefined ? {} : { changeCursor };
    const inPage = this.#state.records.some((candidate) => candidate.id === record.id);
    if (inPage) {
      if (record.deletedAt !== undefined) {
        this.#optimisticRecords.delete(record.id);
        this.#publish({
          records: this.#state.records.filter((candidate) => candidate.id !== record.id),
          // The row was counted in both totals while it sat on the page.
          totalCount: decrementTotal(this.#state.totalCount),
          unfilteredTotal: decrementTotal(this.#state.unfilteredTotal),
          lastDeletedRecord: record,
          ...cursorPatch,
        });
        this.#reloadDeletedRecordsIfLoaded();
        this.#reloadServerHistoryIfLoaded();
        this.#refreshAggregates();
        return;
      }
      this.#publish({
        records: replaceRecord(
          this.#state.records,
          this.#optimisticRecords.get(record.id) ?? record,
        ),
        deletedRecords: this.#state.deletedRecords.filter(
          (candidate) => candidate.id !== record.id,
        ),
        ...cursorPatch,
      });
      return;
    }
    if (record.deletedAt !== undefined) {
      this.#reloadDeletedRecordsIfLoaded();
      this.#reloadServerHistoryIfLoaded();
      this.#refreshAggregates();
      this.#publish({ ...cursorPatch });
      return;
    }
    // A Record that is not on the current page (external create or a filter
    // membership change) cannot be patched in place; soft-reload keeps the
    // existing rows visible while the query is re-run.
    const view = this.#state.views.find((candidate) => candidate.id === this.#state.selectedViewId);
    if (view !== undefined && isGridView(view)) {
      void this.#reloadSelectedViewQuery(view);
    } else {
      this.#publish({ ...cursorPatch });
    }
  }

  async selectWorkspace(workspaceId: string): Promise<void> {
    if (!this.#state.workspaces.some((workspace) => workspace.id === workspaceId)) return;
    this.#selection = { workspaceId };
    await this.load();
  }

  async selectBase(baseId: string): Promise<void> {
    if (!this.#state.bases.some((base) => base.id === baseId)) return;
    this.#selection = {
      ...(this.#state.selectedWorkspaceId === null
        ? {}
        : { workspaceId: this.#state.selectedWorkspaceId }),
      baseId,
    };
    await this.load();
  }

  async selectTable(tableId: string): Promise<void> {
    if (!this.#state.tables.some((table) => table.id === tableId)) return;
    this.#selection = {
      ...(this.#state.selectedWorkspaceId === null
        ? {}
        : { workspaceId: this.#state.selectedWorkspaceId }),
      ...(this.#state.selectedBaseId === null ? {} : { baseId: this.#state.selectedBaseId }),
      tableId,
    };
    await this.load();
  }

  async selectView(viewId: string): Promise<void> {
    const view = this.#state.views.find((candidate) => candidate.id === viewId);
    if (view === undefined) return;
    if (!isGridView(view)) {
      await this.#onNonGridViewSelected?.(view, this.#state);
      return;
    }
    this.#selection = {
      ...(this.#state.selectedWorkspaceId === null
        ? {}
        : { workspaceId: this.#state.selectedWorkspaceId }),
      ...(this.#state.selectedBaseId === null ? {} : { baseId: this.#state.selectedBaseId }),
      ...(this.#state.selectedTableId === null ? {} : { tableId: this.#state.selectedTableId }),
      viewId,
    };
    await this.load();
  }

  async createView(input: ViewCreateInput): Promise<ViewCreateOutcome> {
    const tableId = this.#state.selectedTableId;
    if (this.#viewWrites === null || tableId === null || this.#isOffline()) {
      return viewWriteFailed('validation', 'View creation is unavailable for this connection.');
    }
    const request = createViewRequest(input, this.#state);
    if (request === null) {
      return viewWriteFailed(
        'validation',
        'A Map View requires an active Location Field in this Table.',
      );
    }
    const outcome = await this.#viewWrites.createView(tableId, request);
    if (outcome.status === 'created') {
      await this.#acceptCreatedView(outcome.view);
    } else {
      this.#publish({});
    }
    return outcome;
  }

  async retryViewIntent(intentId: string): Promise<ViewCreateOutcome | null> {
    if (this.#viewWrites === null) return null;
    const outcome = await this.#viewWrites.retryCreateIntent(intentId);
    if (outcome?.status === 'created') {
      await this.#acceptCreatedView(outcome.view);
    } else {
      this.#publish({});
    }
    return outcome;
  }

  async dismissViewIntent(intentId: string): Promise<void> {
    await this.#viewWrites?.dismissCreateIntent(intentId);
    this.#publish({});
  }

  async openManageViews(): Promise<void> {
    const tableId = this.#state.selectedTableId;
    if (tableId === null || this.#isOffline()) {
      this.#publish({
        deletedViews: [],
        deletedViewsStatus: 'error',
        deletedViewsError: {
          message:
            tableId === null
              ? 'Select a Table to manage its Views.'
              : 'View management is unavailable while offline.',
        },
      });
      return;
    }
    this.#publish({ deletedViewsStatus: 'loading', deletedViewsError: null });
    try {
      const deletedViews = await this.#client.listViews(tableId, { lifecycle: 'deleted' });
      this.#publish({ deletedViews, deletedViewsStatus: 'ready', deletedViewsError: null });
    } catch (error) {
      this.#publish({
        deletedViewsStatus: 'error',
        deletedViewsError: asClientError(error).details,
      });
    }
  }

  closeManageViews(): void {
    this.#publish({
      deletedViews: [],
      deletedViewsStatus: 'idle',
      deletedViewsError: null,
    });
  }

  async updateView(viewId: string, patch: ViewUpdatePatch): Promise<ViewWriteOutcome> {
    return this.#runViewWrite(viewId, (view, writes) => writes.updateView(view, patch));
  }

  async renameView(viewId: string, name: string): Promise<ViewWriteOutcome> {
    return this.#runViewWrite(viewId, (view, writes) => writes.updateView(view, { name }));
  }

  async copyView(viewId: string, name: string): Promise<ViewCopyOutcome> {
    const view = this.#state.views.find((candidate) => candidate.id === viewId);
    if (view === undefined || this.#viewWrites === null) {
      return viewWriteFailed('validation', 'View copying is unavailable for this connection.');
    }
    if (this.#isOffline()) {
      return viewWriteFailed('network', 'View copying is unavailable while offline.');
    }
    if (findBrokenViewFieldIds(view, this.#state.fields).queryFieldIds.length > 0) {
      return { status: 'repair-required', view };
    }
    const repairedConfig = repairViewConfig(view, this.#state.fields, { removeFieldIds: [] });
    const source = repairedConfig === null ? view : ({ ...view, config: repairedConfig } as View);
    const outcome = await this.#viewWrites.copyView(source, name);
    if (outcome.status === 'created') {
      await this.#acceptCreatedView(outcome.view);
    } else {
      this.#publish({});
    }
    return outcome;
  }

  async deleteView(viewId: string): Promise<ViewWriteOutcome> {
    return this.#runViewWrite(viewId, (view, writes) => writes.deleteView(view));
  }

  async restoreView(viewId: string): Promise<ViewWriteOutcome> {
    return this.#runViewWrite(viewId, (view, writes) => writes.restoreView(view));
  }

  async setDefaultView(viewId: string): Promise<ViewWriteOutcome> {
    return this.#runViewWrite(viewId, (view, writes) => writes.setDefaultView(view));
  }

  async applyViewFilter(viewId: string, filter: FilterNode | undefined): Promise<ViewWriteOutcome> {
    return this.#runViewWrite(viewId, (view, writes) => {
      if (view.type !== 'grid') {
        return Promise.resolve(
          viewWriteFailed('validation', 'Filters can only be saved on a Grid View.'),
        );
      }
      if (filter !== undefined && validateFilterDraft(filter, this.#state.fields).length > 0) {
        return Promise.resolve(viewWriteFailed('validation', 'The Filter draft is invalid.'));
      }
      const config: { -readonly [K in keyof GridViewConfig]: GridViewConfig[K] } = {
        ...view.config,
      };
      if (filter === undefined) {
        delete config.filter;
      } else {
        config.filter = filter;
      }
      return writes.updateView(view, { config });
    });
  }

  async applyViewSort(viewId: string, sort: readonly SortSpec[]): Promise<ViewWriteOutcome> {
    return this.#runViewWrite(viewId, (view, writes) => {
      if (view.type !== 'grid') {
        return Promise.resolve(
          viewWriteFailed('validation', 'Sort can only be saved on a Grid View.'),
        );
      }
      const fields = new Map(this.#state.fields.map((field) => [field.id, field]));
      const seen = new Set<string>();
      for (const entry of sort) {
        const field = fields.get(entry.fieldId);
        if (
          field === undefined ||
          field.deletedAt !== undefined ||
          !isSortableField(field) ||
          seen.has(entry.fieldId)
        ) {
          return Promise.resolve(viewWriteFailed('validation', 'The Sort draft is invalid.'));
        }
        seen.add(entry.fieldId);
      }
      if (sort.length > MAX_SORT_FIELDS) {
        return Promise.resolve(viewWriteFailed('validation', 'The Sort draft is invalid.'));
      }
      return writes.updateView(view, {
        config: { ...view.config, sort: sort.map((entry) => ({ ...entry })) },
      });
    });
  }

  async applyViewManualSort(viewId: string, enabled: boolean): Promise<ViewWriteOutcome> {
    return this.#runViewWrite(viewId, (view, writes) => {
      if (view.type !== 'grid') {
        return Promise.resolve(
          viewWriteFailed('validation', 'Manual sorting can only be saved on a Grid View.'),
        );
      }
      const config: { -readonly [K in keyof GridViewConfig]: GridViewConfig[K] } = {
        ...view.config,
      };
      if (enabled) config.manualSort = true;
      else delete config.manualSort;
      return writes.updateView(view, { config });
    });
  }

  async moveRecord(
    recordId: string,
    anchors: { beforeRecordId?: string; afterRecordId?: string },
  ): Promise<void> {
    const moveRecord = this.#client.moveRecord?.bind(this.#client);
    const tableId = this.#state.selectedTableId;
    if (moveRecord === undefined || tableId === null) {
      throw this.#publishEditFailure(this.#translate('record.move.failed'));
    }
    try {
      const result = await moveRecord(tableId, recordId, anchors);
      this.#authoritativeRecords.set(recordId, result.record);
    } catch {
      throw this.#publishEditFailure(this.#translate('record.move.failed'));
    }
    const view = this.#state.views.find((candidate) => candidate.id === this.#state.selectedViewId);
    if (view !== undefined && isGridView(view)) {
      await this.#reloadSelectedViewQuery(view);
    }
  }

  async applyViewDisplay(viewId: string, patch: GridDisplayPatch): Promise<ViewWriteOutcome> {
    return this.#runViewWrite(viewId, (view, writes) => {
      if (view.type !== 'grid') {
        return Promise.resolve(
          viewWriteFailed('validation', 'Display settings can only be saved on a Grid View.'),
        );
      }
      if (validateDisplayPatch(patch, this.#state.fields).length > 0) {
        return Promise.resolve(viewWriteFailed('validation', 'The display patch is invalid.'));
      }
      return writes.updateView(view, {
        config: {
          ...view.config,
          projection: [...patch.projection],
          columnOrder: [...patch.columnOrder],
          columnWidths: { ...patch.columnWidths },
          frozenFieldIds: [...patch.frozenFieldIds],
          rowHeight: patch.rowHeight,
        },
      });
    });
  }

  async setSearch(raw: string): Promise<boolean> {
    const term = raw.trim();
    if ([...term].length > MAX_SEARCH_CODE_POINTS) return false;
    const view = this.#state.views.find((candidate) => candidate.id === this.#state.selectedViewId);
    if (view === undefined || !isGridView(view) || this.#state.selectedTableId === null) {
      return false;
    }
    if (this.#searchViewId === view.id && term === this.#searchTerm) return true;
    this.#searchTerm = term;
    this.#searchViewId = view.id;
    this.#publish({});
    await this.#reloadSelectedViewQuery(view);
    return true;
  }

  async repairView(viewId: string, repair: ViewConfigRepairInput): Promise<ViewWriteOutcome> {
    return this.#runViewWrite(viewId, (view, writes) => {
      const config = repairViewConfig(view, this.#state.fields, repair);
      if (config === null) {
        return Promise.resolve(
          viewWriteFailed('validation', 'The View repair requires an active Location Field.'),
        );
      }
      const remaining = findBrokenViewFieldIds({ ...view, config } as View, this.#state.fields);
      if (remaining.queryFieldIds.length > 0) {
        return Promise.resolve(
          viewWriteFailed(
            'validation',
            'Some broken Field references still need a decision before saving.',
          ),
        );
      }
      return writes.updateView(view, { config });
    });
  }

  async resolveViewConflict(viewId: string, action: 'adopt-latest' | 're-edit'): Promise<void> {
    const issue = this.#viewWriteIssues.get(viewId);
    if (issue?.kind !== 'conflict') return;
    this.#viewWriteIssues.delete(viewId);
    const latest = issue.latestView;
    if (latest === undefined || latest.deletedAt !== undefined) {
      this.#publish({});
      return;
    }
    if (action === 're-edit') {
      this.#viewWriteBases.set(viewId, latest);
      this.#publish({});
      return;
    }
    const views = this.#state.views.some((candidate) => candidate.id === viewId)
      ? this.#state.views.map((candidate) => (candidate.id === viewId ? latest : candidate))
      : [...this.#state.views, latest];
    this.#publish({ views });
    if (this.#state.selectedViewId === viewId && isGridView(latest)) {
      await this.#reloadSelectedViewQuery(latest, this.#translate('view.write.refreshFailed'));
    }
  }

  async retryViewWrite(viewId: string): Promise<ViewWriteOutcome | null> {
    const entry = this.#viewWriteRetries.get(viewId);
    if (entry === undefined) return null;
    return this.#executeViewWrite(entry.view, entry.run);
  }

  async dismissViewWriteIssue(viewId: string): Promise<void> {
    this.#viewWriteIssues.delete(viewId);
    this.#viewWriteRetries.delete(viewId);
    this.#viewWriteBases.delete(viewId);
    await this.#refreshViewLists();
  }

  async createField(
    input: FieldSubmitInput,
    anchor: { readonly fieldId: string; readonly side: 'left' | 'right' } | null = null,
  ): Promise<FieldWriteOutcome> {
    const tableId = this.#state.selectedTableId;
    if (!isFieldWriteClient(this.#client) || tableId === null) {
      return fieldWriteFailed('validation', 'Field management is unavailable for this connection.');
    }
    if (this.#isOffline()) {
      return fieldWriteFailed('network', 'Field management is unavailable while offline.');
    }
    const config = fieldConfigFromInput(input);
    if (config === null) {
      return fieldWriteFailed('validation', 'The Field configuration is invalid.');
    }
    let field: Field;
    try {
      field = await this.#client.createField(
        tableId,
        {
          name: input.name,
          type: input.type,
          config,
          ...(input.description === undefined || input.description.trim() === ''
            ? {}
            : { description: input.description }),
        },
        this.#mutationIdFactory(),
      );
    } catch (error) {
      return fieldWriteFailed(
        error instanceof LoomTableClientError ? error.kind : 'server',
        error instanceof Error ? error.message : 'The Field could not be created.',
      );
    }
    const view = this.#state.views.find((candidate) => candidate.id === this.#state.selectedViewId);
    if (view !== undefined && isGridView(view) && this.#viewWrites !== null) {
      const config = view.config;
      const anchorIndex = anchor === null ? -1 : config.columnOrder.indexOf(anchor.fieldId);
      const insertAt =
        anchorIndex === -1 || anchor === null
          ? config.columnOrder.length
          : anchorIndex + (anchor.side === 'right' ? 1 : 0);
      const columnOrder = [...config.columnOrder];
      columnOrder.splice(insertAt, 0, field.id);
      const outcome = await this.#viewWrites.updateView(view, {
        config: {
          ...config,
          projection: [...config.projection, field.id],
          columnOrder,
        },
      });
      if (outcome.status === 'saved') {
        this.#clearViewWriteState(view.id);
        const views = this.#state.views.map((candidate) =>
          candidate.id === view.id ? outcome.view : candidate,
        );
        this.#publish({ views });
      }
    }
    await this.load();
    return { status: 'written', field };
  }

  async updateField(
    fieldId: string,
    input: {
      readonly name?: string;
      readonly options?: readonly SelectOptionInput[];
      readonly maxCount?: number;
      readonly description?: string;
      readonly format?: NumberFormatConfig | null;
    },
  ): Promise<FieldWriteOutcome> {
    const field = this.#state.fields.find((candidate) => candidate.id === fieldId);
    if (!isFieldWriteClient(this.#client) || field === undefined) {
      return fieldWriteFailed('validation', 'Field management is unavailable for this connection.');
    }
    if (this.#isOffline()) {
      return fieldWriteFailed('network', 'Field management is unavailable while offline.');
    }
    const config = fieldUpdateConfigFromInput(field, input);
    if (config === null) {
      return fieldWriteFailed('validation', 'The Field configuration is invalid.');
    }
    try {
      const updated = await this.#client.updateField(fieldId, {
        type: field.type,
        expectedRevision: field.revision,
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(config === undefined ? {} : { config }),
        ...(input.description === undefined
          ? {}
          : { description: input.description.trim() === '' ? null : input.description }),
      });
      await this.load();
      return { status: 'written', field: updated };
    } catch (error) {
      return fieldWriteFailed(
        error instanceof LoomTableClientError ? error.kind : 'server',
        error instanceof Error ? error.message : 'The Field could not be updated.',
      );
    }
  }

  async previewFieldConversion(fieldId: string, type: Field['type']): Promise<ConversionPreview> {
    if (this.#client.previewFieldConversion === undefined) {
      throw new LoomTableClientError('validation', {
        message: 'Field conversion is unavailable for this connection.',
      });
    }
    return this.#client.previewFieldConversion(fieldId, type);
  }

  async convertField(fieldId: string, request: ConvertFieldRequest): Promise<ConversionResult> {
    if (this.#client.convertField === undefined) {
      throw new LoomTableClientError('validation', {
        message: 'Field conversion is unavailable for this connection.',
      });
    }
    const result = await this.#client.convertField(fieldId, request);
    const fields = this.#state.fields.map((field) => (field.id === fieldId ? result.field : field));
    this.#publish({ fields });
    if (this.#viewWrites !== null) {
      for (const view of this.#state.views) {
        if (view.type !== 'grid') continue;
        const config = repairGridConfigForFieldType(view.config, result.field);
        if (config === null) continue;
        try {
          await this.#viewWrites.updateView(view, { config });
        } catch {
          // A failed repair leaves the stale rules in place; the next query
          // surfaces them through the normal view-config issue path.
        }
      }
    }
    await this.refresh();
    return result;
  }

  async deleteField(fieldId: string): Promise<FieldWriteOutcome> {
    const field = this.#state.fields.find((candidate) => candidate.id === fieldId);
    if (!isFieldWriteClient(this.#client) || field === undefined) {
      return fieldWriteFailed('validation', 'Field management is unavailable for this connection.');
    }
    if (this.#isOffline()) {
      return fieldWriteFailed('network', 'Field management is unavailable while offline.');
    }
    try {
      await this.#client.deleteField(fieldId, field.revision);
    } catch (error) {
      return fieldWriteFailed(
        error instanceof LoomTableClientError ? error.kind : 'server',
        error instanceof Error ? error.message : 'The Field could not be deleted.',
      );
    }
    const fields = this.#state.fields.filter((candidate) => candidate.id !== fieldId);
    if (this.#viewWrites !== null) {
      for (const view of this.#state.views) {
        if (view.type !== 'grid' || !gridViewMentionsField(view, fieldId)) continue;
        const config = repairViewConfig(view, fields, { removeFieldIds: [fieldId] });
        if (config === null) continue;
        await this.#viewWrites.updateView(view, { config });
      }
    }
    await this.load();
    return { status: 'written', field };
  }

  async #runViewWrite(viewId: string, run: ViewWriteRun): Promise<ViewWriteOutcome> {
    const view =
      this.#viewWriteBases.get(viewId) ??
      this.#state.views.find((candidate) => candidate.id === viewId) ??
      this.#state.deletedViews.find((candidate) => candidate.id === viewId);
    if (view === undefined) {
      return viewWriteFailed('validation', 'The View is no longer available in this Table.');
    }
    return this.#executeViewWrite(view, run);
  }

  async #executeViewWrite(view: View, run: ViewWriteRun): Promise<ViewWriteOutcome> {
    const writes = this.#viewWrites;
    if (writes === null) {
      return viewWriteFailed('validation', 'View management is unavailable for this connection.');
    }
    if (this.#isOffline()) {
      return viewWriteFailed('network', 'View management is unavailable while offline.');
    }
    if (this.#viewWritePending.has(view.id)) {
      return viewWriteFailed('validation', 'Another View write is already in progress.');
    }
    this.#viewWritePending.add(view.id);
    this.#publish({});
    try {
      const outcome = await run(view, writes);
      await this.#handleViewWriteOutcome(view, outcome, run);
      return outcome;
    } finally {
      this.#viewWritePending.delete(view.id);
      this.#publish({});
    }
  }

  async #handleViewWriteOutcome(
    view: View,
    outcome: ViewWriteOutcome,
    run: ViewWriteRun,
  ): Promise<void> {
    switch (outcome.status) {
      case 'saved': {
        this.#clearViewWriteState(view.id);
        if (this.#state.views.some((candidate) => candidate.id === view.id)) {
          const views = this.#state.views.map((candidate) =>
            candidate.id === view.id ? outcome.view : candidate,
          );
          this.#publish({ views });
        } else {
          await this.#refreshViewLists();
        }
        if (this.#state.selectedViewId === view.id && isGridView(outcome.view)) {
          await this.#reloadSelectedViewQuery(
            outcome.view,
            this.#translate('view.write.refreshFailed'),
          );
        }
        return;
      }
      case 'deleted': {
        this.#clearViewWriteState(view.id);
        await this.#applyViewDeleted(view.id);
        return;
      }
      case 'conflict': {
        this.#viewWriteIssues.set(view.id, {
          kind: 'conflict',
          message: 'The View configuration changed on the Server.',
          ...(outcome.latestView === null ? {} : { latestView: outcome.latestView }),
        });
        this.#publish({});
        return;
      }
      case 'unresolved': {
        this.#viewWriteRetries.set(view.id, { view, run });
        this.#viewWriteIssues.set(view.id, {
          kind: 'unresolved',
          message: outcome.error.message,
        });
        this.#publish({});
        return;
      }
      case 'failed': {
        this.#viewWriteIssues.set(view.id, {
          kind:
            outcome.kind === 'authentication' || outcome.kind === 'forbidden'
              ? 'permission'
              : 'error',
          message: outcome.error.message,
        });
        this.#publish({});
      }
    }
  }

  async #applyViewDeleted(viewId: string): Promise<void> {
    const index = this.#state.views.findIndex((candidate) => candidate.id === viewId);
    const wasSelected = this.#state.selectedViewId === viewId;
    await this.#refreshViewLists();
    if (!wasSelected) return;
    const active = this.#state.views.filter((candidate) => candidate.deletedAt === undefined);
    const fallback = active[index] ?? active[index - 1] ?? null;
    if (fallback === null) {
      this.#selection = {
        ...(this.#state.selectedWorkspaceId === null
          ? {}
          : { workspaceId: this.#state.selectedWorkspaceId }),
        ...(this.#state.selectedBaseId === null ? {} : { baseId: this.#state.selectedBaseId }),
        ...(this.#state.selectedTableId === null ? {} : { tableId: this.#state.selectedTableId }),
      };
      this.#publishEmpty('view', { selectedViewId: null });
      return;
    }
    await this.selectView(fallback.id);
  }

  async #refreshViewLists(): Promise<void> {
    const tableId = this.#state.selectedTableId;
    if (tableId === null) return;
    try {
      const views = await this.#client.listViews(tableId);
      this.#publish({ views });
      if (this.#state.deletedViewsStatus !== 'idle') {
        await this.#refreshDeletedViews(tableId);
      }
    } catch {
      this.#publish({});
    }
  }

  async #refreshDeletedViews(tableId: string): Promise<void> {
    try {
      const deletedViews = await this.#client.listViews(tableId, { lifecycle: 'deleted' });
      this.#publish({ deletedViews, deletedViewsStatus: 'ready', deletedViewsError: null });
    } catch (error) {
      this.#publish({
        deletedViewsStatus: 'error',
        deletedViewsError: asClientError(error).details,
      });
    }
  }

  async #reloadSelectedViewQuery(view: GridView, failureMessage?: string): Promise<void> {
    const requestToken = ++this.#requestToken;
    this.#publish({
      status: 'loading',
      phase: 'query',
      error: null,
      hasMore: false,
      nextCursor: null,
      totalCount: null,
      // unfilteredTotal is filter-independent; keep it so the counter doesn't flash.
      unfilteredTotal: this.#state.unfilteredTotal,
    });
    try {
      await this.#loadQuery(requestToken, view.tableId, view, undefined, true);
    } catch (error) {
      if (failureMessage !== undefined) {
        if (!this.#isCurrent(requestToken)) return;
        const clientError = asClientError(error);
        this.#publish({
          status: gridStatusForError(clientError, this.#isOffline()),
          phase: 'idle',
          error: { ...clientError.details, message: failureMessage },
        });
        return;
      }
      this.#publishError(requestToken, error);
    }
  }

  #clearViewWriteState(viewId: string): void {
    this.#viewWriteIssues.delete(viewId);
    this.#viewWriteRetries.delete(viewId);
    this.#viewWriteBases.delete(viewId);
  }

  async #acceptCreatedView(view: View): Promise<void> {
    const tableId = this.#state.selectedTableId;
    if (tableId !== null) {
      try {
        const views = await this.#client.listViews(tableId);
        this.#publish({ views });
      } catch {
        this.#publish({});
      }
    }
    if (view.type === 'grid') {
      await this.selectView(view.id);
    } else {
      await this.#onNonGridViewSelected?.(view, this.#state);
    }
  }

  async loadNextPage(): Promise<void> {
    const { nextCursor, selectedTableId, selectedViewId, views } = this.#state;
    if (
      this.#loadingMoreToken === this.#requestToken ||
      nextCursor === null ||
      selectedTableId === null
    ) {
      return;
    }
    const view = views.find((candidate) => candidate.id === selectedViewId);
    if (view === undefined || !isGridView(view)) return;

    const requestToken = this.#requestToken;
    this.#loadingMoreToken = requestToken;
    this.#publish({ status: 'loading', phase: 'query', error: null });
    try {
      await this.#loadQuery(requestToken, selectedTableId, view, nextCursor, false);
    } catch (error) {
      this.#publishError(requestToken, error);
    } finally {
      if (this.#loadingMoreToken === requestToken) this.#loadingMoreToken = null;
    }
  }

  #loadQuery(
    requestToken: number,
    tableId: string,
    view: GridView,
    cursor: string | undefined,
    replace: boolean,
  ): Promise<void> {
    return this.#client
      .query(createGridQuery(tableId, view, this.#pageSize, cursor, this.#searchTerm))
      .then(async (result) => {
        if (!this.#isCurrent(requestToken)) return;
        if (replace || !this.#state.records.length) {
          this.#applyQueryResult(result, true);
          return;
        }
        this.#applyQueryResult(result, false);
      })
      .catch(async (error: unknown) => {
        if (error instanceof LoomTableClientError && error.kind === 'cursor-expired' && !replace) {
          await this.#loadQuery(requestToken, tableId, view, undefined, true);
          return;
        }
        throw error;
      });
  }

  #applyQueryResult(result: QueryResult, replace: boolean): void {
    const knownIds = new Set(this.#state.records.map((record) => record.id));
    const incoming = replace ? result.items : result.items.filter((item) => !knownIds.has(item.id));
    const sourceRecords = replace ? incoming : [...this.#state.records, ...incoming];
    for (const record of result.items) {
      this.#authoritativeRecords.set(record.id, record);
      if (this.#pendingFor(record.id) === 0) {
        this.#optimisticRecords.set(record.id, record);
      }
    }
    const records = sourceRecords.map((record) => this.#optimisticRecords.get(record.id) ?? record);
    const emptyReason = records.length === 0 ? queryEmptyReason(this.#state, result) : null;
    this.#publish({
      status: records.length === 0 ? 'empty' : 'ready',
      phase: 'idle',
      records,
      hasMore: result.hasMore,
      nextCursor: result.nextCursor ?? null,
      changeCursor: result.changeCursor,
      // A fresh first page is the authority for both totals — never fall back
      // to a stale denominator once a successful re-query has landed. Only a
      // continuation page (which omits totals) keeps the previous values.
      totalCount: result.totalCount ?? (replace ? null : this.#state.totalCount),
      unfilteredTotal: result.unfilteredTotal ?? (replace ? null : this.#state.unfilteredTotal),
      emptyReason,
      error: null,
    });
    if (replace) this.#refreshAggregates();
  }

  #pendingFor(recordId: string): number {
    if (this.#durableQueue !== null) {
      return this.#durableQueue.getRecordSnapshot(recordId).pending;
    }
    return this.#queue?.getSnapshot(recordId).pending ?? 0;
  }

  #handleMutationApplied(recordId: string, result: MutationResult): void {
    const record = result.results.find((item) => item.index === 0)?.record;
    if (record === undefined) return;
    this.#authoritativeRecords.set(recordId, record);
    const pending = this.#pendingFor(recordId);
    if (pending <= (this.#durableQueue === null ? 1 : 0)) {
      this.#optimisticRecords.set(recordId, record);
      this.#dirtyRecords.delete(recordId);
    }
    this.#conflicts.delete(recordId);
    const clearsEditError = this.#state.editErrorRecordId === recordId;
    if (record.deletedAt !== undefined) {
      // Deleted Records leave the active page immediately. The row is removed
      // in place, so decrement the displayed totals by one — they count exactly
      // this Record while it sat on the page. The invalidation event that fired
      // just before this (onApplied precedes the lane event) may have already
      // removed the row; guard on presence so the decrement never runs twice.
      this.#optimisticRecords.delete(recordId);
      const inPage = this.#state.records.some((candidate) => candidate.id === recordId);
      this.#publish({
        records: this.#state.records.filter((candidate) => candidate.id !== recordId),
        ...(inPage
          ? {
              totalCount: decrementTotal(this.#state.totalCount),
              unfilteredTotal: decrementTotal(this.#state.unfilteredTotal),
            }
          : {}),
        conflicts: [...this.#conflicts.values()],
        editStatuses: removeEditStatus(this.#state.editStatuses, recordId),
        editDrafts: removeEditDraftsForRecord(this.#state.editDrafts, recordId),
        editError: clearsEditError ? null : this.#state.editError,
        editErrorRecordId: clearsEditError ? null : this.#state.editErrorRecordId,
        lastDeletedRecord: record,
      });
      this.#reloadDeletedRecordsIfLoaded();
      this.#reloadServerHistoryIfLoaded();
      this.#refreshAggregates();
      return;
    }
    this.#publish({
      records: replaceRecord(this.#state.records, this.#optimisticRecords.get(recordId) ?? record),
      conflicts: [...this.#conflicts.values()],
      editError: clearsEditError ? null : this.#state.editError,
      editErrorRecordId: clearsEditError ? null : this.#state.editErrorRecordId,
      ...(this.#state.lastDeletedRecord?.id === recordId ? { lastDeletedRecord: null } : {}),
      deletedRecords: this.#state.deletedRecords.filter((candidate) => candidate.id !== recordId),
    });
    this.#reloadServerHistoryIfLoaded();
    this.#refreshAggregates();
  }

  #handleDurableQueueEvent(event: MutationQueueSchedulerEvent): void {
    if (event.tableId !== undefined && event.tableId !== this.#state.selectedTableId) {
      return;
    }
    if (event.kind === 'createRecord') {
      this.#handleCreateOpEvent(event);
      return;
    }
    const recordId =
      event.recordId ?? event.applied?.result.results.find((item) => item.index === 0)?.record.id;
    if (recordId === undefined) return;
    if (event.applied !== undefined) {
      this.#handleMutationApplied(recordId, event.applied.result);
    }
    if (event.recordId !== undefined) {
      this.#handleQueueSnapshot(recordId, controllerSnapshot(event.snapshot));
    }
  }

  #handleCreateOpEvent(event: MutationQueueSchedulerEvent): void {
    const tableId = event.tableId ?? this.#state.selectedTableId;
    if (tableId === null) return;
    const ops = [...this.#state.recordCreateOps];
    const index = ops.findIndex((op) => op.operationId === event.operationId);
    const previous = index < 0 ? undefined : ops[index];
    const createdRecord =
      event.applied?.result.results.find((item) => item.index === 0)?.record ??
      previous?.createdRecord;
    // A lane that goes idle without an applied result was discarded — drop the op.
    if (createdRecord === undefined && event.snapshot.state === 'idle') {
      if (index >= 0) {
        ops.splice(index, 1);
        this.#publishCreateOps(ops);
      }
      return;
    }
    // Lane removal after apply reports an idle snapshot; keep the applied
    // marker so the "open new Record" affordance survives until dismissed.
    const lastError = event.snapshot.lastError ?? previous?.lastError;
    const next: RecordCreateOp = {
      operationId: event.operationId,
      tableId,
      state: createdRecord !== undefined ? 'idle' : event.snapshot.state,
      ...(lastError === undefined ? {} : { lastError }),
      ...(createdRecord === undefined ? {} : { createdRecord }),
    };
    if (index < 0) ops.push(next);
    else ops[index] = next;
    this.#publishCreateOps(ops);
  }

  #publishCreateOps(ops: readonly RecordCreateOp[]): void {
    const nextState = { ...this.#state, recordCreateOps: ops };
    this.#publish({
      recordCreateOps: ops,
      saveStatus: gridSaveStatus(nextState, this.#isOffline(), this.#dirtyRecords.size > 0),
    });
  }

  #removeCreateOp(operationId: string): void {
    if (!this.#state.recordCreateOps.some((op) => op.operationId === operationId)) return;
    this.#publishCreateOps(
      this.#state.recordCreateOps.filter((op) => op.operationId !== operationId),
    );
  }

  #handleLegacyQueueSnapshot(recordId: string, snapshot: MutationQueueSnapshot): void {
    const conflict = this.#queue?.getConflict(recordId)?.error.conflict;
    this.#handleQueueSnapshot(recordId, {
      state: snapshot.state,
      pending: snapshot.pending,
      ...(snapshot.error === undefined ? {} : { error: snapshot.error }),
      ...(conflict === undefined ? {} : { conflict }),
    });
  }

  #handleQueueSnapshot(recordId: string, snapshot: ControllerQueueSnapshot): void {
    const editStatuses = { ...this.#state.editStatuses };
    if (snapshot.state === 'idle') {
      delete editStatuses[recordId];
      if (this.#durableQueue === null) this.#dirtyRecords.delete(recordId);
    } else {
      editStatuses[recordId] = snapshot.state;
    }

    if (snapshot.state === 'conflict' && snapshot.conflict !== undefined) {
      const body = snapshot.conflict.conflicts[0];
      if (body !== undefined) {
        this.#conflicts.set(recordId, {
          ...body,
          clientMutationId: snapshot.conflict.clientMutationId,
          failedCommandIndex: snapshot.conflict.failedCommandIndex,
          message: snapshot.error?.details.message ?? 'The Record changed on the Server.',
        });
      }
    } else {
      this.#conflicts.delete(recordId);
    }
    const conflicts = [...this.#conflicts.values()];
    const editError =
      snapshot.state === 'idle' && this.#state.editErrorRecordId === recordId
        ? null
        : (snapshot.error?.details ?? this.#state.editError);
    const editErrorRecordId =
      snapshot.state === 'idle' && this.#state.editErrorRecordId === recordId
        ? null
        : snapshot.error !== undefined ||
            snapshot.state === 'conflict' ||
            snapshot.state === 'error' ||
            snapshot.state === 'terminal'
          ? recordId
          : this.#state.editErrorRecordId;
    const editDrafts =
      snapshot.state === 'idle'
        ? removeEditDraftsForRecord(this.#state.editDrafts, recordId)
        : this.#state.editDrafts;
    const nextState = {
      ...this.#state,
      editStatuses,
      conflicts,
      editError,
      editErrorRecordId,
    };
    this.#publish({
      editStatuses,
      conflicts,
      editError,
      editErrorRecordId,
      editDrafts,
      saveStatus: gridSaveStatus(nextState, this.#isOffline(), this.#dirtyRecords.size > 0),
    });
  }

  #publishEditFailure(
    message: string,
    code?: string,
    editDraft?: GridEditDraft,
  ): LoomTableClientError {
    const error = new LoomTableClientError('validation', {
      message,
      ...(code === undefined ? {} : { code }),
    });
    this.#publish({
      editError: error.details,
      ...(editDraft === undefined
        ? {}
        : {
            editStatuses: { ...this.#state.editStatuses, [editDraft.recordId]: 'error' as const },
            editDrafts: upsertEditDraft(this.#state.editDrafts, editDraft),
            editErrorRecordId: editDraft.recordId,
          }),
      saveStatus: this.#isOffline() ? 'offline-readonly' : 'error',
    });
    return error;
  }

  #recordFromConflict(recordId: string, conflict: GridConflict): LoomTableRecord {
    const previous =
      this.#authoritativeRecords.get(recordId) ??
      this.#state.records.find((record) => record.id === recordId);
    if (previous === undefined) {
      throw new LoomTableClientError('invalid-response', {
        message: 'The conflicted Record is no longer present in the Grid.',
      });
    }
    return {
      ...previous,
      revision: conflict.currentRevision,
      values: conflict.currentValues,
      updatedAt: new Date().toISOString(),
    };
  }

  #publishEmpty(
    emptyReason: GridEmptyReason,
    state: Partial<Pick<GridState, 'workspaces' | 'bases' | 'tables' | 'views' | 'fields'>> &
      Partial<
        Pick<
          GridState,
          'selectedWorkspaceId' | 'selectedBaseId' | 'selectedTableId' | 'selectedViewId'
        >
      >,
  ): void {
    this.#searchTerm = '';
    this.#searchViewId = null;
    this.#publish({
      ...state,
      status: 'empty',
      phase: 'idle',
      records: [],
      hasMore: false,
      nextCursor: null,
      changeCursor: null,
      totalCount: 0,
      unfilteredTotal: 0,
      emptyReason,
      error: null,
      deletedViews: [],
      deletedViewsStatus: 'idle',
      deletedViewsError: null,
    });
  }

  #publishError(requestToken: number, error: unknown): void {
    if (!this.#isCurrent(requestToken)) return;
    const clientError = asClientError(error);
    const status = gridStatusForError(clientError, this.#isOffline());
    this.#publish({
      status,
      phase: 'idle',
      error: clientError.details,
    });
  }

  #publish(update: Partial<GridState>): void {
    this.#state = {
      ...this.#state,
      ...update,
      search: this.#searchTerm,
      pendingViewIntents: this.#viewWrites?.listPendingCreates() ?? [],
      viewWritePending: [...this.#viewWritePending],
      viewWriteIssues: Object.fromEntries(this.#viewWriteIssues),
    };
    for (const listener of this.#listeners) listener(this.#state);
  }

  #isCurrent(requestToken: number): boolean {
    return requestToken === this.#requestToken;
  }
}

export function createGridQuery(
  tableId: string,
  view: GridView,
  limit = DEFAULT_GRID_PAGE_SIZE,
  cursor?: string,
  search?: string,
): QueryRequest {
  const config = view.config;
  return {
    tableId,
    viewId: view.id,
    limit,
    ...(cursor === undefined ? {} : { cursor }),
    ...(config.projection.length === 0 ? {} : { projection: [...config.projection] }),
    ...(config.filter === undefined ? {} : { filter: config.filter }),
    ...(config.sort.length === 0 ? {} : { sort: config.sort.map((sort) => ({ ...sort })) }),
    ...(search === undefined || search === '' ? {} : { search }),
  };
}

export type GridView = Extract<View, { type: 'grid' }>;

function isGridView(view: View): view is GridView {
  return view.type === 'grid';
}

function isViewWriteClient(client: GridDataSource): client is GridDataSource & ViewWriteClient {
  return (
    typeof client.getView === 'function' &&
    typeof client.createView === 'function' &&
    typeof client.updateView === 'function' &&
    typeof client.deleteView === 'function' &&
    typeof client.restoreView === 'function'
  );
}

function createViewRequest(input: ViewCreateInput, state: GridState): CreateViewRequest | null {
  if (input.type === 'map') {
    const locationField = state.fields.find(
      (field) =>
        field.id === input.locationFieldId &&
        field.type === 'location' &&
        field.deletedAt === undefined,
    );
    if (locationField === undefined) return null;
    return { type: 'map', name: input.name, config: { locationFieldId: locationField.id } };
  }
  const table = state.tables.find((candidate) => candidate.id === state.selectedTableId);
  const primary = state.fields.find((field) => field.id === table?.primaryFieldId);
  const config: GridViewConfig = {
    projection: primary === undefined ? [] : [primary.id],
    columnOrder: primary === undefined ? [] : [primary.id],
    columnWidths: {},
    frozenFieldIds: [],
    rowHeight: 'standard',
    sort: [],
  };
  return { type: 'grid', name: input.name, config };
}

function chooseResource<T extends { id: string }>(
  resources: readonly T[],
  preferredId: string | undefined,
): T | null {
  return resources.find((resource) => resource.id === preferredId) ?? resources[0] ?? null;
}

function queryEmptyReason(state: GridState, result: QueryResult): GridEmptyReason {
  if (state.selectedViewId === null) return 'records';
  const view = state.views.find((candidate) => candidate.id === state.selectedViewId);
  if (
    result.totalCount === 0 &&
    view?.type === 'grid' &&
    (view.config.filter !== undefined || state.search !== '')
  ) {
    return 'no-match';
  }
  return 'records';
}

function decrementTotal(value: number | null): number | null {
  return value === null ? null : Math.max(0, value - 1);
}

function normalizePageSize(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 500) return DEFAULT_GRID_PAGE_SIZE;
  return value;
}

function defaultOfflineCheck(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

function asClientError(error: unknown): LoomTableClientError {
  if (error instanceof LoomTableClientError) return error;
  return new LoomTableClientError('server', {
    message: 'The LoomTable Server returned an unexpected Grid error.',
  });
}

function gridStatusForError(error: LoomTableClientError, offline: boolean): GridStatus {
  if (error.kind === 'authentication') return 'authentication';
  if (error.kind === 'forbidden') return 'forbidden';
  if ((error.kind === 'network' || error.kind === 'timeout') && offline) return 'offline';
  if (error.kind === 'network' || error.kind === 'timeout') return 'network';
  return 'server-error';
}

function replaceRecord(
  records: readonly LoomTableRecord[],
  replacement: LoomTableRecord,
): readonly LoomTableRecord[] {
  return records.map((record) => (record.id === replacement.id ? replacement : record));
}

function withCellValue(
  record: LoomTableRecord,
  fieldId: string,
  value: MutationValue,
): LoomTableRecord {
  return {
    ...record,
    values: { ...record.values, [fieldId]: value },
  };
}

function withoutCellValue(record: LoomTableRecord, fieldId: string): LoomTableRecord {
  const values = { ...record.values };
  delete values[fieldId];
  return { ...record, values };
}

function upsertEditDraft(
  drafts: readonly GridEditDraft[],
  draft: GridEditDraft,
): readonly GridEditDraft[] {
  return [
    ...drafts.filter(
      (candidate) => candidate.recordId !== draft.recordId || candidate.fieldId !== draft.fieldId,
    ),
    draft,
  ];
}

function removeEditDraftsForRecord(
  drafts: readonly GridEditDraft[],
  recordId: string,
): readonly GridEditDraft[] {
  return drafts.filter((draft) => draft.recordId !== recordId);
}

function removeEditStatus(
  statuses: Readonly<Record<string, GridEditStatus>>,
  recordId: string,
): Readonly<Record<string, GridEditStatus>> {
  const { [recordId]: _removed, ...rest } = statuses;
  return rest;
}

function withValues(
  record: LoomTableRecord,
  set: Readonly<Record<string, MutationValue>>,
  unsetFieldIds: readonly string[] | undefined,
): LoomTableRecord {
  const values = { ...record.values, ...set };
  for (const fieldId of unsetFieldIds ?? []) delete values[fieldId];
  return { ...record, values };
}

function controllerSnapshot(snapshot: MutationQueueRecordSnapshot): ControllerQueueSnapshot {
  const error =
    snapshot.lastError === undefined
      ? undefined
      : new LoomTableClientError(
          snapshot.lastError.kind,
          {
            message: snapshot.lastError.message,
            ...(snapshot.lastError.code === undefined ? {} : { code: snapshot.lastError.code }),
            ...(snapshot.lastError.httpStatus === undefined
              ? {}
              : { httpStatus: snapshot.lastError.httpStatus }),
            ...(snapshot.lastError.requestId === undefined
              ? {}
              : { requestId: snapshot.lastError.requestId }),
          },
          undefined,
          snapshot.conflict,
        );
  if (snapshot.state === 'sending') {
    return {
      state: 'saving',
      pending: snapshot.pending,
      ...(error === undefined ? {} : { error }),
    };
  }
  if (snapshot.state === 'terminal') {
    return {
      state: 'terminal',
      pending: snapshot.pending,
      ...(error === undefined ? {} : { error }),
    };
  }
  if (snapshot.state === 'auth-paused' || snapshot.state === 'error') {
    return { state: 'error', pending: snapshot.pending, ...(error === undefined ? {} : { error }) };
  }
  return {
    state: snapshot.state === 'queued' ? 'queued' : snapshot.state,
    pending: snapshot.pending,
    ...(error === undefined ? {} : { error }),
    ...(snapshot.conflict === undefined ? {} : { conflict: snapshot.conflict }),
  };
}

function gridSaveStatus(state: GridState, offline: boolean, dirty = false): ViewSaveStatus {
  if (offline || state.status === 'offline') return 'offline-readonly';
  const createStates = state.recordCreateOps
    .filter((op) => op.createdRecord === undefined)
    .map((op) => op.state);
  if (
    state.conflicts.length > 0 ||
    Object.values(state.editStatuses).some((status) => status === 'conflict') ||
    createStates.some((status) => status === 'conflict')
  ) {
    return 'conflict';
  }
  if (
    Object.values(state.editStatuses).some(
      (status) => status === 'error' || status === 'terminal',
    ) ||
    createStates.some(
      (status) => status === 'error' || status === 'terminal' || status === 'auth-paused',
    )
  ) {
    return 'error';
  }
  if (
    Object.values(state.editStatuses).some(
      (status) => status === 'queued' || status === 'saving',
    ) ||
    createStates.some((status) => status === 'queued' || status === 'sending')
  ) {
    return 'saving';
  }
  if (dirty) return 'dirty';
  return 'saved';
}
