import type { Field, GridViewConfig } from '../client/loomtable-client';

export const GRID_COLUMN_WIDTH_MIN = 80;
export const GRID_COLUMN_WIDTH_MAX = 1000;
export const GRID_COLUMN_WIDTH_DEFAULT = 180;
export const GRID_INDEX_COLUMN_WIDTH = 56;

export interface GridDisplayPatch {
  readonly projection: readonly string[];
  readonly columnOrder: readonly string[];
  readonly columnWidths: Readonly<Record<string, number>>;
  readonly frozenFieldIds: readonly string[];
  readonly rowHeight: GridViewConfig['rowHeight'];
}

export interface ResolvedGridColumns {
  readonly ordered: readonly Field[];
  readonly frozen: readonly Field[];
  readonly normal: readonly Field[];
  readonly widths: ReadonlyMap<string, number>;
  readonly frozenOffsets: ReadonlyMap<string, number>;
}

export type DisplayPatchIssueReason =
  'no-visible-fields' | 'unknown-field' | 'width-out-of-range' | 'frozen-not-visible';

export interface DisplayPatchIssue {
  readonly reason: DisplayPatchIssueReason;
  readonly fieldId?: string;
}

export function clampGridColumnWidth(width: number): number {
  return Math.max(GRID_COLUMN_WIDTH_MIN, Math.min(GRID_COLUMN_WIDTH_MAX, Math.round(width)));
}

function activeFieldsByPosition(fields: readonly Field[]): readonly Field[] {
  return fields
    .filter((field) => field.deletedAt === undefined)
    .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id));
}

export function resolveGridColumns(
  fields: readonly Field[],
  config: GridViewConfig | undefined,
): ResolvedGridColumns {
  const active = activeFieldsByPosition(fields);
  const byId = new Map(active.map((field) => [field.id, field]));
  const projection = config?.projection ?? [];
  const visibleIds =
    projection.length === 0
      ? new Set(active.map((field) => field.id))
      : new Set(projection.filter((fieldId) => byId.has(fieldId)));

  const seen = new Set<string>();
  const orderedVisible: Field[] = [];
  for (const fieldId of config?.columnOrder ?? []) {
    if (!visibleIds.has(fieldId) || seen.has(fieldId)) continue;
    const field = byId.get(fieldId);
    if (field === undefined) continue;
    seen.add(fieldId);
    orderedVisible.push(field);
  }
  for (const field of active) {
    if (visibleIds.has(field.id) && !seen.has(field.id)) orderedVisible.push(field);
  }

  const frozenIds = new Set(config?.frozenFieldIds ?? []);
  const frozen = orderedVisible.filter((field) => frozenIds.has(field.id));
  const normal = orderedVisible.filter((field) => !frozenIds.has(field.id));

  const widths = new Map<string, number>();
  for (const field of [...frozen, ...normal]) {
    widths.set(field.id, clampGridColumnWidth(config?.columnWidths[field.id] ?? 180));
  }
  const frozenOffsets = new Map<string, number>();
  let offset = GRID_INDEX_COLUMN_WIDTH;
  for (const field of frozen) {
    frozenOffsets.set(field.id, offset);
    offset += widths.get(field.id) ?? GRID_COLUMN_WIDTH_DEFAULT;
  }

  return { ordered: [...frozen, ...normal], frozen, normal, widths, frozenOffsets };
}

export function validateDisplayPatch(
  patch: GridDisplayPatch,
  fields: readonly Field[],
): readonly DisplayPatchIssue[] {
  const issues: DisplayPatchIssue[] = [];
  const active = new Set(activeFieldsByPosition(fields).map((field) => field.id));
  const visible = new Set(patch.projection);

  if (patch.projection.length === 0) issues.push({ reason: 'no-visible-fields' });
  for (const fieldId of patch.projection) {
    if (!active.has(fieldId)) issues.push({ reason: 'unknown-field', fieldId });
  }
  for (const [fieldId, width] of Object.entries(patch.columnWidths)) {
    if (!visible.has(fieldId)) {
      issues.push({ reason: 'unknown-field', fieldId });
      continue;
    }
    if (
      !Number.isInteger(width) ||
      width < GRID_COLUMN_WIDTH_MIN ||
      width > GRID_COLUMN_WIDTH_MAX
    ) {
      issues.push({ reason: 'width-out-of-range', fieldId });
    }
  }
  for (const fieldId of patch.frozenFieldIds) {
    if (!visible.has(fieldId)) issues.push({ reason: 'frozen-not-visible', fieldId });
  }
  return issues;
}
