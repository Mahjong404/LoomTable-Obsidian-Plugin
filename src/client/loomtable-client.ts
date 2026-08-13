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
  | 'conflict'
  | 'cursor-expired'
  | 'forbidden'
  | 'invalid-response'
  | 'network'
  | 'not-found'
  | 'server'
  | 'timeout'
  | 'validation';

export interface LoomTableClientErrorDetails {
  readonly message: string;
  readonly code?: string;
  readonly httpStatus?: number;
  readonly requestId?: string;
}

export class LoomTableClientError extends Error {
  constructor(
    readonly kind: LoomTableClientErrorKind,
    readonly details: LoomTableClientErrorDetails,
    options?: ErrorOptions,
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

export type EmptyFieldType =
  'text' | 'longText' | 'number' | 'checkbox' | 'date' | 'url' | 'location';

export type Field =
  | (FieldBase & {
      readonly type: EmptyFieldType;
      readonly config: Readonly<Record<string, never>>;
    })
  | (FieldBase & {
      readonly type: 'select' | 'multiSelect';
      readonly config: SelectFieldConfig;
    });

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
}
