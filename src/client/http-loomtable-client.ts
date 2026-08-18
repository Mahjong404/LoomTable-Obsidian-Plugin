import type { components } from '../generated/transport';
import type { HttpTransport, HttpTransportRequest, HttpTransportResponse } from './http-transport';
import { normalizeServerOrigin } from './server-origin';
import {
  LOOMTABLE_API_VERSION,
  LoomTableClientError,
  type Attachment,
  type AttachmentDownload,
  type AttachmentFieldConfig,
  type AttachmentRef,
  type AttachmentSource,
  type AttachmentStatus,
  type Base,
  type Change,
  type ChangePage,
  type BootstrapState,
  type ConnectionCheckResult,
  type ConflictBody,
  type ConflictDetails,
  type DeletedSelectOption,
  type Field,
  type FilterNode,
  type GridViewConfig,
  type InitializeAttachmentRequest,
  type JsonValue,
  type LoomTableClient,
  type LoomTableClientErrorDetails,
  type LoomTableRecord,
  type MapClusterRecordsQueryRequest,
  type MapCoordinate,
  type MapFeature,
  type MapPoint,
  type MapQueryRequest,
  type MapQueryResult,
  type MapQuerySummary,
  type MapSummaryResult,
  type MapViewport,
  type MapViewportBox,
  type MapViewConfig,
  type MutationCommandResult,
  type MutationRequest,
  type MutationResult,
  type QueryRequest,
  type QueryResult,
  type PullChangesRequest,
  type ResourceListOptions,
  type SelectFieldConfig,
  type SelectOption,
  type SortSpec,
  type ServerIncompatibility,
  type ServerMeta,
  type Table,
  type UpdateViewRequest,
  type View,
  type Workspace,
} from './loomtable-client';

type TransportServerMeta = components['schemas']['ServerMeta'];
type TransportQueryRequest = components['schemas']['QueryRequest'];
type TransportMutationRequest = components['schemas']['MutationRequest'];
type TransportMapQueryRequest = components['schemas']['MapQueryRequest'];
type TransportMapClusterRecordsQueryRequest =
  components['schemas']['MapClusterRecordsQueryRequest'];
type TransportUpdateViewRequest = components['schemas']['UpdateViewRequest'];

export interface HttpLoomTableClientConfig {
  readonly serverOrigin: string;
  readonly pluginVersion: string;
  readonly accessToken: () => string | null;
}

export interface HttpLoomTableClientOptions {
  readonly requestTimeoutMs?: number;
  readonly delay?: (milliseconds: number) => Promise<void>;
  readonly random?: () => number;
}

interface JsonRequestOptions {
  readonly method?: HttpTransportRequest['method'];
  readonly query?: Readonly<Record<string, string | undefined>>;
  readonly body?: unknown;
  readonly headers?: Readonly<Record<string, string>>;
  readonly retryable?: boolean;
}

interface RawRequestOptions {
  readonly method?: HttpTransportRequest['method'];
  readonly query?: Readonly<Record<string, string | undefined>>;
  readonly body?: string | ArrayBuffer;
  readonly headers?: Readonly<Record<string, string>>;
  readonly retryable?: boolean;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_CHANGE_PAGE_LIMIT = 100;
const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 250;
const MAX_RETRY_AFTER_MS = 30_000;
const RETRYABLE_STATUSES = new Set([408, 429, 502, 503, 504]);
const RETENTION_VALUES = new Set(['30d', '90d', '365d', 'forever']);
const BOOTSTRAP_STATES = new Set(['required', 'complete', 'unknown']);
const ATTACHMENT_SOURCES = new Set(['managed', 'vault']);
const ATTACHMENT_STATUSES = new Set(['pending', 'ready']);
const MAX_RENDERABLE_LATITUDE = 85.0511287798066;
const EMPTY_FIELD_TYPES = new Set([
  'text',
  'longText',
  'number',
  'checkbox',
  'date',
  'url',
  'location',
]);
const FILTER_OPERATORS = new Set([
  'is',
  'isNot',
  'isEmpty',
  'isNotEmpty',
  'contains',
  'notContains',
  'startsWith',
  'endsWith',
  'greaterThan',
  'greaterOrEqual',
  'lessThan',
  'lessOrEqual',
  'includes',
  'excludes',
]);

export class HttpLoomTableClient implements LoomTableClient {
  readonly #serverOrigin: string;
  readonly #pluginVersion: string;
  readonly #accessToken: () => string | null;
  readonly #transport: HttpTransport;
  readonly #requestTimeoutMs: number;
  readonly #delay: (milliseconds: number) => Promise<void>;
  readonly #random: () => number;

  constructor(
    config: HttpLoomTableClientConfig,
    transport: HttpTransport,
    options: HttpLoomTableClientOptions = {},
  ) {
    this.#serverOrigin = normalizeServerOrigin(config.serverOrigin);
    this.#pluginVersion = config.pluginVersion;
    this.#accessToken = config.accessToken;
    this.#transport = transport;
    this.#requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.#delay = options.delay ?? delay;
    this.#random = options.random ?? Math.random;
  }

  async getMeta(): Promise<ServerMeta> {
    const value = await this.#requestJson('/v1/meta', null);
    return decodeServerMeta(value);
  }

  async checkConnection(): Promise<ConnectionCheckResult> {
    let meta: ServerMeta;
    try {
      meta = await this.getMeta();
    } catch (error) {
      return connectionFailure(error);
    }

    let incompatibility: ServerIncompatibility | null;
    try {
      incompatibility = determineIncompatibility(meta, this.#pluginVersion);
    } catch (error) {
      return { kind: 'server-error', meta, error: asClientError(error).details };
    }
    if (incompatibility !== null) {
      return { kind: 'incompatible', meta, reason: incompatibility };
    }

    let token: string;
    try {
      token = this.#accessToken()?.trim() ?? '';
    } catch {
      return { kind: 'authentication-required', meta };
    }
    if (token === '') {
      return { kind: 'authentication-required', meta };
    }

    try {
      await this.#requestJson('/v1/workspaces', token);
      return { kind: 'connected', meta };
    } catch (error) {
      const failure = asClientError(error);
      if (failure.kind === 'authentication') {
        return { kind: 'authentication-failed', meta, error: failure.details };
      }
      if (failure.kind === 'forbidden') {
        return { kind: 'forbidden', meta, error: failure.details };
      }
      if (failure.details.code === 'MIGRATION_REQUIRED') {
        return {
          kind: 'incompatible',
          meta,
          reason: { kind: 'migration-required' },
          error: failure.details,
        };
      }
      if (failure.kind === 'network' || failure.kind === 'timeout') {
        return { kind: 'unreachable', error: failure.details };
      }
      return { kind: 'server-error', meta, error: failure.details };
    }
  }

  async listWorkspaces(): Promise<readonly Workspace[]> {
    const value = await this.#requestJson('/v1/workspaces', this.#requireAccessToken());
    return decodeResourceList(value, decodeWorkspace, 'workspace');
  }

  async listBases(workspaceId: string): Promise<readonly Base[]> {
    const value = await this.#requestJson('/v1/bases', this.#requireAccessToken(), {
      query: { workspaceId },
    });
    return decodeResourceList(value, decodeBase, 'base');
  }

