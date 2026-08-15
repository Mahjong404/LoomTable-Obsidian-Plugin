MethodException: 
Line |
   2 |  … t.ts' -Raw; $c = $c.Replace([char]13 + [char]10, [char]10).Replace([c …
     |                ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
     | Cannot convert argument "oldChar", with value: "
", for "Replace" to type "System.Char": "Cannot convert value "
" to type "System.Char". Error: "String must be exactly one character long.""
import { describe, expect, it, vi } from 'vitest';

import {
  LoomTableClientError,
  type Field,
  type GridViewConfig,
  type LoomTableRecord,
  type MutationRequest,
  type MutationResult,
  type View,
} from '../../src/client/loomtable-client';
import {
  GridViewController,
  createGridQuery,
  type GridDataSource,
} from '../../src/ui/grid-view-controller';
import {
  InMemoryLoomTableClient,
  type InMemoryGridData,
} from '../fixtures/in-memory-loomtable-client';

describe('GridViewController', () => {
  it('discovers the current Workspace/Base/Table/View and submits the saved query contract', async () => {
    const data = createData(createRecords(3), createGridConfig(true));
    const client = new InMemoryLoomTableClient(data);
    const controller = new GridViewController(client, { pageSize: 2 });

    await controller.load();

    expect(controller.state.status).toBe('ready');
    expect(controller.state.selectedWorkspaceId).toBe('workspace_01');
    expect(controller.state.selectedBaseId).toBe('base_01');
    expect(controller.state.selectedTableId).toBe('table_01');
    expect(controller.state.selectedViewId).toBe('view_01');
    expect(controller.state.records).toHaveLength(2);
    expect(controller.state.hasMore).toBe(true);
    expect(client.queryRequests[0]).toEqual({
      tableId: 'table_01',
      viewId: 'view_01',
      limit: 2,
      projection: ['field_name'],
      filter: {
        kind: 'rule',
        fieldId: 'field_name',
        operator: 'contains',
        value: 'a',
      },
      sort: [{ fieldId: 'field_name', direction: 'asc', nulls: 'last' }],
    });
  });

  it('uses the opaque cursor to append the next page without changing the query', async () => {
    const client = new InMemoryLoomTableClient(
      createData(createRecords(3), createGridConfig(false)),
    );
    const controller = new GridViewController(client, { pageSize: 2 });

    await controller.load();
    await controller.loadNextPage();

    expect(controller.state.status).toBe('ready');
    expect(controller.state.records.map((record) => record.id)).toEqual([
      'record_01',
      'record_02',
      'record_03',
    ]);
    expect(client.queryRequests[1]?.cursor).toBe('cursor:2');
    expect(controller.state.hasMore).toBe(false);
    expect(controller.state.nextCursor).toBe(null);
  });

  it('distinguishes an empty Table from an empty filtered result', async () => {
    const emptyTableController = new GridViewController(
      new InMemoryLoomTableClient(createData([], createGridConfig(false))),
    );
    await emptyTableController.load();
    expect(emptyTableController.state.status).toBe('empty');
    expect(emptyTableController.state.emptyReason).toBe('records');

    const noMatchController = new GridViewController(
      new InMemoryLoomTableClient(createData([], createGridConfig(true))),
    );
    await noMatchController.load();
    expect(noMatchController.state.status).toBe('empty');
    expect(noMatchController.state.emptyReason).toBe('no-match');
  });

  it('maps offline network failures to a distinct Grid state', async () => {
    const data = createData(createRecords(1), createGridConfig(false));
    const source = failingSource(data, new LoomTableClientError('network', { message: 'offline' }));
    const controller = new GridViewController(source, { isOffline: () => true });

    await controller.load();

    expect(controller.state.status).toBe('offline');
    expect(controller.state.error?.message).toBe('offline');
  });

  it.each([
    ['authentication', 'authentication'],
    ['forbidden', 'forbidden'],
    ['server', 'server-error'],
  ] as const)('keeps %s errors distinct in the Grid state', async (kind, expectedStatus) => {
    const source = failingSource(
      createData(createRecords(1), createGridConfig(false)),
      new LoomTableClientError(kind, { message: kind }),
    );
    const controller = new GridViewController(source, { isOffline: () => false });

    await controller.load();

    expect(controller.state.status).toBe(expectedStatus);
    expect(controller.state.error?.message).toBe(kind);
  });

  it('rejects invalid Cell values without enqueueing a mutation', async () => {
    const data = createData(createRecords(1), createGridConfig(false));
    const client = new InMemoryLoomTableClient(data);
    const controller = new GridViewController(client);
    await controller.load();

    await expect(
      controller.editCell('record_01', 'field_name', 'bad\u0000value'),
    ).rejects.toMatchObject({ kind: 'validation' });
    expect(client.mutationRequests).toHaveLength(0);
    expect(controller.state.editError?.message).toContain('control characters');
  });

  it('keeps an optimistic value while the mutation is in flight and applies the Server Record', async () => {
    const data = createData(createRecords(1), createGridConfig(false));
    let resolveMutation: ((result: MutationResult) => void) | undefined;
    const mutate = vi.fn(
      () => new Promise<MutationResult>((resolve) => (resolveMutation = resolve)),
    );
    const controller = new GridViewController(withMutation(data, mutate));
    await controller.load();

    const pending = controller.editCell('record_01', 'field_name', 'Optimistic');
    await Promise.resolve();
    expect(controller.state.records[0]?.values.field_name).toBe('Optimistic');
    expect(controller.state.editStatuses.record_01).toBe('saving');
    resolveMutation?.(mutationResult('mutation_01', 'Optimistic', 2));
    await pending;

    expect(controller.state.records[0]?.revision).toBe(2);
    expect(controller.state.records[0]?.values.field_name).toBe('Optimistic');
    expect(controller.state.editStatuses.record_01).toBeUndefined();
  });

  it('surfaces a conflict and supports explicit overwrite using the Server revision', async () => {
    const data = createData(createRecords(1), createGridConfig(false));
    const conflict = new LoomTableClientError(
      'conflict',
      { message: 'Revision conflict.', code: 'CONFLICT' },
      undefined,
      {
        clientMutationId: 'mutation_01',
        failedCommandIndex: 0,
        conflicts: [
          {
            recordId: 'record_01',
            expectedRevision: 1,
            currentRevision: 2,
            currentValues: { field_name: 'Server value' },
            submittedSet: { field_name: 'Local value' },
          },
        ],
      },
    );
    const mutate = vi
      .fn<(tableId: string, request: MutationRequest) => Promise<MutationResult>>()
      .mockRejectedValueOnce(conflict)
      .mockResolvedValueOnce(mutationResult('mutation_02', 'Local value', 3));
    const controller = new GridViewController(withMutation(data, mutate));
    await controller.load();

    await expect(
      controller.editCell('record_01', 'field_name', 'Local value'),
    ).rejects.toMatchObject({ kind: 'conflict' });
    expect(controller.state.conflicts[0]).toMatchObject({
      currentRevision: 2,
      currentValues: { field_name: 'Server value' },
      submittedSet: { field_name: 'Local value' },
    });

    controller.resolveConflict('record_01', 'overwrite');
    await vi.waitFor(() => expect(mutate).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(controller.state.records[0]?.revision).toBe(3));
    expect(mutate.mock.calls[1]?.[1].commands[0]).toMatchObject({ expectedRevision: 2 });
    expect(controller.state.conflicts).toHaveLength(0);
    expect(controller.state.records[0]?.revision).toBe(3);
  });

  it('keeps Map Views in navigation and delegates selection without querying them as Grid data', async () => {
    const mapView: Extract<View, { type: 'map' }> = {
      id: 'view_map',
      tableId: 'table_01',
      name: 'Map',
      type: 'map',
      config: { locationFieldId: 'field_location' },
      revision: 1,
      createdAt: '2026-08-14T00:00:00Z',
      updatedAt: '2026-08-14T00:00:00Z',
    };
    const onMapSelected = vi.fn();
    const client = new InMemoryLoomTableClient(
      createData(createRecords(1), createGridConfig(false), [mapView]),
    );
    const controller = new GridViewController(client, { onNonGridViewSelected: onMapSelected });

    await controller.load();
    await controller.selectView('view_map');

    expect(controller.state.views.map((view) => view.id)).toEqual(['view_01', 'view_map']);
    expect(onMapSelected).toHaveBeenCalledWith(mapView, controller.state);
    expect(client.queryRequests).toHaveLength(1);
  });
});

