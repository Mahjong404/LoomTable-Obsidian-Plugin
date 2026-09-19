import { describe, expect, it, vi } from 'vitest';

import {
  LoomTableClientError,
  type CreateViewRequest,
  type View,
} from '../../src/client/loomtable-client';
import {
  ViewWriteCoordinator,
  type PendingViewCreateIntent,
  type PendingViewCreateStore,
  type ViewWriteClient,
} from '../../src/ui/view-write-coordinator';

const GRID_REQUEST: CreateViewRequest = {
  name: 'Board',
  type: 'grid',
  config: {
    projection: ['field_name'],
    columnOrder: ['field_name'],
    columnWidths: {},
    frozenFieldIds: [],
    rowHeight: 'standard',
    sort: [],
  },
};

const GRID_VIEW: View = {
  id: 'view_grid',
  tableId: 'table_01',
  name: 'Board',
  type: 'grid',
  isDefault: false,
  config: GRID_REQUEST.config,
  revision: 1,
  createdAt: '2026-08-14T00:00:00Z',
  updatedAt: '2026-08-14T00:00:00Z',
};

function createClient(overrides: Partial<ViewWriteClient> = {}): ViewWriteClient {
  return {
    getView: vi.fn(async () => GRID_VIEW),
    createView: vi.fn(async () => GRID_VIEW),
    updateView: vi.fn(async () => ({ ...GRID_VIEW, revision: GRID_VIEW.revision + 1 })),
    deleteView: vi.fn(async () => undefined),
    restoreView: vi.fn(async () => ({ ...GRID_VIEW, revision: GRID_VIEW.revision + 1 })),
    setDefaultView: vi.fn(async () => ({
      ...GRID_VIEW,
      isDefault: true,
      revision: GRID_VIEW.revision + 1,
    })),
    ...overrides,
  };
}

function createStore(): PendingViewCreateStore & { items: PendingViewCreateIntent[] } {
  const items: PendingViewCreateIntent[] = [];
  return {
    items,
    list: () => [...items],
    put: (intent) => {
      const index = items.findIndex((item) => item.intentId === intent.intentId);
      if (index >= 0) items.splice(index, 1, intent);
      else items.push(intent);
    },
    remove: (intentId) => {
      const index = items.findIndex((intent) => intent.intentId === intentId);
      if (index >= 0) items.splice(index, 1);
    },
  };
}

