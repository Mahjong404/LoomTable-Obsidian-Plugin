import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MUTATION_QUEUE_SETTINGS,
  MAX_MUTATION_QUEUE_BYTES,
  MutationQueueStore,
  normalizeMutationQueueSettings,
  type MutationQueueSettingsV1,
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

    const saves: MutationQueueSettingsV1[] = [];
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
              ...entry().request,
              commands: [
                {
                  ...entry().request.commands[0],
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
              ...entry().request,
              commands: [
                {
                  ...entry().request.commands[0],
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
              ...entry().request,
              commands: [
                {
                  ...entry().request.commands[0],
                  set: { field_a: largeValue },
                },
              ],
            },
          }),
        ],
      }),
    ).toThrow(/serialized size/);
  });
});

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

