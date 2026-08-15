import type {
  Base,
  Field,
  LoomTableRecord,
  MutationRequest,
  MutationResult,
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
  readonly mutationRequests: Array<{
    readonly tableId: string;
    readonly request: MutationRequest;
  }> = [];
  readonly #data: InMemoryGridData;
  readonly #records: LoomTableRecord[];

  constructor(data: InMemoryGridData) {
    this.#data = data;
    this.#records = [...data.records];
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
    const records = this.#records.filter((record) => record.tableId === request.tableId);
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

  async mutate(tableId: string, request: MutationRequest): Promise<MutationResult> {
    this.mutationRequests.push({ tableId, request });
    const command = request.commands[0];
    if (command?.kind !== 'updateRecord')
      throw new Error('Only updateRecord is supported in memory.');
    const index = this.#records.findIndex((record) => record.id === command.recordId);
    const record = this.#records[index];
    if (record === undefined) throw new Error('Record not found.');
    if (record.revision !== command.expectedRevision) {
      const error = new (class extends Error {})('conflict');
      throw error;
    }
    const values = { ...record.values, ...(command.set ?? {}) };
    for (const fieldId of command.unsetFieldIds ?? []) delete values[fieldId];
    const updated: LoomTableRecord = {
      ...record,
      revision: record.revision + 1,
      values,
      updatedAt: new Date().toISOString(),
    };
    this.#records[index] = updated;
    return {
      clientMutationId: request.clientMutationId,
      results: [{ index: 0, status: 'applied', record: updated }],
      changeCursor: 'change_02',
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

