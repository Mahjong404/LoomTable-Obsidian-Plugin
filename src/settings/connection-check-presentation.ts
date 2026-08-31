import {
  LoomTableClientError,
  type ConnectionCheckResult,
  type LoomTableClientErrorDetails,
  type ServerMeta,
} from '../client/loomtable-client';
import type { LoomTableClientErrorKind } from '../client/loomtable-client';
import type { Translator } from '../i18n';

export type ConnectionCheckFailureKind =
  'authentication-failed' | 'forbidden' | 'unreachable' | 'server-error';

export interface ConnectionCheckFailure {
  readonly kind: ConnectionCheckFailureKind;
  readonly error: LoomTableClientErrorDetails;
}

export type ConnectionCheckState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'checking' }
  | { readonly kind: 'complete'; readonly result: ConnectionCheckResult }
  | { readonly kind: 'failed'; readonly failure: ConnectionCheckFailure };

export type ConnectionCheckTone = 'idle' | 'pending' | 'success' | 'warning' | 'error';

export type ConnectionCheckStateListener = (profileId: string, state: ConnectionCheckState) => void;

export class ConnectionCheckController {
  readonly #states = new Map<string, ConnectionCheckState>();
  readonly #sequences = new Map<string, number>();

  constructor(private readonly onStateChange: ConnectionCheckStateListener = () => undefined) {}

  stateFor(profileId: string): ConnectionCheckState {
    return this.#states.get(profileId) ?? { kind: 'idle' };
  }

