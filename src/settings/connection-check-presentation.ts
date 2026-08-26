import type {
  ConnectionCheckResult,
  LoomTableClientErrorDetails,
  ServerMeta,
} from '../client/loomtable-client';
import type { Translator } from '../i18n';

export type ConnectionCheckState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'checking' }
  | { readonly kind: 'complete'; readonly result: ConnectionCheckResult };

export type ConnectionCheckTone = 'idle' | 'pending' | 'success' | 'warning' | 'error';

export function describeConnectionCheck(state: ConnectionCheckState, t: Translator): string {
  if (state.kind === 'idle') return t('connection.status.notTested');
  if (state.kind === 'checking') return t('connection.status.checking');

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