  async listTables(baseId: string, options: ResourceListOptions = {}): Promise<readonly Table[]> {
    const value = await this.#requestJson('/v1/tables', this.#requireAccessToken(), {
      query: {
        baseId,
        lifecycle: options.lifecycle,
      },
    });
    return decodeResourceList(value, decodeTable, 'table');
  }

  async listFields(tableId: string, options: ResourceListOptions = {}): Promise<readonly Field[]> {
    const value = await this.#requestJson(
      `/v1/tables/${encodeURIComponent(tableId)}/fields`,
      this.#requireAccessToken(),
      { query: { lifecycle: options.lifecycle } },
    );
    return decodeResourceList(value, decodeField, 'field');
  }

  async listViews(tableId: string, options: ResourceListOptions = {}): Promise<readonly View[]> {
    const value = await this.#requestJson(
      `/v1/tables/${encodeURIComponent(tableId)}/views`,
      this.#requireAccessToken(),
      { query: { lifecycle: options.lifecycle } },
    );
    return decodeResourceList(value, decodeView, 'view');
  }

  async query(request: QueryRequest): Promise<QueryResult> {
    const tableId = request.tableId.trim();
    if (tableId === '') {
      throw new LoomTableClientError('validation', {
        message: 'A Table ID is required to query Records.',
      });
    }
    const limit = request.limit ?? 100;
    if (!isPositiveInteger(limit) || limit > 500) {
      throw new LoomTableClientError('validation', {
        message: 'Record query limit must be an integer between 1 and 500.',
      });
    }

    const body: TransportQueryRequest = {
      limit,
      ...(request.viewId === undefined ? {} : { viewId: request.viewId }),
      ...(request.lifecycle === undefined ? {} : { lifecycle: request.lifecycle }),
      ...(request.cursor === undefined ? {} : { cursor: request.cursor }),
      ...(request.projection === undefined ? {} : { projection: [...request.projection] }),
      ...(request.filter === undefined ? {} : { filter: toTransportFilter(request.filter) }),
      ...(request.sort === undefined ? {} : { sort: request.sort.map((sort) => ({ ...sort })) }),
      ...(request.search === undefined ? {} : { search: request.search }),
    };
    const value = await this.#requestJson(
      `/v1/tables/${encodeURIComponent(tableId)}/records/query`,
      this.#requireAccessToken(),
      { method: 'POST', body, retryable: true },
    );
    return decodeQueryResult(value);
  }

  async pullChanges(
    tableId: string,
    request: PullChangesRequest = {},
  ): Promise<ChangePage> {
    const normalizedTableId = tableId.trim();
    if (normalizedTableId === '') {
      throw new LoomTableClientError('validation', {
        message: 'A Table ID is required to pull Changes.',
      });
    }
    const limit = request.limit ?? DEFAULT_CHANGE_PAGE_LIMIT;
    if (!isPositiveInteger(limit) || limit > 500) {
      throw new LoomTableClientError('validation', {
        message: 'Change page limit must be an integer between 1 and 500.',
      });
    }
    const value = await this.#requestJson(
      `/v1/tables/${encodeURIComponent(normalizedTableId)}/changes`,
      this.#requireAccessToken(),
      {
        query: {
          cursor: request.cursor,
          limit: String(limit),
        },
      },
    );
    return decodeChangePage(value);
  }

  async mutate(tableId: string, request: MutationRequest): Promise<MutationResult> {
    const normalizedTableId = tableId.trim();
    if (normalizedTableId === '') {
      throw new LoomTableClientError('validation', {
        message: 'A Table ID is required to mutate Records.',
      });
    }
    if (request.clientMutationId.trim() === '') {
      throw new LoomTableClientError('validation', {
        message: 'A clientMutationId is required to mutate Records.',
      });
    }
    if (request.commands.length < 1 || request.commands.length > 500) {
      throw new LoomTableClientError('validation', {
        message: 'A Record Mutation must contain between 1 and 500 commands.',
      });
    }

    const body = {
      clientMutationId: request.clientMutationId,
      commands: request.commands.map((command) => ({ ...command })),
    } as TransportMutationRequest;
    const value = await this.#requestJson(
      `/v1/tables/${encodeURIComponent(normalizedTableId)}/records/mutate`,
      this.#requireAccessToken(),
      { method: 'POST', body, retryable: true },
    );
    return decodeMutationResult(value);
  }

  async getRecord(recordId: string): Promise<LoomTableRecord> {
    const normalizedRecordId = recordId.trim();
    if (normalizedRecordId === '') {
      throw new LoomTableClientError('validation', {
        message: 'A Record ID is required to read a Record.',
      });
    }
    const value = await this.#requestJson(
      `/v1/records/${encodeURIComponent(normalizedRecordId)}`,
      this.#requireAccessToken(),
    );
    return decodeRecord(value);
  }

  async queryMap(viewId: string, request: MapQueryRequest): Promise<MapQueryResult> {
    const normalizedViewId = viewId.trim();
    if (normalizedViewId === '') {
      throw new LoomTableClientError('validation', {
        message: 'A View ID is required to query a Map.',
      });
    }
    validateMapQueryRequest(request);
    const body: TransportMapQueryRequest = {
      viewport: {
        boxes: request.viewport.boxes.map((box) => ({ ...box })),
      },
      zoom: request.zoom,
      pixelWidth: request.pixelWidth,
      pixelHeight: request.pixelHeight,
    };
    const value = await this.#requestJson(
      `/v1/views/${encodeURIComponent(normalizedViewId)}/map/query`,
      this.#requireAccessToken(),
      { method: 'POST', body, retryable: true },
    );
    return decodeMapQueryResult(value);
  }

  async summarizeMap(viewId: string): Promise<MapSummaryResult> {
    const normalizedViewId = viewId.trim();
    if (normalizedViewId === '') {
      throw new LoomTableClientError('validation', {
        message: 'A View ID is required to summarize a Map.',
      });
    }
    const value = await this.#requestJson(
      `/v1/views/${encodeURIComponent(normalizedViewId)}/map/summary`,
      this.#requireAccessToken(),
      { method: 'POST', retryable: true },
    );
    return decodeMapSummaryResult(value);
  }

  async queryMapClusterRecords(
    viewId: string,
    request: MapClusterRecordsQueryRequest,
  ): Promise<QueryResult> {
    const normalizedViewId = viewId.trim();
    const clusterToken = request.clusterToken.trim();
    if (normalizedViewId === '' || clusterToken === '') {
      throw new LoomTableClientError('validation', {
        message: 'A View ID and cluster token are required to read Cluster Records.',
      });
    }
    const limit = request.limit ?? 100;
    if (!isPositiveInteger(limit) || limit > 500) {
      throw new LoomTableClientError('validation', {
        message: 'Cluster Record query limit must be an integer between 1 and 500.',
      });
    }
    const body: TransportMapClusterRecordsQueryRequest = {
      clusterToken,
      limit,
      ...(request.cursor === undefined ? {} : { cursor: request.cursor }),
    };
    const value = await this.#requestJson(
      `/v1/views/${encodeURIComponent(normalizedViewId)}/map/cluster-records/query`,
      this.#requireAccessToken(),
      { method: 'POST', body, retryable: true },
    );
    return decodeQueryResult(value);
  }

  async updateView(viewId: string, request: UpdateViewRequest): Promise<View> {
    const normalizedViewId = viewId.trim();
    if (normalizedViewId === '') {
      throw new LoomTableClientError('validation', {
        message: 'A View ID is required to update a View.',
      });
    }
    if (!isPositiveInteger(request.expectedRevision)) {
      throw new LoomTableClientError('validation', {
        message: 'View expectedRevision must be a positive integer.',
      });
    }
    const body = { ...request } as TransportUpdateViewRequest;
    const value = await this.#requestJson(
      `/v1/views/${encodeURIComponent(normalizedViewId)}`,
      this.#requireAccessToken(),
      { method: 'PATCH', body, retryable: false },
    );
    return decodeView(value);
  }

  async initializeAttachment(
    request: InitializeAttachmentRequest,
    idempotencyKey: string,
  ): Promise<Attachment> {
    const normalizedIdempotencyKey = idempotencyKey.trim();
    if (normalizedIdempotencyKey === '') {
      throw new LoomTableClientError('validation', {
        message: 'An Idempotency-Key is required to initialize an Attachment.',
      });
    }
    const value = await this.#requestJson('/v1/attachments/init', this.#requireAccessToken(), {
      method: 'POST',
      body: request,
      headers: { 'Idempotency-Key': normalizedIdempotencyKey },
      retryable: true,
    });
    return decodeAttachment(value);
  }

  async getAttachment(attachmentId: string): Promise<Attachment> {
    const value = await this.#requestJson(
      '/v1/attachments/' + encodeURIComponent(attachmentId),
      this.#requireAccessToken(),
    );
    return decodeAttachment(value);
  }

  async deleteAttachment(attachmentId: string, expectedRevision: number): Promise<void> {
    if (!isPositiveInteger(expectedRevision)) {
      throw new LoomTableClientError('validation', {
        message: 'Attachment expectedRevision must be a positive integer.',
      });
    }
    await this.#request(
      '/v1/attachments/' + encodeURIComponent(attachmentId),
      this.#requireAccessToken(),
      {
        method: 'DELETE',
        query: { expectedRevision: String(expectedRevision) },
        retryable: false,
      },
    );
  }

  async uploadAttachmentContent(
    attachmentId: string,
    bytes: ArrayBuffer,
    contentType?: string,
  ): Promise<Attachment> {
    const response = await this.#request(
      '/v1/attachments/' + encodeURIComponent(attachmentId) + '/content',
      this.#requireAccessToken(),
      {
        method: 'PUT',
        body: bytes,
        headers: {
          'Content-Type': contentType?.trim() || 'application/octet-stream',
        },
        retryable: false,
      },
    );
    return decodeAttachment(decodeJsonResponse(response));
  }

  async downloadAttachmentContent(attachmentId: string): Promise<AttachmentDownload> {
    const response = await this.#request(
      '/v1/attachments/' + encodeURIComponent(attachmentId) + '/content',
      this.#requireAccessToken(),
      {
        method: 'GET',
        headers: { Accept: '*/*' },
      },
    );
    if (response.bytes === undefined) {
      throw new LoomTableClientError('invalid-response', {
        message: 'The LoomTable Server returned no Attachment content.',
        httpStatus: response.status,
      });
    }
    const contentType = getHeader(response.headers, 'content-type');
    return {
      bytes: response.bytes,
      ...(contentType === undefined ? {} : { contentType }),
    };
  }

  #requireAccessToken(): string {
    try {
      const token = this.#accessToken()?.trim() ?? '';
      if (token !== '') return token;
    } catch {
      // Treat an unavailable SecretStorage value as an authentication requirement.
    }
    throw new LoomTableClientError('authentication', {
      message: 'A LoomTable Server Token is required for this operation.',
    });
  }

  async #requestJson(
    path: string,
    token: string | null,
    options: JsonRequestOptions = {},
  ): Promise<unknown> {
    const body = options.body === undefined ? undefined : JSON.stringify(options.body);
    const response = await this.#request(path, token, {
      ...(options.method === undefined ? {} : { method: options.method }),
      ...(options.query === undefined ? {} : { query: options.query }),
      ...(body === undefined ? {} : { body }),
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...options.headers,
      },
      ...(options.retryable === undefined ? {} : { retryable: options.retryable }),
    });
    return decodeJsonResponse(response);
  }

  async #request(
    path: string,
    token: string | null,
    options: RawRequestOptions = {},
  ): Promise<HttpTransportResponse> {
    const method = options.method ?? 'GET';
    const retryable = options.retryable ?? method === 'GET';
    const headers = {
      Accept: 'application/json',
      ...(token === null ? {} : authenticatedHeaders(token)),
      ...options.headers,
    };
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      let response: HttpTransportResponse;
      try {
        response = await withTimeout(
          this.#transport({
            url: buildRequestUrl(this.#serverOrigin, path, options.query ?? {}),
            method,
            headers,
            ...(options.body === undefined ? {} : { body: options.body }),
          }),
          this.#requestTimeoutMs,
        );
      } catch (error) {
        if (retryable && attempt < MAX_ATTEMPTS - 1) {
          await this.#waitBeforeRetry(attempt);
          continue;
        }
        if (error instanceof RequestTimeoutError) {
          throw new LoomTableClientError(
            'timeout',
            { message: 'The LoomTable Server timed out.' },
            {
              cause: error,
            },
          );
        }
        throw new LoomTableClientError(
          'network',
          { message: 'The LoomTable Server could not be reached.' },
          { cause: error },
        );
      }

      const apiError = decodeApiError(response.body);
      if (
        retryable &&
        RETRYABLE_STATUSES.has(response.status) &&
        apiError?.code !== 'MIGRATION_REQUIRED' &&
        attempt < MAX_ATTEMPTS - 1
      ) {
        await this.#waitBeforeRetry(attempt, response.headers);
        continue;
      }

      if (response.status < 200 || response.status >= 300) {
        throw errorFromResponse(response.status, apiError);
      }
      return response;
    }

    throw new Error('Unreachable retry state.');
  }

  async #waitBeforeRetry(
    attempt: number,
    headers: Readonly<Record<string, string>> = {},
  ): Promise<void> {
    const retryAfter = parseRetryAfter(headers);
    const exponentialDelay = RETRY_BASE_DELAY_MS * 2 ** attempt;
    const jitteredDelay = exponentialDelay * (0.75 + this.#random() * 0.5);
    await this.#delay(retryAfter ?? jitteredDelay);
  }
}

