import {
  LoomTableClientError,
  type Base,
  type ConflictBody,
  type ConflictDetails,
  type Field,
  type LoomTableClient,
  type LoomTableClientErrorDetails,
  type LoomTableRecord,
  type MutationRequest,
  type MutationResult,
  type MutationValue,
  type QueryRequest,
  type QueryResult,
  type Table,
  type UpdateRecordCommand,
  type View,
  type Workspace,
} from '../client/loomtable-client';
import {
  normalizeCellValue,
  normalizeLocationValue,
  type LocationEditIntent,
} from './field-value-editor';
import {
  MutationQueue,
  createMutationId,
  type MutationQueueSnapshot,
} from './mutation-queue';
import type {
  DurableMutationQueuePort,
  MutationQueueRecordSnapshot,
  MutationQueueSchedulerEvent,
} from './mutation-queue-scheduler';
import type { ViewSaveStatus } from './save-status';

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

export type GridEditStatus = 'queued' | 'saving' | 'conflict' | 'error';

export interface GridConflict extends ConflictBody {
  readonly clientMutationId: string;
  readonly message: string;
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
  readonly emptyReason: GridEmptyReason | null;
  readonly error: LoomTableClientErrorDetails | null;
  readonly editStatuses: Readonly<Record<string, GridEditStatus>>;
  readonly conflicts: readonly GridConflict[];
  readonly editError: LoomTableClientErrorDetails | null;
  readonly saveStatus: ViewSaveStatus;
}

export type GridDataSource = Pick<
  LoomTableClient,
  'listWorkspaces' | 'listBases' | 'listTables' | 'listFields' | 'listViews' | 'query'
> &
  Partial<Pick<LoomTableClient, 'getRecord' | 'mutate'>>;

export interface GridViewControllerOptions {
  readonly pageSize?: number;
  readonly isOffline?: () => boolean;
  readonly mutationQueue?: DurableMutationQueuePort;
  readonly mutationIdFactory?: () => string;
  readonly mutationNetworkAttempts?: number;
  readonly onNonGridViewSelected?: (view: View, state: GridState) => void | Promise<void>;
}

export interface GridEditOptions {
  readonly unset?: boolean;
}

export type GridStateListener = (state: GridState) => void;

interface ControllerQueueSnapshot {
  readonly state: 'idle' | 'queued' | 'saving' | 'conflict' | 'error';
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
  emptyReason: null,
  error: null,
  editStatuses: {},
  conflicts: [],
  editError: null,
  saveStatus: 'saved',
};

export class GridViewController {
  readonly #client: GridDataSource;
  readonly #pageSize: number;
  readonly #isOffline: () => boolean;
  readonly #listeners = new Set<GridStateListener>();
  readonly #queue: MutationQueue | null;
  readonly #durableQueue: DurableMutationQueuePort | null;
  readonly #mutationIdFactory: () => string;
  readonly #onNonGridViewSelected: GridViewControllerOptions['onNonGridViewSelected'];
  #queueUnsubscribe: (() => void) | null = null;
  readonly #authoritativeRecords = new Map<string, LoomTableRecord>();
  readonly #optimisticRecords = new Map<string, LoomTableRecord>();
  readonly #conflicts = new Map<string, GridConflict>();
  readonly #dirtyRecords = new Set<string>();
  #state: GridState = INITIAL_STATE;
  #selection: GridSelection = {};
  #requestToken = 0;
  #loadingMore = false;

  constructor(client: GridDataSource, options: GridViewControllerOptions = {}) {
    this.#client = client;
    this.#pageSize = normalizePageSize(options.pageSize ?? DEFAULT_GRID_PAGE_SIZE);
    this.#isOffline = options.isOffline ?? defaultOfflineCheck;
    this.#onNonGridViewSelected = options.onNonGridViewSelected;
    this.#durableQueue = options.mutationQueue ?? null;
    this.#mutationIdFactory = options.mutationIdFactory ?? createMutationId;
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
  ): Promise<void> {
    const field = this.#state.fields.find((candidate) => candidate.id === fieldId);
    const record =
      this.#state.records.find((candidate) => candidate.id === recordId) ??
      (sourceRecord?.id === recordId ? sourceRecord : undefined);
    const tableId = this.#state.selectedTableId;
    if (field === undefined || record === undefined || tableId === null) {
      throw this.#publishEditFailure('The selected Grid Cell is no longer available.');
    }
    const offline = this.#isOffline();
    if (offline || this.#state.status !== 'ready') {
      throw this.#publishEditFailure(
        offline || this.#state.status === 'offline'
          ? 'Grid editing is unavailable while offline.'
          : 'Grid editing is unavailable until the Grid is ready.',
      );
    }
    const normalized = options.unset
      ? { ok: true as const, value: null }
      : field.type === 'location'
        ? normalizeLocationValue(rawValue)
        : normalizeCellValue(field, rawValue);
    if (!normalized.ok) throw this.#publishEditFailure(normalized.message);
    if (this.#queue === null && this.#durableQueue === null) {
      throw this.#publishEditFailure('Record editing is unavailable for this connection.');
    }

