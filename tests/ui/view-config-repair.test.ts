import { describe, expect, it } from 'vitest';

import type { Field, FilterNode, View } from '../../src/client/loomtable-client';
import { findBrokenViewFieldIds, repairViewConfig } from '../../src/ui/view-config-repair';

const BASE_FIELD = {
  tableId: 'table_01',
  position: 0,
  schemaVersion: 1,
  revision: 1,
  config: {},
};

function textField(id: string, deletedAt?: string): Field {
  return {
    ...BASE_FIELD,
    id,
    name: id,
    type: 'text',
    ...(deletedAt === undefined ? {} : { deletedAt }),
  };
}

function locationField(id: string, deletedAt?: string): Field {
  return {
    ...BASE_FIELD,
    id,
    name: id,
    type: 'location',
    ...(deletedAt === undefined ? {} : { deletedAt }),
  };
}

const FIELDS: readonly Field[] = [
  textField('field_name'),
  textField('field_notes'),
  textField('field_gone', '2026-09-01T00:00:00Z'),
  locationField('field_place'),
];

const GRID_VIEW: View = {
  id: 'view_grid',
  tableId: 'table_01',
  name: 'Board',
  type: 'grid',
  revision: 1,
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
  config: {
    projection: ['field_name', 'field_gone'],
    columnOrder: ['field_name', 'field_gone'],
    columnWidths: { field_name: 200, field_gone: 300 },
    frozenFieldIds: ['field_gone'],
    rowHeight: 'standard',
    filter: {
      kind: 'group',
      operator: 'and',
      children: [
        { kind: 'rule', fieldId: 'field_name', operator: 'contains', value: 'a' },
        { kind: 'rule', fieldId: 'field_gone', operator: 'is', value: 'b' },
      ],
    },
    sort: [{ fieldId: 'field_gone', direction: 'asc', nulls: 'last' }],
  },
};

describe('findBrokenViewFieldIds', () => {
  it('separates query-semantic and presentation-only stale refs for Grid Views', () => {
    const issues = findBrokenViewFieldIds(GRID_VIEW, FIELDS);

    expect(issues.queryFieldIds).toEqual(['field_gone']);
    expect(issues.presentationFieldIds).toEqual(['field_gone']);
  });

  it('reports a deleted or wrong-type Map Location Field as a query ref', () => {
    const map: View = {
      id: 'view_map',
      tableId: 'table_01',
      name: 'Map',
      type: 'map',
      revision: 1,
      createdAt: '2026-09-01T00:00:00Z',
      updatedAt: '2026-09-01T00:00:00Z',
      config: { locationFieldId: 'field_name' },
    };

    expect(findBrokenViewFieldIds(map, FIELDS).queryFieldIds).toEqual(['field_name']);

    const ok: View = { ...map, config: { locationFieldId: 'field_place' } };
    expect(findBrokenViewFieldIds(ok, FIELDS).queryFieldIds).toEqual([]);
  });

  it('detects broken refs inside nested Filter groups', () => {
    const filter: FilterNode = {
      kind: 'group',
      operator: 'or',
      children: [
        {
          kind: 'group',
          operator: 'and',
          children: [{ kind: 'rule', fieldId: 'field_gone', operator: 'isEmpty' }],
        },
        { kind: 'rule', fieldId: 'field_name', operator: 'isEmpty' },
      ],
    };
    const view: View = {
      ...GRID_VIEW,
      config: { ...GRID_VIEW.config, projection: ['field_name'], filter },
    };

    const issues = findBrokenViewFieldIds(view, FIELDS);
    expect(issues.queryFieldIds).toEqual(['field_gone']);
  });
});