describe('createGridQuery', () => {
  it('keeps the cursor and view query semantics separate from the route Table ID', () => {
    const view = createView(createGridConfig(true));

    expect(createGridQuery('table/01', view, 50, 'opaque-cursor')).toEqual({
      tableId: 'table/01',
      viewId: 'view_01',
      limit: 50,
      cursor: 'opaque-cursor',
      projection: ['field_name'],
      filter: view.config.filter,
      sort: view.config.sort,
    });
  });
});

function createData(
  records: readonly LoomTableRecord[],
  config: GridViewConfig,
  extraViews: readonly View[] = [],
): InMemoryGridData {
  return {
    workspaces: [
      {
        id: 'workspace_01',
        name: 'Personal',
        revision: 1,
        createdAt: '2026-08-14T00:00:00Z',
        updatedAt: '2026-08-14T00:00:00Z',
      },
    ],
    bases: [
      {
        id: 'base_01',
        workspaceId: 'workspace_01',
        name: 'Notes',
        revision: 1,
        createdAt: '2026-08-14T00:00:00Z',
        updatedAt: '2026-08-14T00:00:00Z',
      },
    ],
    tables: [
      {
        id: 'table_01',
        baseId: 'base_01',
        name: 'Projects',
        primaryFieldId: 'field_name',
        revision: 1,
        createdAt: '2026-08-14T00:00:00Z',
        updatedAt: '2026-08-14T00:00:00Z',
      },
    ],
    fields: [createField()],
    views: [createView(config), ...extraViews],
    records,
  };
}

