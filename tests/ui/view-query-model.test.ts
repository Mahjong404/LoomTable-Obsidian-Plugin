import { describe, expect, it } from 'vitest';

import type {
  Field,
  FilterGroup,
  FilterNode,
  FilterRule,
  JsonValue,
} from '../../src/client/loomtable-client';
import {
  MAX_FILTER_DEPTH,
  MAX_FILTER_NODES,
  addFilterChild,
  countFilterRules,
  filterOperatorsForField,
  isSortableField,
  nextHeaderSort,
  normalizeSearchTerm,
  removeFilterNodeAt,
  setFilterGroupOperator,
  updateFilterNodeAt,
  validateFilterDraft,
  coerceRuleForField,
} from '../../src/ui/view-query-model';

function field(id: string, type: Field['type'], name = id): Field {
  return {
    id,
    tableId: 'table_01',
    name,
    position: 1,
    schemaVersion: 1,
    revision: 1,
    type,
    config:
      type === 'select' || type === 'multiSelect'
        ? {
            options: [
              { id: 'opt_a', name: 'Alpha', color: 'blue' },
              { id: 'opt_b', name: 'Beta', color: 'red' },
            ],
            deletedOptions: [{ id: 'opt_old', name: 'Legacy', color: 'gray', deletedAt: 'x' }],
          }
        : {},
  } as Field;
}

const FIELDS: readonly Field[] = [
  field('field_text', 'text'),
  field('field_number', 'number'),
  field('field_date', 'date'),
  field('field_check', 'checkbox'),
  field('field_select', 'select'),
  field('field_multi', 'multiSelect'),
  field('field_location', 'location'),
  field('field_attach', 'attachment'),
];

function rule(fieldId: string, operator: FilterRule['operator'], value?: unknown): FilterRule {
  if (value === undefined) return { kind: 'rule', fieldId, operator };
  return { kind: 'rule', fieldId, operator, value: value as JsonValue };
}

function group(operator: 'and' | 'or', children: readonly FilterNode[]): FilterGroup {
  return { kind: 'group', operator, children };
}

describe('view-query-model operator matrix', () => {
  it('maps each Field type to the contract operator set', () => {
    expect(filterOperatorsForField(FIELDS[0]!)).toEqual([
      'is',
      'isNot',
      'contains',
      'notContains',
      'startsWith',
      'endsWith',
      'isEmpty',
      'isNotEmpty',
    ]);
    expect(filterOperatorsForField(FIELDS[1]!)).toEqual([
      'is',
      'isNot',
      'greaterThan',
      'greaterOrEqual',
      'lessThan',
      'lessOrEqual',
      'isEmpty',
      'isNotEmpty',
    ]);
    expect(filterOperatorsForField(FIELDS[2]!)).toEqual(filterOperatorsForField(FIELDS[1]!));
    expect(filterOperatorsForField(FIELDS[3]!)).toEqual(['is', 'isNot']);
    expect(filterOperatorsForField(FIELDS[4]!)).toEqual(['is', 'isNot', 'isEmpty', 'isNotEmpty']);
    expect(filterOperatorsForField(FIELDS[5]!)).toEqual([
      'includes',
      'excludes',
      'isEmpty',
      'isNotEmpty',
    ]);
    expect(filterOperatorsForField(FIELDS[6]!)).toEqual(['isEmpty', 'isNotEmpty']);
    expect(filterOperatorsForField(FIELDS[7]!)).toEqual(['isEmpty', 'isNotEmpty']);
  });

  it('marks MultiSelect, Location and Attachment as not sortable', () => {
    expect(isSortableField(FIELDS[0]!)).toBe(true);
    expect(isSortableField(FIELDS[1]!)).toBe(true);
    expect(isSortableField(FIELDS[3]!)).toBe(true);
    expect(isSortableField(FIELDS[4]!)).toBe(true);
    expect(isSortableField(FIELDS[5]!)).toBe(false);
    expect(isSortableField(FIELDS[6]!)).toBe(false);
    expect(isSortableField(FIELDS[7]!)).toBe(false);
  });
});