    const value = normalized.value;
    const authoritative = this.#authoritativeRecords.get(recordId) ?? record;
    this.#dirtyRecords.add(recordId);
    const optimistic = options.unset
      ? withoutCellValue(record, fieldId)
      : withCellValue(record, fieldId, value);
    this.#optimisticRecords.set(recordId, optimistic);
    this.#publish({
      records: replaceRecord(this.#state.records, optimistic),
      editError: null,
      saveStatus: 'dirty',
    });

    const job = {
      tableId,
      recordId,
      initialRevision: authoritative.revision,
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
      if (this.#durableQueue !== null) {
        const request: MutationRequest = {
          clientMutationId: this.#mutationIdFactory(),
          commands: [job.buildCommand(authoritative.revision)],
        };
        await this.#durableQueue.enqueue(tableId, request);
      } else {
        await this.#queue!.enqueue(job);
      }
    } catch (error) {
      if (!(error instanceof LoomTableClientError) || error.kind !== 'conflict') {
        const fallback = this.#authoritativeRecords.get(recordId) ?? record;
        this.#optimisticRecords.set(recordId, fallback);
        this.#publish({ records: replaceRecord(this.#state.records, fallback) });
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

  resolveConflict(recordId: string, action: 'use-server' | 'overwrite'): void {
    const conflict = this.#conflicts.get(recordId);
    const tableId = this.#state.selectedTableId;
    if (conflict === undefined || tableId === null || this.#queue === null) return;

    const current = this.#recordFromConflict(recordId, conflict);
    this.#authoritativeRecords.set(recordId, current);
    const display =
      action === 'overwrite' && conflict.submittedSet !== undefined
        ? withValues(current, conflict.submittedSet, conflict.submittedUnsetFieldIds)
        : current;
    this.#optimisticRecords.set(recordId, display);
    this.#conflicts.delete(recordId);
    this.#publish({
      records: replaceRecord(this.#state.records, display),
      conflicts: [...this.#conflicts.values()],
    });
    this.#queue.resolveConflict(
      recordId,
      action === 'overwrite' ? 'retry' : 'discard',
      current.revision,
    );
  }

  retryEdit(recordId: string): void {
    if (this.#queue === null) return;
    this.#publish({ editError: null });
    this.#queue.retryError(recordId);
  }

  async load(): Promise<void> {
    const requestToken = ++this.#requestToken;
    this.#publish({
      status: 'loading',
      phase: 'navigation',
      emptyReason: null,
      error: null,
      hasMore: false,
      nextCursor: null,
      totalCount: null,
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
        records: [],
        hasMore: false,
        nextCursor: null,
        changeCursor: null,
        totalCount: null,
        emptyReason: null,
        error: null,
      });
      await this.#loadQuery(requestToken, table.id, view, undefined, true);
    } catch (error) {
      this.#publishError(requestToken, error);
    }
  }

  async refresh(): Promise<void> {
    await this.load();
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

  async loadNextPage(): Promise<void> {
    const { nextCursor, selectedTableId, selectedViewId, views } = this.#state;
    if (this.#loadingMore || nextCursor === null || selectedTableId === null) return;
    const view = views.find((candidate) => candidate.id === selectedViewId);
    if (view === undefined || !isGridView(view)) return;

    const requestToken = this.#requestToken;
    this.#loadingMore = true;
    this.#publish({ status: 'loading', phase: 'query', error: null });
    try {
      await this.#loadQuery(requestToken, selectedTableId, view, nextCursor, false);
    } catch (error) {
      this.#publishError(requestToken, error);
    } finally {
      this.#loadingMore = false;
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
      .query(createGridQuery(tableId, view, this.#pageSize, cursor))
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
    const sourceRecords = replace ? result.items : [...this.#state.records, ...result.items];
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
      totalCount: result.totalCount ?? this.#state.totalCount,
      emptyReason,
      error: null,
    });
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
    this.#publish({
      records: replaceRecord(this.#state.records, this.#optimisticRecords.get(recordId) ?? record),
      conflicts: [...this.#conflicts.values()],
      editError: null,
    });
  }

  #handleDurableQueueEvent(event: MutationQueueSchedulerEvent): void {
    if (event.applied !== undefined) {
      this.#handleMutationApplied(event.recordId, event.applied.result);
    }
    this.#handleQueueSnapshot(event.recordId, controllerSnapshot(event.snapshot));
  }

  #handleLegacyQueueSnapshot(recordId: string, snapshot: MutationQueueSnapshot): void {
    this.#handleQueueSnapshot(recordId, {
      ...snapshot,
      ...(this.#queue?.getConflict(recordId)?.error.conflict === undefined
        ? {}
        : { conflict: this.#queue.getConflict(recordId)!.error.conflict }),
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
          message: snapshot.error?.details.message ?? 'The Record changed on the Server.',
        });
      }
    }
    const conflicts = [...this.#conflicts.values()];
    const editError =
      snapshot.state === 'idle'
        ? null
        : (snapshot.error?.details ?? this.#state.editError);
    const nextState = {
      ...this.#state,
      editStatuses,
      conflicts,
      editError,
    };
    this.#publish({
      editStatuses,
      conflicts,
      editError,
      saveStatus: gridSaveStatus(nextState, this.#isOffline(), this.#dirtyRecords.size > 0),
    });
  }

  #publishEditFailure(message: string): LoomTableClientError {
    const error = new LoomTableClientError('validation', { message });
    this.#publish({
      editError: error.details,
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
    this.#publish({
      ...state,
      status: 'empty',
      phase: 'idle',
      records: [],
      hasMore: false,
      nextCursor: null,
      changeCursor: null,
      totalCount: 0,
      emptyReason,
      error: null,
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
    this.#state = { ...this.#state, ...update };
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
  };
}