function buildRequestUrl(
  serverOrigin: string,
  path: string,
  query: Readonly<Record<string, string | undefined>>,
): string {
  const url = new URL(`${serverOrigin}${path}`);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) url.searchParams.set(key, value);
  }
  return url.toString();
}

function decodeJsonResponse(response: HttpTransportResponse): unknown {
  try {
    return JSON.parse(response.body) as unknown;
  } catch (error) {
    throw new LoomTableClientError(
      'invalid-response',
      {
        message: 'The LoomTable Server returned an invalid JSON response.',
        httpStatus: response.status,
      },
      { cause: error },
    );
  }
}

function decodeResourceList<T>(
  value: unknown,
  decodeItem: (item: unknown) => T,
  resourceName: string,
): readonly T[] {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw invalidResourceList(resourceName);
  }
  try {
    return value.items.map(decodeItem);
  } catch (error) {
    if (error instanceof LoomTableClientError) throw error;
    throw invalidResourceList(resourceName, error);
  }
}

function decodeQueryResult(value: unknown): QueryResult {
  if (
    !isRecord(value) ||
    !Array.isArray(value.items) ||
    typeof value.hasMore !== 'boolean' ||
    typeof value.changeCursor !== 'string' ||
    !isOptionalString(value.nextCursor) ||
    !isOptionalNonNegativeInteger(value.totalCount) ||
    (value.hasMore && value.nextCursor === undefined) ||
    (!value.hasMore && value.nextCursor !== undefined)
  ) {
    throw invalidResource('query result');
  }

  try {
    const items = value.items.map(decodeRecord);
    return {
      items,
      hasMore: value.hasMore,
      changeCursor: value.changeCursor,
      ...(value.nextCursor === undefined ? {} : { nextCursor: value.nextCursor }),
      ...(value.totalCount === undefined ? {} : { totalCount: value.totalCount }),
    };
  } catch (error) {
    if (error instanceof LoomTableClientError) throw error;
    throw invalidResource('query result');
  }
}

