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
      return describeError(t('connection.status.authenticationFailed'), result.error, t);
    case 'forbidden':
      return describeError(t('connection.status.forbidden'), result.error, t);
    case 'incompatible':
      return describeIncompatibility(result, t);
    case 'unreachable':
      return describeError(t('connection.status.unreachable'), result.error, t);
    case 'server-error':
      return describeError(t('connection.status.serverError'), result.error, t);
  }
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
      return describeError(
        t('connection.status.migrationRequired'),
        result.error ?? { message: t('connection.status.migrationRequired') },
        t,
      );
  }
}

function describeMeta(meta: ServerMeta, t: Translator): string {
  return `${t('connection.status.serverVersion')} ${meta.serverVersion} · API ${meta.apiVersion}`;
}

function describeError(summary: string, error: LoomTableClientErrorDetails, t: Translator): string {
  const diagnostics = [
    error.code,
    error.requestId === undefined
      ? undefined
      : `${t('connection.status.requestId')} ${error.requestId}`,
  ].filter((value): value is string => value !== undefined);
  return diagnostics.length === 0 ? summary : `${summary} (${diagnostics.join(' · ')})`;
}
