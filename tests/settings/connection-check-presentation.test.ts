import { describe, expect, it } from 'vitest';

import { createTranslator } from '../../src/i18n';
import {
  connectionCheckTone,
  connectionDiagnostics,
  describeConnectionCheck,
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
});