function decodeChangePage(value: unknown): ChangePage {
  if (
    !isRecord(value) ||
    !Array.isArray(value.items) ||
    typeof value.nextCursor !== 'string' ||
    typeof value.hasMore !== 'boolean'
  ) {
    throw invalidResource('change page');
  }

  try {
    return {
      items: value.items.map(decodeChange),
      nextCursor: value.nextCursor,
      hasMore: value.hasMore,
    };
  } catch (error) {
    if (error instanceof LoomTableClientError) throw error;
    throw invalidResource('change page');
  }
}

function decodeChange(value: unknown): Change {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    !isChangeKind(value.kind) ||
    typeof value.tableId !== 'string' ||
    !isOptionalString(value.recordId) ||
    !isOptionalString(value.objectId) ||
    !isPositiveInteger(value.revision) ||
    !isOptionalString(value.actorId) ||
    typeof value.occurredAt !== 'string'
  ) {
    throw invalidResource('change');
  }
  return {
    id: value.id,
    kind: value.kind,
    tableId: value.tableId,
    revision: value.revision,
    occurredAt: value.occurredAt,
    ...(value.recordId === undefined ? {} : { recordId: value.recordId }),
    ...(value.objectId === undefined ? {} : { objectId: value.objectId }),
    ...(value.actorId === undefined ? {} : { actorId: value.actorId }),
  };
}

function isChangeKind(value: unknown): value is Change['kind'] {
  return (
    value === 'recordCreated' ||
    value === 'recordUpdated' ||
    value === 'recordDeleted' ||
    value === 'recordRestored' ||
    value === 'schemaChanged' ||
    value === 'viewChanged'
  );
}

function decodeMutationResult(value: unknown): MutationResult {
  if (
    !isRecord(value) ||
    typeof value.clientMutationId !== 'string' ||
    !Array.isArray(value.results) ||
    typeof value.changeCursor !== 'string'
  ) {
    throw invalidResource('mutation result');
  }

  try {
    const results: MutationCommandResult[] = value.results.map((item) => {
      if (
        !isRecord(item) ||
        !isNonNegativeInteger(item.index) ||
        (item.status !== 'applied' && item.status !== 'unchanged')
      ) {
        throw invalidResource('mutation command result');
      }
      return {
        index: item.index,
        status: item.status,
        record: decodeRecord(item.record),
      };
    });
    return {
      clientMutationId: value.clientMutationId,
      results,
      changeCursor: value.changeCursor,
    };
  } catch (error) {
    if (error instanceof LoomTableClientError) throw error;
    throw invalidResource('mutation result');
  }
}

function decodeMapQueryResult(value: unknown): MapQueryResult {
  if (
    !isRecord(value) ||
    !Array.isArray(value.features) ||
    value.features.length > 500 ||
    !isNonNegativeInteger(value.viewportRenderableRecordCount) ||
    !isPositiveInteger(value.viewRevision) ||
    typeof value.changeCursor !== 'string'
  ) {
    throw invalidResource('map query result');
  }

  const features: MapFeature[] = [];
  const pointIds = new Set<string>();
  const clusterIds = new Set<string>();
  let representedRecordCount = 0;
  for (const item of value.features) {
    const feature = decodeMapFeature(item);
    if (feature === null) throw invalidResource('map query result');
    if (feature.kind === 'point') {
      if (pointIds.has(feature.recordId)) throw invalidResource('map query result');
      pointIds.add(feature.recordId);
      representedRecordCount += 1;
    } else {
      if (clusterIds.has(feature.clusterId)) throw invalidResource('map query result');
      clusterIds.add(feature.clusterId);
      representedRecordCount += feature.pointCount;
    }
    features.push(feature);
  }
  if (representedRecordCount !== value.viewportRenderableRecordCount) {
    throw invalidResource('map query result');
  }
  return {
    features,
    viewportRenderableRecordCount: value.viewportRenderableRecordCount,
    viewRevision: value.viewRevision,
    changeCursor: value.changeCursor,
  };
}

function decodeMapSummaryResult(value: unknown): MapSummaryResult {
  if (
    !isRecord(value) ||
    !isPositiveInteger(value.viewRevision) ||
    typeof value.changeCursor !== 'string' ||
    !isRecord(value.summary)
  ) {
    throw invalidResource('map summary result');
  }
  const summary = decodeMapQuerySummary(value.summary);
  if (summary === null) throw invalidResource('map summary result');
  return {
    summary,
    viewRevision: value.viewRevision,
    changeCursor: value.changeCursor,
  };
}

function decodeMapQuerySummary(value: Record<string, unknown>): MapQuerySummary | null {
  if (
    !isNonNegativeInteger(value.matchedRecordCount) ||
    !isNonNegativeInteger(value.renderableRecordCount) ||
    !isNonNegativeInteger(value.unlocatedRecordCount) ||
    !isNonNegativeInteger(value.unrenderableRecordCount) ||
    value.matchedRecordCount !==
      value.renderableRecordCount + value.unlocatedRecordCount + value.unrenderableRecordCount
  ) {
    return null;
  }
  const dataBounds =
    value.dataBounds === undefined ? undefined : decodeMapViewport(value.dataBounds);
  if (value.dataBounds !== undefined && dataBounds === null) return null;
  return {
    matchedRecordCount: value.matchedRecordCount,
    renderableRecordCount: value.renderableRecordCount,
    unlocatedRecordCount: value.unlocatedRecordCount,
    unrenderableRecordCount: value.unrenderableRecordCount,
    ...(dataBounds === undefined || dataBounds === null ? {} : { dataBounds }),
  };
}

