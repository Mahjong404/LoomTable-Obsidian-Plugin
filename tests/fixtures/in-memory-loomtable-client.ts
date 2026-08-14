import type {
  Base,
  Field,
  LoomTableRecord,
  QueryRequest,
  QueryResult,
  Table,
  View,
  Workspace,
} from '../../src/client/loomtable-client';
import type { GridDataSource } from '../../src/ui/grid-view-controller';

export interface InMemoryGridData {
  readonly workspaces: readonly Workspace[];
  readonly bases: readonly Base[];
  readonly tables: readonly Table[];
  readonly fields: readonly Field[];
  readonly views: readonly View[];
  readonly records: readonly LoomTableRecord[];
}

export class InMemoryLoomTableClient implements GridDataSource {
  readonly queryRequests: QueryRequest[] = [];
  readonly #data: InMemoryGridData;

  constructor(data: InMemoryGridData) {
    this.#data = data;
  }

  async listWorkspaces(): Promise<readonly Workspace[]> {
    return this.#data.workspaces;
  }

  async listBases(workspaceId: string): Promise<readonly Base[]> {
    return this.#data.bases.filter((base) => base.workspaceId === workspaceId);
  }

  async listTables(baseId: string): Promise<readonly Table[]> {
    return this.#data.tables.filter((table) => table.baseId === baseId);
  }

  async listFields(tableId: string): Promise<readonly Field[]> {
    return this.#data.fields.filter((field) => field.tableId === tableId);
  }

  async listViews(tableId: string): Promise<readonly View[]> {
    return this.#data.views.filter((view) => view.tableId === tableId);
  }

  async query(request: QueryRequest): Promise<QueryResult> {
    this.queryRequests.push(request);
    const records = this.#data.records.filter((record) => record.tableId === request.tableId);
    const offset = decodeCursor(request.cursor);
    const limit = request.limit ?? 100;
    const items = records.slice(offset, offset + limit);
    const nextOffset = offset + items.length;
    const hasMore = nextOffset < records.length;
    return {
      items,
      hasMore,
      changeCursor: 'change_01',
      ...(hasMore ? { nextCursor: encodeCursor(nextOffset) } : {}),
      ...(request.cursor === undefined ? { totalCount: records.length } : {}),
    };
  }
}

function encodeCursor(offset: number): string {
  return `cursor:${offset}`;
}

function decodeCursor(cursor: string | undefined): number {
  if (cursor === undefined) return 0;
  const [, value] = cursor.split(':');
  const offset = Number(value);
  return Number.isInteger(offset) && offset >= 0 ? offset : 0;
}
