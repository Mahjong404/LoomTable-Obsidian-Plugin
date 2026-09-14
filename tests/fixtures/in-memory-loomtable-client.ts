import {
  LoomTableClientError,
  normalizeResourceName,
  type Attachment,
  type AttachmentDownload,
  type Base,
  type ChangePage,
  type ConnectionCheckResult,
  type CreateFieldRequest,
  type CreateViewRequest,
  type Field,
  type InitializeAttachmentRequest,
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
  type QueryRequest,
  type QueryResult,
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
  'getView' | 'createView' | 'updateView' | 'deleteView' | 'restoreView'
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
      revision: view.revision + 1,
      updatedAt: new Date(1_800_000_000_000 + ++this.#clock * 1000).toISOString(),
    };
    delete (restored as { deletedAt?: string }).deletedAt;
    this.#views[index] = restored;
    return restored;
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
    this.#clock += 1;
    const stamp = new Date(1_800_000_000_000 + this.#clock * 1000).toISOString();
    const position =
      Math.max(0, ...this.#fields.filter((f) => f.tableId === tableId).map((f) => f.position)) + 1;
    const config =
      request.type === 'select' || request.type === 'multiSelect'
        ? {
            options: (
              request.config as { options: { id?: string; name: string; color: string }[] }
            ).options.map(
              (option, index) => ({
                id: option.id ?? `option_${this.#fieldSequence}_${index}`,
                name: option.name,
                color: option.color,
              }),
            ),
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
              options: (request.config as { options: { id?: string; name: string; color: string }[] })
                .options.map((option, optionIndex) => ({
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
      ...(request.cursor === undefined ? { totalCount: records.length } : {}),
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