function createField(): Field {
  return {
    id: 'field_name',
    tableId: 'table_01',
    name: 'Name',
    position: 0,
    schemaVersion: 1,
    revision: 1,
    type: 'text',
    config: {},
  };
}

function createGridConfig(withFilter: boolean): GridViewConfig {
  return {
    projection: ['field_name'],
    columnOrder: ['field_name'],
    columnWidths: { field_name: 180 },
    frozenFieldIds: [],
    rowHeight: 'standard',
    ...(withFilter
      ? {
          filter: {
            kind: 'rule' as const,
            fieldId: 'field_name',
            operator: 'contains' as const,
            value: 'a',
          },
        }
      : {}),
    sort: [{ fieldId: 'field_name', direction: 'asc', nulls: 'last' }],
  };
}

function createView(config: GridViewConfig): Extract<View, { type: 'grid' }> {
  return {
    id: 'view_01',
    tableId: 'table_01',
    name: 'Grid',
    type: 'grid',
    config,
    revision: 1,
    createdAt: '2026-08-14T00:00:00Z',
    updatedAt: '2026-08-14T00:00:00Z',
  };
}

function createRecords(count: number): readonly LoomTableRecord[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `record_0${index + 1}`,
    tableId: 'table_01',
    revision: 1,
    values: { field_name: `Record ${index + 1}` },
    createdAt: '2026-08-14T00:00:00Z',
    updatedAt: '2026-08-14T00:00:00Z',
  }));
}

function failingSource(data: InMemoryGridData, error: LoomTableClientError): GridDataSource {
  const client = new InMemoryLoomTableClient(data);
  return {
    listWorkspaces: () => client.listWorkspaces(),
    listBases: (workspaceId) => client.listBases(workspaceId),
    listTables: (baseId) => client.listTables(baseId),
    listFields: (tableId) => client.listFields(tableId),
    listViews: (tableId) => client.listViews(tableId),
    query: async () => {
      throw error;
    },
  };
}

function withMutation(
  data: InMemoryGridData,
  mutate: (tableId: string, request: MutationRequest) => Promise<MutationResult>,
): GridDataSource {
  const client = new InMemoryLoomTableClient(data);
  return {
    listWorkspaces: () => client.listWorkspaces(),
    listBases: (workspaceId) => client.listBases(workspaceId),
    listTables: (baseId) => client.listTables(baseId),
    listFields: (tableId) => client.listFields(tableId),
    listViews: (tableId) => client.listViews(tableId),
    query: (request) => client.query(request),
    mutate,
  };
}

function mutationResult(clientMutationId: string, value: string, revision: number): MutationResult {
  return {
    clientMutationId,
    results: [
      {
        index: 0,
        status: 'applied',
        record: {
          id: 'record_01',
          tableId: 'table_01',
          revision,
          values: { field_name: value },
          createdAt: '2026-08-14T00:00:00Z',
          updatedAt: '2026-08-15T00:00:00Z',
        },
      },
    ],
    changeCursor: 'change_02',
  };
}

