export const LOOMTABLE_API_VERSION = 'v1' as const;

export interface ServerMeta {
  readonly serverVersion: string;
  readonly apiVersion: string;
  readonly minPluginVersion: string;
  readonly capabilities: readonly string[];
  readonly changeRetention: '30d' | '90d' | '365d' | 'forever';
  readonly idempotencyRetention: '30d' | '90d' | '365d' | 'forever';
  readonly migrationRequired?: boolean;
}

export type LoomTableClientErrorKind =
  'authentication' | 'forbidden' | 'invalid-response' | 'network' | 'server' | 'timeout';

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

export interface LoomTableClient {
  getMeta(): Promise<ServerMeta>;
  checkConnection(): Promise<ConnectionCheckResult>;
}