function decodeMapFeature(value: unknown): MapFeature | null {
  if (!isRecord(value) || typeof value.kind !== 'string') return null;
  const position = decodeMapCoordinate(value.position);
  if (position === null) return null;
  if (value.kind === 'point') {
    if (typeof value.recordId !== 'string' || typeof value.primaryFieldText !== 'string') {
      return null;
    }
    return {
      kind: 'point',
      recordId: value.recordId,
      position,
      primaryFieldText: value.primaryFieldText,
    } satisfies MapPoint;
  }
  if (
    value.kind !== 'cluster' ||
    typeof value.clusterId !== 'string' ||
    !isPositiveInteger(value.pointCount) ||
    value.pointCount < 2 ||
    typeof value.recordsQueryToken !== 'string'
  ) {
    return null;
  }
  const bounds = decodeMapViewport(value.bounds);
  if (bounds === null) return null;
  if (value.expansionZoom !== undefined && !isNonNegativeFiniteNumber(value.expansionZoom)) {
    return null;
  }
  return {
    kind: 'cluster',
    clusterId: value.clusterId,
    position,
    bounds,
    pointCount: value.pointCount,
    recordsQueryToken: value.recordsQueryToken,
    ...(value.expansionZoom === undefined ? {} : { expansionZoom: value.expansionZoom }),
  };
}

function decodeMapCoordinate(value: unknown): MapCoordinate | null {
  if (
    !isRecord(value) ||
    !isFiniteNumber(value.lat) ||
    !isFiniteNumber(value.lng) ||
    value.lat < -MAX_RENDERABLE_LATITUDE ||
    value.lat > MAX_RENDERABLE_LATITUDE ||
    value.lng < -180 ||
    value.lng > 180
  ) {
    return null;
  }
  return { lat: value.lat, lng: value.lng };
}

function decodeMapViewport(value: unknown): MapViewport | null {
  if (
    !isRecord(value) ||
    !Array.isArray(value.boxes) ||
    value.boxes.length < 1 ||
    value.boxes.length > 2
  ) {
    return null;
  }
  const boxes: MapViewportBox[] = [];
  for (const item of value.boxes) {
    if (
      !isRecord(item) ||
      !isFiniteNumber(item.west) ||
      !isFiniteNumber(item.south) ||
      !isFiniteNumber(item.east) ||
      !isFiniteNumber(item.north) ||
      item.west < -180 ||
      item.west > 180 ||
      item.east < -180 ||
      item.east > 180 ||
      item.south < -MAX_RENDERABLE_LATITUDE ||
      item.south > MAX_RENDERABLE_LATITUDE ||
      item.north < -MAX_RENDERABLE_LATITUDE ||
      item.north > MAX_RENDERABLE_LATITUDE ||
      item.west > item.east ||
      item.south > item.north
    ) {
      return null;
    }
    boxes.push({
      west: item.west,
      south: item.south,
      east: item.east,
      north: item.north,
    });
  }
  return { boxes };
}

function validateMapQueryRequest(request: MapQueryRequest): void {
  if (
    !isNonNegativeFiniteNumber(request.zoom) ||
    !isPositiveInteger(request.pixelWidth) ||
    !isPositiveInteger(request.pixelHeight) ||
    decodeMapViewport(request.viewport) === null
  ) {
    throw new LoomTableClientError('validation', {
      message: 'Map query viewport, zoom, and pixel dimensions are invalid.',
    });
  }
}

function decodeRecord(value: unknown): LoomTableRecord {
  if (!isRecord(value)) throw invalidResource('record');
  const values = decodeRecordValues(value.values);
  if (
    typeof value.id !== 'string' ||
    typeof value.tableId !== 'string' ||
    !isPositiveInteger(value.revision) ||
    values === null ||
    typeof value.createdAt !== 'string' ||
    typeof value.updatedAt !== 'string' ||
    !isOptionalString(value.deletedAt)
  ) {
    throw invalidResource('record');
  }
  return {
    id: value.id,
    tableId: value.tableId,
    revision: value.revision,
    values,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    ...(value.deletedAt === undefined ? {} : { deletedAt: value.deletedAt }),
  };
}

function decodeRecordValues(value: unknown): Readonly<Record<string, JsonValue>> | null {
  if (!isRecord(value)) return null;
  const values: Record<string, JsonValue> = {};
  for (const [fieldId, fieldValue] of Object.entries(value)) {
    if (!isJsonValue(fieldValue)) return null;
    values[fieldId] = fieldValue;
  }
  return values;
}

function toTransportFilter(value: FilterNode): components['schemas']['FilterNode'] {
  if (value.kind === 'group') {
    return {
      kind: 'group',
      operator: value.operator,
      children: value.children.map(toTransportFilter),
    };
  }
  return {
    kind: 'rule',
    fieldId: value.fieldId,
    operator: value.operator,
    ...(value.value === undefined ? {} : { value: value.value }),
  };
}

function decodeWorkspace(value: unknown): Workspace {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    !isPositiveInteger(value.revision) ||
    typeof value.createdAt !== 'string' ||
    typeof value.updatedAt !== 'string'
  ) {
    throw invalidResource('workspace');
  }
  return {
    id: value.id,
    name: value.name,
    revision: value.revision,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function decodeBase(value: unknown): Base {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.workspaceId !== 'string' ||
    typeof value.name !== 'string' ||
    !isPositiveInteger(value.revision) ||
    typeof value.createdAt !== 'string' ||
    typeof value.updatedAt !== 'string'
  ) {
    throw invalidResource('base');
  }
  return {
    id: value.id,
    workspaceId: value.workspaceId,
    name: value.name,
    revision: value.revision,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function decodeTable(value: unknown): Table {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.baseId !== 'string' ||
    typeof value.name !== 'string' ||
    typeof value.primaryFieldId !== 'string' ||
    !isPositiveInteger(value.revision) ||
    typeof value.createdAt !== 'string' ||
    typeof value.updatedAt !== 'string' ||
    !isOptionalString(value.deletedAt)
  ) {
    throw invalidResource('table');
  }
  return {
    id: value.id,
    baseId: value.baseId,
    name: value.name,
    primaryFieldId: value.primaryFieldId,
    revision: value.revision,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    ...(value.deletedAt === undefined ? {} : { deletedAt: value.deletedAt }),
  };
}

function decodeField(value: unknown): Field {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.tableId !== 'string' ||
    typeof value.name !== 'string' ||
    !isNonNegativeInteger(value.position) ||
    !isPositiveInteger(value.schemaVersion) ||
    !isPositiveInteger(value.revision) ||
    !isOptionalString(value.deletedAt) ||
    typeof value.type !== 'string' ||
    !isRecord(value.config)
  ) {
    throw invalidResource('field');
  }

  const base = {
    id: value.id,
    tableId: value.tableId,
    name: value.name,
    position: value.position,
    schemaVersion: value.schemaVersion,
    revision: value.revision,
    ...(value.deletedAt === undefined ? {} : { deletedAt: value.deletedAt }),
  };

  if (EMPTY_FIELD_TYPES.has(value.type)) {
    if (!isEmptyObject(value.config)) throw invalidResource('field');
    return { ...base, type: value.type, config: {} } as Field;
  }
  if (value.type === 'select' || value.type === 'multiSelect') {
    const config = decodeSelectFieldConfig(value.config);
    if (config === null) throw invalidResource('field');
    return { ...base, type: value.type, config };
  }
  if (value.type === 'attachment') {
    const config = decodeAttachmentFieldConfig(value.config);
    if (config === null) throw invalidResource('field');
    return { ...base, type: 'attachment', config };
  }
  throw invalidResource('field');
}