describe('repairViewConfig', () => {
  it('removes confirmed broken query refs and cleans stale presentation refs', () => {
    const repaired = repairViewConfig(GRID_VIEW, FIELDS, { removeFieldIds: ['field_gone'] });

    if (repaired === null || 'locationFieldId' in repaired) {
      throw new Error('expected a Grid config');
    }
    expect(repaired.projection).toEqual(['field_name']);
    expect(repaired.sort).toEqual([]);
    expect(repaired.columnOrder).toEqual(['field_name']);
    expect(repaired.columnWidths).toEqual({ field_name: 200 });
    expect(repaired.frozenFieldIds).toEqual([]);
    expect(repaired.filter).toEqual({
      kind: 'group',
      operator: 'and',
      children: [{ kind: 'rule', fieldId: 'field_name', operator: 'contains', value: 'a' }],
    });
    expect(
      findBrokenViewFieldIds({ ...GRID_VIEW, config: repaired }, FIELDS).queryFieldIds,
    ).toEqual([]);
  });

  it('drops the whole Filter when the only root rule referenced a broken Field', () => {
    const view: View = {
      ...GRID_VIEW,
      config: {
        ...GRID_VIEW.config,
        filter: { kind: 'rule', fieldId: 'field_gone', operator: 'is', value: 'x' },
      },
    };

    const repaired = repairViewConfig(view, FIELDS, { removeFieldIds: ['field_gone'] });
    if (repaired === null || 'locationFieldId' in repaired) {
      throw new Error('expected a Grid config');
    }
    expect(repaired.filter).toBeUndefined();
  });

  it('collapses emptied Filter groups upward without submitting empty children', () => {
    const view: View = {
      ...GRID_VIEW,
      config: {
        ...GRID_VIEW.config,
        filter: {
          kind: 'group',
          operator: 'and',
          children: [
            {
              kind: 'group',
              operator: 'or',
              children: [{ kind: 'rule', fieldId: 'field_gone', operator: 'isEmpty' }],
            },
            { kind: 'rule', fieldId: 'field_name', operator: 'isNotEmpty' },
          ],
        },
      },
    };

    const repaired = repairViewConfig(view, FIELDS, { removeFieldIds: ['field_gone'] });
    if (repaired === null || 'locationFieldId' in repaired) {
      throw new Error('expected a Grid config');
    }
    expect(repaired.filter).toEqual({
      kind: 'group',
      operator: 'and',
      children: [{ kind: 'rule', fieldId: 'field_name', operator: 'isNotEmpty' }],
    });
  });

  it('requires an explicit active Location Field when repairing a Map View', () => {
    const map: View = {
      id: 'view_map',
      tableId: 'table_01',
      name: 'Map',
      type: 'map',
      revision: 1,
      createdAt: '2026-09-01T00:00:00Z',
      updatedAt: '2026-09-01T00:00:00Z',
      config: {
        locationFieldId: 'field_gone',
        filter: { kind: 'rule', fieldId: 'field_gone', operator: 'isNotEmpty' },
      },
    };

    expect(repairViewConfig(map, FIELDS, {})).toBeNull();
    expect(repairViewConfig(map, FIELDS, { locationFieldId: 'field_name' })).toBeNull();

    const repaired = repairViewConfig(map, FIELDS, {
      removeFieldIds: ['field_gone'],
      locationFieldId: 'field_place',
    });
    if (repaired === null || !('locationFieldId' in repaired)) {
      throw new Error('expected a Map config');
    }
    expect(repaired.locationFieldId).toBe('field_place');
    expect(repaired.filter).toBeUndefined();
  });

  it('keeps a valid Map Location Field and camera while removing broken Filter refs', () => {
    const map: View = {
      id: 'view_map',
      tableId: 'table_01',
      name: 'Map',
      type: 'map',
      revision: 1,
      createdAt: '2026-09-01T00:00:00Z',
      updatedAt: '2026-09-01T00:00:00Z',
      config: {
        locationFieldId: 'field_place',
        center: { lat: 10, lng: 20 },
        zoom: 8,
        filter: { kind: 'rule', fieldId: 'field_gone', operator: 'is', value: 1 },
      },
    };

    const repaired = repairViewConfig(map, FIELDS, { removeFieldIds: ['field_gone'] });
    if (repaired === null || !('locationFieldId' in repaired)) {
      throw new Error('expected a Map config');
    }
    expect(repaired.locationFieldId).toBe('field_place');
    expect(repaired.center).toEqual({ lat: 10, lng: 20 });
    expect(repaired.zoom).toBe(8);
    expect(repaired.filter).toBeUndefined();
  });
});
