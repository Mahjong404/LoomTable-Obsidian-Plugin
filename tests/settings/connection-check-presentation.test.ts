import { describe, expect, it, vi } from 'vitest';

import { LoomTableClientError } from '../../src/client/loomtable-client';
import { createTranslator } from '../../src/i18n';
import {
  ConnectionCheckController,
  connectionCheckTone,
  connectionDiagnostics,
  describeConnectionCheck,
  renderConnectionCheckDescription,
} from '../../src/settings/connection-check-presentation';

const meta = {
  serverVersion: '0.1.0',
  apiVersion: 'v1',
  minPluginVersion: '0.1.0',
  capabilities: ['grid', 'map'],
  changeRetention: '30d' as const,
  idempotencyRetention: '30d' as const,
  migrationRequired: false,
  bootstrapState: 'complete' as const,
};

describe('connection check presentation', () => {
  it('shows connected Server metadata with a success tone', () => {
    const state = { kind: 'complete', result: { kind: 'connected', meta } } as const;

    expect(describeConnectionCheck(state, createTranslator('en'))).toContain(
      'Connected and authenticated. Server 0.1.0 · API v1',
    );
    expect(connectionCheckTone(state)).toBe('success');
  });

  it('retains migration diagnostics in an actionable warning', () => {
    const state = {
      kind: 'complete',
      result: {
        kind: 'incompatible',
        reason: { kind: 'migration-required' },
        error: {
          message: 'Migrate first.',
          code: 'MIGRATION_REQUIRED',
          requestId: 'req_01ARZ3NDEKTSV4RRFFQ69G5FAV',
        },
      },
    } as const;

    const description = describeConnectionCheck(state, createTranslator('zh-CN'));
    expect(description).toContain('请执行 Server 迁移命令');
    expect(description).not.toContain('MIGRATION_REQUIRED');
    expect(description).not.toContain('req_01ARZ3NDEKTSV4RRFFQ69G5FAV');
    expect(connectionDiagnostics(state)).toContain('MIGRATION_REQUIRED');
    expect(connectionDiagnostics(state)).toContain('req_01ARZ3NDEKTSV4RRFFQ69G5FAV');
    expect(connectionCheckTone(state)).toBe('warning');
  });

  it('maps rejected connection checks to a translated, diagnosable failure state', async () => {
    const controller = new ConnectionCheckController();
    const error = new LoomTableClientError('network', {
      message: 'raw transport detail must not be shown',
      code: 'NETWORK_UNAVAILABLE',
      requestId: 'req_settings_network',
    });

    await controller.run('profile-01', () => Promise.reject(error));

    const state = controller.stateFor('profile-01');
    expect(describeConnectionCheck(state, createTranslator('en'))).toContain(
      'The Server could not be reached',
    );
    expect(describeConnectionCheck(state, createTranslator('en'))).not.toContain(
      'raw transport detail',
    );
    expect(connectionDiagnostics(state)).toContain('NETWORK_UNAVAILABLE');
    expect(connectionDiagnostics(state)).toContain('req_settings_network');
    expect(connectionCheckTone(state)).toBe('error');
  });

  it('keeps technical connection fields behind an explicit diagnostic disclosure', async () => {
    const controller = new ConnectionCheckController();
    await controller.run('profile-01', () =>
      Promise.reject(
        new LoomTableClientError('server', {
          message: 'raw server detail must not be shown',
          code: 'SERVER_FAILURE',
          httpStatus: 503,
          requestId: 'req_settings_server',
        }),
      ),
    );

    const host = document.createElement('div');
    host.append(
      renderConnectionCheckDescription(controller.stateFor('profile-01'), createTranslator('en')),
    );

    expect(host.textContent).toContain('The Server returned an unexpected response');
    expect(host.textContent).not.toContain('raw server detail');
    expect(host.querySelector('details > summary')?.textContent).toBe(
      createTranslator('en')('common.openDiagnostics'),
    );
    expect(host.querySelector('pre')?.textContent).toContain('SERVER_FAILURE');
    expect(host.querySelector('pre')?.textContent).toContain('req_settings_server');
  });

  it('ignores a duplicate connection check while the first check is pending', async () => {
    const controller = new ConnectionCheckController();
    let resolveFirst: (result: typeof connectedResult) => void = () => undefined;
    const firstResult = new Promise<typeof connectedResult>((resolve) => {
      resolveFirst = resolve;
    });
    const check = vi.fn(() => firstResult);

    const firstRun = controller.run('profile-01', check);
    expect(controller.stateFor('profile-01')).toEqual({ kind: 'checking' });
    await controller.run('profile-01', check);
    expect(check).toHaveBeenCalledTimes(1);

    resolveFirst(connectedResult);
    await firstRun;
    expect(controller.stateFor('profile-01')).toEqual({
      kind: 'complete',
      result: connectedResult,
    });
  });

  it('does not publish a late result after the profile is invalidated', async () => {
    const controller = new ConnectionCheckController();
    let resolveCheck: (result: typeof connectedResult) => void = () => undefined;
    const pending = new Promise<typeof connectedResult>((resolve) => {
      resolveCheck = resolve;
    });

    const run = controller.run('profile-01', () => pending);
    controller.invalidate('profile-01');
    resolveCheck(connectedResult);

    await run;
    expect(controller.stateFor('profile-01')).toEqual({ kind: 'idle' });
  });
});

const connectedResult = {
  kind: 'connected',
  meta,
} as const;
