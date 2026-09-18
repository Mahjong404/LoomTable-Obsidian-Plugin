export const LOOMTABLE_API_VERSION = 'v1' as const;

export type BootstrapState = 'required' | 'complete' | 'unknown';

export interface ServerMeta {
  readonly serverVersion: string;
  readonly apiVersion: string;
  readonly minPluginVersion: string;
  readonly capabilities: readonly string[];
  readonly changeRetention: '30d' | '90d' | '365d' | 'forever';
  readonly idempotencyRetention: '30d' | '90d' | '365d' | 'forever';
  readonly migrationRequired: boolean;
  readonly bootstrapState: BootstrapState;
}

export type LoomTableClientErrorKind =
  | 'authentication'
  | 'capability'
  | 'conflict'
  | 'cursor-expired'
  | 'forbidden'
  | 'invalid-response'
  | 'network'
  | 'not-found'
  | 'server'
  | 'timeout'
  | 'validation';

export type LoomTableApiErrorDetails = Readonly<Record<string, unknown>>;

export interface LoomTableClientErrorDetails {
  readonly message: string;
  readonly code?: string;
  readonly httpStatus?: number;
  readonly requestId?: string;
  /** A bounded server hint for the durable mutation scheduler. */
  readonly retryAfterMs?: number;
  readonly apiDetails?: LoomTableApiErrorDetails;
}

export class LoomTableClientError extends Error {
  constructor(
    readonly kind: LoomTableClientErrorKind,
    readonly details: LoomTableClientErrorDetails,
    options?: ErrorOptions,
    readonly conflict?: ConflictDetails,
  ) {
    super(details.message, options);
    this.name = 'LoomTableClientError';
  }
}

export type ServerIncompatibility =
  | {
      readonly kind: 'api-version';
      readonly expectedApiVersion: typeof LOOMTABLE_API_VERSION;
      readonly actualApiVersion: string;
    }
  | {
      readonly kind: 'plugin-version';
      readonly currentPluginVersion: string;
      readonly minimumPluginVersion: string;
    }
  | { readonly kind: 'migration-required' };

export type ConnectionCheckResult =
  | { readonly kind: 'connected'; readonly meta: ServerMeta }
  | { readonly kind: 'authentication-required'; readonly meta: ServerMeta }
  | {
      readonly kind: 'authentication-failed';
      readonly meta: ServerMeta;
      readonly error: LoomTableClientErrorDetails;
    }
  | {
      readonly kind: 'forbidden';
      readonly meta: ServerMeta;
      readonly error: LoomTableClientErrorDetails;
    }
  | {
      readonly kind: 'incompatible';
      readonly meta?: ServerMeta;
      readonly reason: ServerIncompatibility;
      readonly error?: LoomTableClientErrorDetails;
    }
  | { readonly kind: 'unreachable'; readonly error: LoomTableClientErrorDetails }
  | {
      readonly kind: 'server-error';
      readonly error: LoomTableClientErrorDetails;
      readonly meta?: ServerMeta;
    };

export type LifecycleScope = 'active' | 'deleted' | 'all';

export interface ResourceListOptions {
  readonly lifecycle?: LifecycleScope;
}