describe('view-query-model header sort cycle', () => {
  it('cycles none → asc → desc → none with nulls=last', () => {
    const asc = nextHeaderSort([], 'field_text');
    expect(asc).toEqual([{ fieldId: 'field_text', direction: 'asc', nulls: 'last' }]);
    const desc = nextHeaderSort(asc!, 'field_text');
    expect(desc).toEqual([{ fieldId: 'field_text', direction: 'desc', nulls: 'last' }]);
    expect(nextHeaderSort(desc!, 'field_text')).toEqual([]);
  });

  it('switches to the clicked Field as a single sort', () => {
    const next = nextHeaderSort(
      [{ fieldId: 'field_text', direction: 'desc', nulls: 'last' }],
      'field_number',
    );
    expect(next).toEqual([{ fieldId: 'field_number', direction: 'asc', nulls: 'last' }]);
  });

  it('returns null when a multi-sort exists so the panel opens instead', () => {
    const multi = [
      { fieldId: 'field_text' as const, direction: 'asc' as const, nulls: 'last' as const },
      { fieldId: 'field_number' as const, direction: 'desc' as const, nulls: 'last' as const },
    ];
    expect(nextHeaderSort(multi, 'field_text')).toBeNull();
  });
});

describe('view-query-model Filter draft editing', () => {
  it('adds rules and groups under a parent path', () => {
    let root = group('and', [rule('field_text', 'contains', 'a')]);
    root = addFilterChild(root, [], 'group', FIELDS[0]!) as FilterGroup;
    expect(root.children).toHaveLength(2);
    const child = root.children[1];
    if (child === undefined || child.kind !== 'group') throw new Error('expected group');
    root = addFilterChild(root, [1], 'rule', FIELDS[0]!) as FilterGroup;
    const nested = root.children[1];
    if (nested === undefined || nested.kind !== 'group') throw new Error('expected group');
    expect(nested.children).toHaveLength(1);
  });

  it('removes a node and collapses empty non-root groups upward', () => {
    const root = group('and', [
      rule('field_text', 'contains', 'a'),
      group('or', [rule('field_number', 'is', 1)]),
    ]);
    const next = removeFilterNodeAt(root, [1, 0]) as FilterGroup;
    expect(next.children).toHaveLength(1);
    expect(next.children[0]?.kind).toBe('rule');
  });

  it('returns undefined when the last root rule is removed', () => {
    const root = rule('field_text', 'contains', 'a');
    expect(removeFilterNodeAt(root, [])).toBeUndefined();
  });

  it('removes a root group whose last child was deleted', () => {
    const root = group('and', [rule('field_text', 'contains', 'a')]);
    const next = removeFilterNodeAt(root, [0]);
    expect(next).toBeUndefined();
  });

  it('toggles the group operator and updates rules in place', () => {
    const root = group('and', [rule('field_text', 'contains', 'a')]);
    const toggled = setFilterGroupOperator(root, [], 'or') as FilterGroup;
    expect(toggled.operator).toBe('or');
    const updated = updateFilterNodeAt(toggled, [0], () => rule('field_text', 'is', 'b'));
    expect((updated as FilterGroup).children[0]).toEqual(rule('field_text', 'is', 'b'));
  });
});

