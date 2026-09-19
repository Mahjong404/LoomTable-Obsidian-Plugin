import {
  LoomTableClientError,
  normalizeResourceName,
  type AggregateFn,
  type AggregateRequest,
  type AggregateResult,
  type Attachment,
  type AttachmentDownload,
  type Base,
  type ChangePage,
  type ConnectionCheckResult,
  type ConversionPreview,
  type ConversionResult,
  type ConvertFieldRequest,
  type CreateFieldRequest,
  type CreateViewRequest,
  type Field,
  type HistoryPage,
  type InitializeAttachmentRequest,
  type JsonValue,
  type LoomTableClient,
  type LoomTableRecord,
  type LocationValue,
  type MapCluster,
  type MapFeature,
  type MapPoint,
  type MapClusterRecordsQueryRequest,
  type MapQueryRequest,
  type MapQueryResult,
  type MapSummaryResult,
  type MutationRequest,
  type MutationResult,
  type PullHistoryRequest,
  type QueryRequest,
  type DistinctValue,
  type DistinctValuesPage,
  type DistinctValuesRequest,
  type QueryResult,
  type RecordOrderResult,
  type ResourceListOptions,
  type ServerMeta,
  type Table,
  type UpdateFieldRequest,
  type UpdateViewRequest,
  type View,
  type Workspace,
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

type ViewWriteSource = Pick<
  LoomTableClient,
  'getView' | 'createView' | 'updateView' | 'deleteView' | 'restoreView' | 'setDefaultView'
>;

const IN_MEMORY_META: ServerMeta = {
  serverVersion: 'in-memory',
  apiVersion: 'v1',
  minPluginVersion: '0.0.0',
  capabilities: [],
  changeRetention: '30d',
  idempotencyRetention: '30d',
  migrationRequired: false,
  bootstrapState: 'complete',
};

export class InMemoryLoomTableClient implements GridDataSource, ViewWriteSource, LoomTableClient {
  readonly queryRequests: QueryRequest[] = [];
  readonly mutationRequests: Array<{
    readonly tableId: string;
    readonly request: MutationRequest;
  }> = [];
  readonly viewCreateKeys: string[] = [];
  readonly fieldCreateKeys: string[] = [];
  readonly fieldValueRequests: Array<{
    readonly tableId: string;
    readonly fieldId: string;
    readonly request: DistinctValuesRequest;
  }> = [];
  readonly aggregateRequests: Array<{
    readonly tableId: string;
    readonly request: AggregateRequest;
  }> = [];
  readonly #data: InMemoryGridData;
  readonly #records: LoomTableRecord[];
  readonly #views: View[];
  readonly #fields: Field[];
  readonly #createIntents = new Map<string, { readonly body: string; readonly view: View }>();
  readonly #fieldCreateIntents = new Map<
    string,
    { readonly body: string; readonly field: Field }
  >();
  readonly #mutationResults = new Map<
    string,
    { readonly request: MutationRequest; readonly result: MutationResult }
  >();
  #viewSequence = 0;
  #recordSequence = 0;
  #fieldSequence = 0;
  #clock = 0;

  constructor(data: InMemoryGridData) {
    this.#data = data;
    this.#records = [...data.records];
    this.#views = [...data.views];
    this.#fields = [...data.fields];
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

  async listFields(tableId: string, options: ResourceListOptions = {}): Promise<readonly Field[]> {
    const lifecycle = options.lifecycle ?? 'active';
    return this.#fields.filter((field) => {
      if (field.tableId !== tableId) return false;
      if (lifecycle === 'all') return true;
      return lifecycle === 'deleted'
        ? field.deletedAt !== undefined
        : field.deletedAt === undefined;
    });
  }

  async listViews(tableId: string, options: ResourceListOptions = {}): Promise<readonly View[]> {
    const lifecycle = options.lifecycle ?? 'active';
    return this.#views.filter((view) => {
      if (view.tableId !== tableId) return false;
      if (lifecycle === 'all') return true;
      return lifecycle === 'deleted' ? view.deletedAt !== undefined : view.deletedAt === undefined;
    });
  }

  async getView(viewId: string): Promise<View> {
    const view = this.#views.find((candidate) => candidate.id === viewId);
    if (view === undefined) {
      throw new LoomTableClientError('not-found', {
        message: 'The View does not exist.',
        httpStatus: 404,
        code: 'NOT_FOUND',
      });
    }
    return view;
  }

  async createView(
    tableId: string,
    request: CreateViewRequest,
    idempotencyKey: string,
  ): Promise<View> {
    this.viewCreateKeys.push(idempotencyKey);
    const body = JSON.stringify(request);
    const existing = this.#createIntents.get(idempotencyKey);
    if (existing !== undefined) {
      if (existing.body !== body) {
        throw new LoomTableClientError('conflict', {
          message: 'The Idempotency-Key was already used with a different request.',
          httpStatus: 409,
          code: 'IDEMPOTENCY_KEY_REUSED',
        });
      }
      return existing.view;
    }
    const table = this.#data.tables.find((candidate) => candidate.id === tableId);
    const name = normalizeResourceName(request.name);
    if (table === undefined || !name.ok) {
      throw new LoomTableClientError('validation', {
        message: 'The View could not be created.',
        httpStatus: 422,
        code: 'VALIDATION_FAILED',
      });
    }
    this.#viewSequence += 1;
    this.#clock += 1;
    const stamp = new Date(1_800_000_000_000 + this.#clock * 1000).toISOString();
    const view: View = {
      id: `view_${String(this.#viewSequence).padStart(2, '0')}`,
      tableId,
      name: name.name,
      type: request.type,
      config: structuredClone(request.config),
      isDefault: false,
      revision: 1,
      createdAt: stamp,
      updatedAt: stamp,
    } as View;
    this.#views.push(view);
    this.#createIntents.set(idempotencyKey, { body, view });
    return view;
  }

  async updateView(viewId: string, request: UpdateViewRequest): Promise<View> {
    const view = this.#views.find((candidate) => candidate.id === viewId);
    if (view === undefined) {
      throw new LoomTableClientError('not-found', {
        message: 'The View does not exist.',
        httpStatus: 404,
        code: 'NOT_FOUND',
      });
    }
    if (view.revision !== request.expectedRevision) {
      throw new LoomTableClientError('conflict', {
        message: 'The View changed on the Server.',
        httpStatus: 409,
        code: 'CONFLICT',
      });
    }
    if (view.type !== request.type) {
      throw new LoomTableClientError('validation', {
        message: 'A View type cannot be changed.',
        httpStatus: 422,
        code: 'VALIDATION_FAILED',
      });
    }
    let name = view.name;
    if (request.name !== undefined) {
      const normalized = normalizeResourceName(request.name);
      if (!normalized.ok) {
        throw new LoomTableClientError('validation', {
          message: 'The View name is invalid.',
          httpStatus: 422,
          code: 'VALIDATION_FAILED',
        });
      }
      name = normalized.name;
    }
    const index = this.#views.indexOf(view);
    const updated: View = {
      ...view,
      name,
      config: structuredClone(request.config),
      revision: view.revision + 1,
      updatedAt: new Date(1_800_000_000_000 + ++this.#clock * 1000).toISOString(),
    } as View;
    this.#views[index] = updated;
    return updated;
  }

  async deleteView(viewId: string, expectedRevision: number): Promise<void> {
    const view = this.#views.find((candidate) => candidate.id === viewId);
    if (view === undefined) {
      throw new LoomTableClientError('not-found', {
        message: 'The View does not exist.',
        httpStatus: 404,
        code: 'NOT_FOUND',
      });
    }
    if (view.revision !== expectedRevision) {
      throw new LoomTableClientError('conflict', {
        message: 'The View changed on the Server.',
        httpStatus: 409,
        code: 'CONFLICT',
      });
    }
    const index = this.#views.indexOf(view);
    this.#views[index] = {
      ...view,
      revision: view.revision + 1,
      updatedAt: new Date(1_800_000_000_000 + ++this.#clock * 1000).toISOString(),
      deletedAt: new Date(1_800_000_000_000 + this.#clock * 1000).toISOString(),
    };
  }

  async restoreView(viewId: string, expectedRevision: number): Promise<View> {
    const view = this.#views.find((candidate) => candidate.id === viewId);
    if (view === undefined) {
      throw new LoomTableClientError('not-found', {
        message: 'The View does not exist.',
        httpStatus: 404,
        code: 'NOT_FOUND',
      });
    }
    if (view.revision !== expectedRevision || view.deletedAt === undefined) {
      throw new LoomTableClientError('conflict', {
        message: 'The View changed on the Server.',
        httpStatus: 409,
        code: 'CONFLICT',
      });
    }
    const index = this.#views.indexOf(view);
    const restored: View = {
      ...view,
      isDefault: false,
      revision: view.revision + 1,
      updatedAt: new Date(1_800_000_000_000 + ++this.#clock * 1000).toISOString(),
    };
    delete (restored as { deletedAt?: string }).deletedAt;
    this.#views[index] = restored;
    return restored;
  }

  async setDefaultView(viewId: string, expectedRevision: number): Promise<View> {
    const view = this.#views.find((candidate) => candidate.id === viewId);
    if (view === undefined) {
      throw new LoomTableClientError('not-found', {
        message: 'The View does not exist.',
        httpStatus: 404,
        code: 'NOT_FOUND',
      });
    }
    if (view.revision !== expectedRevision || view.deletedAt !== undefined) {
      throw new LoomTableClientError('conflict', {
        message: 'The View changed on the Server.',
        httpStatus: 409,
        code: 'CONFLICT',
      });
    }
    const stamp = new Date(1_800_000_000_000 + ++this.#clock * 1000).toISOString();
    for (let index = 0; index < this.#views.length; index++) {
      const candidate = this.#views[index];
      if (candidate !== undefined && candidate.tableId === view.tableId && candidate.isDefault) {
        this.#views[index] = {
          ...candidate,
          isDefault: false,
          revision: candidate.revision + 1,
          updatedAt: stamp,
        };
      }
    }
    const index = this.#views.findIndex((candidate) => candidate.id === viewId);
    const current = this.#views[index];
    if (current === undefined) {
      throw new LoomTableClientError('not-found', {
        message: 'The View does not exist.',
        httpStatus: 404,
        code: 'NOT_FOUND',
      });
    }
    const updated: View = {
      ...current,
      isDefault: true,
      revision: view.revision + 1,
      updatedAt: stamp,
    };
    this.#views[index] = updated;
    return updated;
  }

  async createField(
    tableId: string,
    request: CreateFieldRequest,
    idempotencyKey: string,
  ): Promise<Field> {
    this.fieldCreateKeys.push(idempotencyKey);
    const body = JSON.stringify(request);
    const existing = this.#fieldCreateIntents.get(idempotencyKey);
    if (existing !== undefined) {
      if (existing.body !== body) {
        throw new LoomTableClientError('conflict', {
          message: 'The Idempotency-Key was already used with a different request.',
          httpStatus: 409,
          code: 'IDEMPOTENCY_KEY_REUSED',
        });
      }
      return existing.field;
    }
    const table = this.#data.tables.find((candidate) => candidate.id === tableId);
    const name = normalizeResourceName(request.name);
    if (table === undefined || !name.ok) {
      throw new LoomTableClientError('validation', {
        message: 'The Field could not be created.',
        httpStatus: 422,
        code: 'VALIDATION_FAILED',
      });
    }
    this.#fieldSequence += 1;
    const position =
      Math.max(0, ...this.#fields.filter((f) => f.tableId === tableId).map((f) => f.position)) + 1;
    const config =
      request.type === 'select' || request.type === 'multiSelect'
        ? {
            options: (
              request.config as { options: { id?: string; name: string; color: string }[] }
            ).options.map((option, index) => ({
              id: option.id ?? `option_${this.#fieldSequence}_${index}`,
              name: option.name,
              color: option.color,
            })),
            deletedOptions: [],
          }
        : structuredClone(request.config);
    const field = {
      id: `field_new_${String(this.#fieldSequence).padStart(2, '0')}`,
      tableId,
      name: name.name,
      position,
      schemaVersion: 1,
      revision: 1,
      type: request.type,
      config,
    } as Field;
    this.#fields.push(field);
    this.#fieldCreateIntents.set(idempotencyKey, { body, field });
    return field;
  }

  async updateField(fieldId: string, request: UpdateFieldRequest): Promise<Field> {
    const field = this.#fields.find((candidate) => candidate.id === fieldId);
    if (field === undefined) {
      throw new LoomTableClientError('not-found', {
        message: 'The Field does not exist.',
        httpStatus: 404,
        code: 'NOT_FOUND',
      });
    }
    if (field.revision !== request.expectedRevision || field.type !== request.type) {
      throw new LoomTableClientError('conflict', {
        message: 'The Field changed on the Server.',
        httpStatus: 409,
        code: 'CONFLICT',
      });
    }
    const index = this.#fields.indexOf(field);
    const name = request.name === undefined ? field.name : normalizeResourceName(request.name);
    if (!name || (typeof name !== 'string' && !name.ok)) {
      throw new LoomTableClientError('validation', {
        message: 'The Field name is invalid.',
        httpStatus: 422,
        code: 'VALIDATION_FAILED',
      });
    }
    const config =
      request.config === undefined
        ? field.config
        : request.type === 'select' || request.type === 'multiSelect'
          ? {
              options: (
                request.config as { options: { id?: string; name: string; color: string }[] }
              ).options.map((option, optionIndex) => ({
                id: option.id ?? `option_${this.#fieldSequence}_${optionIndex}`,
                name: option.name,
                color: option.color,
              })),
              deletedOptions: [],
            }
          : structuredClone(request.config);
    const updated: Field = {
      ...field,
      name: typeof name === 'string' ? name : name.name,
      config,
      revision: field.revision + 1,
    } as Field;
    this.#fields[index] = updated;
    return updated;
  }

  async deleteField(fieldId: string, expectedRevision: number): Promise<void> {
    const field = this.#fields.find((candidate) => candidate.id === fieldId);
    if (field === undefined) {
      throw new LoomTableClientError('not-found', {
        message: 'The Field does not exist.',
        httpStatus: 404,
        code: 'NOT_FOUND',
      });
    }
    if (field.revision !== expectedRevision) {
      throw new LoomTableClientError('conflict', {
        message: 'The Field changed on the Server.',
        httpStatus: 409,
        code: 'CONFLICT',
      });
    }
    const index = this.#fields.indexOf(field);
    this.#fields[index] = {
      ...field,
      revision: field.revision + 1,
      deletedAt: new Date(1_800_000_000_000 + ++this.#clock * 1000).toISOString(),
    };
  }

  async restoreField(fieldId: string, expectedRevision: number): Promise<Field> {
    const field = this.#fields.find((candidate) => candidate.id === fieldId);
    if (field === undefined) {
      throw new LoomTableClientError('not-found', {
        message: 'The Field does not exist.',
        httpStatus: 404,
        code: 'NOT_FOUND',
      });
    }
    if (field.revision !== expectedRevision || field.deletedAt === undefined) {
      throw new LoomTableClientError('conflict', {
        message: 'The Field changed on the Server.',
        httpStatus: 409,
        code: 'CONFLICT',
      });
    }
    const index = this.#fields.indexOf(field);
    const restored: Field = { ...field, revision: field.revision + 1 };
    delete (restored as { deletedAt?: string }).deletedAt;
    this.#fields[index] = restored;
    return restored;
  }

  async query(request: QueryRequest): Promise<QueryResult> {
    this.queryRequests.push(request);
    const lifecycle = request.lifecycle ?? 'active';
    const records = this.#records.filter((record) => {
      if (record.tableId !== request.tableId) return false;
      if (lifecycle === 'all') return true;
      return lifecycle === 'deleted'
        ? record.deletedAt !== undefined
        : record.deletedAt === undefined;
    });
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
      ...(request.cursor === undefined
        ? {
            totalCount: records.length,
            unfilteredTotal: this.#records.filter(
              (record) => record.tableId === request.tableId && record.deletedAt === undefined,
            ).length,
          }
        : {}),
    };
  }

  async getRecord(recordId: string): Promise<LoomTableRecord> {
    const record = this.#records.find((candidate) => candidate.id === recordId);
    if (record === undefined) {
      throw new LoomTableClientError('not-found', {
        message: 'The Record does not exist.',
        httpStatus: 404,
        code: 'NOT_FOUND',
      });
    }
    return record;
  }

  async duplicateRecord(tableId: string, recordId: string): Promise<RecordOrderResult> {
    const source = this.#records.find(
      (record) => record.id === recordId && record.tableId === tableId,
    );
    if (source === undefined || source.deletedAt !== undefined) {
      throw new LoomTableClientError('not-found', {
        message: 'The Record does not exist.',
        httpStatus: 404,
        code: 'NOT_FOUND',
      });
    }
    this.#recordSequence += 1;
    const copy: LoomTableRecord = {
      ...source,
      id: `record_dup_${String(this.#recordSequence).padStart(2, '0')}`,
      revision: 1,
      values: { ...source.values },
      createdAt: new Date(1_800_000_000_000 + ++this.#clock * 1000).toISOString(),
      updatedAt: new Date(1_800_000_000_000 + ++this.#clock * 1000).toISOString(),
    };
    delete (copy as { deletedAt?: string }).deletedAt;
    this.#records.push(copy);
    return { record: copy, changeCursor: 'change_01' };
  }

  async moveRecord(
    tableId: string,
    recordId: string,
    request: { beforeRecordId?: string; afterRecordId?: string },
  ): Promise<RecordOrderResult> {
    const index = this.#records.findIndex(
      (record) => record.id === recordId && record.tableId === tableId,
    );
    const record = this.#records[index];
    if (record === undefined || record.deletedAt !== undefined) {
      throw new LoomTableClientError('not-found', {
        message: 'The Record does not exist.',
        httpStatus: 404,
        code: 'NOT_FOUND',
      });
    }
    this.#records.splice(index, 1);
    let target = this.#records.length;
    if (request.afterRecordId !== undefined) {
      const anchor = this.#records.findIndex(
        (candidate) => candidate.id === request.afterRecordId && candidate.tableId === tableId,
      );
      if (anchor >= 0) target = anchor + 1;
    } else if (request.beforeRecordId !== undefined) {
      const anchor = this.#records.findIndex(
        (candidate) => candidate.id === request.beforeRecordId && candidate.tableId === tableId,
      );
      if (anchor >= 0) target = anchor;
    }
    this.#records.splice(target, 0, record);
    return { record, changeCursor: 'change_01' };
  }

  async queryFieldValues(
    tableId: string,
    fieldId: string,
    request: DistinctValuesRequest = {},
  ): Promise<DistinctValuesPage> {
    this.fieldValueRequests.push({ tableId, fieldId, request });
    const field = this.#fields.find(
      (candidate) => candidate.id === fieldId && candidate.tableId === tableId,
    );
    if (field === undefined || field.deletedAt !== undefined) {
      throw new LoomTableClientError('not-found', {
        message: 'The Field does not exist.',
        httpStatus: 404,
        code: 'NOT_FOUND',
      });
    }
    if (field.type === 'location' || field.type === 'attachment') {
      throw new LoomTableClientError('validation', {
        message: 'Distinct values are unsupported for this Field type.',
        httpStatus: 422,
        code: 'UNSUPPORTED_FIELD_TYPE',
      });
    }
    const active = this.#records.filter(
      (record) => record.tableId === tableId && record.deletedAt === undefined,
    );
    const counts = new Map<string, { value: string | number | boolean; count: number }>();
    let emptyCount = 0;
    for (const record of active) {
      const raw = record.values[fieldId];
      const parts =
        field.type === 'multiSelect' && Array.isArray(raw)
          ? raw.filter((item): item is string => typeof item === 'string')
          : [raw];
      const present = parts.filter(
        (item): item is string | number | boolean =>
          typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean',
      );
      if (
        raw === undefined ||
        raw === null ||
        raw === '' ||
        (Array.isArray(raw) && present.length === 0)
      ) {
        emptyCount += 1;
        continue;
      }
      for (const item of present) {
        const key = `${typeof item}:${String(item)}`;
        const entry = counts.get(key);
        if (entry === undefined) counts.set(key, { value: item, count: 1 });
        else counts.set(key, { value: item, count: entry.count + 1 });
      }
    }
    const displayFor = (value: string | number | boolean): string | undefined => {
      if (field.type !== 'select' && field.type !== 'multiSelect') return undefined;
      return (
        field.config.options.find((option) => option.id === value)?.name ??
        field.config.deletedOptions.find((option) => option.id === value)?.name
      );
    };
    const rankFor = (value: string | number | boolean): number => {
      if (field.type !== 'select' && field.type !== 'multiSelect') return 0;
      const index = field.config.options.findIndex((option) => option.id === value);
      return index === -1 ? Number.MAX_SAFE_INTEGER : index;
    };
    let items: DistinctValue[] = [...counts.values()]
      .map((entry) => {
        const display = displayFor(entry.value);
        return {
          value: entry.value,
          count: entry.count,
          ...(display === undefined ? {} : { display }),
        };
      })
      .sort((a, b) => {
        const rank = rankFor(a.value) - rankFor(b.value);
        if (rank !== 0) return rank;
        if (typeof a.value === 'number' && typeof b.value === 'number') {
          return a.value - b.value;
        }
        return String(a.value).localeCompare(String(b.value));
      });
    const search = request.search?.trim().toLowerCase();
    if (search !== undefined && search !== '') {
      items = items.filter((item) =>
        (item.display ?? String(item.value)).toLowerCase().includes(search),
      );
    }
    const offset = decodeCursor(request.cursor);
    const limit = request.limit ?? 100;
    const page = items.slice(offset, offset + limit);
    const nextOffset = offset + page.length;
    const hasMore = nextOffset < items.length;
    return {
      items: page,
      emptyCount,
      hasMore,
      changeCursor: 'change_01',
      ...(hasMore ? { nextCursor: encodeCursor(nextOffset) } : {}),
    };
  }

  async aggregateRecords(tableId: string, request: AggregateRequest): Promise<AggregateResult> {
    this.aggregateRequests.push({ tableId, request });
    const active = this.#records.filter(
      (record) => record.tableId === tableId && record.deletedAt === undefined,
    );
    const results: Record<string, Record<string, number | string | null>> = {};
    for (const fieldId of request.fieldIds) {
      const field = this.#fields.find(
        (candidate) => candidate.id === fieldId && candidate.tableId === tableId,
      );
      const values = active
        .map((record) => record.values[fieldId])
        .filter(
          (value): value is Exclude<JsonValue, null | undefined> =>
            value !== undefined &&
            value !== null &&
            value !== '' &&
            !(Array.isArray(value) && value.length === 0),
        );
      const entry: Record<string, number | string | null> = {};
      for (const fn of request.fns) {
        entry[fn] = aggregateValue(fn, field, values);
      }
      results[fieldId] = entry;
    }
    return { results, changeCursor: 'change_01' };
  }

  async mutate(tableId: string, request: MutationRequest): Promise<MutationResult> {
    this.mutationRequests.push({ tableId, request });
    const replayed = this.#mutationResults.get(request.clientMutationId);
    if (replayed !== undefined) {
      const storedBody = JSON.stringify(replayed.request);
      if (storedBody !== JSON.stringify(request)) {
        throw new LoomTableClientError('conflict', {
          message: 'The client mutation ID was already used with a different request.',
          httpStatus: 409,
          code: 'IDEMPOTENCY_KEY_REUSED',
        });
      }
      return replayed.result;
    }
    const command = request.commands[0];
    const result = this.#applyMutation(tableId, request, command);
    this.#mutationResults.set(request.clientMutationId, { request, result });
    return result;
  }

  #applyMutation(
    tableId: string,
    request: MutationRequest,
    command: MutationRequest['commands'][number] | undefined,
  ): MutationResult {
    const stamp = () => new Date(1_800_000_000_000 + ++this.#clock * 1000).toISOString();
    if (command?.kind === 'createRecord') {
      this.#recordSequence += 1;
      const record: LoomTableRecord = {
        id: `record_new_${String(this.#recordSequence).padStart(2, '0')}`,
        tableId,
        revision: 1,
        values: { ...(command.values ?? {}) },
        createdAt: stamp(),
        updatedAt: stamp(),
      };
      this.#records.push(record);
      return {
        clientMutationId: request.clientMutationId,
        results: [{ index: 0, status: 'applied', record }],
        changeCursor: 'change_02',
      };
    }
    if (command === undefined) throw new Error('Missing mutation command.');
    const index = this.#records.findIndex((record) => record.id === command.recordId);
    const record = this.#records[index];
    if (record === undefined) {
      throw new LoomTableClientError('not-found', {
        message: 'The Record does not exist.',
        httpStatus: 404,
        code: 'NOT_FOUND',
      });
    }
    if (record.revision !== command.expectedRevision) {
      throw new LoomTableClientError(
        'conflict',
        {
          message: 'The Record changed on the Server.',
          httpStatus: 409,
          code: 'CONFLICT',
        },
        undefined,
        {
          clientMutationId: request.clientMutationId,
          failedCommandIndex: 0,
          conflicts: [
            {
              recordId: record.id,
              expectedRevision: command.expectedRevision,
              currentRevision: record.revision,
              currentValues: record.values,
            },
          ],
        },
      );
    }
    if (command.kind === 'updateRecord') {
      if (record.deletedAt !== undefined) {
        throw new LoomTableClientError('validation', {
          message: 'The Record is deleted.',
          httpStatus: 422,
          code: 'INVALID_STATE_TRANSITION',
        });
      }
      const values = { ...record.values, ...(command.set ?? {}) };
      for (const fieldId of command.unsetFieldIds ?? []) delete values[fieldId];
      const updated: LoomTableRecord = {
        ...record,
        revision: record.revision + 1,
        values,
        updatedAt: stamp(),
      };
      this.#records[index] = updated;
      return {
        clientMutationId: request.clientMutationId,
        results: [{ index: 0, status: 'applied', record: updated }],
        changeCursor: 'change_02',
      };
    }
    if (command.kind === 'deleteRecord') {
      if (record.deletedAt !== undefined) {
        throw new LoomTableClientError('validation', {
          message: 'The Record is already deleted.',
          httpStatus: 422,
          code: 'INVALID_STATE_TRANSITION',
        });
      }
      const deleted: LoomTableRecord = {
        ...record,
        revision: record.revision + 1,
        updatedAt: stamp(),
        deletedAt: stamp(),
      };
      this.#records[index] = deleted;
      return {
        clientMutationId: request.clientMutationId,
        results: [{ index: 0, status: 'applied', record: deleted }],
        changeCursor: 'change_02',
      };
    }
    if (command.kind === 'restoreRecord') {
      if (record.deletedAt === undefined) {
        throw new LoomTableClientError('validation', {
          message: 'The Record is not deleted.',
          httpStatus: 422,
          code: 'INVALID_STATE_TRANSITION',
        });
      }
      const restored: LoomTableRecord = {
        ...record,
        revision: record.revision + 1,
        updatedAt: stamp(),
      };
      delete (restored as { deletedAt?: string }).deletedAt;
      this.#records[index] = restored;
      return {
        clientMutationId: request.clientMutationId,
        results: [{ index: 0, status: 'applied', record: restored }],
        changeCursor: 'change_02',
      };
    }
    throw new Error(`Unsupported mutation kind.`);
  }

  async getMeta(): Promise<ServerMeta> {
    return IN_MEMORY_META;
  }

  async checkConnection(): Promise<ConnectionCheckResult> {
    return { kind: 'connected', meta: IN_MEMORY_META };
  }

  async pullChanges(): Promise<ChangePage> {
    return { items: [], nextCursor: 'change_02', hasMore: false };
  }

  readonly historyRequests: PullHistoryRequest[] = [];
  readonly historyPages: HistoryPage[] = [];
  readonly previewRequests: Array<{
    readonly fieldId: string;
    readonly type: Field['type'];
  }> = [];
  readonly conversionPreviews: ConversionPreview[] = [];
  readonly convertRequests: Array<{
    readonly fieldId: string;
    readonly request: ConvertFieldRequest;
  }> = [];
  readonly conversionResults: ConversionResult[] = [];

  async pullHistory(_tableId: string, request: PullHistoryRequest = {}): Promise<HistoryPage> {
    this.historyRequests.push(request);
    return (
      this.historyPages.shift() ?? {
        items: [],
        hasMore: false,
        changeCursor: 'change_02',
      }
    );
  }

  async previewFieldConversion(fieldId: string, type: Field['type']): Promise<ConversionPreview> {
    this.previewRequests.push({ fieldId, type });
    return (
      this.conversionPreviews.shift() ?? {
        supported: false,
        reason: 'Conversion is not supported.',
        totalRecords: 0,
      }
    );
  }

  async convertField(fieldId: string, request: ConvertFieldRequest): Promise<ConversionResult> {
    this.convertRequests.push({ fieldId, request });
    const queued = this.conversionResults.shift();
    if (queued !== undefined) return queued;
    const index = this.#fields.findIndex((field) => field.id === fieldId);
    if (index < 0) {
      throw new LoomTableClientError('not-found', {
        message: 'The Field does not exist.',
        httpStatus: 404,
        code: 'NOT_FOUND',
      });
    }
    const field = this.#fields[index]!;
    const updated = {
      ...field,
      type: request.type,
      revision: field.revision + 1,
      config: {},
    } as Field;
    this.#fields[index] = updated;
    return {
      field: updated,
      stats: { ok: 0, lossy: 0, lost: 0, empty: 0 },
    };
  }

  async summarizeMap(viewId: string): Promise<MapSummaryResult> {
    const view = this.#requireMapView(viewId);
    const located = this.#locatedRecords(view);
    return {
      summary: {
        matchedRecordCount: located.length,
        renderableRecordCount: located.length,
        unlocatedRecordCount: this.#records.length - located.length,
        unrenderableRecordCount: 0,
      },
      viewRevision: view.revision,
      changeCursor: 'change_01',
    };
  }

  async queryMap(viewId: string, request: MapQueryRequest): Promise<MapQueryResult> {
    const view = this.#requireMapView(viewId);
    const located = this.#locatedRecords(view);
    const features: MapFeature[] =
      request.zoom < 10 && located.length > 1
        ? [
            {
              kind: 'cluster',
              clusterId: 'cluster_inmemory',
              position: located[0]!.position,
              bounds: request.viewport,
              pointCount: located.length,
              recordsQueryToken: 'inmemory-cluster',
            } satisfies MapCluster,
          ]
        : located.map((entry): MapPoint => ({
            kind: 'point',
            recordId: entry.record.id,
            position: entry.position,
            primaryFieldText: entry.title,
          }));
    return {
      features,
      viewportRenderableRecordCount: located.length,
      viewRevision: view.revision,
      changeCursor: 'change_01',
    };
  }

  async queryMapClusterRecords(
    viewId: string,
    request: MapClusterRecordsQueryRequest,
  ): Promise<QueryResult> {
    const view = this.#requireMapView(viewId);
    const located = this.#locatedRecords(view).map((entry) => entry.record);
    const offset = decodeCursor(request.cursor);
    const limit = request.limit ?? 100;
    const items = located.slice(offset, offset + limit);
    const nextOffset = offset + items.length;
    const hasMore = nextOffset < located.length;
    return {
      items,
      hasMore,
      changeCursor: 'change_01',
      ...(hasMore ? { nextCursor: encodeCursor(nextOffset) } : {}),
      ...(request.cursor === undefined ? { totalCount: located.length } : {}),
    };
  }

  #requireMapView(viewId: string): Extract<View, { type: 'map' }> {
    const view = this.#views.find((candidate) => candidate.id === viewId);
    if (view === undefined || view.type !== 'map') {
      throw new LoomTableClientError('not-found', {
        message: 'The Map View does not exist.',
        httpStatus: 404,
        code: 'NOT_FOUND',
      });
    }
    return view;
  }

  #locatedRecords(
    view: Extract<View, { type: 'map' }>,
  ): Array<{ record: LoomTableRecord; position: { lat: number; lng: number }; title: string }> {
    const fieldId = view.config.locationFieldId;
    const primaryFieldId =
      this.#data.tables.find((table) => table.id === view.tableId)?.primaryFieldId ?? null;
    return this.#records.flatMap((record) => {
      if (record.tableId !== view.tableId || record.deletedAt !== undefined) return [];
      const location = record.values[fieldId] as LocationValue | undefined;
      if (
        location === null ||
        location === undefined ||
        typeof location !== 'object' ||
        typeof location.lat !== 'number' ||
        typeof location.lng !== 'number'
      ) {
        return [];
      }
      const titleValue = primaryFieldId === null ? null : record.values[primaryFieldId];
      const title = typeof titleValue === 'string' && titleValue !== '' ? titleValue : record.id;
      return [{ record, position: { lat: location.lat, lng: location.lng }, title }];
    });
  }

  async initializeAttachment(_request: InitializeAttachmentRequest): Promise<Attachment> {
    throw unsupported();
  }

  async getAttachment(_attachmentId: string): Promise<Attachment> {
    throw unsupported();
  }

  async deleteAttachment(_attachmentId: string, _expectedRevision: number): Promise<void> {
    throw unsupported();
  }

  async uploadAttachmentContent(_attachmentId: string, _bytes: ArrayBuffer): Promise<Attachment> {
    throw unsupported();
  }

  async downloadAttachmentContent(_attachmentId: string): Promise<AttachmentDownload> {
    throw unsupported();
  }
}

function aggregateValue(
  fn: AggregateFn,
  field: Field | undefined,
  values: readonly Exclude<JsonValue, null | undefined>[],
): number | string | null {
  if (fn === 'count') return values.length;
  if (field?.type === 'number') {
    const numbers = values.filter((value): value is number => typeof value === 'number');
    if (numbers.length === 0) return null;
    if (fn === 'sum') return numbers.reduce((total, value) => total + value, 0);
    if (fn === 'avg') return numbers.reduce((total, value) => total + value, 0) / numbers.length;
    if (fn === 'min') return Math.min(...numbers);
    if (fn === 'max') return Math.max(...numbers);
    return null;
  }
  if (field?.type === 'date') {
    const dates = values.filter((value): value is string => typeof value === 'string');
    if (dates.length === 0) return null;
    if (fn === 'min') return dates.reduce((a, b) => (a <= b ? a : b));
    if (fn === 'max') return dates.reduce((a, b) => (a >= b ? a : b));
    return null;
  }
  return null;
}

function unsupported(): LoomTableClientError {
  return new LoomTableClientError('capability', {
    message: 'The in-memory client does not manage attachment content.',
    httpStatus: 400,
    code: 'CAPABILITY_UNAVAILABLE',
  });
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
