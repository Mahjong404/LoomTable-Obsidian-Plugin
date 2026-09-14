import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MUTATION_QUEUE_SETTINGS,
  MAX_MUTATION_QUEUE_BYTES,
  MutationQueueStore,
  normalizeMutationQueueSettings,
  type MutationQueueSettingsV2,
} from '../../src/settings/mutation-queue-settings';
import { normalizePluginSettings } from '../../src/settings/plugin-settings';

const MUTATION_ID = 'mut_0123456789ABCDEFGHJKMNPQRS';

describe('mutation queue settings', () => {
  it('upgrades legacy settings with an empty durable queue', () => {
    const settings = normalizePluginSettings({ schemaVersion: 2, locale: 'en' });

    expect(settings.schemaVersion).toBe(3);
    expect(settings.mutationQueue).toEqual(DEFAULT_MUTATION_QUEUE_SETTINGS);
    expect(normalizePluginSettings(settings)).toEqual(settings);
  });

  it('hydrates sending entries as queued without changing the request body', async () => {
    const persisted = {
      schemaVersion: 1,
      entries: [entry({ state: 'sending' })],
    };

    const store = new MutationQueueStore(persisted);
    const snapshot = store.getSnapshot();
    expect(snapshot.entries[0]).toMatchObject({
      clientMutationId: MUTATION_ID,
      state: 'queued',
      expectedRevision: 3,
    });
    expect(snapshot.entries[0]?.request).toEqual(persisted.entries[0]?.request);

    const saves: MutationQueueSettingsV2[] = [];
    const hydrated = await MutationQueueStore.hydrate({
      load: async () => persisted,
      save: async (value) => {
        saves.push(value);
      },
    });
    await hydrated.persist();
    expect(saves).toHaveLength(1);
    expect(saves[0]?.entries[0]?.state).toBe('queued');
  });

  it('rejects malformed entries, mismatched request metadata, and duplicate IDs', () => {
    expect(() =>
      normalizeMutationQueueSettings({
        schemaVersion: 1,
        entries: [entry({ clientMutationId: 'not-a-server-id' })],
      }),
    ).toThrow(/mutation ID format/);

    expect(() =>
      normalizeMutationQueueSettings({
        schemaVersion: 1,
        entries: [
          entry({
            request: {
              ...requestOf(entry()),
              commands: [
                {
                  ...commandOf(entry()),
                  expectedRevision: 4,
                },
              ],
            },
          }),
        ],
      }),
    ).toThrow(/match the request command revision/);

    expect(() =>
      normalizeMutationQueueSettings({
        schemaVersion: 1,
        entries: [entry(), entry()],
      }),
    ).toThrow(/must be unique/);
  });

  it('rejects unsafe command shapes and error details', () => {
    expect(() =>
      normalizeMutationQueueSettings({
        schemaVersion: 1,
        entries: [
          entry({
            request: {
              ...requestOf(entry()),
              commands: [
                {
                  ...commandOf(entry()),
                  set: { field_a: 'local' },
                  unsetFieldIds: ['field_a'],
                },
              ],
            },
          }),
        ],
      }),
    ).toThrow(/overlap/);

    expect(() =>
      normalizeMutationQueueSettings({
        schemaVersion: 1,
        entries: [
          entry({
            state: 'error',
            lastError: {
              kind: 'server',
              message: 'failure',
              apiDetails: { secret: 'must-not-be-persisted' },
            },
          }),
        ],
      }),
    ).toThrow(/unknown property/);
  });

  it('rejects queues beyond the serialized size limit', () => {
    const largeValue = 'x'.repeat(MAX_MUTATION_QUEUE_BYTES);
    expect(() =>
      normalizeMutationQueueSettings({
        schemaVersion: 1,
        entries: [
          entry({
            request: {
              ...requestOf(entry()),
              commands: [
                {
                  ...commandOf(entry()),
                  set: { field_a: largeValue },
                },
              ],
            },
          }),
        ],
      }),
    ).toThrow(/serialized size/);
  });

  it('migrates a v1 updateRecord entry to v2 preserving id, body, revision and state', () => {
    const normalized = normalizeMutationQueueSettings({
      schemaVersion: 1,
      entries: [
        entry({
          state: 'error',
          attemptCount: 2,
          lastError: { kind: 'network', message: 'offline' },
        }),
      ],
    });

    expect(normalized.schemaVersion).toBe(2);
    const migrated = normalized.entries[0];
    expect(migrated).toMatchObject({
      kind: 'updateRecord',
      tableId: 'table_01',
      recordId: 'record_01',
      clientMutationId: MUTATION_ID,
      expectedRevision: 3,
      state: 'error',
      attemptCount: 2,
      lastError: { kind: 'network', message: 'offline' },
    });
    expect(migrated?.request.commands[0]).toEqual({
      kind: 'updateRecord',
      recordId: 'record_01',
      expectedRevision: 3,
      set: { field_a: 'local' },
    });
  });

  it('accepts createRecord entries without a recordId or expectedRevision', () => {
    const normalized = normalizeMutationQueueSettings({
      schemaVersion: 2,
      entries: [
        {
          kind: 'createRecord',
          tableId: 'table_01',
          clientMutationId: MUTATION_ID,
          request: {
            clientMutationId: MUTATION_ID,
            commands: [{ kind: 'createRecord', values: { field_a: 'draft' } }],
          },
          state: 'queued',
          attemptCount: 0,
          createdAt: '2026-08-15T00:00:00.000Z',
          updatedAt: '2026-08-15T00:00:00.000Z',
        },
      ],
    });

    expect(normalized.entries[0]).toMatchObject({
      kind: 'createRecord',
      clientMutationId: MUTATION_ID,
      state: 'queued',
    });
    expect(normalized.entries[0]?.recordId).toBeUndefined();
    expect(normalized.entries[0]?.expectedRevision).toBeUndefined();
  });

  it('accepts deleteRecord and restoreRecord entries with required revisions', () => {
    const base = {
      tableId: 'table_01',
      recordId: 'record_01',
      expectedRevision: 3,
      clientMutationId: MUTATION_ID,
      state: 'queued' as const,
      attemptCount: 0,
      createdAt: '2026-08-15T00:00:00.000Z',
      updatedAt: '2026-08-15T00:00:00.000Z',
    };
    for (const kind of ['deleteRecord', 'restoreRecord'] as const) {
      const normalized = normalizeMutationQueueSettings({
        schemaVersion: 2,
        entries: [
          {
            ...base,
            kind,
            request: {
              clientMutationId: MUTATION_ID,
              commands: [{ kind, recordId: 'record_01', expectedRevision: 3 }],
            },
          },
        ],
      });
      expect(normalized.entries[0]?.kind).toBe(kind);
      expect(normalized.entries[0]?.recordId).toBe('record_01');
    }
  });

  it('rejects v2 entries with mismatched kind metadata or invalid command shapes', () => {
    // createRecord must not carry recordId/expectedRevision
    expect(() =>
      normalizeMutationQueueSettings({
        schemaVersion: 2,
        entries: [
          {
            kind: 'createRecord',
            tableId: 'table_01',
            recordId: 'record_01',
            clientMutationId: MUTATION_ID,
            request: {
              clientMutationId: MUTATION_ID,
              commands: [{ kind: 'createRecord', values: {} }],
            },
            state: 'queued',
            attemptCount: 0,
            createdAt: '2026-08-15T00:00:00.000Z',
            updatedAt: '2026-08-15T00:00:00.000Z',
          },
        ],
      }),
    ).toThrow(/recordId/);

    // entry kind must match the persisted command kind
    expect(() =>
      normalizeMutationQueueSettings({
        schemaVersion: 2,
        entries: [
          {
            kind: 'deleteRecord',
            tableId: 'table_01',
            recordId: 'record_01',
            expectedRevision: 3,
            clientMutationId: MUTATION_ID,
            request: {
              clientMutationId: MUTATION_ID,
              commands: [
                {
                  kind: 'updateRecord',
                  recordId: 'record_01',
                  expectedRevision: 3,
                  set: { field_a: 'x' },
                },
              ],
            },
            state: 'queued',
            attemptCount: 0,
            createdAt: '2026-08-15T00:00:00.000Z',
            updatedAt: '2026-08-15T00:00:00.000Z',
          },
        ],
      }),
    ).toThrow(/kind/);

    // deleteRecord requires a positive expectedRevision
    expect(() =>
      normalizeMutationQueueSettings({
        schemaVersion: 2,
        entries: [
          {
            kind: 'deleteRecord',
            tableId: 'table_01',
            recordId: 'record_01',
            expectedRevision: 0,
            clientMutationId: MUTATION_ID,
            request: {
              clientMutationId: MUTATION_ID,
              commands: [{ kind: 'deleteRecord', recordId: 'record_01', expectedRevision: 0 }],
            },
            state: 'queued',
            attemptCount: 0,
            createdAt: '2026-08-15T00:00:00.000Z',
            updatedAt: '2026-08-15T00:00:00.000Z',
          },
        ],
      }),
    ).toThrow(/expectedRevision/);
  });

  it('rejects unknown schema versions and corrupt roots', () => {
    expect(() => normalizeMutationQueueSettings({ schemaVersion: 99, entries: [] })).toThrow(
      /schema version/,
    );
    expect(() => normalizeMutationQueueSettings('garbage')).toThrow();
    expect(() => normalizeMutationQueueSettings({ schemaVersion: 2, entries: 'nope' })).toThrow();
  });
});

function requestOf(value: Record<string, unknown>): {
  clientMutationId: string;
  commands: readonly [Record<string, unknown>];
} {
  return value.request as {
    clientMutationId: string;
    commands: readonly [Record<string, unknown>];
  };
}

function commandOf(value: Record<string, unknown>): Record<string, unknown> {
  return requestOf(value).commands[0];
}

function entry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tableId: 'table_01',
    recordId: 'record_01',
    clientMutationId: MUTATION_ID,
    request: {
      clientMutationId: MUTATION_ID,
      commands: [
        {
          kind: 'updateRecord',
          recordId: 'record_01',
          expectedRevision: 3,
          set: { field_a: 'local' },
        },
      ],
    },
    expectedRevision: 3,
    state: 'queued',
    attemptCount: 0,
    createdAt: '2026-08-15T00:00:00.000Z',
    updatedAt: '2026-08-15T00:00:00.000Z',
    ...overrides,
  };
}
