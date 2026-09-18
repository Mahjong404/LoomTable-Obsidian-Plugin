import { describe, expect, it, vi } from 'vitest';

import {
  LoomTableClientError,
  type ConflictDetails,
  type Field,
  type FilterNode,
  type GridViewConfig,
  type JsonValue,
  type LoomTableRecord,
  type MutationRequest,
  type MutationResult,
  type QueryRequest,
  type QueryResult,
  type View,
} from '../../src/client/loomtable-client';
import {
  GridViewController,
  createGridQuery,
  type GridDataSource,
  type GridState,
} from '../../src/ui/grid-view-controller';
import {
  InMemoryLoomTableClient,
  type InMemoryGridData,
} from '../fixtures/in-memory-loomtable-client';
import { createTranslator } from '../../src/i18n';
import { createRecordDetail } from '../../src/ui/record-detail';
import {
  MutationQueueScheduler,
  type DurableMutationQueuePort,
  type DurableMutationQueueTransport,
  type MutationQueueRecordSnapshot,
  type MutationQueueSchedulerEvent,
} from '../../src/ui/mutation-queue-scheduler';
import {
  MutationQueueStore,
  type MutationQueueSettingsV2,
} from '../../src/settings/mutation-queue-settings';
import type {
  PendingViewCreateIntent,
  PendingViewCreateStore,
} from '../../src/ui/view-write-coordinator';

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
    const controller = new GridViewController(client, {
      translate: createTranslator('zh-CN'),
    });
    await controller.load();

    await expect(
      controller.editCell('record_01', 'field_name', 'bad\u0000value'),
    ).rejects.toMatchObject({ kind: 'validation' });
    expect(client.mutationRequests).toHaveLength(0);
    expect(controller.state.editError?.code).toBe('FIELD_VALUE_TEXT_CONTROL');
    expect(controller.state.editError?.message).toBe('文本包含不支持的控制字符。');
    expect(controller.state.editStatuses.record_01).toBe('error');
    expect(controller.state.editDrafts).toEqual([
      {
        recordId: 'record_01',
        fieldId: 'field_name',
        rawValue: 'bad\u0000value',
      },
    ]);
    expect(controller.state.editErrorRecordId).toBe('record_01');
    expect(controller.state.saveStatus).toBe('error');
  });

  it('rejects Cell edits while offline before sending a Mutation', async () => {
    const data = createData(createRecords(1), createGridConfig(false));
    const mutate = vi
      .fn<(tableId: string, request: MutationRequest) => Promise<MutationResult>>()
      .mockResolvedValue(mutationResult('mutation_01', 'Local value', 2));
    const controller = new GridViewController(withMutation(data, mutate), {
      isOffline: () => true,
    });
    await controller.load();

    expect(controller.state.status).toBe('ready');
    await expect(
      controller.editCell('record_01', 'field_name', 'Local value'),
    ).rejects.toMatchObject({ kind: 'validation' });

    expect(mutate).not.toHaveBeenCalled();
    expect(controller.state.editError?.message).toContain('offline');
    expect(controller.state.saveStatus).toBe('offline-readonly');
  });

  it('exposes dirty, saving, and saved View status around an UpdateRecord', async () => {
    const data = createData(createRecords(1), createGridConfig(false));
    let resolveMutation: ((result: MutationResult) => void) | undefined;
    const mutate = vi.fn(
      () => new Promise<MutationResult>((resolve) => (resolveMutation = resolve)),
    );
    const controller = new GridViewController(withMutation(data, mutate));
    const statuses: string[] = [];
    controller.subscribe((state) => statuses.push(state.saveStatus));
    await controller.load();

    const pending = controller.editCell('record_01', 'field_name', 'Saving');
    expect(controller.state.saveStatus).toBe('saving');
    resolveMutation?.(mutationResult('mutation_status_01', 'Saving', 2));
    await pending;

    expect(statuses).toContain('dirty');
    expect(statuses).toContain('saving');
    expect(controller.state.saveStatus).toBe('saved');
  });

  it('exposes a failed View save without changing the optimistic rollback contract', async () => {
    const data = createData(createRecords(1), createGridConfig(false));
    const mutate = vi
      .fn<(tableId: string, request: MutationRequest) => Promise<MutationResult>>()
      .mockRejectedValueOnce(
        new LoomTableClientError('validation', { message: 'The value is invalid.' }),
      )
      .mockResolvedValueOnce(mutationResult('mutation_retry_01', 'Retried', 2));
    const controller = new GridViewController(withMutation(data, mutate));
    await controller.load();

    await expect(controller.editCell('record_01', 'field_name', 'Rejected')).rejects.toThrow(
      'The value is invalid.',
    );
    expect(controller.state.saveStatus).toBe('error');
    expect(controller.state.records[0]?.values.field_name).toBe('Record 1');

    controller.retryEdit('record_01');
    await vi.waitFor(() => expect(mutate).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(controller.state.saveStatus).toBe('saved'));
    expect(controller.state.records[0]?.values.field_name).toBe('Retried');
  });

  it('saves a validated Location object through a single UpdateRecord command', async () => {
    const initial = locationRecord({
      label: 'Old label',
      lat: 10,
      lng: 20,
      precision: 'approximate',
    });
    const saved = {
      ...initial,
      revision: 2,
      values: {
        ...initial.values,
        field_location: {
          label: 'New label',
          address: 'New address',
          lat: 90,
          lng: -180,
          precision: 'exact' as const,
        },
      },
    };
    const mutate = vi.fn().mockResolvedValue({
      clientMutationId: 'mutation_location_01',
      results: [{ index: 0, status: 'applied', record: saved }],
      changeCursor: 'change_02',
    } satisfies MutationResult);
    const controller = new GridViewController(
      withMutation(
        createData([initial], createGridConfig(false), [], [createLocationField()]),
        mutate,
      ),
    );
    await controller.load();

    await controller.editLocation('record_01', 'field_location', {
      kind: 'set',
      value: {
        label: ' New label ',
        address: 'New address',
        lat: 90,
        lng: -180,
        precision: 'exact',
      },
    });

    expect(mutate).toHaveBeenCalledWith(
      'table_01',
      expect.objectContaining({
        commands: [
          expect.objectContaining({
            kind: 'updateRecord',
            recordId: 'record_01',
            expectedRevision: 1,
            set: {
              field_location: {
                label: 'New label',
                address: 'New address',
                lat: 90,
                lng: -180,
                precision: 'exact',
              },
            },
          }),
        ],
      }),
    );
    expect(controller.state.records[0]).toEqual(saved);
    expect(controller.state.editError).toBeNull();
  });

  it('keeps explicit Location clear distinct from Unset', async () => {
    const initial = locationRecord({ label: 'Old label', lat: 10, lng: 20 });
    const cleared = {
      ...initial,
      revision: 2,
      values: { ...initial.values, field_location: null },
    };
    const unset = { ...initial, revision: 3, values: { field_name: 'Record 1' } };
    const mutate = vi
      .fn<(tableId: string, request: MutationRequest) => Promise<MutationResult>>()
      .mockResolvedValueOnce({
        clientMutationId: 'mutation_location_02',
        results: [{ index: 0, status: 'applied', record: cleared }],
        changeCursor: 'change_02',
      } satisfies MutationResult)
      .mockResolvedValueOnce({
        clientMutationId: 'mutation_location_03',
        results: [{ index: 0, status: 'applied', record: unset }],
        changeCursor: 'change_03',
      } satisfies MutationResult);
    const controller = new GridViewController(
      withMutation(
        createData([initial], createGridConfig(false), [], [createLocationField()]),
        mutate,
      ),
    );
    await controller.load();

    await controller.editLocation('record_01', 'field_location', { kind: 'clear' });
    expect(mutate.mock.calls[0]?.[1].commands[0]).toMatchObject({
      kind: 'updateRecord',
      set: { field_location: null },
    });
    expect(controller.state.records[0]?.values).toHaveProperty('field_location', null);

    await controller.editLocation('record_01', 'field_location', { kind: 'unset' });
    expect(mutate.mock.calls[1]?.[1].commands[0]).toMatchObject({
      kind: 'updateRecord',
      unsetFieldIds: ['field_location'],
    });
    expect(controller.state.records[0]?.values).not.toHaveProperty('field_location');
  });

  it('does not collapse durable auth, terminal, or conflict states into Saved', async () => {
    const conflict = {
      clientMutationId: 'mut_0123456789ABCDEFGHJKMNPQRS',
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
    } as const;
    const scenarios = [
      {
        state: 'auth-paused' as const,
        expectedStatus: 'error' as const,
        error: new LoomTableClientError('authentication', {
          message: 'Authentication is required.',
          httpStatus: 401,
        }),
      },
      {
        state: 'terminal' as const,
        expectedStatus: 'error' as const,
        error: new LoomTableClientError('validation', {
          message: 'The Server rejected this mutation.',
          httpStatus: 422,
        }),
      },
      {
        state: 'conflict' as const,
        expectedStatus: 'conflict' as const,
        error: new LoomTableClientError(
          'conflict',
          { message: 'The Record changed on the Server.', code: 'CONFLICT', httpStatus: 409 },
          undefined,
          conflict,
        ),
        conflict,
      },
    ];

    for (const scenario of scenarios) {
      const client = new InMemoryLoomTableClient(
        createData(createRecords(1), createGridConfig(false)),
      );
      const queue = new FakeDurableQueue(scenario.state, scenario.conflict);
      const controller = new GridViewController(client, { mutationQueue: queue });
      await controller.load();

      const edit = controller.editCell('record_01', 'field_name', 'Local value');
      if (scenario.state === 'auth-paused') {
        await vi.waitFor(() => expect(controller.state.saveStatus).toBe('error'));
      } else {
        await expect(edit).rejects.toMatchObject({ kind: scenario.error.kind });
      }
      expect(controller.state.saveStatus).toBe(scenario.expectedStatus);
      expect(controller.state.saveStatus).not.toBe('saved');
      controller.dispose();
    }
  });

  it('reports auth gating when durable enqueue rejects before creating an entry', async () => {
    const transport = {
      mutate: vi.fn<(tableId: string, request: MutationRequest) => Promise<MutationResult>>(),
    };
    const scheduler = new MutationQueueScheduler({
      store: new MutationQueueStore({ schemaVersion: 1, entries: [] }),
      transport,
    });
    await scheduler.start();
    await scheduler.setOnline(true);

    const controller = new GridViewController(
      new InMemoryLoomTableClient(createData(createRecords(1), createGridConfig(false))),
      {
        mutationQueue: scheduler,
        mutationIdFactory: () => 'mut_0123456789ABCDEFGHJKMNPQRS',
        isOffline: () => false,
      },
    );
    await controller.load();

    await expect(
      controller.editCell('record_01', 'field_name', 'Local value'),
    ).rejects.toMatchObject({ kind: 'authentication' });

    expect(scheduler.getSnapshot().entries).toHaveLength(0);
    expect(controller.state.records[0]?.values.field_name).toBe('Record 1');
    expect(controller.state.editError).toMatchObject({
      message: 'Authentication is required before this mutation can be queued.',
      httpStatus: 401,
    });
    expect(controller.state.saveStatus).toBe('error');
    expect(controller.state.saveStatus).not.toBe('saved');

    controller.dispose();
    scheduler.stop();
  });

  it('preserves an existing optimistic edit when a later durable enqueue is rejected', async () => {
    const queue = new QueuedDurableQueue();
    const controller = new GridViewController(
      new InMemoryLoomTableClient(createData(createRecords(1), createGridConfig(false))),
      {
        mutationQueue: queue,
        mutationIdFactory: () => 'mut_0123456789ABCDEFGHJKMNPQRS',
        isOffline: () => false,
      },
    );
    await controller.load();

    const firstEdit = controller.editCell('record_01', 'field_name', 'First local value');
    await vi.waitFor(() => expect(queue.getRecordSnapshot('record_01').pending).toBe(1));
    expect(controller.state.records[0]?.values.field_name).toBe('First local value');

    await expect(
      controller.editCell('record_01', 'field_name', 'Second local value'),
    ).rejects.toMatchObject({ kind: 'authentication' });

    expect(queue.getRecordSnapshot('record_01')).toMatchObject({
      state: 'queued',
      pending: 1,
    });
    expect(controller.state.records[0]?.values.field_name).toBe('First local value');
    expect(controller.state.editError).toMatchObject({
      message: 'Authentication is required before this mutation can be queued.',
      httpStatus: 401,
    });
    expect(controller.state.saveStatus).toBe('error');
    expect(controller.state.saveStatus).not.toBe('saved');

    controller.dispose();
    void firstEdit;
  });

  it('can edit a Map-selected Record that is outside the current Grid page', async () => {
    const visible = createRecords(1)[0];
    if (visible === undefined) throw new Error('Grid fixture is missing.');
    const source = { ...locationRecord({ label: 'Map value', lat: 1, lng: 2 }), id: 'record_99' };
    const updated = {
      ...source,
      revision: 2,
      values: { ...source.values, field_location: { label: 'Updated', lat: 3, lng: 4 } },
    };
    const mutate = vi
      .fn<(tableId: string, request: MutationRequest) => Promise<MutationResult>>()
      .mockResolvedValue({
        clientMutationId: 'mutation_map_record_01',
        results: [{ index: 0, status: 'applied', record: updated }],
        changeCursor: 'change_04',
      } satisfies MutationResult);
    const controller = new GridViewController(
      withMutation(
        createData([visible], createGridConfig(false), [], [createLocationField()]),
        mutate,
      ),
    );
    await controller.load();

    await controller.editLocation(
      'record_99',
      'field_location',
      {
        kind: 'set',
        value: { label: 'Updated', lat: 3, lng: 4 },
      },
      source,
    );

    expect(mutate.mock.calls[0]?.[1].commands[0]).toMatchObject({
      recordId: 'record_99',
      expectedRevision: 1,
      set: { field_location: { label: 'Updated', lat: 3, lng: 4 } },
    });
  });

  it('rejects Location edits while offline before sending a Mutation', async () => {
    const mutate = vi.fn<(tableId: string, request: MutationRequest) => Promise<MutationResult>>();
    const controller = new GridViewController(
      withMutation(
        createData(
          [locationRecord({ label: 'Old label', lat: 10, lng: 20 })],
          createGridConfig(false),
          [],
          [createLocationField()],
        ),
        mutate,
      ),
      { isOffline: () => true },
    );
    await controller.load();

    await expect(
      controller.editLocation('record_01', 'field_location', {
        kind: 'set',
        value: { label: 'Offline', lat: 1, lng: 2 },
      }),
    ).rejects.toMatchObject({ kind: 'validation' });
    expect(mutate).not.toHaveBeenCalled();
    expect(controller.state.editError?.message).toContain('offline');
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
    expect(controller.state.editDrafts).toEqual([]);
  });

  it('rolls back an optimistic value while preserving the mutation error state', async () => {
    const data = createData(createRecords(1), createGridConfig(false));
    const mutate = vi.fn().mockRejectedValue(
      new LoomTableClientError('validation', {
        code: 'BAD_REQUEST',
        message: 'The clientMutationId is invalid.',
      }),
    );
    const controller = new GridViewController(withMutation(data, mutate));
    await controller.load();

    await expect(
      controller.editCell('record_01', 'field_name', 'Optimistic'),
    ).rejects.toMatchObject({ kind: 'validation' });

    expect(controller.state.records[0]?.values.field_name).toBe('Record 1');
    expect(controller.state.editStatuses.record_01).toBe('error');
    expect(controller.state.editError).toMatchObject({
      code: 'BAD_REQUEST',
      message: 'The clientMutationId is invalid.',
    });
    expect(controller.state.editDrafts).toEqual([
      {
        recordId: 'record_01',
        fieldId: 'field_name',
        rawValue: 'Optimistic',
      },
    ]);
  });

  it('binds a prototype mutation method and accepts an unchanged response', async () => {
    const data = createData(createRecords(1), createGridConfig(false));
    const client = new PrototypeMutationClient(data, data.records[0]);
    const request: MutationRequest = {
      clientMutationId: 'unbound_mutation',
      commands: [
        {
          kind: 'updateRecord',
          recordId: 'record_01',
          expectedRevision: 1,
          set: { field_name: 'Record 1' },
        },
      ],
    };
    const unbound = client.mutate.bind(undefined);
    await expect(unbound('table_01', request)).rejects.toThrow(TypeError);

    const controller = new GridViewController(client);
    await controller.load();

    await expect(controller.editCell('record_01', 'field_name', 'Record 1')).resolves.toMatchObject(
      {
        id: 'record_01',
        revision: 1,
        values: { field_name: 'Record 1' },
      },
    );

    expect(client.mutationRequests).toHaveLength(1);
    expect(client.mutationRequests[0]?.request.commands[0]).toMatchObject({
      kind: 'updateRecord',
      recordId: 'record_01',
      expectedRevision: 1,
      set: { field_name: 'Record 1' },
    });
    expect(controller.state.records[0]).toMatchObject({
      id: 'record_01',
      revision: 1,
      values: { field_name: 'Record 1' },
    });
    expect(controller.state.editStatuses.record_01).toBeUndefined();
    expect(controller.state.editError).toBeNull();
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
    expect(controller.state.saveStatus).toBe('conflict');

    controller.resolveConflict('record_01', 'overwrite');
    await vi.waitFor(() => expect(mutate).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(controller.state.records[0]?.revision).toBe(3));
    expect(mutate.mock.calls[1]?.[1].commands[0]).toMatchObject({ expectedRevision: 2 });
    expect(controller.state.conflicts).toHaveLength(0);
    expect(controller.state.records[0]?.revision).toBe(3);
  });

  it('keeps the full durable Conflict metadata and retries overwrite with a fresh request', async () => {
    const conflict: ConflictDetails = {
      clientMutationId: 'mut_0123456789ABCDEFGHJKMNPQRS',
      failedCommandIndex: 0,
      conflicts: [
        {
          recordId: 'record_01',
          expectedRevision: 1,
          currentRevision: 2,
          currentValues: { field_name: 'Server value', field_other: 7 },
          submittedSet: { field_name: 'Local value' },
          submittedUnsetFieldIds: ['field_other'],
        },
      ],
    };
    const transport = {
      mutate: vi.fn<DurableMutationQueueTransport['mutate']>(),
    };
    transport.mutate.mockRejectedValueOnce(
      new LoomTableClientError(
        'conflict',
        { message: 'Revision conflict.', code: 'CONFLICT', httpStatus: 409 },
        undefined,
        conflict,
      ),
    );
    transport.mutate.mockImplementationOnce(async (_tableId, request) =>
      mutationResult(request.clientMutationId, 'Local value', 3),
    );
    const scheduler = new MutationQueueScheduler({
      store: new MutationQueueStore({ schemaVersion: 1, entries: [] }),
      transport,
    });
    await scheduler.setOnline(true);
    await scheduler.setAuthReady(true);
    await scheduler.start();

    const controller = new GridViewController(
      new InMemoryLoomTableClient(createData(createRecords(1), createGridConfig(false))),
      {
        mutationQueue: scheduler,
        mutationIdFactory: () => conflict.clientMutationId,
        isOffline: () => false,
      },
    );
    await controller.load();

    await expect(
      controller.editCell('record_01', 'field_name', 'Local value'),
    ).rejects.toMatchObject({ kind: 'conflict' });

    expect(controller.state.conflicts[0]).toMatchObject({
      clientMutationId: conflict.clientMutationId,
      failedCommandIndex: 0,
      expectedRevision: 1,
      currentRevision: 2,
      currentValues: { field_name: 'Server value', field_other: 7 },
      submittedSet: { field_name: 'Local value' },
      submittedUnsetFieldIds: ['field_other'],
    });
    expect(controller.state.saveStatus).toBe('conflict');

    controller.resolveConflict('record_01', 'overwrite');
    await vi.waitFor(() => expect(transport.mutate).toHaveBeenCalledTimes(2));

    const retryRequest = transport.mutate.mock.calls[1]?.[1];
    expect(retryRequest?.clientMutationId).toMatch(/^mut_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(retryRequest?.clientMutationId).not.toBe(conflict.clientMutationId);
    expect(retryRequest?.commands[0]).toMatchObject({
      kind: 'updateRecord',
      recordId: 'record_01',
      expectedRevision: 2,
      set: { field_name: 'Local value' },
      unsetFieldIds: ['field_other'],
    });

    controller.dispose();
    scheduler.stop();
  });

  it('keeps a replacement conflict visible when overwrite conflicts again', async () => {
    const firstConflict: ConflictDetails = {
      clientMutationId: 'mut_0123456789ABCDEFGHJKMNPQRS',
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
    };
    const transport = {
      mutate: vi.fn<DurableMutationQueueTransport['mutate']>(),
    };
    transport.mutate.mockRejectedValueOnce(
      new LoomTableClientError(
        'conflict',
        { message: 'Revision conflict.', code: 'CONFLICT', httpStatus: 409 },
        undefined,
        firstConflict,
      ),
    );
    transport.mutate.mockImplementationOnce(async (_tableId, request) => {
      const command = request.commands[0];
      if (command?.kind !== 'updateRecord') throw new Error('Unexpected command.');
      const secondConflict: ConflictDetails = {
        clientMutationId: request.clientMutationId,
        failedCommandIndex: 0,
        conflicts: [
          {
            recordId: command.recordId,
            expectedRevision: command.expectedRevision,
            currentRevision: command.expectedRevision + 1,
            currentValues: { field_name: 'New Server value' },
            submittedSet: { field_name: 'Local value' },
          },
        ],
      };
      throw new LoomTableClientError(
        'conflict',
        { message: 'Revision conflict again.', code: 'CONFLICT', httpStatus: 409 },
        undefined,
        secondConflict,
      );
    });
    const scheduler = new MutationQueueScheduler({
      store: new MutationQueueStore({ schemaVersion: 1, entries: [] }),
      transport,
    });
    await scheduler.setOnline(true);
    await scheduler.setAuthReady(true);
    await scheduler.start();

    const controller = new GridViewController(
      new InMemoryLoomTableClient(createData(createRecords(1), createGridConfig(false))),
      {
        mutationQueue: scheduler,
        mutationIdFactory: () => firstConflict.clientMutationId,
        isOffline: () => false,
      },
    );
    await controller.load();

    await expect(
      controller.editCell('record_01', 'field_name', 'Local value'),
    ).rejects.toMatchObject({ kind: 'conflict' });

    controller.resolveConflict('record_01', 'overwrite');
    await vi.waitFor(() => expect(transport.mutate).toHaveBeenCalledTimes(2));
    await vi.waitFor(() =>
      expect(controller.state.conflicts[0]?.clientMutationId).not.toBe(
        firstConflict.clientMutationId,
      ),
    );
    expect(controller.state.conflicts[0]?.currentRevision).toBe(3);
    expect(controller.state.saveStatus).toBe('conflict');

    controller.dispose();
    scheduler.stop();
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

  it('loads a complete Record before rendering Detail for a sparse Query projection', async () => {
    const completeRecord = locationRecord({ lat: 1, lng: 2, precision: 'exact' });
    const sparseRecord = { ...completeRecord, values: { field_name: 'Record 1' } };
    const data = createData([sparseRecord], createGridConfig(false), [], [createLocationField()]);
    const getRecord = vi.fn().mockResolvedValue(completeRecord);
    const controller = new GridViewController(withGetRecord(data, getRecord));

    await controller.load();
    const queriedRecord = controller.state.records[0];
    expect(queriedRecord).toBeDefined();
    if (queriedRecord === undefined) return;

    const detailRecord = await loadRecordForDetail(controller, queriedRecord);
    expect(getRecord).toHaveBeenCalledWith(queriedRecord.id);
    const container = document.createElement('div');
    container.append(
      createRecordDetail(detailRecord, {
        fields: controller.state.fields,
        translate: createTranslator('en'),
        callbacks: { onLocationEdit: vi.fn() },
      }),
    );
    expect(container.querySelector('.loom-location-values')).not.toBeNull();
    expect(container.querySelector<HTMLButtonElement>('.loom-location-edit')?.disabled).toBe(false);
  });

  it('does not fetch a Record that already contains the full Query field set', async () => {
    const completeRecord = locationRecord({ lat: 1, lng: 2, precision: 'exact' });
    const data = createData([completeRecord], createGridConfig(false), [], [createLocationField()]);
    const getRecord = vi.fn().mockResolvedValue(completeRecord);
    const controller = new GridViewController(withGetRecord(data, getRecord));

    await controller.load();
    const queriedRecord = controller.state.records[0];
    expect(queriedRecord).toBeDefined();
    if (queriedRecord === undefined) return;

    const detailRecord = await loadRecordForDetail(controller, queriedRecord);
    expect(getRecord).not.toHaveBeenCalled();
    expect(detailRecord).toBe(queriedRecord);
  });
});

it('uses the durable queue seam instead of the client mutation bypass and applies the full returned Record', async () => {
  const data = createData(createRecords(1), createGridConfig(false));
  const client = new InMemoryLoomTableClient(data);
  const saves: MutationQueueSettingsV2[] = [];
  const returnedRecord = {
    ...data.records[0]!,
    revision: 2,
    values: { field_name: 'Server authoritative' },
  };
  const transport = {
    mutate: vi.fn(async (_tableId: string, request: MutationRequest): Promise<MutationResult> => ({
      clientMutationId: request.clientMutationId,
      results: [{ index: 0, status: 'applied', record: returnedRecord }],
      changeCursor: 'opaque-change-cursor',
    })),
  };
  const store = new MutationQueueStore(
    { schemaVersion: 1, entries: [] },
    {
      async load() {
        return { schemaVersion: 1, entries: [] };
      },
      async save(value) {
        saves.push(value);
      },
    },
  );
  const scheduler = new MutationQueueScheduler({
    store,
    transport,
    random: () => 0.5,
  });
  await scheduler.setOnline(true);
  await scheduler.setAuthReady(true);
  await scheduler.start();

  const controller = new GridViewController(client, {
    mutationQueue: scheduler,
    mutationIdFactory: () => 'mut_0123456789ABCDEFGHJKMNPQRS',
  });
  await controller.load();
  const detailResult = await controller.editCell('record_01', 'field_name', 'Local intent');

  expect(client.mutationRequests).toHaveLength(0);
  expect(transport.mutate).toHaveBeenCalledWith(
    'table_01',
    expect.objectContaining({
      clientMutationId: 'mut_0123456789ABCDEFGHJKMNPQRS',
      commands: [
        {
          kind: 'updateRecord',
          recordId: 'record_01',
          expectedRevision: 1,
          set: { field_name: 'Local intent' },
        },
      ],
    }),
  );
  expect(detailResult).toEqual(returnedRecord);
  expect(controller.state.records[0]).toEqual(returnedRecord);
  expect(controller.state.saveStatus).toBe('saved');
  expect(
    saves.some((snapshot) =>
      snapshot.entries.some(
        (entry) =>
          entry.clientMutationId === 'mut_0123456789ABCDEFGHJKMNPQRS' &&
          entry.request.commands[0]?.kind === 'updateRecord' &&
          entry.request.commands[0].set?.field_name === 'Local intent',
      ),
    ),
  ).toBe(true);
  scheduler.stop();
});

describe('GridViewController View creation', () => {
  it('creates a Grid View with the primary-field default config and selects it', async () => {
    const client = new InMemoryLoomTableClient(
      createData(createRecords(1), createGridConfig(false)),
    );
    const controller = new GridViewController(client);
    await controller.load();

    const outcome = await controller.createView({ type: 'grid', name: 'Board' });

    expect(outcome.status).toBe('created');
    if (outcome.status !== 'created' || outcome.view.type !== 'grid') {
      throw new Error('Expected a created Grid View.');
    }
    expect(outcome.view.config.projection).toEqual(['field_name']);
    expect(outcome.view.config.columnOrder).toEqual(['field_name']);
    expect(controller.state.selectedViewId).toBe(outcome.view.id);
    expect(controller.state.views.some((view) => view.id === outcome.view.id)).toBe(true);
    expect(client.viewCreateKeys).toHaveLength(1);
  });

  it('delegates a created Map View to the non-grid surface', async () => {
    const client = new InMemoryLoomTableClient(
      createData(createRecords(1), createGridConfig(false), [], [createLocationField()]),
    );
    const onNonGridViewSelected = vi.fn<(view: View, state: GridState) => void>();
    const controller = new GridViewController(client, { onNonGridViewSelected });
    await controller.load();

    const outcome = await controller.createView({
      type: 'map',
      name: 'Map',
      locationFieldId: 'field_location',
    });

    expect(outcome.status).toBe('created');
    expect(onNonGridViewSelected).toHaveBeenCalledTimes(1);
    const [delegatedView, delegatedState] = onNonGridViewSelected.mock.calls[0] ?? [];
    if (outcome.status !== 'created') throw new Error('Expected a created Map View.');
    expect(delegatedView?.id).toBe(outcome.view.id);
    expect(delegatedState?.views.some((view) => view.id === outcome.view.id)).toBe(true);
  });

  it('does not attempt a View write while offline', async () => {
    const client = new InMemoryLoomTableClient(
      createData(createRecords(1), createGridConfig(false)),
    );
    const controller = new GridViewController(client, { isOffline: () => true });
    await controller.load();

    const outcome = await controller.createView({ type: 'grid', name: 'Board' });

    expect(outcome.status).toBe('failed');
    expect(client.viewCreateKeys).toHaveLength(0);
  });

  it('rejects a Map View without an active Location Field before any write', async () => {
    const client = new InMemoryLoomTableClient(
      createData(createRecords(1), createGridConfig(false)),
    );
    const controller = new GridViewController(client);
    await controller.load();

    const outcome = await controller.createView({
      type: 'map',
      name: 'Map',
      locationFieldId: 'field_missing',
    });

    expect(outcome.status).toBe('failed');
    expect(client.viewCreateKeys).toHaveLength(0);
  });

  it('keeps an unconfirmed create durable, retries it once, and supports dismiss', async () => {
    const client = new InMemoryLoomTableClient(
      createData(createRecords(1), createGridConfig(false)),
    );
    vi.spyOn(client, 'createView').mockImplementationOnce(async () => {
      throw new LoomTableClientError('network', { message: 'offline' });
    });
    const intents = createIntentStore();
    const controller = new GridViewController(client, { viewIntents: intents.store });
    await controller.load();

    const outcome = await controller.createView({ type: 'grid', name: 'Board' });
    expect(outcome.status).toBe('unresolved');
    expect(intents.store.list()).toHaveLength(1);
    expect(controller.state.pendingViewIntents).toHaveLength(1);

    const intentId = intents.store.list()[0]?.intentId ?? '';
    const retried = await controller.retryViewIntent(intentId);
    expect(retried?.status).toBe('created');
    expect(intents.store.list()).toHaveLength(0);
    expect(controller.state.pendingViewIntents).toHaveLength(0);
    expect(client.viewCreateKeys).toEqual([intentId]);
    if (retried?.status === 'created') {
      expect(controller.state.selectedViewId).toBe(retried.view.id);
    }

    vi.spyOn(client, 'createView').mockImplementationOnce(async () => {
      throw new LoomTableClientError('network', { message: 'offline' });
    });
    const second = await controller.createView({ type: 'grid', name: 'Later' });
    expect(second.status).toBe('unresolved');
    await controller.dismissViewIntent(intents.store.list()[0]?.intentId ?? '');
    expect(intents.store.list()).toHaveLength(0);
    expect(controller.state.pendingViewIntents).toHaveLength(0);
  });

  it('falls back to another View when the selected View was deleted', async () => {
    const client = new InMemoryLoomTableClient(
      createData(createRecords(1), createGridConfig(false), [
        { ...createView(createGridConfig(false)), id: 'view_02', name: 'Second' },
      ]),
    );
    const controller = new GridViewController(client);
    await controller.load();
    await controller.selectView('view_02');
    expect(controller.state.selectedViewId).toBe('view_02');

    await client.deleteView('view_02', 1);
    await controller.refresh();

    expect(controller.state.status).toBe('ready');
    expect(controller.state.selectedViewId).toBe('view_01');
  });

  it('reports an empty View state when the Table has no Views', async () => {
    const data = createData(createRecords(1), createGridConfig(false));
    const client = new InMemoryLoomTableClient({ ...data, views: [] });
    const controller = new GridViewController(client);
    await controller.load();

    expect(controller.state.status).toBe('empty');
    expect(controller.state.emptyReason).toBe('view');
    expect(controller.state.selectedViewId).toBeNull();
    expect(controller.state.views).toEqual([]);
  });
});

describe('GridViewController View management', () => {
  it('lists deleted Views for the manage panel and reports load failures', async () => {
    const client = new InMemoryLoomTableClient(
      createData(createRecords(1), createGridConfig(false), [
        {
          ...createView(createGridConfig(false)),
          id: 'view_deleted',
          name: 'Old Board',
          revision: 3,
          deletedAt: '2026-09-01T00:00:00Z',
        },
      ]),
    );
    const controller = new GridViewController(client);
    await controller.load();

    await controller.openManageViews();

    expect(controller.state.deletedViewsStatus).toBe('ready');
    expect(controller.state.deletedViews.map((view) => view.id)).toEqual(['view_deleted']);

    const failing = new InMemoryLoomTableClient(
      createData(createRecords(1), createGridConfig(false)),
    );
    vi.spyOn(failing, 'listViews').mockImplementation(async (_tableId, options) => {
      if (options?.lifecycle === 'deleted') {
        throw new LoomTableClientError('network', { message: 'offline' });
      }
      return [];
    });
    const failingController = new GridViewController(failing);
    await failingController.load();
    await failingController.openManageViews();
    expect(failingController.state.deletedViewsStatus).toBe('error');
  });

  it('renames a View with the full config and revision, then reloads the selected query', async () => {
    const client = new InMemoryLoomTableClient(
      createData(createRecords(2), createGridConfig(false)),
    );
    const controller = new GridViewController(client);
    await controller.load();
    const queriesBefore = client.queryRequests.length;

    const updateView = vi.spyOn(client, 'updateView');
    const outcome = await controller.renameView('view_01', 'Renamed Board');

    expect(outcome.status).toBe('saved');
    const renamed = controller.state.views.find((view) => view.id === 'view_01');
    expect(renamed?.name).toBe('Renamed Board');
    expect(renamed?.revision).toBe(2);
    expect(client.queryRequests.length).toBeGreaterThan(queriesBefore);
    const update = updateView.mock.calls.at(-1);
    expect(update?.[1]).toEqual({
      type: 'grid',
      name: 'Renamed Board',
      config: createGridConfig(false),
      expectedRevision: 1,
    });
  });

  it('stores a conflict issue with the latest View and adopts or re-edits on it', async () => {
    const client = new InMemoryLoomTableClient(
      createData(createRecords(1), createGridConfig(false)),
    );
    const controller = new GridViewController(client);
    await controller.load();
    await client.updateView('view_01', {
      type: 'grid',
      name: 'Elsewhere',
      config: createGridConfig(false),
      expectedRevision: 1,
    });

    const conflicted = await controller.renameView('view_01', 'Local name');

    expect(conflicted.status).toBe('conflict');
    const issue = controller.state.viewWriteIssues['view_01'];
    expect(issue?.kind).toBe('conflict');
    expect(issue?.latestView?.name).toBe('Elsewhere');

    await controller.resolveViewConflict('view_01', 're-edit');
    expect(controller.state.viewWriteIssues['view_01']).toBeUndefined();

    const reapplied = await controller.renameView('view_01', 'Local name');
    expect(reapplied.status).toBe('saved');
    expect(controller.state.views.find((view) => view.id === 'view_01')?.name).toBe('Local name');
  });

  it('adopts the latest View on a conflict without reapplying stale edits', async () => {
    const client = new InMemoryLoomTableClient(
      createData(createRecords(1), createGridConfig(false)),
    );
    const controller = new GridViewController(client);
    await controller.load();
    await client.updateView('view_01', {
      type: 'grid',
      name: 'Elsewhere',
      config: createGridConfig(false),
      expectedRevision: 1,
    });
    await controller.renameView('view_01', 'Local name');

    await controller.resolveViewConflict('view_01', 'adopt-latest');

    const view = controller.state.views.find((candidate) => candidate.id === 'view_01');
    expect(view?.name).toBe('Elsewhere');
    expect(view?.revision).toBe(2);
    expect(controller.state.viewWriteIssues['view_01']).toBeUndefined();
  });

  it('copies a View with the saved config under a confirmed name', async () => {
    const client = new InMemoryLoomTableClient(
      createData(createRecords(1), createGridConfig(true)),
    );
    const controller = new GridViewController(client);
    await controller.load();

    const outcome = await controller.copyView('view_01', 'Board copy');

    expect(outcome.status).toBe('created');
    if (outcome.status !== 'created' || outcome.view.type !== 'grid') {
      throw new Error('Expected a created Grid View.');
    }
    expect(outcome.view.name).toBe('Board copy');
    expect(outcome.view.config).toEqual(createGridConfig(true));
    expect(outcome.view.revision).toBe(1);
    expect(controller.state.selectedViewId).toBe(outcome.view.id);
  });

  it('drops stale display-only Field references when copying a View', async () => {
    const stale: View = {
      ...createView(createGridConfig(false)),
      config: {
        ...createGridConfig(false),
        columnOrder: ['field_name', 'field_gone'],
        columnWidths: { field_name: 180, field_gone: 240 },
        frozenFieldIds: ['field_gone'],
      },
    };
    const client = new InMemoryLoomTableClient({
      ...createData(createRecords(1), createGridConfig(false)),
      views: [stale],
    });
    const controller = new GridViewController(client);
    await controller.load();

    const outcome = await controller.copyView('view_01', 'Copy');

    expect(outcome.status).toBe('created');
    if (outcome.status !== 'created' || outcome.view.type !== 'grid') {
      throw new Error('Expected a created Grid View.');
    }
    expect(outcome.view.config.columnOrder).toEqual(['field_name']);
    expect(outcome.view.config.columnWidths).toEqual({ field_name: 180 });
    expect(outcome.view.config.frozenFieldIds).toEqual([]);
  });

  it('blocks copying a View with broken query refs until it is repaired', async () => {
    const broken: View = {
      ...createView(createGridConfig(false)),
      config: { ...createGridConfig(false), projection: ['field_name', 'field_gone'] },
    };
    const client = new InMemoryLoomTableClient({
      ...createData(createRecords(1), createGridConfig(false)),
      views: [broken],
    });
    const controller = new GridViewController(client);
    await controller.load();

    const outcome = await controller.copyView('view_01', 'Copy');

    expect(outcome.status).toBe('repair-required');
    expect(client.viewCreateKeys).toHaveLength(0);
  });

  it('deletes a non-selected View and keeps the current selection', async () => {
    const client = new InMemoryLoomTableClient(
      createData(createRecords(1), createGridConfig(false), [
        { ...createView(createGridConfig(false)), id: 'view_02', name: 'Second' },
      ]),
    );
    const controller = new GridViewController(client);
    await controller.load();

    const outcome = await controller.deleteView('view_02');

    expect(outcome.status).toBe('deleted');
    expect(controller.state.views.map((view) => view.id)).toEqual(['view_01']);
    expect(controller.state.selectedViewId).toBe('view_01');
  });

  it('selects the next active View after deleting the selected one, then the previous', async () => {
    const client = new InMemoryLoomTableClient(
      createData(createRecords(1), createGridConfig(false), [
        { ...createView(createGridConfig(false)), id: 'view_02', name: 'Second' },
        { ...createView(createGridConfig(false)), id: 'view_03', name: 'Third' },
      ]),
    );
    const controller = new GridViewController(client);
    await controller.load();
    await controller.selectView('view_02');

    const deleted = await controller.deleteView('view_02');
    expect(deleted.status).toBe('deleted');
    expect(controller.state.selectedViewId).toBe('view_03');

    await controller.selectView('view_01');
    await controller.deleteView('view_03');
    expect(controller.state.selectedViewId).toBe('view_01');

    await controller.deleteView('view_01');
    expect(controller.state.selectedViewId).toBeNull();
    expect(controller.state.status).toBe('empty');
    expect(controller.state.emptyReason).toBe('view');
  });

  it('restores a deleted View and refreshes both lists', async () => {
    const client = new InMemoryLoomTableClient(
      createData(createRecords(1), createGridConfig(false), [
        {
          ...createView(createGridConfig(false)),
          id: 'view_deleted',
          name: 'Old Board',
          revision: 3,
          deletedAt: '2026-09-01T00:00:00Z',
        },
      ]),
    );
    const controller = new GridViewController(client);
    await controller.load();
    await controller.openManageViews();

    const outcome = await controller.restoreView('view_deleted');

    expect(outcome.status).toBe('saved');
    expect(controller.state.views.map((view) => view.id)).toEqual(['view_01', 'view_deleted']);
    expect(controller.state.deletedViews).toEqual([]);
  });

  it('repairs a broken View config with an explicit field removal', async () => {
    const broken: View = {
      ...createView(createGridConfig(false)),
      config: {
        ...createGridConfig(false),
        projection: ['field_name', 'field_gone'],
        columnOrder: ['field_name', 'field_gone'],
        sort: [{ fieldId: 'field_gone', direction: 'asc', nulls: 'last' }],
      },
    };
    const client = new InMemoryLoomTableClient({
      ...createData(createRecords(1), createGridConfig(false)),
      views: [broken],
    });
    const controller = new GridViewController(client);
    await controller.load();

    const outcome = await controller.repairView('view_01', { removeFieldIds: ['field_gone'] });

    expect(outcome.status).toBe('saved');
    const view = controller.state.views.find((candidate) => candidate.id === 'view_01');
    if (view?.type !== 'grid') throw new Error('Expected a Grid View.');
    expect(view.config.projection).toEqual(['field_name']);
    expect(view.config.columnOrder).toEqual(['field_name']);
    expect(view.config.sort).toEqual([]);
  });

  it('keeps an unresolved write retryable with the original revision and dismiss reconciles', async () => {
    const client = new InMemoryLoomTableClient(
      createData(createRecords(1), createGridConfig(false)),
    );
    vi.spyOn(client, 'updateView').mockImplementationOnce(async () => {
      throw new LoomTableClientError('timeout', { message: 'slow' });
    });
    const controller = new GridViewController(client);
    await controller.load();

    const unresolved = await controller.renameView('view_01', 'Maybe');
    expect(unresolved.status).toBe('unresolved');
    expect(controller.state.viewWriteIssues['view_01']?.kind).toBe('unresolved');

    const retried = await controller.retryViewWrite('view_01');
    expect(retried?.status).toBe('saved');
    expect(controller.state.views.find((view) => view.id === 'view_01')?.name).toBe('Maybe');
    expect(controller.state.viewWriteIssues['view_01']).toBeUndefined();

    vi.spyOn(client, 'updateView').mockImplementationOnce(async () => {
      throw new LoomTableClientError('network', { message: 'offline' });
    });
    await controller.renameView('view_01', 'Stuck');
    await controller.dismissViewWriteIssue('view_01');
    expect(controller.state.viewWriteIssues['view_01']).toBeUndefined();
  });

  it('marks a View write pending while in flight and blocks a second write', async () => {
    const client = new InMemoryLoomTableClient(
      createData(createRecords(1), createGridConfig(false)),
    );
    let release: (() => void) | undefined;
    vi.spyOn(client, 'updateView').mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve({ ...createView(createGridConfig(false)), revision: 2, name: 'Held' });
        }),
    );
    const controller = new GridViewController(client);
    await controller.load();

    const pending = controller.renameView('view_01', 'Held');
    expect(controller.state.viewWritePending).toEqual(['view_01']);

    const blocked = await controller.renameView('view_01', 'Other');
    expect(blocked.status).toBe('failed');

    release?.();
    await pending;
    expect(controller.state.viewWritePending).toEqual([]);
  });

  it('rejects all View management writes while offline without touching the client', async () => {
    const client = new InMemoryLoomTableClient(
      createData(createRecords(1), createGridConfig(false)),
    );
    const updateView = vi.spyOn(client, 'updateView');
    const controller = new GridViewController(client, { isOffline: () => true });
    await controller.load();

    expect((await controller.renameView('view_01', 'x')).status).toBe('failed');
    expect((await controller.copyView('view_01', 'x')).status).toBe('failed');
    expect((await controller.deleteView('view_01')).status).toBe('failed');
    expect((await controller.restoreView('view_01')).status).toBe('failed');
    expect((await controller.repairView('view_01', { removeFieldIds: [] })).status).toBe('failed');
    expect(updateView).not.toHaveBeenCalled();
  });
});