describe('ViewWriteCoordinator create', () => {
  it('creates a View with a fresh mutation id and clears any stored intent', async () => {
    const client = createClient();
    const store = createStore();
    const coordinator = new ViewWriteCoordinator(client, {
      intents: store,
      mutationIdFactory: () => 'mut_fixed',
      now: () => '2026-09-01T00:00:00Z',
    });

    const outcome = await coordinator.createView('table_01', GRID_REQUEST);

    expect(outcome).toEqual({ status: 'created', view: GRID_VIEW });
    expect(client.createView).toHaveBeenCalledWith('table_01', GRID_REQUEST, 'mut_fixed');
    expect(store.items).toEqual([]);
  });

  it('persists an unresolved intent when the result is unknown and replays it with the same key', async () => {
    const createView = vi
      .fn()
      .mockRejectedValueOnce(new LoomTableClientError('timeout', { message: 'timed out' }))
      .mockResolvedValueOnce(GRID_VIEW);
    const client = createClient({ createView });
    const store = createStore();
    const coordinator = new ViewWriteCoordinator(client, {
      intents: store,
      mutationIdFactory: () => 'mut_replay',
      now: () => '2026-09-01T00:00:00Z',
    });

    const first = await coordinator.createView('table_01', GRID_REQUEST);
    expect(first.status).toBe('unresolved');
    expect(store.items).toHaveLength(1);
    expect(store.items[0]?.intentId).toBe('mut_replay');
    expect(store.items[0]?.request).toEqual(GRID_REQUEST);
    expect(coordinator.listPendingCreates('table_01')).toHaveLength(1);
    expect(coordinator.listPendingCreates('table_other')).toHaveLength(0);

    const second = await coordinator.retryCreateIntent('mut_replay');
    expect(second).toEqual({ status: 'created', view: GRID_VIEW });
    expect(createView).toHaveBeenNthCalledWith(2, 'table_01', GRID_REQUEST, 'mut_replay');
    expect(store.items).toHaveLength(0);
  });

  it('does not deduplicate away a second unresolved result on retry', async () => {
    const createView = vi
      .fn()
      .mockRejectedValue(new LoomTableClientError('network', { message: 'offline' }));
    const store = createStore();
    const coordinator = new ViewWriteCoordinator(createClient({ createView }), {
      intents: store,
      mutationIdFactory: () => 'mut_twice',
    });

    await coordinator.createView('table_01', GRID_REQUEST);
    const again = await coordinator.retryCreateIntent('mut_twice');
    expect(again?.status).toBe('unresolved');
    expect(store.items).toHaveLength(1);
  });

  it('drops a stored intent when the user dismisses it without sending a request', async () => {
    const store = createStore();
    const createView = vi.fn();
    const coordinator = new ViewWriteCoordinator(createClient({ createView }), {
      intents: store,
    });
    await store.put({
      intentId: 'mut_stored',
      tableId: 'table_01',
      request: GRID_REQUEST,
      createdAt: '2026-09-01T00:00:00Z',
    });

    await coordinator.dismissCreateIntent('mut_stored');

    expect(store.items).toHaveLength(0);
    expect(createView).not.toHaveBeenCalled();
  });

  it('treats idempotency-key reuse and revision conflicts as definitive failures', async () => {
    const createView = vi.fn().mockRejectedValue(
      new LoomTableClientError('conflict', {
        message: 'reused',
        httpStatus: 409,
        code: 'IDEMPOTENCY_KEY_REUSED',
      }),
    );
    const store = createStore();
    const coordinator = new ViewWriteCoordinator(createClient({ createView }), {
      intents: store,
    });

    const outcome = await coordinator.createView('table_01', GRID_REQUEST);
    expect(outcome.status).toBe('failed');
    expect(outcome.status === 'failed' && outcome.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(outcome.status === 'failed' && outcome.kind).toBe('conflict');
    expect(store.items).toHaveLength(0);
  });

  it('copies a saved View type/config under a confirmed name and shares intent persistence', async () => {
    const createView = vi
      .fn()
      .mockRejectedValueOnce(new LoomTableClientError('network', { message: 'offline' }))
      .mockResolvedValueOnce({ ...GRID_VIEW, id: 'view_copy', name: 'Board copy' });
    const store = createStore();
    const coordinator = new ViewWriteCoordinator(createClient({ createView }), {
      intents: store,
      mutationIdFactory: () => 'mut_copy',
      now: () => '2026-09-01T00:00:00Z',
    });
    const source: View = {
      ...GRID_VIEW,
      id: 'view_source',
      revision: 7,
      name: 'Board',
      deletedAt: '2026-09-01T00:00:00Z',
    };

    const first = await coordinator.copyView(source, 'Board copy');

    expect(first.status).toBe('unresolved');
    expect(createView).toHaveBeenCalledWith(
      'table_01',
      { type: 'grid', name: 'Board copy', config: GRID_VIEW.config },
      'mut_copy',
    );
    expect(store.items).toHaveLength(1);

    const second = await coordinator.retryCreateIntent('mut_copy');
    expect(second?.status).toBe('created');
    expect(second?.status === 'created' && second.view.id).toBe('view_copy');
    expect(store.items).toHaveLength(0);
  });

  it('does not let a copied View config mutate the source config', async () => {
    const createView = vi.fn(
      async (_tableId: string, _request: CreateViewRequest, _key: string) => GRID_VIEW,
    );
    const coordinator = new ViewWriteCoordinator(createClient({ createView }));
    const config = {
      projection: ['field_name'],
      columnOrder: ['field_name'],
      columnWidths: { field_name: 220 },
      frozenFieldIds: ['field_name'],
      rowHeight: 'compact' as const,
      sort: [{ fieldId: 'field_name', direction: 'asc' as const, nulls: 'last' as const }],
    };
    const source: View = { ...GRID_VIEW, config };

    await coordinator.copyView(source, 'Copy');
    const sent = createView.mock.calls[0]?.[1];
    if (sent === undefined || sent.type !== 'grid') {
      throw new Error('createView was not called');
    }
    (sent.config.columnWidths as Record<string, number>)['field_name'] = 10;
    expect(config.columnWidths['field_name']).toBe(220);
  });
});

describe('ViewWriteCoordinator existing-View writes', () => {
  it('reads back the latest View after a revision conflict', async () => {
    const latest = { ...GRID_VIEW, revision: 4, name: 'Renamed elsewhere' };
    const client = createClient({
      updateView: vi
        .fn()
        .mockRejectedValue(new LoomTableClientError('conflict', { message: 'stale' })),
      getView: vi.fn(async () => latest),
    });
    const coordinator = new ViewWriteCoordinator(client);

    const outcome = await coordinator.updateView(GRID_VIEW, { name: 'Local name' });

    expect(client.updateView).toHaveBeenCalledWith('view_grid', {
      type: 'grid',
      name: 'Local name',
      config: GRID_VIEW.config,
      expectedRevision: 1,
    });
    expect(outcome).toEqual({ status: 'conflict', latestView: latest });
  });

  it('confirms an uncertain update by comparing the read-back revision', async () => {
    const applied = { ...GRID_VIEW, revision: 2, name: 'Local name' };
    const client = createClient({
      updateView: vi
        .fn()
        .mockRejectedValue(new LoomTableClientError('timeout', { message: 'slow' })),
      getView: vi.fn(async () => applied),
    });
    const coordinator = new ViewWriteCoordinator(client);

    const outcome = await coordinator.updateView(GRID_VIEW, { name: 'Local name' });
    expect(outcome).toEqual({ status: 'saved', view: applied });
  });

  it('reports a conflict when the read-back revision advanced with different content', async () => {
    const overwritten: View = {
      ...GRID_VIEW,
      revision: 3,
      name: 'Changed elsewhere',
      config: { ...GRID_VIEW.config, rowHeight: 'compact' },
    };
    const client = createClient({
      updateView: vi
        .fn()
        .mockRejectedValue(new LoomTableClientError('network', { message: 'offline' })),
      getView: vi.fn(async () => overwritten),
    });
    const coordinator = new ViewWriteCoordinator(client);

    const outcome = await coordinator.updateView(GRID_VIEW, { name: 'Local name' });

    expect(outcome).toEqual({ status: 'conflict', latestView: overwritten });
  });

  it('reports an uncertain update as unresolved when the read-back fails', async () => {
    const client = createClient({
      updateView: vi
        .fn()
        .mockRejectedValue(new LoomTableClientError('timeout', { message: 'slow' })),
      getView: vi
        .fn()
        .mockRejectedValue(new LoomTableClientError('network', { message: 'offline' })),
    });
    const coordinator = new ViewWriteCoordinator(client);

    const outcome = await coordinator.updateView(GRID_VIEW, { name: 'Local name' });

    expect(outcome.status).toBe('unresolved');
    expect(outcome.status === 'unresolved' && outcome.kind).toBe('timeout');
  });

  it('reports an unchanged read-back as unresolved instead of silently retrying', async () => {
    const client = createClient({
      updateView: vi
        .fn()
        .mockRejectedValue(new LoomTableClientError('network', { message: 'offline' })),
      getView: vi.fn(async () => GRID_VIEW),
    });
    const coordinator = new ViewWriteCoordinator(client);

    const outcome = await coordinator.updateView(GRID_VIEW, { name: 'Local name' });
    expect(outcome.status).toBe('unresolved');
    expect(client.updateView).toHaveBeenCalledTimes(1);
  });

  it('serializes writes for the same View and keeps different Views parallel', async () => {
    const order: string[] = [];
    const updateView = vi.fn(
      (viewId: string) =>
        new Promise<View>((resolve) => {
          order.push(`start:${viewId}`);
          setTimeout(
            () => {
              order.push(`end:${viewId}`);
              resolve({ ...GRID_VIEW, id: viewId, revision: 2 });
            },
            viewId === 'view_slow' ? 10 : 0,
          );
        }),
    );
    const client = createClient({ updateView });
    const coordinator = new ViewWriteCoordinator(client);
    const slow: View = { ...GRID_VIEW, id: 'view_slow' };
    const other: View = { ...GRID_VIEW, id: 'view_other' };

    await Promise.all([
      coordinator.updateView(slow, { name: 'a' }),
      coordinator.updateView(slow, { name: 'b' }),
      coordinator.updateView(other, { name: 'c' }),
    ]);

    expect(order).toEqual([
      'start:view_slow',
      'start:view_other',
      'end:view_other',
      'end:view_slow',
      'start:view_slow',
      'end:view_slow',
    ]);
  });

  it('deletes a View and treats an already-gone View as deleted', async () => {
    const deleteView = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new LoomTableClientError('not-found', { message: 'gone' }));
    const client = createClient({ deleteView });
    const coordinator = new ViewWriteCoordinator(client);

    expect(await coordinator.deleteView(GRID_VIEW)).toEqual({ status: 'deleted' });
    expect(client.deleteView).toHaveBeenCalledWith('view_grid', 1);
    expect(await coordinator.deleteView(GRID_VIEW)).toEqual({ status: 'deleted' });
  });

  it('confirms an uncertain delete through a tombstone read-back', async () => {
    const tombstone: View = { ...GRID_VIEW, revision: 2, deletedAt: '2026-09-01T00:00:00Z' };
    const client = createClient({
      deleteView: vi
        .fn()
        .mockRejectedValue(new LoomTableClientError('timeout', { message: 'slow' })),
      getView: vi.fn(async () => tombstone),
    });
    const coordinator = new ViewWriteCoordinator(client);

    expect(await coordinator.deleteView(GRID_VIEW)).toEqual({ status: 'deleted' });
  });

  it('keeps an uncertain delete unresolved when the read-back cannot confirm it', async () => {
    const client = createClient({
      deleteView: vi
        .fn()
        .mockRejectedValue(new LoomTableClientError('timeout', { message: 'slow' })),
      getView: vi
        .fn()
        .mockRejectedValue(new LoomTableClientError('not-found', { message: 'gone' })),
    });
    const coordinator = new ViewWriteCoordinator(client);

    const outcome = await coordinator.deleteView(GRID_VIEW);

    expect(outcome.status).toBe('unresolved');
  });

  it('reports a still-active read-back after an uncertain delete as unresolved', async () => {
    const client = createClient({
      deleteView: vi
        .fn()
        .mockRejectedValue(new LoomTableClientError('network', { message: 'offline' })),
      getView: vi.fn(async () => GRID_VIEW),
    });
    const coordinator = new ViewWriteCoordinator(client);

    const outcome = await coordinator.deleteView(GRID_VIEW);

    expect(outcome.status).toBe('unresolved');
    expect(outcome.status === 'unresolved' && outcome.kind).toBe('network');
  });

  it('confirms a stale-revision restore through the active read-back', async () => {
    const tombstone: View = { ...GRID_VIEW, revision: 2, deletedAt: '2026-09-01T00:00:00Z' };
    const restored: View = { ...GRID_VIEW, revision: 3 };
    const client = createClient({
      restoreView: vi
        .fn()
        .mockRejectedValueOnce(new LoomTableClientError('conflict', { message: 'stale' }))
        .mockResolvedValueOnce(restored),
      getView: vi.fn(async () => restored),
    });
    const coordinator = new ViewWriteCoordinator(client);

    const confirmed = await coordinator.restoreView(tombstone);
    expect(client.restoreView).toHaveBeenCalledWith('view_grid', 2);
    expect(confirmed).toEqual({ status: 'saved', view: restored });

    const ok = await coordinator.restoreView(tombstone);
    expect(ok).toEqual({ status: 'saved', view: restored });
  });

  it('keeps a restore conflicted when the read-back is still deleted', async () => {
    const tombstone: View = { ...GRID_VIEW, revision: 2, deletedAt: '2026-09-01T00:00:00Z' };
    const stillDeleted: View = {
      ...GRID_VIEW,
      revision: 4,
      deletedAt: '2026-09-01T00:00:00Z',
    };
    const client = createClient({
      restoreView: vi
        .fn()
        .mockRejectedValue(new LoomTableClientError('conflict', { message: 'stale' })),
      getView: vi.fn(async () => stillDeleted),
    });
    const coordinator = new ViewWriteCoordinator(client);

    const outcome = await coordinator.restoreView(tombstone);
    expect(outcome).toEqual({ status: 'conflict', latestView: stillDeleted });
  });
});
