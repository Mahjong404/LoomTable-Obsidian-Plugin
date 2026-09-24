import type {
  Field,
  FilterGroup,
  FilterNode,
  FilterOperator,
  FilterRule,
  JsonValue,
  SortSpec,
} from '../client/loomtable-client';

export const MAX_FILTER_DEPTH = 8;
export const MAX_FILTER_NODES = 100;
export const MAX_SORT_FIELDS = 10;
export const MAX_SEARCH_CODE_POINTS = 500;

const EMPTY_OPERATORS: readonly FilterOperator[] = ['isEmpty', 'isNotEmpty'];
const TEXT_OPERATORS: readonly FilterOperator[] = [
  'is',
  'isNot',
  'contains',
  'notContains',
  'startsWith',
  'endsWith',
  'isEmpty',
  'isNotEmpty',
];
const ORDERED_OPERATORS: readonly FilterOperator[] = [
  'is',
  'isNot',
  'greaterThan',
  'greaterOrEqual',
  'lessThan',
  'lessOrEqual',
  'isEmpty',
  'isNotEmpty',
];
const CHECKBOX_OPERATORS: readonly FilterOperator[] = ['is', 'isNot'];
const SELECT_OPERATORS: readonly FilterOperator[] = ['is', 'isNot', 'isEmpty', 'isNotEmpty'];
const MULTI_SELECT_OPERATORS: readonly FilterOperator[] = [
  'includes',
  'excludes',
  'isEmpty',
  'isNotEmpty',
];

export function filterOperatorsForField(field: Field): readonly FilterOperator[] {
  switch (field.type) {
    case 'text':
    case 'longText':
    case 'url':
      return TEXT_OPERATORS;
    case 'number':
    case 'date':
      return ORDERED_OPERATORS;
    case 'checkbox':
      return CHECKBOX_OPERATORS;
    case 'select':
      return SELECT_OPERATORS;
    case 'multiSelect':
      return MULTI_SELECT_OPERATORS;
    default:
      return EMPTY_OPERATORS;
  }
}

export function operatorNeedsValue(operator: FilterOperator): boolean {
  return operator !== 'isEmpty' && operator !== 'isNotEmpty';
}

export function isSortableField(field: Field): boolean {
  return field.type !== 'multiSelect' && field.type !== 'location' && field.type !== 'attachment';
}

export function defaultSortFor(fieldId: string): SortSpec {
  return { fieldId, direction: 'asc', nulls: 'last' };
}

export function nextHeaderSort(
  current: readonly SortSpec[],
  fieldId: string,
): readonly SortSpec[] | null {
  if (current.length > 1) return null;
  const existing = current[0];
  if (existing === undefined || existing.fieldId !== fieldId) {
    return [defaultSortFor(fieldId)];
  }
  if (existing.direction === 'asc') {
    return [{ ...existing, direction: 'desc' }];
  }
  return [];
}

export type FilterPath = readonly number[];

export type FilterIssueReason =
  | 'empty-group'
  | 'depth'
  | 'too-many'
  | 'unknown-field'
  | 'operator-unsupported'
  | 'value-missing'
  | 'value-invalid'
  | 'option-unknown';

export interface FilterIssue {
  readonly path: FilterPath;
  readonly reason: FilterIssueReason;
}

export function countFilterRules(root: FilterNode | undefined): number {
  if (root === undefined) return 0;
  if (root.kind === 'rule') return 1;
  return root.children.reduce((count, child) => count + countFilterRules(child), 0);
}

export function countFilterNodes(root: FilterNode | undefined): number {
  if (root === undefined) return 0;
  if (root.kind === 'rule') return 1;
  return 1 + root.children.reduce((count, child) => count + countFilterNodes(child), 0);
}

export function filterNodeAt(root: FilterNode, path: FilterPath): FilterNode | undefined {
  let node: FilterNode = root;
  for (const index of path) {
    if (node.kind !== 'group') return undefined;
    const child = node.children[index];
    if (child === undefined) return undefined;
    node = child;
  }
  return node;
}

export function createFilterRule(field: Field, operator?: FilterOperator): FilterRule {
  return {
    kind: 'rule',
    fieldId: field.id,
    operator: operator ?? filterOperatorsForField(field)[0]!,
  };
}

export function addFilterChild(
  root: FilterNode,
  parentPath: FilterPath,
  kind: 'rule' | 'group',
  field: Field,
): FilterNode {
  const child: FilterNode =
    kind === 'group' ? { kind: 'group', operator: 'and', children: [] } : createFilterRule(field);
  return updateFilterNodeAt(root, parentPath, (parent) => {
    if (parent.kind === 'group') {
      return { ...parent, children: [...parent.children, child] };
    }
    return { kind: 'group', operator: 'and', children: [parent, child] };
  });
}