describe('GridViewController query controls', () => {
  const containsRule = (value: string): FilterNode => ({
    kind: 'rule',
    fieldId: 'field_name',
    operator: 'contains',
    value,
  });
  const selectedConfig = (controller: GridViewController): GridViewConfig => {
    const view = controller.state.views.find(
      (candidate) => candidate.id === controller.state.selectedViewId,
    );
    if (view?.type !== 'grid') throw new Error('The selected View is not a Grid View.');
    return view.config;
  };

  it('applies a normalized Search term without saving it to the View config', async () => {
    const client = new InMemoryLoomTableClient(
      createData(createRecords(3), createGridConfig(false)),
    );
    const controller = new GridViewController(client, { pageSize: 2 });
    await controller.load();

    await expect(controller.setSearch('  alpha  ')).resolves.toBe(true);

    expect(controller.state.search).toBe('alpha');
    const request = client.queryRequests.at(-1);
    expect(request?.search).toBe('alpha');
    expect(request?.cursor).toBeUndefined();
    expect(JSON.stringify(selectedConfig(controller))).not.toContain('search');
  });

  it('rejects an over-length Search and skips a request for an unchanged term', async () => {
    const client = new InMemoryLoomTableClient(
      createData(createRecords(1), createGridConfig(false)),
    );
    const controller = new GridViewController(client);
    await controller.load();
    expect(client.queryRequests).toHaveLength(1);

    await expect(controller.setSearch('x'.repeat(501))).resolves.toBe(false);
    expect(client.queryRequests).toHaveLength(1);
    expect(controller.state.search).toBe('');

    await controller.setSearch('alpha');
    await controller.setSearch(' alpha ');
    expect(client.queryRequests).toHaveLength(2);
  });

  it('clears an applied Search explicitly and re-queries from the first page', async () => {
    const client = new InMemoryLoomTableClient(
      createData(createRecords(3), createGridConfig(false)),
    );
    const controller = new GridViewController(client, { pageSize: 2 });
    await controller.load();
    await controller.setSearch('alpha');

    await controller.setSearch('   ');

    expect(controller.state.search).toBe('');
    const request = client.queryRequests.at(-1);
    expect(request).not.toHaveProperty('search');
    expect(request?.cursor).toBeUndefined();
  });

  it('reports a no-match empty result while a Search is applied', async () => {
    const client = new InMemoryLoomTableClient(createData([], createGridConfig(false)));
    const controller = new GridViewController(client);
    await controller.load();
    expect(controller.state.emptyReason).toBe('records');

    await controller.setSearch('alpha');

    expect(controller.state.status).toBe('empty');
    expect(controller.state.emptyReason).toBe('no-match');
  });

  it('keeps the applied Search on refresh and resets it when the View changes', async () => {
    const secondView = { ...createView(createGridConfig(false)), id: 'view_02', name: 'Second' };
    const client = new InMemoryLoomTableClient(
      createData(createRecords(1), createGridConfig(false), [secondView]),
    );
    const controller = new GridViewController(client);
    await controller.load();
    await controller.setSearch('alpha');

    await controller.refresh();
    expect(controller.state.search).toBe('alpha');
    expect(client.queryRequests.at(-1)?.search).toBe('alpha');

    await controller.selectView('view_02');
    expect(controller.state.search).toBe('');
    expect(client.queryRequests.at(-1)).not.toHaveProperty('search');
  });

  it('saves a Filter through the View write path and re-queries with it', async () => {
    const client = new InMemoryLoomTableClient(
      createData(createRecords(2), createGridConfig(false)),
    );
    const controller = new GridViewController(client);
    await controller.load();
    const rule = containsRule('needle');

    const outcome = await controller.applyViewFilter('view_01', rule);

    expect(outcome.status).toBe('saved');
    expect(selectedConfig(controller).filter).toEqual(rule);
    const request = client.queryRequests.at(-1);
    expect(request?.filter).toEqual(rule);
    expect(request?.cursor).toBeUndefined();
  });

  it('clears the saved Filter by writing a config without filter', async () => {
    const client = new InMemoryLoomTableClient(
      createData(createRecords(2), createGridConfig(true)),
    );
    const controller = new GridViewController(client);
    await controller.load();

    const outcome = await controller.applyViewFilter('view_01', undefined);

    expect(outcome.status).toBe('saved');
    expect('filter' in selectedConfig(controller)).toBe(false);
    expect(client.queryRequests.at(-1)).not.toHaveProperty('filter');
  });

  it('saves Sort changes and clears back to the Server default order', async () => {
    const client = new InMemoryLoomTableClient(
      createData(createRecords(2), createGridConfig(false)),
    );
    const controller = new GridViewController(client);
    await controller.load();
    const sort = [{ fieldId: 'field_name', direction: 'desc' as const, nulls: 'first' as const }];

    await expect(controller.applyViewSort('view_01', sort)).resolves.toMatchObject({
      status: 'saved',
    });
    expect(selectedConfig(controller).sort).toEqual(sort);
    expect(client.queryRequests.at(-1)?.sort).toEqual(sort);

    await expect(controller.applyViewSort('view_01', [])).resolves.toMatchObject({
      status: 'saved',
    });
    expect(selectedConfig(controller).sort).toEqual([]);
    expect(client.queryRequests.at(-1)).not.toHaveProperty('sort');
  });

  it('rejects an invalid Filter draft without a View write', async () => {
    const client = new InMemoryLoomTableClient(
      createData(createRecords(1), createGridConfig(false)),
    );
    const controller = new GridViewController(client);
    await controller.load();
    const updateSpy = vi.spyOn(client, 'updateView');

    const outcome = await controller.applyViewFilter('view_01', {
      kind: 'rule',
      fieldId: 'field_missing',
      operator: 'contains',
      value: 'x',
    });

    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') expect(outcome.kind).toBe('validation');
    expect(updateSpy).not.toHaveBeenCalled();
    expect(selectedConfig(controller).filter).toBeUndefined();
  });

  it('rejects duplicate or unsortable Sort drafts without a View write', async () => {
    const client = new InMemoryLoomTableClient(
      createData(createRecords(1), createGridConfig(false), [], [createLocationField()]),
    );
    const controller = new GridViewController(client);
    await controller.load();
    const updateSpy = vi.spyOn(client, 'updateView');

    const duplicate = await controller.applyViewSort('view_01', [
      { fieldId: 'field_name', direction: 'asc', nulls: 'first' },
      { fieldId: 'field_name', direction: 'desc', nulls: 'last' },
    ]);
    expect(duplicate.status).toBe('failed');

    const unsortable = await controller.applyViewSort('view_01', [
      { fieldId: 'field_location', direction: 'asc', nulls: 'first' },
    ]);
    expect(unsortable.status).toBe('failed');
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('saves a display patch through the View write path and re-queries with the projection', async () => {
    const client = new InMemoryLoomTableClient(
      createData(createRecords(2), createGridConfig(false), [], [createLocationField()]),
    );
    const controller = new GridViewController(client);
    await controller.load();

    const outcome = await controller.applyViewDisplay('view_01', {
      projection: ['field_name'],
      columnOrder: ['field_name', 'field_location'],
      columnWidths: { field_name: 240 },
      frozenFieldIds: ['field_name'],
      rowHeight: 'compact',
    });

    expect(outcome.status).toBe('saved');
    expect(selectedConfig(controller).projection).toEqual(['field_name']);
    expect(selectedConfig(controller).columnWidths).toEqual({ field_name: 240 });
    expect(selectedConfig(controller).frozenFieldIds).toEqual(['field_name']);
    expect(selectedConfig(controller).rowHeight).toBe('compact');
    const request = client.queryRequests.at(-1);
    expect(request?.projection).toEqual(['field_name']);
    expect(request?.cursor).toBeUndefined();
  });

  it('rejects an invalid display patch without a View write', async () => {
    const client = new InMemoryLoomTableClient(
      createData(createRecords(1), createGridConfig(false)),
    );
    const controller = new GridViewController(client);
    await controller.load();
    const updateSpy = vi.spyOn(client, 'updateView');

    const empty = await controller.applyViewDisplay('view_01', {
      projection: [],
      columnOrder: ['field_name'],
      columnWidths: {},
      frozenFieldIds: [],
      rowHeight: 'standard',
    });
    expect(empty.status).toBe('failed');

    const badWidth = await controller.applyViewDisplay('view_01', {
      projection: ['field_name'],
      columnOrder: ['field_name'],
      columnWidths: { field_name: 40 },
      frozenFieldIds: [],
      rowHeight: 'standard',
    });
    expect(badWidth.status).toBe('failed');

    const frozenHidden = await controller.applyViewDisplay('view_01', {
      projection: ['field_name'],
      columnOrder: ['field_name'],
      columnWidths: {},
      frozenFieldIds: ['field_other'],
      rowHeight: 'standard',
    });
    expect(frozenHidden.status).toBe('failed');
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('keeps the previous rows while a Filter write reloads the query', async () => {
    const client = new InMemoryLoomTableClient(
      createData(createRecords(2), createGridConfig(false)),
    );
    const controller = new GridViewController(client);
    await controller.load();
    let resolveReload!: (result: QueryResult) => void;
    vi.spyOn(client, 'query').mockImplementationOnce(
      () =>
        new Promise<QueryResult>((resolve) => {
          resolveReload = resolve;
        }),
    );

    const pending = controller.applyViewFilter('view_01', containsRule('needle'));
    await vi.waitFor(() => expect(controller.state.status).toBe('loading'));
    expect(controller.state.records).toHaveLength(2);

    resolveReload({
      items: [createRecords(1)[0]!],
      hasMore: false,
      changeCursor: 'change_02',
      totalCount: 1,
    });
    await pending;
    expect(controller.state.records).toHaveLength(1);
    expect(controller.state.status).toBe('ready');
  });

  it('keeps the old data and a discoverable issue when the Filter write fails', async () => {
    const client = new InMemoryLoomTableClient(
      createData(createRecords(2), createGridConfig(false)),
    );
    const controller = new GridViewController(client);
    await controller.load();
    vi.spyOn(client, 'updateView').mockRejectedValue(
      new LoomTableClientError('network', { message: 'offline' }),
    );

    const outcome = await controller.applyViewFilter('view_01', containsRule('needle'));

    expect(outcome.status).toBe('unresolved');
    expect(controller.state.viewWriteIssues['view_01']?.kind).toBe('unresolved');
    expect(controller.state.records).toHaveLength(2);
    expect(selectedConfig(controller).filter).toBeUndefined();
  });

  it('preserves the saved config and reports a refresh failure after a successful write', async () => {
    const client = new InMemoryLoomTableClient(
      createData(createRecords(2), createGridConfig(false)),
    );
    const controller = new GridViewController(client);
    await controller.load();
    vi.spyOn(client, 'query').mockRejectedValueOnce(
      new LoomTableClientError('server', { message: 'boom' }),
    );

    const outcome = await controller.applyViewFilter('view_01', containsRule('needle'));

    expect(outcome.status).toBe('saved');
    expect(selectedConfig(controller).filter).toEqual(containsRule('needle'));
    expect(controller.state.error?.message).toBe(
      'The View configuration was saved, but refreshing the data failed.',
    );
  });

  it('drops a stale continuation page issued before a Search change', async () => {
    const client = new InMemoryLoomTableClient(
      createData(createRecords(3), createGridConfig(false)),
    );
    const controller = new GridViewController(client, { pageSize: 2 });
    await controller.load();
    let resolvePage!: (result: QueryResult) => void;
    vi.spyOn(client, 'query').mockImplementationOnce(
      () =>
        new Promise<QueryResult>((resolve) => {
          resolvePage = resolve;
        }),
    );

    const pendingPage = controller.loadNextPage();
    await controller.setSearch('beta');
    resolvePage({
      items: [createRecords(3)[2]!],
      hasMore: false,
      changeCursor: 'change_02',
    });
    await pendingPage;

    expect(controller.state.records.map((record) => record.id)).toEqual(['record_01', 'record_02']);
    await controller.loadNextPage();
    expect(controller.state.records.map((record) => record.id)).toEqual([
      'record_01',
      'record_02',
      'record_03',
    ]);
  });

  it('dedupes overlapping Records across continuation pages', async () => {
    const client = new InMemoryLoomTableClient(
      createData(createRecords(3), createGridConfig(false)),
    );
    const controller = new GridViewController(client, { pageSize: 2 });
    const records = createRecords(3);
    vi.spyOn(client, 'query')
      .mockResolvedValueOnce({
        items: records.slice(0, 2),
        hasMore: true,
        nextCursor: 'cursor_1',
        changeCursor: 'change_01',
        totalCount: 3,
      })
      .mockResolvedValueOnce({
        items: [records[1]!, records[2]!],
        hasMore: false,
        changeCursor: 'change_02',
      });

    await controller.load();
    await controller.loadNextPage();

    expect(controller.state.records.map((record) => record.id)).toEqual([
      'record_01',
      'record_02',
      'record_03',
    ]);
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

  it('attaches the applied Search term to the query contract', () => {
    const view = createView(createGridConfig(false));

    expect(createGridQuery('table_01', view, 50, undefined, 'alpha')).toMatchObject({
      search: 'alpha',
    });
    expect(createGridQuery('table_01', view, 50, undefined, '')).not.toHaveProperty('search');
  });
});

class PrototypeMutationClient extends InMemoryLoomTableClient {
  readonly #unchangedRecord: LoomTableRecord;

  constructor(data: InMemoryGridData, unchangedRecord: LoomTableRecord | undefined) {
    super(data);
    if (unchangedRecord === undefined) throw new Error('A fixture Record is required.');
    this.#unchangedRecord = unchangedRecord;
  }

  override async mutate(tableId: string, request: MutationRequest): Promise<MutationResult> {
    this.mutationRequests.push({ tableId, request });
    return {
      clientMutationId: request.clientMutationId,
      results: [{ index: 0, status: 'unchanged', record: this.#unchangedRecord }],
      changeCursor: 'change_01',
    };
  }
}

function createData(
  records: readonly LoomTableRecord[],
  config: GridViewConfig,
  extraViews: readonly View[] = [],
  extraFields: readonly Field[] = [],
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
    fields: [createField(), ...extraFields],
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

function createLocationField(): Field {
  return {
    id: 'field_location',
    tableId: 'table_01',
    name: 'Location',
    position: 1,
    schemaVersion: 1,
    revision: 1,
    type: 'location',
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

function locationRecord(value: Record<string, JsonValue>): LoomTableRecord {
  return {
    id: 'record_01',
    tableId: 'table_01',
    revision: 1,
    values: { field_name: 'Record 1', field_location: value },
    createdAt: '2026-08-14T00:00:00Z',
    updatedAt: '2026-08-14T00:00:00Z',
  };
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

function withGetRecord(
  data: InMemoryGridData,
  getRecord: (recordId: string) => Promise<LoomTableRecord>,
): GridDataSource {
  const client = new InMemoryLoomTableClient(data);
  return {
    listWorkspaces: () => client.listWorkspaces(),
    listBases: (workspaceId: string) => client.listBases(workspaceId),
    listTables: (baseId: string) => client.listTables(baseId),
    listFields: (tableId: string) => client.listFields(tableId),
    listViews: (tableId: string) => client.listViews(tableId),
    query: (request: QueryRequest) => client.query(request),
    getRecord,
  };
}

function createIntentStore(): { store: PendingViewCreateStore } {
  const intents: PendingViewCreateIntent[] = [];
  return {
    store: {
      list: () => [...intents],
      put: (intent) => {
        const index = intents.findIndex((item) => item.intentId === intent.intentId);
        if (index >= 0) intents.splice(index, 1, intent);
        else intents.push(intent);
      },
      remove: (intentId) => {
        const index = intents.findIndex((item) => item.intentId === intentId);
        if (index >= 0) intents.splice(index, 1);
      },
    },
  };
}

async function loadRecordForDetail(
  controller: GridViewController,
  record: LoomTableRecord,
): Promise<LoomTableRecord> {
  const loader = (
    controller as unknown as {
      getRecordForDetail?: (record: LoomTableRecord) => Promise<LoomTableRecord>;
    }
  ).getRecordForDetail;
  expect(loader).toBeTypeOf('function');
  if (loader === undefined) throw new Error('Detail Record loading seam is unavailable.');
  return loader.call(controller, record);
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

class QueuedDurableQueue implements DurableMutationQueuePort {
  readonly #listeners = new Set<(event: MutationQueueSchedulerEvent) => void>();
  #snapshot: MutationQueueRecordSnapshot = { state: 'idle', pending: 0 };

  subscribe(listener: (event: MutationQueueSchedulerEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  resolveConflict(recordId: string, action: 'adopt-server' | 'overwrite'): Promise<void> {
    void recordId;
    void action;
    return Promise.resolve();
  }

  discardAllForRecord(recordId: string): Promise<void> {
    void recordId;
    return Promise.resolve();
  }

  getRecordSnapshot(recordId: string): MutationQueueRecordSnapshot {
    void recordId;
    return this.#snapshot;
  }

  getOperationSnapshot(clientMutationId: string): MutationQueueRecordSnapshot {
    void clientMutationId;
    return this.#snapshot;
  }

  discardOperation(clientMutationId: string): Promise<void> {
    void clientMutationId;
    return Promise.resolve();
  }

  retryOperation(clientMutationId: string): Promise<void> {
    void clientMutationId;
    return Promise.resolve();
  }

  enqueue(): Promise<MutationResult> {
    if (this.#snapshot.pending === 0) {
      this.#snapshot = { state: 'queued', pending: 1 };
      return new Promise(() => undefined);
    }
    throw new LoomTableClientError('authentication', {
      message: 'Authentication is required before this mutation can be queued.',
      httpStatus: 401,
    });
  }
}

class FakeDurableQueue implements DurableMutationQueuePort {
  readonly #listeners = new Set<(event: MutationQueueSchedulerEvent) => void>();
  readonly #entryState: MutationQueueRecordSnapshot;
  #snapshot: MutationQueueRecordSnapshot = { state: 'idle', pending: 0 };

  constructor(
    state: Extract<MutationQueueRecordSnapshot['state'], 'auth-paused' | 'terminal' | 'conflict'>,
    conflict?: MutationQueueRecordSnapshot['conflict'],
  ) {
    this.#entryState = {
      state,
      pending: 1,
      ...(conflict === undefined ? {} : { conflict }),
    };
  }

  subscribe(listener: (event: MutationQueueSchedulerEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  resolveConflict(recordId: string, action: 'adopt-server' | 'overwrite'): Promise<void> {
    void recordId;
    void action;
    return Promise.resolve();
  }

  discardAllForRecord(recordId: string): Promise<void> {
    void recordId;
    return Promise.resolve();
  }

  getRecordSnapshot(recordId: string): MutationQueueRecordSnapshot {
    void recordId;
    return this.#snapshot;
  }

  getOperationSnapshot(clientMutationId: string): MutationQueueRecordSnapshot {
    void clientMutationId;
    return this.#snapshot;
  }

  discardOperation(clientMutationId: string): Promise<void> {
    void clientMutationId;
    return Promise.resolve();
  }

  retryOperation(clientMutationId: string): Promise<void> {
    void clientMutationId;
    return Promise.resolve();
  }

  async enqueue(): Promise<MutationResult> {
    this.#snapshot = this.#entryState;
    const event: MutationQueueSchedulerEvent = {
      operationId: 'mut_0000000000000000000000000A',
      kind: 'updateRecord',
      recordId: 'record_01',
      snapshot: this.#snapshot,
    };
    for (const listener of this.#listeners) listener(event);
    if (this.#snapshot.state === 'auth-paused') return new Promise(() => undefined);
    if (this.#snapshot.state === 'conflict') {
      throw new LoomTableClientError(
        'conflict',
        { message: 'The Record changed on the Server.', code: 'CONFLICT', httpStatus: 409 },
        undefined,
        this.#snapshot.conflict,
      );
    }
    throw new LoomTableClientError('validation', {
      message: 'The Server rejected this mutation.',
      httpStatus: 422,
    });
  }
}

describe('Record create', () => {
  it('enqueues a createRecord command with a stable mutation ID and returns the new Record', async () => {
    const transport = {
      mutate: vi.fn(
        async (_tableId: string, request: MutationRequest): Promise<MutationResult> => ({
          clientMutationId: request.clientMutationId,
          results: [
            {
              index: 0,
              status: 'applied',
              record: {
                id: 'record_new',
                tableId: 'table_01',
                revision: 1,
                values: { field_name: 'Draft' },
                createdAt: '2026-08-15T00:00:00Z',
                updatedAt: '2026-08-15T00:00:00Z',
              },
            },
          ],
          changeCursor: 'change_02',
        }),
      ),
    };
    const scheduler = new MutationQueueScheduler({
      store: new MutationQueueStore({ schemaVersion: 2, entries: [] }),
      transport,
    });
    await scheduler.start();
    await scheduler.setOnline(true);
    await scheduler.setAuthReady(true);

    const controller = new GridViewController(
      new InMemoryLoomTableClient(createData(createRecords(1), createGridConfig(false))),
      {
        mutationQueue: scheduler,
        mutationIdFactory: () => 'mut_0123456789ABCDEFGHJKMNPQRS',
        isOffline: () => false,
      },
    );
    await controller.load();

    const record = await controller.createRecord({ field_name: 'Draft' });

    expect(record.id).toBe('record_new');
    expect(transport.mutate).toHaveBeenCalledTimes(1);
    expect(transport.mutate.mock.calls[0]?.[1]).toEqual({
      clientMutationId: 'mut_0123456789ABCDEFGHJKMNPQRS',
      commands: [{ kind: 'createRecord', values: { field_name: 'Draft' } }],
    });
    // The created Record is tracked as an applied create op, not inserted
    // into the active query page.
    expect(controller.state.records.map((candidate) => candidate.id)).not.toContain('record_new');
    expect(controller.state.recordCreateOps).toHaveLength(1);
    expect(controller.state.recordCreateOps[0]).toMatchObject({
      operationId: 'mut_0123456789ABCDEFGHJKMNPQRS',
      tableId: 'table_01',
      state: 'idle',
      createdRecord: { id: 'record_new' },
    });
    controller.dispose();
    scheduler.stop();
  });

  it('rejects creation while offline and when the durable queue is missing', async () => {
    const offline = new GridViewController(
      new InMemoryLoomTableClient(createData(createRecords(1), createGridConfig(false))),
      { mutationQueue: new QueuedDurableQueue(), isOffline: () => true },
    );
    await offline.load();
    await expect(offline.createRecord({})).rejects.toMatchObject({ kind: 'validation' });
    offline.dispose();

    const noQueue = new GridViewController(
      new InMemoryLoomTableClient(createData(createRecords(1), createGridConfig(false))),
      { isOffline: () => false },
    );
    await noQueue.load();
    await expect(noQueue.createRecord({})).rejects.toMatchObject({ kind: 'validation' });
    noQueue.dispose();
  });

  it('tracks a queued create op, supports retry/discard, and ignores other Tables', async () => {
    const releases = new Map<string, () => void>();
    const transport = {
      mutate: vi.fn(
        (tableId: string, request: MutationRequest) =>
          new Promise<MutationResult>((resolve) => {
            void tableId;
            releases.set(request.clientMutationId, () =>
              resolve({
                clientMutationId: request.clientMutationId,
                results: [
                  {
                    index: 0,
                    status: 'applied',
                    record: {
                      id: 'record_new',
                      tableId: 'table_01',
                      revision: 1,
                      values: {},
                      createdAt: '2026-08-15T00:00:00Z',
                      updatedAt: '2026-08-15T00:00:00Z',
                    },
                  },
                ],
                changeCursor: 'change_02',
              }),
            );
          }),
      ),
    };
    const scheduler = new MutationQueueScheduler({
      store: new MutationQueueStore({ schemaVersion: 2, entries: [] }),
      transport,
    });
    await scheduler.start();
    const controller = new GridViewController(
      new InMemoryLoomTableClient(createData(createRecords(1), createGridConfig(false))),
      {
        mutationQueue: scheduler,
        mutationIdFactory: () => 'mut_0123456789ABCDEFGHJKMNPQRS',
        isOffline: () => false,
      },
    );
    await controller.load();
    await scheduler.setOnline(true);
    await scheduler.setAuthReady(true);

    // The transport never resolves, so the create op stays in-flight.
    const pending = controller.createRecord({ field_name: 'Later' }).catch((e: unknown) => e);
    await vi.waitFor(() =>
      expect(controller.state.recordCreateOps).toEqual([
        expect.objectContaining({
          operationId: 'mut_0123456789ABCDEFGHJKMNPQRS',
          tableId: 'table_01',
        }),
      ]),
    );
    expect(controller.state.recordCreateOps[0]?.state).toBe('sending');

    // A create lane for another Table must not surface in this controller.
    const foreignPending = scheduler
      .enqueue('table_02', {
        clientMutationId: 'mut_0123456789ABCDEFGHJKMNPQRT',
        commands: [{ kind: 'createRecord', values: {} }],
      })
      .catch((error: unknown) => error);
    // The foreign op persists durably; its lane events never reach this Table.
    await vi.waitFor(() => expect(scheduler.getSnapshot().entries).toHaveLength(2));
    expect(
      controller.state.recordCreateOps.some(
        (op) => op.operationId === 'mut_0123456789ABCDEFGHJKMNPQRT',
      ),
    ).toBe(false);

    await scheduler.discardOperation('mut_0123456789ABCDEFGHJKMNPQRS');
    await scheduler.discardOperation('mut_0123456789ABCDEFGHJKMNPQRT');
    expect(await pending).toBeInstanceOf(Error);
    expect(await foreignPending).toBeInstanceOf(Error);
    await vi.waitFor(() => expect(controller.state.recordCreateOps).toEqual([]));
    controller.dispose();
    scheduler.stop();
  });

  it('ignores late applied queue events after dispose', async () => {
    let release: ((result: MutationResult) => void) | undefined;
    const transport = {
      mutate: vi.fn(
        (_tableId: string, request: MutationRequest) =>
          new Promise<MutationResult>((resolve) => {
            release = resolve;
            void request;
          }),
      ),
    };
    const scheduler = new MutationQueueScheduler({
      store: new MutationQueueStore({ schemaVersion: 2, entries: [] }),
      transport,
    });
    await scheduler.start();
    const controller = new GridViewController(
      new InMemoryLoomTableClient(createData(createRecords(1), createGridConfig(false))),
      {
        mutationQueue: scheduler,
        mutationIdFactory: () => 'mut_0123456789ABCDEFGHJKMNPQRS',
        isOffline: () => false,
      },
    );
    await controller.load();
    await scheduler.setOnline(true);
    await scheduler.setAuthReady(true);
    const pending = controller.createRecord({ field_name: 'Late' }).catch((e: unknown) => e);
    await vi.waitFor(() => expect(controller.state.recordCreateOps[0]?.state).toBe('sending'));

    controller.dispose();
    release?.({
      clientMutationId: 'mut_0123456789ABCDEFGHJKMNPQRS',
      results: [
        {
          index: 0,
          status: 'applied',
          record: {
            id: 'record_new',
            tableId: 'table_01',
            revision: 1,
            values: {},
            createdAt: '2026-08-15T00:00:00Z',
            updatedAt: '2026-08-15T00:00:00Z',
          },
        },
      ],
      changeCursor: 'change_02',
    });
    expect(await pending).toMatchObject({ id: 'record_new' });
    await scheduler.drain();
    expect(controller.state.recordCreateOps).toEqual([
      expect.objectContaining({ state: 'sending' }),
    ]);
    scheduler.stop();
  });
});

describe('Record lifecycle', () => {
  function createLifecycleController(
    records: readonly LoomTableRecord[] = createRecords(3),
    options: { readonly sequence?: number } = {},
  ) {
    let sequence = options.sequence ?? 0;
    const client = new InMemoryLoomTableClient(createData(records, createGridConfig(false)));
    const scheduler = new MutationQueueScheduler({
      store: new MutationQueueStore({ schemaVersion: 2, entries: [] }),
      transport: client,
    });
    const controller = new GridViewController(client, {
      mutationQueue: scheduler,
      mutationIdFactory: () => `mut_${String(++sequence).padStart(26, '0')}`,
      isOffline: () => false,
    });
    return { client, scheduler, controller };
  }

  async function startLifecycle(
    scheduler: MutationQueueScheduler,
    controller: GridViewController,
  ): Promise<void> {
    await scheduler.start();
    await controller.load();
    await scheduler.setOnline(true);
    await scheduler.setAuthReady(true);
  }

  it('deletes a Record with its authoritative revision and surfaces an undo notice', async () => {
    const { client, scheduler, controller } = createLifecycleController();
    await startLifecycle(scheduler, controller);

    expect(controller.canDeleteRecord('record_01')).toBe('ok');
    const deleted = await controller.deleteRecord('record_01');
    await scheduler.drain();

    expect(deleted.deletedAt).not.toBeUndefined();
    const sent = client.mutationRequests[0]?.request;
    expect(sent?.commands[0]).toEqual({
      kind: 'deleteRecord',
      recordId: 'record_01',
      expectedRevision: 1,
    });
    expect(controller.state.records.some((record) => record.id === 'record_01')).toBe(false);
    expect(controller.state.lastDeletedRecord?.id).toBe('record_01');
    expect(controller.state.records).toHaveLength(2);
    scheduler.stop();
  });

  it('blocks delete while an update is pending and reports the draft gate', async () => {
    const { scheduler, controller } = createLifecycleController();
    await startLifecycle(scheduler, controller);

    void controller.editCell('record_01', 'field_name', 'draft');
    await vi.waitFor(() => expect(controller.state.editDrafts.length).toBeGreaterThan(0));
    expect(controller.canDeleteRecord('record_01')).toBe('draft');
    await expect(controller.deleteRecord('record_01')).rejects.toMatchObject({
      kind: 'validation',
    });
    scheduler.stop();
  });

  it('restores a deleted Record with the current authoritative revision', async () => {
    const { client, scheduler, controller } = createLifecycleController();
    await startLifecycle(scheduler, controller);
    await controller.deleteRecord('record_01');
    await scheduler.drain();

    const outcome = await controller.restoreRecord('record_01');
    await scheduler.drain();

    expect(outcome).toMatchObject({ status: 'restored' });
    const restoreRequest = client.mutationRequests[1]?.request;
    expect(restoreRequest?.commands[0]).toEqual({
      kind: 'restoreRecord',
      recordId: 'record_01',
      expectedRevision: 2,
    });
    expect(controller.state.lastDeletedRecord).toBeNull();
    scheduler.stop();
  });

  it('reports already-active on undo without sending a second restore', async () => {
    const { client, scheduler, controller } = createLifecycleController();
    await startLifecycle(scheduler, controller);
    await controller.deleteRecord('record_01');
    await scheduler.drain();
    // Simulate another client restoring the Record first.
    await client.mutate('table_01', {
      clientMutationId: 'mut_external_restore',
      commands: [{ kind: 'restoreRecord', recordId: 'record_01', expectedRevision: 2 }],
    });
    const before = client.mutationRequests.length;

    const outcome = await controller.restoreRecord('record_01');

    expect(outcome.status).toBe('already-active');
    expect(client.mutationRequests).toHaveLength(before);
    expect(controller.state.lastDeletedRecord).toBeNull();
    scheduler.stop();
  });

  it('lists deleted Records without View scoping and paginates the recycle list', async () => {
    const deleted: LoomTableRecord[] = Array.from({ length: 3 }, (_, index) => ({
      id: `record_d${index + 1}`,
      tableId: 'table_01',
      revision: 2,
      values: { field_name: `Deleted ${index + 1}` },
      createdAt: '2026-08-14T00:00:00Z',
      updatedAt: '2026-08-15T00:00:00Z',
      deletedAt: '2026-08-15T00:00:00Z',
    }));
    const { client, scheduler, controller } = createLifecycleController([
      ...createRecords(1),
      ...deleted,
    ]);
    await startLifecycle(scheduler, controller);

    await controller.loadDeletedRecords({ pageSize: 2 });

    const recycle = client.queryRequests.at(-1);
    expect(recycle).toMatchObject({ tableId: 'table_01', lifecycle: 'deleted', limit: 2 });
    expect(recycle?.viewId).toBeUndefined();
    expect(recycle?.filter).toBeUndefined();
    expect(controller.state.deletedRecords.map((record) => record.id)).toEqual([
      'record_d1',
      'record_d2',
    ]);
    expect(controller.state.deletedRecordsHasMore).toBe(true);

    await controller.loadMoreDeletedRecords();
    expect(controller.state.deletedRecords.map((record) => record.id)).toEqual([
      'record_d1',
      'record_d2',
      'record_d3',
    ]);
    expect(controller.state.deletedRecordsHasMore).toBe(false);
    scheduler.stop();
  });

  it('loads Server history pages and appends with the active kind filter', async () => {
    const { client, scheduler, controller } = createLifecycleController();
    await startLifecycle(scheduler, controller);
    client.historyPages.push(
      {
        items: [
          {
            id: 'ch_1',
            kind: 'recordUpdated',
            tableId: 'table_01',
            recordId: 'record_01',
            revision: 3,
            occurredAt: '2026-09-20T10:00:00Z',
            primaryFieldText: 'Alpha',
            fields: [{ fieldId: 'field_name', before: 'A', after: 'Alpha' }],
          },
          {
            id: 'ch_2',
            kind: 'recordCreated',
            tableId: 'table_01',
            recordId: 'record_02',
            revision: 1,
            occurredAt: '2026-09-20T09:00:00Z',
          },
        ],
        hasMore: true,
        nextCursor: 'hist_02',
        changeCursor: 'change_02',
      },
      {
        items: [
          {
            id: 'ch_3',
            kind: 'recordUpdated',
            tableId: 'table_01',
            recordId: 'record_03',
            revision: 5,
            occurredAt: '2026-09-20T08:00:00Z',
          },
        ],
        hasMore: false,
        changeCursor: 'change_03',
      },
    );

    await controller.loadServerHistory({ kind: 'recordUpdated' });
    expect(client.historyRequests[0]?.kind).toBe('recordUpdated');
    expect(typeof client.historyRequests[0]?.limit).toBe('number');
    expect(controller.state.serverHistory.map((change) => change.id)).toEqual(['ch_1', 'ch_2']);
    expect(controller.state.serverHistoryStatus).toBe('ready');
    expect(controller.state.serverHistoryHasMore).toBe(true);

    await controller.loadMoreServerHistory('recordUpdated');
    expect(client.historyRequests[1]).toMatchObject({
      kind: 'recordUpdated',
      cursor: 'hist_02',
    });
    expect(controller.state.serverHistory.map((change) => change.id)).toEqual([
      'ch_1',
      'ch_2',
      'ch_3',
    ]);
    expect(controller.state.serverHistoryHasMore).toBe(false);
    scheduler.stop();
  });

  it('reloads Server history after an applied mutation when it was loaded', async () => {
    const { client, scheduler, controller } = createLifecycleController();
    await startLifecycle(scheduler, controller);
    await controller.loadServerHistory();
    expect(client.historyRequests).toHaveLength(1);
    client.historyPages.push({
      items: [],
      hasMore: false,
      changeCursor: 'change_03',
    });

    void controller.editCell('record_01', 'field_name', 'changed');
    await scheduler.drain();
    await vi.waitFor(() => expect(client.historyRequests.length).toBeGreaterThan(1));
    scheduler.stop();
  });

  it('removes a restored Record from the recycle list', async () => {
    const { client, scheduler, controller } = createLifecycleController();
    await startLifecycle(scheduler, controller);
    await controller.deleteRecord('record_01');
    await scheduler.drain();
    await controller.loadDeletedRecords();
    expect(controller.state.deletedRecords.some((record) => record.id === 'record_01')).toBe(true);

    const outcome = await controller.restoreRecord('record_01');
    expect(outcome.status).toBe('restored');
    expect(controller.state.deletedRecords.some((record) => record.id === 'record_01')).toBe(false);
    void client;
    scheduler.stop();
  });

  it('keeps the Record and surfaces the failure when delete fails', async () => {
    const client = new InMemoryLoomTableClient(
      createData(createRecords(2), createGridConfig(false)),
    );
    const scheduler = new MutationQueueScheduler({
      store: new MutationQueueStore({ schemaVersion: 2, entries: [] }),
      transport: {
        mutate: async (_tableId: string, request: MutationRequest) => {
          const command = request.commands[0];
          if (command?.kind === 'deleteRecord') {
            throw new LoomTableClientError('validation', {
              message: 'delete failed',
              httpStatus: 400,
            });
          }
          return client.mutate(_tableId, request);
        },
      },
    });
    let sequence = 0;
    const controller = new GridViewController(client, {
      mutationQueue: scheduler,
      mutationIdFactory: () => `mut_${String(++sequence).padStart(26, '9')}`,
      isOffline: () => false,
    });
    await startLifecycle(scheduler, controller);

    const pending = controller.deleteRecord('record_01').catch((e: unknown) => e);
    const outcome = await pending;
    expect(outcome).toBeInstanceOf(Error);
    await vi.waitFor(() => expect(controller.state.editStatuses['record_01']).toBe('terminal'));
    expect(controller.state.records.some((record) => record.id === 'record_01')).toBe(true);
    expect(controller.state.lastDeletedRecord).toBeNull();
    scheduler.stop();
  });

  it('allows a fresh delete after a terminal failure by discarding the stale entry', async () => {
    const client = new InMemoryLoomTableClient(
      createData(createRecords(2), createGridConfig(false)),
    );
    let failDelete = true;
    const scheduler = new MutationQueueScheduler({
      store: new MutationQueueStore({ schemaVersion: 2, entries: [] }),
      transport: {
        mutate: async (_tableId: string, request: MutationRequest) => {
          if (request.commands[0]?.kind === 'deleteRecord' && failDelete) {
            throw new LoomTableClientError('validation', {
              message: 'delete failed',
              httpStatus: 400,
            });
          }
          return client.mutate(_tableId, request);
        },
      },
    });
    let sequence = 0;
    const controller = new GridViewController(client, {
      mutationQueue: scheduler,
      mutationIdFactory: () => `mut_${String(++sequence).padStart(26, '5')}`,
      isOffline: () => false,
    });
    await startLifecycle(scheduler, controller);

    await expect(controller.deleteRecord('record_01')).rejects.toBeInstanceOf(Error);
    await vi.waitFor(() => expect(controller.state.editStatuses['record_01']).toBe('terminal'));

    failDelete = false;
    expect(controller.canDeleteRecord('record_01')).toBe('ok');
    const deleted = await controller.deleteRecord('record_01');
    expect(deleted.deletedAt).not.toBeUndefined();
    expect(controller.state.records.some((record) => record.id === 'record_01')).toBe(false);
    expect(controller.state.editStatuses['record_01']).toBeUndefined();
    scheduler.stop();
  });

  it('blocks a second delete while one is in flight and keeps other Records editable', async () => {
    const client = new InMemoryLoomTableClient(
      createData(createRecords(2), createGridConfig(false)),
    );
    let releaseDelete!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseDelete = resolve;
    });
    const scheduler = new MutationQueueScheduler({
      store: new MutationQueueStore({ schemaVersion: 2, entries: [] }),
      transport: {
        mutate: async (_tableId: string, request: MutationRequest) => {
          if (request.commands[0]?.kind === 'deleteRecord') await gate;
          return client.mutate(_tableId, request);
        },
      },
    });
    let sequence = 0;
    const controller = new GridViewController(client, {
      mutationQueue: scheduler,
      mutationIdFactory: () => `mut_${String(++sequence).padStart(26, '7')}`,
      isOffline: () => false,
    });
    await startLifecycle(scheduler, controller);

    const deletePending = controller.deleteRecord('record_01');
    await vi.waitFor(() => expect(controller.state.editStatuses['record_01']).toBe('saving'));

    expect(controller.canDeleteRecord('record_01')).toBe('pending');
    await expect(controller.deleteRecord('record_01')).rejects.toMatchObject({
      kind: 'validation',
    });
    expect(controller.canDeleteRecord('record_02')).toBe('ok');
    const edit = controller.editCell('record_02', 'field_name', 'still editable');
    releaseDelete();
    await edit;
    await deletePending;

    expect(controller.state.records.some((record) => record.id === 'record_01')).toBe(false);
    expect(
      controller.state.records.find((record) => record.id === 'record_02')?.values.field_name,
    ).toBe('still editable');
    scheduler.stop();
  });
});

describe('Record navigation', () => {
  it('reports bounds and returns adjacent Records along the query sequence', async () => {
    const client = new InMemoryLoomTableClient(
      createData(createRecords(3), createGridConfig(false)),
    );
    const controller = new GridViewController(client, { pageSize: 2 });
    await controller.load();

    expect(controller.canNavigateRecord('record_01', -1)).toBe(false);
    expect(controller.canNavigateRecord('record_01', 1)).toBe(true);
    expect(controller.canNavigateRecord('record_02', -1)).toBe(true);
    expect(controller.canNavigateRecord('record_02', 1)).toBe(true);
    expect(controller.canNavigateRecord('record_missing', 1)).toBe(false);

    expect((await controller.navigateRecord('record_01', 1))?.id).toBe('record_02');
    expect(await controller.navigateRecord('record_01', -1)).toBeNull();
    expect(await controller.navigateRecord('record_missing', 1)).toBeNull();
  });

  it('loads the next page when navigating past the loaded boundary', async () => {
    const client = new InMemoryLoomTableClient(
      createData(createRecords(3), createGridConfig(false)),
    );
    const controller = new GridViewController(client, { pageSize: 2 });
    await controller.load();
    expect(controller.state.records).toHaveLength(2);

    const target = await controller.navigateRecord('record_02', 1);
    expect(target?.id).toBe('record_03');
    expect(controller.state.records).toHaveLength(3);
    expect(client.queryRequests.at(-1)?.cursor).toBe('cursor:2');
    expect(controller.canNavigateRecord('record_03', 1)).toBe(false);
  });

  it('does not fabricate a reverse cursor when the previous page is unknown', async () => {
    const client = new InMemoryLoomTableClient(
      createData(createRecords(3), createGridConfig(false)),
    );
    const controller = new GridViewController(client, { pageSize: 2 });
    await controller.load();
    await controller.loadNextPage();

    expect((await controller.navigateRecord('record_02', -1))?.id).toBe('record_01');
    expect(controller.canNavigateRecord('record_01', -1)).toBe(false);
  });
});

describe('Field management', () => {
  it('creates a Field and inserts it right of the anchor column', async () => {
    const client = new InMemoryLoomTableClient(
      createData(createRecords(2), createGridConfig(false), [], [createLocationField()]),
    );
    const controller = new GridViewController(client);
    await controller.load();

    const outcome = await controller.createField(
      { name: 'Notes', type: 'text' },
      { fieldId: 'field_name', side: 'right' },
    );

    expect(outcome.status).toBe('written');
    expect(client.fieldCreateKeys).toHaveLength(1);
    const view = controller.state.views.find((candidate) => candidate.id === 'view_01');
    expect(view?.config).toMatchObject({
      columnOrder: ['field_name', outcome.status === 'written' ? outcome.field.id : ''],
    });
    expect(controller.state.fields.some((field) => field.name === 'Notes')).toBe(true);
  });

  it('creates a Select Field with option colors', async () => {
    const client = new InMemoryLoomTableClient(
      createData(createRecords(1), createGridConfig(false)),
    );
    const controller = new GridViewController(client);
    await controller.load();

    const outcome = await controller.createField({
      name: 'Status',
      type: 'select',
      options: [
        { name: 'Todo', color: 'gray' },
        { name: 'Done', color: 'green' },
      ],
    });

    expect(outcome.status).toBe('written');
    const created = controller.state.fields.find((field) => field.name === 'Status');
    expect(created?.type).toBe('select');
    expect(created?.config).toMatchObject({
      options: [
        { name: 'Todo', color: 'gray' },
        { name: 'Done', color: 'green' },
      ],
    });
  });

  it('renames a Field with its current revision', async () => {
    const client = new InMemoryLoomTableClient(
      createData(createRecords(1), createGridConfig(false)),
    );
    const controller = new GridViewController(client);
    await controller.load();

    const outcome = await controller.updateField('field_name', { name: 'Title' });

    expect(outcome.status).toBe('written');
    expect(controller.state.fields[0]).toMatchObject({ name: 'Title', revision: 2 });
  });

  it('deletes a Field and scrubs it from every Grid View config', async () => {
    const client = new InMemoryLoomTableClient(
      createData(createRecords(1), createGridConfig(true), [], [createLocationField()]),
    );
    const controller = new GridViewController(client);
    await controller.load();

    const outcome = await controller.deleteField('field_name');

    expect(outcome.status).toBe('written');
    const view = controller.state.views.find((candidate) => candidate.id === 'view_01');
    expect(view?.config).toMatchObject({ projection: [], columnOrder: [] });
    expect(controller.state.fields.some((field) => field.id === 'field_name')).toBe(false);
    const deleted = await client.listFields('table_01', { lifecycle: 'deleted' });
    expect(deleted.map((field) => field.id)).toContain('field_name');
  });

  it('fails Field writes while offline without touching the Server', async () => {
    const client = new InMemoryLoomTableClient(
      createData(createRecords(1), createGridConfig(false)),
    );
    const controller = new GridViewController(client, { isOffline: () => true });
    await controller.load();

    const created = await controller.createField({ name: 'X', type: 'text' });
    const updated = await controller.updateField('field_name', { name: 'Y' });
    const deleted = await controller.deleteField('field_name');

    for (const outcome of [created, updated, deleted]) {
      expect(outcome.status).toBe('failed');
      expect(outcome).toMatchObject({ kind: 'network' });
    }
    expect(client.fieldCreateKeys).toHaveLength(0);
  });

  it('reports Field management as unavailable without a field-capable client', async () => {
    const client = new InMemoryLoomTableClient(
      createData(createRecords(1), createGridConfig(false)),
    );
    const limited = {
      listWorkspaces: client.listWorkspaces.bind(client),
      listBases: client.listBases.bind(client),
      listTables: client.listTables.bind(client),
      listFields: client.listFields.bind(client),
      listViews: client.listViews.bind(client),
      query: client.query.bind(client),
    };
    const controller = new GridViewController(limited);
    await controller.load();

    expect((await controller.createField({ name: 'X', type: 'text' })).status).toBe('failed');
  });
});

describe('Undo/redo history', () => {
  async function createUndoHarness(recordCount = 2) {
    const client = new InMemoryLoomTableClient(
      createData(createRecords(recordCount), createGridConfig(false)),
    );
    const scheduler = new MutationQueueScheduler({
      store: new MutationQueueStore({ schemaVersion: 2, entries: [] }),
      transport: {
        mutate: (tableId: string, request: MutationRequest) => client.mutate(tableId, request),
      },
    });
    await scheduler.start();
    await scheduler.setOnline(true);
    await scheduler.setAuthReady(true);
    let sequence = 0;
    const controller = new GridViewController(client, {
      mutationQueue: scheduler,
      mutationIdFactory: () => `mut_${String(++sequence).padStart(26, '0')}`,
      isOffline: () => false,
    });
    await controller.load();
    return { client, controller, scheduler };
  }

  it('undoes and redoes a Cell edit through the local command stack', async () => {
    const { controller, scheduler } = await createUndoHarness();

    await controller.editCell('record_01', 'field_name', 'Edited');
    expect(controller.state.records[0]?.values.field_name).toBe('Edited');
    expect(controller.state.canUndo).toBe(true);

    await controller.undo();
    expect(controller.state.records[0]?.values.field_name).toBe('Record 1');
    expect(controller.state.canRedo).toBe(true);

    await controller.redo();
    expect(controller.state.records[0]?.values.field_name).toBe('Edited');
    controller.dispose();
    scheduler.stop();
  });

  it('restores a deleted Record on undo and re-deletes it on redo', async () => {
    const { client, controller, scheduler } = await createUndoHarness();

    await controller.deleteRecord('record_01');
    expect(client.mutationRequests.map((entry) => entry.request.commands[0]?.kind)).toContain(
      'deleteRecord',
    );

    await controller.undo();
    expect(client.mutationRequests.map((entry) => entry.request.commands[0]?.kind)).toContain(
      'restoreRecord',
    );

    await controller.redo();
    const deleteCalls = client.mutationRequests.filter(
      (entry) => entry.request.commands[0]?.kind === 'deleteRecord',
    ).length;
    expect(deleteCalls).toBe(2);
    controller.dispose();
    scheduler.stop();
  });

  it('clears the undo stack when the Grid reloads', async () => {
    const { controller, scheduler } = await createUndoHarness();
    await controller.editCell('record_01', 'field_name', 'Edited');
    expect(controller.state.canUndo).toBe(true);

    await controller.load();
    expect(controller.state.canUndo).toBe(false);
    expect(controller.state.canRedo).toBe(false);
    controller.dispose();
    scheduler.stop();
  });
});