export type GridView = Extract<View, { type: 'grid' }>;

function isGridView(view: View): view is GridView {
  return view.type === 'grid';
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
  if (result.totalCount === 0 && view?.type === 'grid' && view.config.filter !== undefined) {
    return 'no-match';
  }
  return 'records';
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

function withValues(
  record: LoomTableRecord,
  set: Readonly<Record<string, MutationValue>>,
  unsetFieldIds: readonly string[] | undefined,
): LoomTableRecord {
  const values = { ...record.values, ...set };
  for (const fieldId of unsetFieldIds ?? []) delete values[fieldId];
  return { ...record, values };
}

function controllerSnapshot(
  snapshot: MutationQueueRecordSnapshot,
): ControllerQueueSnapshot {
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
    return { state: 'saving', pending: snapshot.pending, ...(error === undefined ? {} : { error }) };
  }
  if (snapshot.state === 'auth-paused' || snapshot.state === 'terminal' || snapshot.state === 'error') {
    return { state: 'error', pending: snapshot.pending, ...(error === undefined ? {} : { error }) };
  }
  return {
    state: snapshot.state === 'queued' ? 'queued' : snapshot.state,
    pending: snapshot.pending,
    ...(error === undefined ? {} : { error }),
    ...(snapshot.conflict === undefined ? {} : { conflict: snapshot.conflict }),
  };
}

function gridSaveStatus(
  state: GridState,
  offline: boolean,
  dirty = false,
): ViewSaveStatus {
  if (offline || state.status === 'offline') return 'offline-readonly';
  if (
    state.conflicts.length > 0 ||
    Object.values(state.editStatuses).some((status) => status === 'conflict')
  ) {
    return 'conflict';
  }
  if (Object.values(state.editStatuses).some((status) => status === 'error')) return 'error';
  if (
    Object.values(state.editStatuses).some((status) => status === 'queued' || status === 'saving')
  ) {
    return 'saving';
  }
  if (dirty) return 'dirty';
  return 'saved';
}