export function removeFilterNodeAt(root: FilterNode, path: FilterPath): FilterNode | undefined {
  if (path.length === 0) return undefined;
  const parentPath = path.slice(0, -1);
  const index = path[path.length - 1]!;
  const next = updateFilterNodeAt(root, parentPath, (parent) => {
    if (parent.kind !== 'group') return parent;
    const children = parent.children.filter((_, position) => position !== index);
    return { ...parent, children };
  });
  const collapsed = collapseEmptyGroups(next);
  return collapsed !== undefined && collapsed.kind === 'group' && collapsed.children.length === 1
    ? collapsed.children[0]
    : collapsed;
}

function collapseEmptyGroups(node: FilterNode): FilterNode | undefined {
  if (node.kind === 'rule') return node;
  const children = node.children
    .map(collapseEmptyGroups)
    .filter((child): child is FilterNode => child !== undefined);
  if (children.length === 0) return undefined;
  return { ...node, children };
}

export function updateFilterNodeAt(
  root: FilterNode,
  path: FilterPath,
  updater: (node: FilterNode) => FilterNode,
): FilterNode {
  if (path.length === 0) return updater(root);
  if (root.kind !== 'group') return root;
  const index = path[0]!;
  const children = root.children.map((child, position) =>
    position === index ? updateFilterNodeAt(child, path.slice(1), updater) : child,
  );
  return { ...root, children };
}

export function setFilterGroupOperator(
  root: FilterNode,
  path: FilterPath,
  operator: 'and' | 'or',
): FilterNode {
  return updateFilterNodeAt(root, path, (node) =>
    node.kind === 'group' ? { ...node, operator } : node,
  );
}

export function coerceRuleForField(rule: FilterRule, field: Field): FilterRule {
  const operators = filterOperatorsForField(field);
  const operator = operators.includes(rule.operator) ? rule.operator : operators[0]!;
  if (!operatorNeedsValue(operator)) {
    return { kind: 'rule', fieldId: field.id, operator };
  }
  const next: FilterRule = { kind: 'rule', fieldId: field.id, operator };
  if (rule.value !== undefined && isRuleValueValid(field, operator, rule.value)) {
    return { ...next, value: rule.value };
  }
  return next;
}

export function coerceRuleForOperator(rule: FilterRule, operator: FilterOperator): FilterRule {
  if (!operatorNeedsValue(operator) || rule.value === undefined) {
    return { kind: 'rule', fieldId: rule.fieldId, operator };
  }
  return { kind: 'rule', fieldId: rule.fieldId, operator, value: rule.value };
}

export function validateFilterDraft(
  root: FilterNode | undefined,
  fields: readonly Field[],
): readonly FilterIssue[] {
  if (root === undefined) return [];
  const issues: FilterIssue[] = [];
  const activeFields = new Map(
    fields.filter((field) => field.deletedAt === undefined).map((field) => [field.id, field]),
  );
  if (countFilterNodes(root) > MAX_FILTER_NODES) {
    issues.push({ path: [], reason: 'too-many' });
  }
  const visit = (node: FilterNode, path: number[], depth: number): void => {
    if (depth > MAX_FILTER_DEPTH) {
      issues.push({ path, reason: 'depth' });
      return;
    }
    if (node.kind === 'group') {
      if (node.children.length === 0) {
        issues.push({ path, reason: 'empty-group' });
        return;
      }
      node.children.forEach((child, index) => visit(child, [...path, index], depth + 1));
      return;
    }
    const field = activeFields.get(node.fieldId);
    if (field === undefined) {
      issues.push({ path, reason: 'unknown-field' });
      return;
    }
    if (!filterOperatorsForField(field).includes(node.operator)) {
      issues.push({ path, reason: 'operator-unsupported' });
      return;
    }
    if (!operatorNeedsValue(node.operator)) {
      if (node.value !== undefined) issues.push({ path, reason: 'value-invalid' });
      return;
    }
    if (node.value === undefined || node.value === null) {
      issues.push({ path, reason: 'value-missing' });
      return;
    }
    if (!isRuleValueValid(field, node.operator, node.value)) {
      const reason =
        (field.type === 'select' || field.type === 'multiSelect') &&
        typeof node.value === 'string' &&
        !selectOptionIds(field).has(node.value)
          ? 'option-unknown'
          : 'value-invalid';
      issues.push({ path, reason });
    }
  };
  visit(root, [], 1);
  return issues;
}

function isRuleValueValid(field: Field, operator: FilterOperator, value: JsonValue): boolean {
  void operator;
  switch (field.type) {
    case 'text':
    case 'longText':
    case 'url':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'date':
      return typeof value === 'string' && isValidDateString(value);
    case 'checkbox':
      return typeof value === 'boolean';
    case 'select':
    case 'multiSelect':
      return typeof value === 'string' && selectOptionIds(field).has(value);
    default:
      return false;
  }
}

function selectOptionIds(field: Field): ReadonlySet<string> {
  if (field.type !== 'select' && field.type !== 'multiSelect') return new Set();
  return new Set([
    ...field.config.options.map((option) => option.id),
    ...field.config.deletedOptions.map((option) => option.id),
  ]);
}

function isValidDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function normalizeSearchTerm(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  if ([...trimmed].length > MAX_SEARCH_CODE_POINTS) return null;
  return trimmed;
}