function decodeView(value: unknown): View {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.tableId !== 'string' ||
    typeof value.name !== 'string' ||
    !isPositiveInteger(value.revision) ||
    typeof value.createdAt !== 'string' ||
    typeof value.updatedAt !== 'string' ||
    !isOptionalString(value.deletedAt) ||
    typeof value.type !== 'string' ||
    !isRecord(value.config)
  ) {
    throw invalidResource('view');
  }

  const base = {
    id: value.id,
    tableId: value.tableId,
    name: value.name,
    revision: value.revision,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    ...(value.deletedAt === undefined ? {} : { deletedAt: value.deletedAt }),
  };

  if (value.type === 'grid') {
    const config = decodeGridViewConfig(value.config);
    if (config === null) throw invalidResource('view');
    return { ...base, type: 'grid', config };
  }
  if (value.type === 'map') {
    const config = decodeMapViewConfig(value.config);
    if (config === null) throw invalidResource('view');
    return { ...base, type: 'map', config };
  }
  throw invalidResource('view');
}

function decodeSelectFieldConfig(value: Record<string, unknown>): SelectFieldConfig | null {
  if (!Array.isArray(value.options) || !Array.isArray(value.deletedOptions)) return null;
  const options: SelectOption[] = [];
  for (const item of value.options) {
    const option = decodeSelectOption(item);
    if (option === null) return null;
    options.push(option);
  }
  const deletedOptions: DeletedSelectOption[] = [];
  for (const item of value.deletedOptions) {
    const option = decodeDeletedSelectOption(item);
    if (option === null) return null;
    deletedOptions.push(option);
  }
  return { options, deletedOptions };
}

function decodeSelectOption(value: unknown): SelectOption | null {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    typeof value.color !== 'string'
  ) {
    return null;
  }
  return { id: value.id, name: value.name, color: value.color };
}

function decodeDeletedSelectOption(value: unknown): DeletedSelectOption | null {
  if (!isRecord(value) || typeof value.deletedAt !== 'string') return null;
  const option = decodeSelectOption(value);
  return option === null ? null : { ...option, deletedAt: value.deletedAt };
}

function decodeAttachmentFieldConfig(value: Record<string, unknown>): AttachmentFieldConfig | null {
  const maxCount = value.maxCount ?? 10;
  return isPositiveInteger(maxCount) && maxCount <= 100 ? { maxCount } : null;
}

function decodeAttachment(value: unknown): Attachment {
  if (
    !isRecord(value) ||
    !isAttachmentStatus(value.status) ||
    !isPositiveInteger(value.revision) ||
    typeof value.createdAt !== 'string' ||
    typeof value.updatedAt !== 'string' ||
    !isOptionalString(value.deletedAt)
  ) {
    throw invalidResource('attachment');
  }
  const reference = decodeAttachmentRef(value);
  if (reference === null) throw invalidResource('attachment');
  return {
    ...reference,
    status: value.status,
    revision: value.revision,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    ...(value.deletedAt === undefined ? {} : { deletedAt: value.deletedAt }),
  };
}

function decodeAttachmentRef(value: unknown): AttachmentRef | null {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    !isAttachmentSource(value.source) ||
    typeof value.filename !== 'string' ||
    value.filename.length === 0 ||
    !isOptionalString(value.mimeType) ||
    !isOptionalNonNegativeInteger(value.size) ||
    !isOptionalString(value.storageKey) ||
    !isOptionalString(value.vaultPath) ||
    !isOptionalHash(value.hash) ||
    !isOptionalPositiveInteger(value.width) ||
    !isOptionalPositiveInteger(value.height)
  ) {
    return null;
  }
  return {
    id: value.id,
    source: value.source,
    filename: value.filename,
    ...(value.mimeType === undefined ? {} : { mimeType: value.mimeType }),
    ...(value.size === undefined ? {} : { size: value.size }),
    ...(value.storageKey === undefined ? {} : { storageKey: value.storageKey }),
    ...(value.vaultPath === undefined ? {} : { vaultPath: value.vaultPath }),
    ...(value.hash === undefined ? {} : { hash: value.hash }),
    ...(value.width === undefined ? {} : { width: value.width }),
    ...(value.height === undefined ? {} : { height: value.height }),
  };
}

function decodeGridViewConfig(value: Record<string, unknown>): GridViewConfig | null {
  if (
    !isStringArray(value.projection) ||
    !isStringArray(value.columnOrder) ||
    !isNumberRecord(value.columnWidths) ||
    !isStringArray(value.frozenFieldIds) ||
    !isRowHeight(value.rowHeight) ||
    !Array.isArray(value.sort)
  ) {
    return null;
  }
  const sort: SortSpec[] = [];
  for (const item of value.sort) {
    const decoded = decodeSortSpec(item);
    if (decoded === null) return null;
    sort.push(decoded);
  }
  const filter = value.filter === undefined ? undefined : decodeFilterNode(value.filter);
  if (value.filter !== undefined && filter === null) return null;
  return {
    projection: value.projection,
    columnOrder: value.columnOrder,
    columnWidths: value.columnWidths,
    frozenFieldIds: value.frozenFieldIds,
    rowHeight: value.rowHeight,
    ...(filter === undefined || filter === null ? {} : { filter }),
    sort,
  };
}