describe('view-query-model Filter validation', () => {
  it('accepts a complete draft and counts its rules', () => {
    const root = group('and', [
      rule('field_text', 'contains', '  padded  '),
      group('or', [rule('field_select', 'is', 'opt_old'), rule('field_check', 'is', true)]),
    ]);
    expect(validateFilterDraft(root, FIELDS)).toEqual([]);
    expect(countFilterRules(root)).toBe(3);
  });

  it('keeps user whitespace in text operands', () => {
    const root = rule('field_text', 'contains', '  padded  ');
    expect(validateFilterDraft(root, FIELDS)).toEqual([]);
  });

  it('rejects groups without children and paths beyond the depth limit', () => {
    const emptyGroup = group('and', []);
    expect(validateFilterDraft(emptyGroup, FIELDS).map((issue) => issue.reason)).toEqual([
      'empty-group',
    ]);
    let deep: FilterNode = rule('field_text', 'is', 'a');
    for (let index = 0; index < MAX_FILTER_DEPTH; index += 1) {
      deep = group('and', [deep]);
    }
    const reasons = validateFilterDraft(deep, FIELDS).map((issue) => issue.reason);
    expect(reasons).toContain('depth');
  });

  it('rejects drafts beyond the node budget', () => {
    const children = Array.from({ length: MAX_FILTER_NODES + 1 }, () =>
      rule('field_text', 'is', 'a'),
    );
    expect(
      validateFilterDraft(group('and', children), FIELDS).map((issue) => issue.reason),
    ).toContain('too-many');
  });

  it('flags unknown and deleted Fields as unusable', () => {
    const root = rule('field_gone', 'is', 'a');
    expect(validateFilterDraft(root, FIELDS)[0]?.reason).toBe('unknown-field');
    const deleted = { ...field('field_deleted', 'text'), deletedAt: 'x' } as Field;
    expect(
      validateFilterDraft(rule('field_deleted', 'is', 'a'), [...FIELDS, deleted])[0]?.reason,
    ).toBe('unknown-field');
  });

  it('flags operators outside the Field matrix', () => {
    const root = rule('field_multi', 'is', 'opt_a');
    expect(validateFilterDraft(root, FIELDS)[0]?.reason).toBe('operator-unsupported');
  });

  it('requires non-empty operators to carry a value and empty operators to omit it', () => {
    expect(validateFilterDraft(rule('field_text', 'is'), FIELDS)[0]?.reason).toBe('value-missing');
    const withValue = { ...rule('field_text', 'isEmpty'), value: 'x' };
    expect(validateFilterDraft(withValue, FIELDS)[0]?.reason).toBe('value-invalid');
  });

  it('validates operand types without implicit conversion', () => {
    expect(validateFilterDraft(rule('field_number', 'is', '5'), FIELDS)[0]?.reason).toBe(
      'value-invalid',
    );
    expect(validateFilterDraft(rule('field_number', 'is', 5), FIELDS)).toEqual([]);
    expect(validateFilterDraft(rule('field_number', 'is', Number.NaN), FIELDS)[0]?.reason).toBe(
      'value-invalid',
    );
    expect(validateFilterDraft(rule('field_date', 'is', '2026-13-40'), FIELDS)[0]?.reason).toBe(
      'value-invalid',
    );
    expect(validateFilterDraft(rule('field_date', 'is', '2026-09-14'), FIELDS)).toEqual([]);
    expect(validateFilterDraft(rule('field_check', 'is', 'true'), FIELDS)[0]?.reason).toBe(
      'value-invalid',
    );
    expect(validateFilterDraft(rule('field_check', 'is', false), FIELDS)).toEqual([]);
  });

  it('allows deleted Select options as operands but rejects unknown options', () => {
    expect(validateFilterDraft(rule('field_select', 'is', 'opt_old'), FIELDS)).toEqual([]);
    expect(validateFilterDraft(rule('field_multi', 'includes', 'opt_old'), FIELDS)).toEqual([]);
    expect(validateFilterDraft(rule('field_select', 'is', 'opt_nope'), FIELDS)[0]?.reason).toBe(
      'option-unknown',
    );
    expect(validateFilterDraft(rule('field_multi', 'includes', ['opt_a']), FIELDS)[0]?.reason).toBe(
      'value-invalid',
    );
  });

  it('drops an operand that no longer applies when the Field changes', () => {
    const coerced = coerceRuleForField(rule('field_text', 'contains', 'abc'), FIELDS[3]!);
    expect(coerced.fieldId).toBe('field_check');
    expect(coerced.operator).toBe('is');
    expect(coerced.value).toBeUndefined();
    const kept = coerceRuleForField(rule('field_text', 'is', 'abc'), FIELDS[0]!);
    expect(kept.value).toBe('abc');
  });
});

describe('view-query-model Search normalization', () => {
  it('trims edges and treats an empty term as no Search', () => {
    expect(normalizeSearchTerm('  alpha  ')).toBe('alpha');
    expect(normalizeSearchTerm('   ')).toBeNull();
    expect(normalizeSearchTerm('')).toBeNull();
  });

  it('rejects terms longer than 500 Unicode code points', () => {
    const limit = 'a'.repeat(500);
    expect(normalizeSearchTerm(limit)).toBe(limit);
    expect(normalizeSearchTerm(`${limit}a`)).toBeNull();
    const astral = '𐐷'.repeat(501);
    expect(normalizeSearchTerm(astral)).toBeNull();
  });
});
