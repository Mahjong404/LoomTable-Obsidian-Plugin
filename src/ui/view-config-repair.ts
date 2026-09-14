import type {
  Field,
  FilterNode,
  GridViewConfig,
  MapViewConfig,
  View,
} from '../client/loomtable-client';

export interface ViewConfigFieldIssues {
  readonly queryFieldIds: readonly string[];
  readonly presentationFieldIds: readonly string[];
}

export interface ViewConfigRepairInput {
  readonly removeFieldIds?: readonly string[];
  readonly locationFieldId?: string;
}

export function findBrokenViewFieldIds(
  view: View,
  fields: readonly Field[],
): ViewConfigFieldIssues {
  const active = new Set(
    fields.filter((field) => field.deletedAt === undefined).map((field) => field.id),
  );
  const query = new Set<string>();
  const presentation = new Set<string>();
  const markQuery = (fieldId: string): void => {
    if (!active.has(fieldId)) query.add(fieldId);
  };
  const markPresentation = (fieldId: string): void => {
    if (!active.has(fieldId)) presentation.add(fieldId);
  };
  const scanFilter = (node: FilterNode | undefined): void => {
    if (node === undefined) return;
    if (node.kind === 'rule') {
      markQuery(node.fieldId);
      return;
    }
    for (const child of node.children) scanFilter(child);
  };

  if (view.type === 'grid') {
    const config = view.config;
    for (const fieldId of config.projection) markQuery(fieldId);
    for (const sort of config.sort) markQuery(sort.fieldId);
    scanFilter(config.filter);
    for (const fieldId of config.columnOrder) markPresentation(fieldId);
    for (const fieldId of Object.keys(config.columnWidths)) markPresentation(fieldId);
    for (const fieldId of config.frozenFieldIds) markPresentation(fieldId);
  } else {
    const location = fields.find((field) => field.id === view.config.locationFieldId);
    if (
      location === undefined ||
      location.deletedAt !== undefined ||
      location.type !== 'location'
    ) {
      query.add(view.config.locationFieldId);
    }
    scanFilter(view.config.filter);
  }
  return { queryFieldIds: [...query], presentationFieldIds: [...presentation] };
}

export function repairViewConfig(
  view: View,
  fields: readonly Field[],
  input: ViewConfigRepairInput,
): GridViewConfig | MapViewConfig | null {
  const remove = new Set(input.removeFieldIds ?? []);
  const active = new Set(
    fields.filter((field) => field.deletedAt === undefined).map((field) => field.id),
  );
  if (view.type === 'grid') {
    const config = view.config;
    const filter = removeFilterFieldIds(config.filter, remove);
    const repaired: GridViewConfig = {
      projection: config.projection.filter((fieldId) => !remove.has(fieldId)),
      columnOrder: config.columnOrder.filter(
        (fieldId) => active.has(fieldId) && !remove.has(fieldId),
      ),
      columnWidths: Object.fromEntries(
        Object.entries(config.columnWidths).filter(
          ([fieldId]) => active.has(fieldId) && !remove.has(fieldId),
        ),
      ),
      frozenFieldIds: config.frozenFieldIds.filter(
        (fieldId) => active.has(fieldId) && !remove.has(fieldId),
      ),
      rowHeight: config.rowHeight,
      sort: config.sort.filter((sort) => !remove.has(sort.fieldId)),
      ...(filter === undefined ? {} : { filter }),
    };
    return repaired;
  }

  const issues = findBrokenViewFieldIds(view, fields);
  let locationFieldId = view.config.locationFieldId;
  if (issues.queryFieldIds.includes(view.config.locationFieldId)) {
    const replacement = input.locationFieldId;
    const candidate = fields.find(
      (field) =>
        field.id === replacement &&
        field.deletedAt === undefined &&
        field.type === 'location' &&
        field.tableId === view.tableId,
    );
    if (candidate === undefined) return null;
    locationFieldId = candidate.id;
  } else if (input.locationFieldId !== undefined) {
    const candidate = fields.find(
      (field) =>
        field.id === input.locationFieldId &&
        field.deletedAt === undefined &&
        field.type === 'location' &&
        field.tableId === view.tableId,
    );
    if (candidate === undefined) return null;
    locationFieldId = candidate.id;
  }
  const filter = removeFilterFieldIds(view.config.filter, remove);
  const repaired: MapViewConfig = {
    locationFieldId,
    ...(filter === undefined ? {} : { filter }),
    ...(view.config.center === undefined ? {} : { center: view.config.center }),
    ...(view.config.zoom === undefined ? {} : { zoom: view.config.zoom }),
  };
  return repaired;
}

function removeFilterFieldIds(
  node: FilterNode | undefined,
  remove: ReadonlySet<string>,
): FilterNode | undefined {
  if (node === undefined) return undefined;
  if (node.kind === 'rule') {
    return remove.has(node.fieldId) ? undefined : node;
  }
  const children = node.children
    .map((child) => removeFilterFieldIds(child, remove))
    .filter((child): child is FilterNode => child !== undefined);
  if (children.length === 0) return undefined;
  return { ...node, children };
}
