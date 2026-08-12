import type { components } from '../generated/transport';
import type { HttpTransport, HttpTransportResponse } from './http-transport';
import { normalizeServerOrigin } from './server-origin';
import {
  LOOMTABLE_API_VERSION,
  LoomTableClientError,
  type ConnectionCheckResult,
  type LoomTableClient,
  type LoomTableClientErrorDetails,
  type ServerIncompatibility,
  type ServerMeta,
} from './loomtable-client';

type TransportServerMeta = components['schemas']['ServerMeta'];

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

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 250;
const MAX_RETRY_AFTER_MS = 30_000;
const RETRYABLE_STATUSES = new Set([408, 429, 502, 503, 504]);
const RETENTION_VALUES = new Set(['30d', '90d', '365d', 'forever']);

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

  async #requestJson(path: string, token: string | null): Promise<unknown> {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      let response: HttpTransportResponse;
      try {
        response = await withTimeout(
          this.#transport({
            url: `${this.#serverOrigin}${path}`,
            method: 'GET',
            headers: token === null ? { Accept: 'application/json' } : authenticatedHeaders(token),
          }),
          this.#requestTimeoutMs,
        );
      } catch (error) {
        if (attempt < MAX_ATTEMPTS - 1) {
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
    (value.migrationRequired !== undefined && typeof value.migrationRequired !== 'boolean')
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
    ...(value.migrationRequired === undefined
      ? {}
      : { migrationRequired: value.migrationRequired }),
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
    return { code: error.code, message: error.message, requestId: error.requestId };
  } catch {
    return null;
  }
}

function errorFromResponse(status: number, apiError: ApiError | null): LoomTableClientError {
  const details: LoomTableClientErrorDetails = {
    message: apiError?.message ?? `The LoomTable Server returned HTTP ${status}.`,
    httpStatus: status,
    ...(apiError === null ? {} : { code: apiError.code, requestId: apiError.requestId }),
  };
  if (status === 401) return new LoomTableClientError('authentication', details);
  if (status === 403) return new LoomTableClientError('forbidden', details);
  return new LoomTableClientError('server', details);
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
  return typeof value === 'object' && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isRetention(value: unknown): value is TransportServerMeta['changeRetention'] {
  return typeof value === 'string' && RETENTION_VALUES.has(value);
}
