import { describe, expect, it } from 'vitest';

import type { PendingViewCreateIntent } from '../../src/ui/view-write-coordinator';
import { normalizeViewIntents, ViewCreateIntentStore } from '../../src/settings/view-intents';
import { normalizePluginSettings } from '../../src/settings/plugin-settings';

const INTENT: PendingViewCreateIntent = {
  intentId: 'mut_01JFH2N7X0G0G0G0G0G0G0G0G0',
  tableId: 'table_01',
  request: {
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
  },
  createdAt: '2026-09-01T00:00:00Z',
};

describe('normalizeViewIntents', () => {
  it('keeps well-formed intents and drops malformed entries', () => {
    const normalized = normalizeViewIntents({
      schemaVersion: 1,
      intents: [
        { ...INTENT, profileId: 'profile_a', serverOrigin: 'https://a.test' },
        { intentId: 'mut_bad', request: { name: 'x', type: 'unknown', config: {} } },
        { ...INTENT, intentId: '', profileId: 'p', serverOrigin: 'o' },
        'not-an-intent',
      ],
    });
    expect(normalized.intents).toHaveLength(1);
    expect(normalized.intents[0]).toMatchObject({
      intentId: INTENT.intentId,
      profileId: 'profile_a',
      tableId: 'table_01',
      request: { type: 'grid', name: 'Board' },
    });
  });

  it('validates the Map Location Field id inside stored requests', () => {
    const normalized = normalizeViewIntents({
      schemaVersion: 1,
      intents: [
        {
          ...INTENT,
          profileId: 'p',
          serverOrigin: 'o',
          request: { name: 'Map', type: 'map', config: { locationFieldId: 'field_loc' } },
        },
        {
          ...INTENT,
          intentId: 'mut_other',
          profileId: 'p',
          serverOrigin: 'o',
          request: { name: 'Map', type: 'map', config: {} },
        },
      ],
    });
    expect(normalized.intents).toHaveLength(1);
    expect(normalized.intents[0]?.request).toMatchObject({ type: 'map' });
  });

  it('round-trips through Plugin settings with a default empty state', () => {
    expect(normalizePluginSettings({}).viewIntents.intents).toEqual([]);
    const persisted = normalizePluginSettings({
      viewIntents: {
        schemaVersion: 1,
        intents: [{ ...INTENT, profileId: 'p', serverOrigin: 'o' }],
      },
    });
    expect(persisted.viewIntents.intents).toHaveLength(1);
  });
});

describe('ViewCreateIntentStore', () => {
  function createPersistence(initial: unknown) {
    let data = normalizeViewIntents(initial);
    return {
      load: () => data,
      saved: [] as unknown[],
      save(next: typeof data) {
        data = next;
        this.saved.push(next);
      },
    };
  }

  it('scopes intents to the profile and server origin', () => {
    const persistence = createPersistence({
      schemaVersion: 1,
      intents: [
        { ...INTENT, profileId: 'profile_a', serverOrigin: 'https://a.test' },
        {
          ...INTENT,
          intentId: 'mut_other',
          profileId: 'profile_b',
          serverOrigin: 'https://a.test',
        },
        {
          ...INTENT,
          intentId: 'mut_third',
          profileId: 'profile_a',
          serverOrigin: 'https://b.test',
        },
      ],
    });
    const store = new ViewCreateIntentStore(
      { profileId: 'profile_a', serverOrigin: 'https://a.test' },
      persistence,
    );

    expect(store.list().map((intent) => intent.intentId)).toEqual([INTENT.intentId]);
  });

  it('upserts by intent id and removes only in-scope entries', async () => {
    const persistence = createPersistence({
      schemaVersion: 1,
      intents: [
        { ...INTENT, profileId: 'profile_a', serverOrigin: 'https://a.test' },
        {
          ...INTENT,
          intentId: 'mut_other',
          profileId: 'profile_b',
          serverOrigin: 'https://a.test',
        },
      ],
    });
    const store = new ViewCreateIntentStore(
      { profileId: 'profile_a', serverOrigin: 'https://a.test' },
      persistence,
    );

    await store.put({ ...INTENT, tableId: 'table_02' });
    await store.put({ ...INTENT, intentId: 'mut_new', tableId: 'table_01' });
    expect(store.list()).toHaveLength(2);
    expect(persistence.load().intents).toHaveLength(3);

    await store.remove('mut_other');
    expect(persistence.load().intents).toHaveLength(3);
    await store.remove(INTENT.intentId);
    expect(store.list().map((intent) => intent.intentId)).toEqual(['mut_new']);
  });
});