export interface Workspace {
  readonly id: string;
  readonly name: string;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface Base {
  readonly id: string;
  readonly workspaceId: string;
  readonly name: string;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface Table {
  readonly id: string;
  readonly baseId: string;
  readonly name: string;
  readonly primaryFieldId: string;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly deletedAt?: string;
}

export interface FieldBase {
  readonly id: string;
  readonly tableId: string;
  readonly name: string;
  readonly position: number;
  readonly schemaVersion: number;
  readonly revision: number;
  readonly description?: string;
  readonly deletedAt?: string;
}

export interface SelectOption {
  readonly id: string;
  readonly name: string;
  readonly color: string;
}

export interface DeletedSelectOption extends SelectOption {
  readonly deletedAt: string;
}

export interface SelectFieldConfig {
  readonly options: readonly SelectOption[];
  readonly deletedOptions: readonly DeletedSelectOption[];
}

export type AttachmentSource = 'managed' | 'vault';
export type AttachmentStatus = 'pending' | 'ready';

export interface AttachmentRef {
  readonly id: string;
  readonly source: AttachmentSource;
  readonly filename: string;
  readonly mimeType?: string;
  readonly size?: number;
  readonly storageKey?: string;
  readonly vaultPath?: string;
  readonly hash?: string;
  readonly width?: number;
  readonly height?: number;
}

export interface Attachment extends AttachmentRef {
  readonly status: AttachmentStatus;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly deletedAt?: string;
}

export interface AttachmentFieldConfig {
  readonly maxCount: number;
}

export interface InitializeAttachmentRequest {
  readonly source: AttachmentSource;
  readonly filename: string;
  readonly mimeType?: string;
  readonly size?: number;
  readonly vaultPath?: string;
}

export interface AttachmentDownload {
  readonly bytes: ArrayBuffer;
  readonly contentType?: string;
}

export type EmptyFieldType =
  'text' | 'longText' | 'number' | 'checkbox' | 'date' | 'url' | 'location';

export type LocationPrecision = 'exact' | 'rooftop' | 'approximate';

export type LocationValue = Readonly<{
  label?: string;
  address?: string;
  provider?: string;
  lat?: number;
  lng?: number;
  precision?: LocationPrecision;
}>;

export type Field =
  | (FieldBase & {
      readonly type: EmptyFieldType;
      readonly config: Readonly<Record<string, never>>;
    })
  | (FieldBase & {
      readonly type: 'select' | 'multiSelect';
      readonly config: SelectFieldConfig;
    })
  | (FieldBase & {
      readonly type: 'attachment';
      readonly config: AttachmentFieldConfig;
    });

export type SelectOptionColor =
  'gray' | 'red' | 'orange' | 'yellow' | 'green' | 'cyan' | 'blue' | 'purple' | 'pink';

export interface SelectOptionInput {
  readonly id?: string;
  readonly name: string;
  readonly color: SelectOptionColor;
}

export interface SelectFieldConfigInput {
  readonly options: readonly SelectOptionInput[];
}

export type FieldConfigInput =
  Readonly<Record<string, never>> | SelectFieldConfigInput | AttachmentFieldConfig;

export interface CreateFieldRequest {
  readonly name: string;
  readonly type: Field['type'];
  readonly config: FieldConfigInput;
  readonly description?: string;
}

export interface UpdateFieldRequest {
  readonly type: Field['type'];
  readonly expectedRevision: number;
  readonly name?: string;
  readonly config?: FieldConfigInput;
  readonly description?: string | null;
}

export type JsonValue =
  null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export type FilterOperator =
  | 'is'
  | 'isNot'
  | 'isEmpty'
  | 'isNotEmpty'
  | 'contains'
  | 'notContains'
  | 'startsWith'
  | 'endsWith'
  | 'greaterThan'
  | 'greaterOrEqual'
  | 'lessThan'
  | 'lessOrEqual'
  | 'includes'
  | 'excludes';

export type FilterNode = FilterGroup | FilterRule;

export interface FilterGroup {
  readonly kind: 'group';
  readonly operator: 'and' | 'or';
  readonly children: readonly FilterNode[];
}

export interface FilterRule {
  readonly kind: 'rule';
  readonly fieldId: string;
  readonly operator: FilterOperator;
  readonly value?: JsonValue;
}

export interface SortSpec {
  readonly fieldId: string;
  readonly direction: 'asc' | 'desc';
  readonly nulls: 'first' | 'last';
}

export interface GridViewConfig {
  readonly projection: readonly string[];
  readonly columnOrder: readonly string[];
  readonly columnWidths: Readonly<Record<string, number>>;
  readonly frozenFieldIds: readonly string[];
  readonly rowHeight: 'compact' | 'standard' | 'comfortable';
  readonly filter?: FilterNode;
  readonly sort: readonly SortSpec[];
  readonly manualSort?: boolean;
}

export interface QueryRequest {
  readonly tableId: string;
  readonly viewId?: string;
  readonly lifecycle?: LifecycleScope;
  readonly cursor?: string;
  readonly limit?: number;
  readonly projection?: readonly string[];
  readonly filter?: FilterNode;
  readonly sort?: readonly SortSpec[];
  readonly search?: string;
}

export interface LoomTableRecord {
  readonly id: string;
  readonly tableId: string;
  readonly revision: number;
  readonly values: Readonly<Record<string, JsonValue>>;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly deletedAt?: string;
}

export interface QueryResult {
  readonly items: readonly LoomTableRecord[];
  readonly nextCursor?: string;
  readonly hasMore: boolean;
  readonly changeCursor: string;
  readonly totalCount?: number;
  readonly unfilteredTotal?: number;
}

export interface RecordOrderResult {
  readonly record: LoomTableRecord;
  readonly changeCursor: string;
}

export interface DistinctValue {
  readonly value: string | number | boolean;
  readonly display?: string;
  readonly count: number;
}

export interface DistinctValuesPage {
  readonly items: readonly DistinctValue[];
  readonly emptyCount: number;
  readonly nextCursor?: string;
  readonly hasMore: boolean;
  readonly changeCursor: string;
}

export interface DistinctValuesRequest {
  readonly filter?: FilterNode;
  readonly search?: string;
  readonly cursor?: string;
  readonly limit?: number;
}

export type AggregateFn = 'count' | 'sum' | 'avg' | 'min' | 'max';

export interface AggregateRequest {
  readonly filter?: FilterNode;
  readonly fieldIds: readonly string[];
  readonly fns: readonly AggregateFn[];
}

export type AggregateValue = number | string | null;

export interface AggregateResult {
  readonly results: Readonly<Record<string, Readonly<Record<string, AggregateValue>>>>;
  readonly changeCursor: string;
}

export type ChangeKind =
  | 'recordCreated'
  | 'recordUpdated'
  | 'recordDeleted'
  | 'recordRestored'
  | 'recordMoved'
  | 'schemaChanged'
  | 'viewChanged';

export interface FieldChange {
  readonly fieldId: string;
  readonly before?: JsonValue;
  readonly after?: JsonValue;
}

export interface Change {
  readonly id: string;
  readonly kind: ChangeKind;
  readonly tableId: string;
  readonly recordId?: string;
  readonly objectId?: string;
  readonly revision: number;
  readonly actorId?: string;
  readonly occurredAt: string;
  readonly fields?: readonly FieldChange[];
  readonly primaryFieldText?: string;
}

export interface PullHistoryRequest {
  readonly recordId?: string;
  readonly kind?: ChangeKind;
  readonly fieldId?: string;
  readonly actorId?: string;
  readonly since?: string;
  readonly until?: string;
  readonly cursor?: string;
  readonly limit?: number;
}

export interface HistoryPage {
  readonly items: readonly Change[];
  readonly nextCursor?: string;
  readonly hasMore: boolean;
  readonly changeCursor: string;
}

export interface ConversionModeStats {
  readonly ok: number;
  readonly lossy: number;
  readonly lost: number;
  readonly empty: number;
  readonly distinctValues?: number;
  readonly newOptions?: number;
}

export interface ConversionMode {
  readonly id: string;
  readonly label: string;
  readonly disabled?: boolean;
  readonly reason?: string;
  readonly stats: ConversionModeStats;
}

export interface ConversionPreview {
  readonly supported: boolean;
  readonly reason?: string;
  readonly totalRecords: number;
  readonly modes?: readonly ConversionMode[];
  readonly previewToken?: string;
}

export interface ConvertFieldRequest {
  readonly type: Field['type'];
  readonly mode: string;
  readonly expectedRevision: number;
  readonly previewToken: string;
}

export interface ConversionResult {
  readonly field: Field;
  readonly stats: ConversionModeStats;
}

export interface PullChangesRequest {
  readonly cursor?: string;
  readonly limit?: number;
}

export interface ChangePage {
  readonly items: readonly Change[];
  readonly nextCursor: string;
  readonly hasMore: boolean;
}

export type MutationValue = JsonValue;

export interface CreateRecordCommand {
  readonly kind: 'createRecord';
  readonly values: Readonly<Record<string, MutationValue>>;
}

export interface UpdateRecordCommand {
  readonly kind: 'updateRecord';
  readonly recordId: string;
  readonly expectedRevision: number;
  readonly set?: Readonly<Record<string, MutationValue>>;
  readonly unsetFieldIds?: readonly string[];
}

export interface DeleteRecordCommand {
  readonly kind: 'deleteRecord';
  readonly recordId: string;
  readonly expectedRevision: number;
}

export interface RestoreRecordCommand {
  readonly kind: 'restoreRecord';
  readonly recordId: string;
  readonly expectedRevision: number;
}

export type MutationCommand =
  CreateRecordCommand | UpdateRecordCommand | DeleteRecordCommand | RestoreRecordCommand;

export interface MutationRequest {
  readonly clientMutationId: string;
  readonly commands: readonly MutationCommand[];
}

export interface MutationCommandResult {
  readonly index: number;
  readonly status: 'applied' | 'unchanged';
  readonly record: LoomTableRecord;
}

export interface MutationResult {
  readonly clientMutationId: string;
  readonly results: readonly MutationCommandResult[];
  readonly changeCursor: string;
}

export interface ConflictBody {
  readonly recordId: string;
  readonly expectedRevision: number;
  readonly currentRevision: number;
  readonly currentValues: Readonly<Record<string, MutationValue>>;
  readonly submittedSet?: Readonly<Record<string, MutationValue>>;
  readonly submittedUnsetFieldIds?: readonly string[];
}

export interface ConflictDetails {
  readonly clientMutationId: string;
  readonly failedCommandIndex: number;
  readonly conflicts: readonly ConflictBody[];
}

export interface MapViewConfig {
  readonly locationFieldId: string;
  readonly filter?: FilterNode;
  readonly center?: {
    readonly lat: number;
    readonly lng: number;
  };
  readonly zoom?: number;
}

export interface MapCoordinate {
  readonly lat: number;
  readonly lng: number;
}

export interface MapViewportBox {
  readonly west: number;
  readonly south: number;
  readonly east: number;
  readonly north: number;
}

export interface MapViewport {
  readonly boxes: readonly MapViewportBox[];
}

export interface MapQueryRequest {
  readonly viewport: MapViewport;
  readonly zoom: number;
  readonly pixelWidth: number;
  readonly pixelHeight: number;
}

export interface MapPoint {
  readonly kind: 'point';
  readonly recordId: string;
  readonly position: MapCoordinate;
  readonly primaryFieldText: string;
}

export interface MapCluster {
  readonly kind: 'cluster';
  readonly clusterId: string;
  readonly position: MapCoordinate;
  readonly bounds: MapViewport;
  readonly pointCount: number;
  readonly expansionZoom?: number;
  readonly recordsQueryToken: string;
}

export type MapFeature = MapPoint | MapCluster;

export interface MapQuerySummary {
  readonly matchedRecordCount: number;
  readonly renderableRecordCount: number;
  readonly unlocatedRecordCount: number;
  readonly unrenderableRecordCount: number;
  readonly dataBounds?: MapViewport;
}

export interface MapSummaryResult {
  readonly summary: MapQuerySummary;
  readonly viewRevision: number;
  readonly changeCursor: string;
}

export interface MapQueryResult {
  readonly features: readonly MapFeature[];
  readonly viewportRenderableRecordCount: number;
  readonly viewRevision: number;
  readonly changeCursor: string;
}

export interface MapClusterRecordsQueryRequest {
  readonly clusterToken: string;
  readonly cursor?: string;
  readonly limit?: number;
}

export interface UpdateMapViewRequest {
  readonly type: 'map';
  readonly name?: string;
  readonly config: MapViewConfig;
  readonly expectedRevision: number;
}

export interface UpdateGridViewRequest {
  readonly type: 'grid';
  readonly name?: string;
  readonly config: GridViewConfig;
  readonly expectedRevision: number;
}

export type UpdateViewRequest = UpdateMapViewRequest | UpdateGridViewRequest;

export interface CreateGridViewRequest {
  readonly type: 'grid';
  readonly name: string;
  readonly config: GridViewConfig;
}

export interface CreateMapViewRequest {
  readonly type: 'map';
  readonly name: string;
  readonly config: MapViewConfig;
}

export type CreateViewRequest = CreateGridViewRequest | CreateMapViewRequest;

export const MAX_RESOURCE_NAME_CODE_POINTS = 200;

export type ResourceNameResult =
  | { readonly ok: true; readonly name: string }
  | { readonly ok: false; readonly reason: 'empty' | 'control-character' | 'too-long' };

export function normalizeResourceName(value: string): ResourceNameResult {
  const name = value.trim().normalize('NFC');
  if (name === '') return { ok: false, reason: 'empty' };
  if (/\p{Cc}/u.test(name)) return { ok: false, reason: 'control-character' };
  if ([...name].length > MAX_RESOURCE_NAME_CODE_POINTS) {
    return { ok: false, reason: 'too-long' };
  }
  return { ok: true, name };
}

export interface ViewBase {
  readonly id: string;
  readonly tableId: string;
  readonly name: string;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly deletedAt?: string;
}

export type View =
  | (ViewBase & { readonly type: 'grid'; readonly config: GridViewConfig })
  | (ViewBase & { readonly type: 'map'; readonly config: MapViewConfig });

export interface LoomTableClient {
  getMeta(): Promise<ServerMeta>;
  checkConnection(): Promise<ConnectionCheckResult>;
  listWorkspaces(): Promise<readonly Workspace[]>;
  listBases(workspaceId: string): Promise<readonly Base[]>;
  listTables(baseId: string, options?: ResourceListOptions): Promise<readonly Table[]>;
  listFields(tableId: string, options?: ResourceListOptions): Promise<readonly Field[]>;
  listViews(tableId: string, options?: ResourceListOptions): Promise<readonly View[]>;
  query(request: QueryRequest): Promise<QueryResult>;
  pullChanges(tableId: string, request?: PullChangesRequest): Promise<ChangePage>;
  pullHistory(tableId: string, request?: PullHistoryRequest): Promise<HistoryPage>;
  previewFieldConversion(fieldId: string, type: Field['type']): Promise<ConversionPreview>;
  convertField(fieldId: string, request: ConvertFieldRequest): Promise<ConversionResult>;
  queryFieldValues(
    tableId: string,
    fieldId: string,
    request?: DistinctValuesRequest,
  ): Promise<DistinctValuesPage>;
  aggregateRecords(tableId: string, request: AggregateRequest): Promise<AggregateResult>;
  mutate(tableId: string, request: MutationRequest): Promise<MutationResult>;
  getRecord(recordId: string): Promise<LoomTableRecord>;
  duplicateRecord(tableId: string, recordId: string): Promise<RecordOrderResult>;
  moveRecord(
    tableId: string,
    recordId: string,
    request: { beforeRecordId?: string; afterRecordId?: string },
  ): Promise<RecordOrderResult>;
  queryMap(viewId: string, request: MapQueryRequest): Promise<MapQueryResult>;
  summarizeMap(viewId: string): Promise<MapSummaryResult>;
  queryMapClusterRecords(
    viewId: string,
    request: MapClusterRecordsQueryRequest,
  ): Promise<QueryResult>;
  getView(viewId: string): Promise<View>;
  createView(tableId: string, request: CreateViewRequest, idempotencyKey: string): Promise<View>;
  updateView(viewId: string, request: UpdateViewRequest): Promise<View>;
  deleteView(viewId: string, expectedRevision: number): Promise<void>;
  restoreView(viewId: string, expectedRevision: number): Promise<View>;
  createField(tableId: string, request: CreateFieldRequest, idempotencyKey: string): Promise<Field>;
  updateField(fieldId: string, request: UpdateFieldRequest): Promise<Field>;
  deleteField(fieldId: string, expectedRevision: number): Promise<void>;
  restoreField(fieldId: string, expectedRevision: number): Promise<Field>;
  initializeAttachment(
    request: InitializeAttachmentRequest,
    idempotencyKey: string,
  ): Promise<Attachment>;
  getAttachment(attachmentId: string): Promise<Attachment>;
  deleteAttachment(attachmentId: string, expectedRevision: number): Promise<void>;
  uploadAttachmentContent(
    attachmentId: string,
    bytes: ArrayBuffer,
    contentType?: string,
  ): Promise<Attachment>;
  downloadAttachmentContent(attachmentId: string): Promise<AttachmentDownload>;
}