function decodeMapViewConfig(value: Record<string, unknown>): MapViewConfig | null {
  if (typeof value.locationFieldId !== 'string') return null;
  const filter = value.filter === undefined ? undefined : decodeFilterNode(value.filter);
  if (value.filter !== undefined && filter === null) return null;

  let center: MapViewConfig['center'];
  if (value.center !== undefined) {
    if (
      !isRecord(value.center) ||
      !isFiniteNumber(value.center.lat) ||
      !isFiniteNumber(value.center.lng) ||
      value.center.lat < -MAX_RENDERABLE_LATITUDE ||
      value.center.lat > MAX_RENDERABLE_LATITUDE ||
      value.center.lng < -180 ||
      value.center.lng > 180
    ) {
      return null;
    }
    center = { lat: value.center.lat, lng: value.center.lng };
  }
  if (
    (center === undefined) !== (value.zoom === undefined) ||
    (value.zoom !== undefined && !isNonNegativeFiniteNumber(value.zoom))
  ) {
    return null;
  }
  return {
    locationFieldId: value.locationFieldId,
    ...(filter === undefined || filter === null ? {} : { filter }),
    ...(center === undefined ? {} : { center }),
    ...(value.zoom === undefined ? {} : { zoom: value.zoom }),
  };
}

function decodeFilterNode(value: unknown): FilterNode | null {
  if (!isRecord(value) || typeof value.kind !== 'string') return null;
  if (value.kind === 'group') {
    if (
      (value.operator !== 'and' && value.operator !== 'or') ||
      !Array.isArray(value.children) ||
      value.children.length === 0
    ) {
      return null;
    }
    const children: FilterNode[] = [];
    for (const child of value.children) {
      const decoded = decodeFilterNode(child);
      if (decoded === null) return null;
      children.push(decoded);
    }
    return { kind: 'group', operator: value.operator, children };
  }
  if (
    value.kind !== 'rule' ||
    typeof value.fieldId !== 'string' ||
    typeof value.operator !== 'string' ||
    !FILTER_OPERATORS.has(value.operator) ||
    (value.value !== undefined && !isJsonValue(value.value))
  ) {
    return null;
  }
  return {
    kind: 'rule',
    fieldId: value.fieldId,
    operator: value.operator,
    ...(value.value === undefined ? {} : { value: value.value }),
  } as FilterNode;
}

function decodeSortSpec(value: unknown): SortSpec | null {
  if (
    !isRecord(value) ||
    typeof value.fieldId !== 'string' ||
    (value.direction !== 'asc' && value.direction !== 'desc') ||
    (value.nulls !== 'first' && value.nulls !== 'last')
  ) {
    return null;
  }
  return { fieldId: value.fieldId, direction: value.direction, nulls: value.nulls };
}

function invalidResourceList(resourceName: string, cause?: unknown): LoomTableClientError {
  return new LoomTableClientError(
    'invalid-response',
    { message: `The LoomTable Server returned an invalid ${resourceName} list response.` },
    cause === undefined ? undefined : { cause },
  );
}

function invalidResource(resourceName: string): LoomTableClientError {
  return new LoomTableClientError('invalid-response', {
    message: `The LoomTable Server returned an invalid ${resourceName}.`,
  });
}

function authenticatedHeaders(token: string): Readonly<Record<string, string>> {
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

function connectionFailure(error: unknown): ConnectionCheckResult {
  const failure = asClientError(error);
  if (failure.details.code === 'MIGRATION_REQUIRED') {
    return {
      kind: 'incompatible',
      reason: { kind: 'migration-required' },
      error: failure.details,
    };
  }
  if (failure.kind === 'network' || failure.kind === 'timeout') {
    return { kind: 'unreachable', error: failure.details };
  }
  return { kind: 'server-error', error: failure.details };
}

function asClientError(error: unknown): LoomTableClientError {
  if (error instanceof LoomTableClientError) return error;
  return new LoomTableClientError(
    'server',
    { message: 'An unexpected LoomTable connection error occurred.' },
    { cause: error },
  );
}

function determineIncompatibility(
  meta: ServerMeta,
  pluginVersion: string,
): ServerIncompatibility | null {
  if (meta.apiVersion !== LOOMTABLE_API_VERSION) {
    return {
      kind: 'api-version',
      expectedApiVersion: LOOMTABLE_API_VERSION,
      actualApiVersion: meta.apiVersion,
    };
  }
  if (meta.migrationRequired === true) {
    return { kind: 'migration-required' };
  }

  const comparison = compareSemver(pluginVersion, meta.minPluginVersion);
  if (comparison === null) {
    throw new LoomTableClientError('invalid-response', {
      message: 'The LoomTable Server returned an invalid minimum Plugin version.',
    });
  }
  if (comparison < 0) {
    return {
      kind: 'plugin-version',
      currentPluginVersion: pluginVersion,
      minimumPluginVersion: meta.minPluginVersion,
    };
  }
  return null;
}

function decodeServerMeta(value: unknown): ServerMeta {
  if (!isRecord(value)) {
    throw invalidMeta();
  }
  if (
    typeof value.serverVersion !== 'string' ||
    typeof value.apiVersion !== 'string' ||
    typeof value.minPluginVersion !== 'string' ||
    !isStringArray(value.capabilities) ||
    !isRetention(value.changeRetention) ||
    !isRetention(value.idempotencyRetention) ||
    typeof value.migrationRequired !== 'boolean' ||
    !isBootstrapState(value.bootstrapState)
  ) {
    throw invalidMeta();
  }

  const transportMeta: TransportServerMeta = {
    serverVersion: value.serverVersion,
    apiVersion: value.apiVersion,
    minPluginVersion: value.minPluginVersion,
    capabilities: value.capabilities,
    changeRetention: value.changeRetention,
    idempotencyRetention: value.idempotencyRetention,
    migrationRequired: value.migrationRequired,
    bootstrapState: value.bootstrapState,
  };
  return transportMeta;
}

function invalidMeta(): LoomTableClientError {
  return new LoomTableClientError('invalid-response', {
    message: 'The LoomTable Server returned invalid compatibility metadata.',
  });
}

interface ApiError {
  readonly code: string;
  readonly message: string;
  readonly requestId: string;
  readonly conflict?: ConflictDetails;
  readonly apiDetails?: Readonly<Record<string, unknown>>;
}

function decodeApiError(body: string): ApiError | null {
  try {
    const value: unknown = JSON.parse(body);
    if (!isRecord(value) || !isRecord(value.error)) return null;
    const error = value.error;
    if (
      typeof error.code !== 'string' ||
      typeof error.message !== 'string' ||
      typeof error.requestId !== 'string'
    ) {
      return null;
    }
    const conflict = decodeConflictDetails(error);
    const apiDetails = decodeApiErrorDetails(error.details);
    return {
      code: error.code,
      message: error.message,
      requestId: error.requestId,
      ...(conflict === undefined ? {} : { conflict }),
      ...(apiDetails === undefined ? {} : { apiDetails }),
    };
  } catch {
    return null;
  }
}

function errorFromResponse(status: number, apiError: ApiError | null): LoomTableClientError {
  const details: LoomTableClientErrorDetails = {
    message: apiError?.message ?? `The LoomTable Server returned HTTP ${status}.`,
    httpStatus: status,
    ...(apiError === null ? {} : { code: apiError.code, requestId: apiError.requestId }),
    ...(apiError?.apiDetails === undefined ? {} : { apiDetails: apiError.apiDetails }),
  };
  if (status === 401) return new LoomTableClientError('authentication', details);
  if (status === 403) return new LoomTableClientError('forbidden', details);
  if (status === 404) return new LoomTableClientError('not-found', details);
  if (status === 409) {
    return new LoomTableClientError('conflict', details, undefined, apiError?.conflict);
  }
  if (status === 501) return new LoomTableClientError('capability', details);
  if (
    status === 410 &&
    (apiError?.code === 'CURSOR_EXPIRED' || apiError?.code === 'QUERY_SNAPSHOT_EXPIRED')
  ) {
    return new LoomTableClientError('cursor-expired', details);
  }
  if (status === 400 || status === 422) return new LoomTableClientError('validation', details);
  return new LoomTableClientError('server', details);
}

function decodeConflictDetails(value: Record<string, unknown>): ConflictDetails | undefined {
  if (
    value.code !== 'CONFLICT' ||
    typeof value.clientMutationId !== 'string' ||
    !isNonNegativeInteger(value.failedCommandIndex) ||
    !Array.isArray(value.conflicts)
  ) {
    return undefined;
  }
  const conflicts: ConflictBody[] = [];
  for (const item of value.conflicts) {
    if (!isRecord(item)) return undefined;
    const currentValues = decodeRecordValues(item.currentValues);
    const submittedSet =
      item.submittedSet === undefined ? undefined : decodeRecordValues(item.submittedSet);
    if (
      typeof item.recordId !== 'string' ||
      !isPositiveInteger(item.expectedRevision) ||
      !isPositiveInteger(item.currentRevision) ||
      currentValues === null ||
      (item.submittedSet !== undefined && submittedSet === null) ||
      (item.submittedUnsetFieldIds !== undefined && !isStringArray(item.submittedUnsetFieldIds))
    ) {
      return undefined;
    }
    conflicts.push({
      recordId: item.recordId,
      expectedRevision: item.expectedRevision,
      currentRevision: item.currentRevision,
      currentValues,
      ...(submittedSet === undefined || submittedSet === null ? {} : { submittedSet }),
      ...(item.submittedUnsetFieldIds === undefined
        ? {}
        : { submittedUnsetFieldIds: item.submittedUnsetFieldIds }),
    });
  }
  return {
    clientMutationId: value.clientMutationId,
    failedCommandIndex: value.failedCommandIndex,
    conflicts,
  };
}

function decodeApiErrorDetails(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return isRecord(value) ? { ...value } : undefined;
}

function getHeader(headers: Readonly<Record<string, string>>, name: string): string | undefined {
  const value = Object.entries(headers).find(
    ([headerName]) => headerName.toLowerCase() === name.toLowerCase(),
  )?.[1];
  const normalized = value?.trim();
  return normalized === undefined || normalized === '' ? undefined : normalized;
}

function parseRetryAfter(headers: Readonly<Record<string, string>>): number | null {
  const value = Object.entries(headers).find(([name]) => name.toLowerCase() === 'retry-after')?.[1];
  if (value === undefined) return null;

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1_000, MAX_RETRY_AFTER_MS);
  }

  const date = Date.parse(value);
  if (Number.isNaN(date)) return null;
  return Math.min(Math.max(0, date - Date.now()), MAX_RETRY_AFTER_MS);
}