  async run(
    profileId: string,
    check: () => Promise<ConnectionCheckResult>,
    isCurrent: () => boolean = () => true,
  ): Promise<boolean> {
    if (this.stateFor(profileId).kind === 'checking') return false;

    const sequence = (this.#sequences.get(profileId) ?? 0) + 1;
    this.#sequences.set(profileId, sequence);
    this.#publish(profileId, { kind: 'checking' });

    try {
      const result = await check();
      if (!this.#isCurrent(profileId, sequence, isCurrent)) return false;
      this.#publish(profileId, { kind: 'complete', result });
      return true;
    } catch (error) {
      if (!this.#isCurrent(profileId, sequence, isCurrent)) return false;
      this.#publish(profileId, { kind: 'failed', failure: connectionCheckFailure(error) });
      return true;
    }
  }

  invalidate(profileId: string): void {
    this.#sequences.set(profileId, (this.#sequences.get(profileId) ?? 0) + 1);
    this.#states.delete(profileId);
  }

  #isCurrent(profileId: string, sequence: number, isCurrent: () => boolean): boolean {
    return this.#sequences.get(profileId) === sequence && isCurrent();
  }

  #publish(profileId: string, state: ConnectionCheckState): void {
    this.#states.set(profileId, state);
    this.onStateChange(profileId, state);
  }
}

export function connectionCheckFailure(error: unknown): ConnectionCheckFailure {
  if (error instanceof LoomTableClientError) {
    return {
      kind: connectionCheckFailureKind(error.kind),
      error: error.details,
    };
  }
  return {
    kind: 'server-error',
    error: { message: 'An unexpected LoomTable connection error occurred.' },
  };
}

export function renderConnectionCheckDescription(
  state: ConnectionCheckState,
  t: Translator,
): DocumentFragment {
  const description = document.createDocumentFragment();
  const summary = document.createElement('span');
  summary.textContent = describeConnectionCheck(state, t);
  description.append(summary);
  const diagnostics = connectionDiagnostics(state);
  if (diagnostics !== null) {
    const details = document.createElement('details');
    details.className = 'loom-diagnostic';
    const disclosure = document.createElement('summary');
    disclosure.textContent = t('common.openDiagnostics');
    const pre = document.createElement('pre');
    pre.textContent = diagnostics;
    details.append(disclosure, pre);
    description.append(document.createTextNode(' '), details);
  }
  return description;
}

export function describeConnectionCheck(state: ConnectionCheckState, t: Translator): string {
  if (state.kind === 'idle') return t('connection.status.notTested');
  if (state.kind === 'checking') return t('connection.status.checking');
  if (state.kind === 'failed') return describeFailure(state.failure.kind, t);

  const { result } = state;
  switch (result.kind) {
    case 'connected':
      return `${t('connection.status.connected')} ${describeMeta(result.meta, t)}`;
    case 'authentication-required':
      return `${t('connection.status.authenticationRequired')} ${describeMeta(result.meta, t)}`;
    case 'authentication-failed':
      return t('connection.status.authenticationFailed');
    case 'forbidden':
      return t('connection.status.forbidden');
    case 'incompatible':
      return describeIncompatibility(result, t);
    case 'unreachable':
      return t('connection.status.unreachable');
    case 'server-error':
      return t('connection.status.serverError');
  }
}

export function connectionDiagnostics(state: ConnectionCheckState): string | null {
  if (state.kind === 'failed') return errorDiagnostic(state.failure.error);
  if (state.kind !== 'complete') return null;
  const { result } = state;
  if (result.kind === 'incompatible') {
    return result.error === undefined ? null : errorDiagnostic(result.error);
  }
  if (
    result.kind !== 'authentication-failed' &&
    result.kind !== 'forbidden' &&
    result.kind !== 'unreachable' &&
    result.kind !== 'server-error'
  ) {
    return null;
  }
  return errorDiagnostic(result.error);
}

export function connectionCheckTone(state: ConnectionCheckState): ConnectionCheckTone {
  if (state.kind === 'idle') return 'idle';
  if (state.kind === 'checking') return 'pending';
  if (state.kind === 'failed') return 'error';
  switch (state.result.kind) {
    case 'connected':
      return 'success';
    case 'authentication-required':
    case 'incompatible':
      return 'warning';
    case 'authentication-failed':
    case 'forbidden':
    case 'server-error':
    case 'unreachable':
      return 'error';
  }
}

function describeIncompatibility(
  result: Extract<ConnectionCheckResult, { kind: 'incompatible' }>,
  t: Translator,
): string {
  switch (result.reason.kind) {
    case 'api-version':
      return `${t('connection.status.incompatibleApi')} ${result.reason.actualApiVersion} → ${result.reason.expectedApiVersion}`;
    case 'plugin-version':
      return `${t('connection.status.incompatiblePlugin')} ${result.reason.minimumPluginVersion}`;
    case 'migration-required':
      return t('connection.status.migrationRequired');
  }
}

function describeFailure(kind: ConnectionCheckFailureKind, t: Translator): string {
  switch (kind) {
    case 'authentication-failed':
      return t('connection.status.authenticationFailed');
    case 'forbidden':
      return t('connection.status.forbidden');
    case 'unreachable':
      return t('connection.status.unreachable');
    case 'server-error':
      return t('connection.status.serverError');
  }
}

function connectionCheckFailureKind(kind: LoomTableClientErrorKind): ConnectionCheckFailureKind {
  switch (kind) {
    case 'authentication':
      return 'authentication-failed';
    case 'forbidden':
      return 'forbidden';
    case 'network':
    case 'timeout':
      return 'unreachable';
    default:
      return 'server-error';
  }
}

function describeMeta(meta: ServerMeta, t: Translator): string {
  return `${t('connection.status.serverVersion')} ${meta.serverVersion} · API ${meta.apiVersion}`;
}

function errorDiagnostic(error: LoomTableClientErrorDetails): string {
  return JSON.stringify(
    {
      ...(error.code === undefined ? {} : { code: error.code }),
      ...(error.httpStatus === undefined ? {} : { httpStatus: error.httpStatus }),
      ...(error.requestId === undefined ? {} : { requestId: error.requestId }),
    },
    null,
    2,
  );
}
