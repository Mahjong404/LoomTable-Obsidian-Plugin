import {
  LoomTableClientError,
  type Base,
  type Field,
  type LoomTableClient,
  type LoomTableClientErrorDetails,
  type LoomTableRecord,
  type QueryRequest,
  type QueryResult,
  type Table,
  type View,
  type Workspace,
} from '../client/loomtable-client';

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
}

export type GridDataSource = Pick<
  LoomTableClient,
  'listWorkspaces' | 'listBases' | 'listTables' | 'listFields' | 'listViews' | 'query'
>;

export interface GridViewControllerOptions {
  readonly pageSize?: number;
  readonly isOffline?: () => boolean;
}

export type GridStateListener = (state: GridState) => void;

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
};

export class GridViewController {
  readonly #client: GridDataSource;
  readonly #pageSize: number;
  readonly #isOffline: () => boolean;
  readonly #listeners = new Set<GridStateListener>();
  #state: GridState = INITIAL_STATE;
  #selection: GridSelection = {};
  #requestToken = 0;
  #loadingMore = false;

  constructor(client: GridDataSource, options: GridViewControllerOptions = {}) {
    this.#client = client;
    this.#pageSize = normalizePageSize(options.pageSize ?? DEFAULT_GRID_PAGE_SIZE);
    this.#isOffline = options.isOffline ?? defaultOfflineCheck;
  }

  get state(): GridState {
    return this.#state;
  }

  subscribe(listener: GridStateListener): () => void {
    this.#listeners.add(listener);
    listener(this.#state);
    return () => this.#listeners.delete(listener);
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
          views: gridViews,
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
        views: gridViews,
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
    if (!this.#state.views.some((view) => view.id === viewId)) return;
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
    const records = replace ? result.items : [...this.#state.records, ...result.items];
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