class RequestTimeoutError extends Error {}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = window.setTimeout(
      () => reject(new RequestTimeoutError('Request timed out.')),
      timeoutMs,
    );
    promise.then(
      (value) => {
        window.clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        window.clearTimeout(timeout);
        reject(error instanceof Error ? error : new Error('HTTP transport failed.'));
      },
    );
  });
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

interface ParsedSemver {
  readonly core: readonly [number, number, number];
  readonly prerelease: readonly string[];
}

function compareSemver(left: string, right: string): number | null {
  const leftVersion = parseSemver(left);
  const rightVersion = parseSemver(right);
  if (leftVersion === null || rightVersion === null) return null;

  for (const index of [0, 1, 2] as const) {
    const difference = leftVersion.core[index] - rightVersion.core[index];
    if (difference !== 0) return Math.sign(difference);
  }

  if (leftVersion.prerelease.length === 0 && rightVersion.prerelease.length === 0) return 0;
  if (leftVersion.prerelease.length === 0) return 1;
  if (rightVersion.prerelease.length === 0) return -1;

  const length = Math.max(leftVersion.prerelease.length, rightVersion.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftIdentifier = leftVersion.prerelease[index];
    const rightIdentifier = rightVersion.prerelease[index];
    if (leftIdentifier === undefined) return -1;
    if (rightIdentifier === undefined) return 1;
    if (leftIdentifier === rightIdentifier) continue;

    const leftNumber = numericIdentifier(leftIdentifier);
    const rightNumber = numericIdentifier(rightIdentifier);
    if (leftNumber !== null && rightNumber !== null) return Math.sign(leftNumber - rightNumber);
    if (leftNumber !== null) return -1;
    if (rightNumber !== null) return 1;
    return leftIdentifier < rightIdentifier ? -1 : 1;
  }
  return 0;
}

function parseSemver(value: string): ParsedSemver | null {
  const match =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u.exec(
      value,
    );
  if (
    match === null ||
    match[1] === undefined ||
    match[2] === undefined ||
    match[3] === undefined
  ) {
    return null;
  }
  const prerelease = match[4]?.split('.') ?? [];
  if (prerelease.some((identifier) => /^\d+$/u.test(identifier) && /^0\d+/u.test(identifier))) {
    return null;
  }
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease,
  };
}

function numericIdentifier(value: string): number | null {
  return /^\d+$/u.test(value) ? Number(value) : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isNumberRecord(value: unknown): value is Record<string, number> {
  return isRecord(value) && Object.values(value).every(isFiniteNumber);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}

function isOptionalNonNegativeInteger(value: unknown): value is number | undefined {
  return value === undefined || isNonNegativeInteger(value);
}

function isOptionalPositiveInteger(value: unknown): value is number | undefined {
  return value === undefined || isPositiveInteger(value);
}

function isOptionalHash(value: unknown): value is string | undefined {
  return value === undefined || (typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value));
}

function isEmptyObject(value: Record<string, unknown>): value is Record<string, never> {
  return Object.keys(value).length === 0;
}

function isRowHeight(value: unknown): value is GridViewConfig['rowHeight'] {
  return value === 'compact' || value === 'standard' || value === 'comfortable';
}

function isJsonValue(value: unknown): value is import('./loomtable-client').JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isRecord(value) && Object.values(value).every(isJsonValue);
}

function isRetention(value: unknown): value is TransportServerMeta['changeRetention'] {
  return typeof value === 'string' && RETENTION_VALUES.has(value);
}

function isBootstrapState(value: unknown): value is BootstrapState {
  return typeof value === 'string' && BOOTSTRAP_STATES.has(value);
}

function isAttachmentSource(value: unknown): value is AttachmentSource {
  return typeof value === 'string' && ATTACHMENT_SOURCES.has(value);
}

function isAttachmentStatus(value: unknown): value is AttachmentStatus {
  return typeof value === 'string' && ATTACHMENT_STATUSES.has(value);
}
