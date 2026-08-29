import { describe, expect, it, vi } from 'vitest';

import {
  LoomTableClientError,
  type ConflictDetails,
  type Field,
  type GridViewConfig,
  type JsonValue,
  type LoomTableRecord,
  type MutationRequest,
  type MutationResult,
  type QueryRequest,
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
  type MutationQueueSettingsV1,
} from '../../src/settings/mutation-queue-settings';

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

    await expect(
      controller.editCell('record_01', 'field_name', 'Record 1'),
    ).resolves.toBeUndefined();

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
  const saves: MutationQueueSettingsV1[] = [];
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
  await controller.editCell('record_01', 'field_name', 'Local intent');

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

  async enqueue(): Promise<MutationResult> {
    this.#snapshot = this.#entryState;
    const event: MutationQueueSchedulerEvent = {
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
