import { describe, expect, it } from 'vitest';

import type { Field, GridViewConfig } from '../../src/client/loomtable-client';
import {
  GRID_COLUMN_WIDTH_DEFAULT,
  GRID_COLUMN_WIDTH_MAX,
  GRID_COLUMN_WIDTH_MIN,
  resolveGridColumns,
  validateDisplayPatch,
} from '../../src/ui/grid-display';

function field(id: string, name: string, position: number, deleted = false): Field {
  return {
    id,
    tableId: 'table_01',
    name,
    position,
    schemaVersion: 1,
    revision: 1,
    type: 'text',
    config: {},
    ...(deleted ? { deletedAt: '2026-01-01T00:00:00Z' } : {}),
  };
}

const FIELDS: readonly Field[] = [
  field('field_a', 'A', 0),
  field('field_b', 'B', 1),
  field('field_c', 'C', 2),
  field('field_d', 'D', 3),
];

function config(overrides: Partial<GridViewConfig> = {}): GridViewConfig {
  return {
    projection: [],
    columnOrder: [],
    columnWidths: {},
    frozenFieldIds: [],
    rowHeight: 'standard',
    sort: [],
    ...overrides,
  };
}

describe('resolveGridColumns', () => {
  it('treats an empty projection as all active Fields in position order', () => {
    const resolved = resolveGridColumns(FIELDS, config());
    expect(resolved.ordered.map((entry) => entry.id)).toEqual([
      'field_a',
      'field_b',
      'field_c',
      'field_d',
    ]);
    expect(resolved.frozen).toEqual([]);
  });

  it('excludes hidden Fields even when they remain in columnOrder', () => {
    const resolved = resolveGridColumns(
      FIELDS,
      config({
        projection: ['field_a', 'field_c'],
        columnOrder: ['field_b', 'field_c', 'field_a'],
      }),
    );
    expect(resolved.ordered.map((entry) => entry.id)).toEqual(['field_c', 'field_a']);
  });

  it('appends visible Fields missing from columnOrder by position', () => {
    const resolved = resolveGridColumns(FIELDS, config({ columnOrder: ['field_c', 'field_a'] }));
    expect(resolved.ordered.map((entry) => entry.id)).toEqual([
      'field_c',
      'field_a',
      'field_b',
      'field_d',
    ]);
  });

  it('partitions frozen columns to the left in columnOrder order', () => {
    const resolved = resolveGridColumns(
      FIELDS,
      config({
        columnOrder: ['field_c', 'field_a', 'field_b', 'field_d'],
        frozenFieldIds: ['field_b', 'field_c'],
      }),
    );
    expect(resolved.frozen.map((entry) => entry.id)).toEqual(['field_c', 'field_b']);
    expect(resolved.ordered.map((entry) => entry.id)).toEqual([
      'field_c',
      'field_b',
      'field_a',
      'field_d',
    ]);
  });

  it('ignores stale display references and deleted Fields', () => {
    const resolved = resolveGridColumns(
      [...FIELDS, field('field_gone', 'Gone', 9, true)],
      config({
        projection: ['field_a', 'field_gone', 'field_missing'],
        columnOrder: ['field_missing', 'field_a'],
        frozenFieldIds: ['field_missing'],
      }),
    );
    expect(resolved.ordered.map((entry) => entry.id)).toEqual(['field_a']);
  });

  it('resolves effective widths with defaults and the 80–1000 clamp', () => {
    const resolved = resolveGridColumns(
      FIELDS,
      config({
        columnWidths: { field_a: 40, field_b: 5000, field_c: 240.6 },
      }),
    );
    expect(resolved.widths.get('field_a')).toBe(GRID_COLUMN_WIDTH_MIN);
    expect(resolved.widths.get('field_b')).toBe(GRID_COLUMN_WIDTH_MAX);
    expect(resolved.widths.get('field_c')).toBe(241);
    expect(resolved.widths.get('field_d')).toBe(GRID_COLUMN_WIDTH_DEFAULT);
  });
});

describe('validateDisplayPatch', () => {
  const base = {
    projection: ['field_a', 'field_b'],
    columnOrder: ['field_b', 'field_a', 'field_c', 'field_d'],
    columnWidths: { field_a: 200 },
    frozenFieldIds: ['field_b'],
    rowHeight: 'compact' as const,
  };

  it('accepts a well-formed patch', () => {
    expect(validateDisplayPatch(base, FIELDS)).toEqual([]);
  });

  it('requires at least one visible Field', () => {
    expect(
      validateDisplayPatch({ ...base, projection: [] }, FIELDS).map((issue) => issue.reason),
    ).toContain('no-visible-fields');
  });

  it('rejects unknown or hidden width entries and out-of-range values', () => {
    const issues = validateDisplayPatch(
      { ...base, columnWidths: { field_missing: 100, field_a: 40 } },
      FIELDS,
    ).map((issue) => issue.reason);
    expect(issues).toContain('unknown-field');
    expect(issues).toContain('width-out-of-range');
  });

  it('rejects a frozen Field that is not visible', () => {
    const issues = validateDisplayPatch({ ...base, frozenFieldIds: ['field_c'] }, FIELDS).map(
      (issue) => issue.reason,
    );
    expect(issues).toContain('frozen-not-visible');
  });
});
