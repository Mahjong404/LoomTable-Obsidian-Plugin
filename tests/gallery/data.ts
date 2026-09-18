// Shared fixtures for the development Gallery. Everything here is plain
// contract data plus a GridState factory — the same objects drive both the
// browser entry (main.ts) and the automated DOM suite (gallery.test.ts).
import type {
  Base,
  Field,
  GridViewConfig,
  LoomTableRecord,
  MapViewConfig,
  Table,
  View,
  Workspace,
} from '../../src/client/loomtable-client';
import type { GridState } from '../../src/ui/grid-view-controller';
import type { InMemoryGridData } from '../fixtures/in-memory-loomtable-client';

export const GALLERY_WORKSPACE: Workspace = {
  id: 'workspace_01',
  name: 'Personal',
  revision: 1,
  createdAt: '2026-08-14T00:00:00Z',
  updatedAt: '2026-08-14T00:00:00Z',
};

export const GALLERY_BASE: Base = {
  id: 'base_01',
  workspaceId: 'workspace_01',
  name: 'Projects Base',
  revision: 1,
  createdAt: '2026-08-14T00:00:00Z',
  updatedAt: '2026-08-14T00:00:00Z',
};

export const GALLERY_TABLE: Table = {
  id: 'table_01',
  baseId: 'base_01',
  name: 'Projects',
  primaryFieldId: 'field_title',
  revision: 1,
  createdAt: '2026-08-14T00:00:00Z',
  updatedAt: '2026-08-14T00:00:00Z',
};

const FIELD_BASE = {
  tableId: 'table_01',
  schemaVersion: 1,
  revision: 1,
};

const STATUS_OPTIONS = [
  { id: 'opt_todo', name: 'Todo', color: '#64748b' },
  { id: 'opt_doing', name: 'In progress', color: '#2563eb' },
  { id: 'opt_done', name: 'Done', color: '#16a34a' },
] as const;

const TAG_OPTIONS = [
  { id: 'tag_alpha', name: 'Alpha', color: '#7c3aed' },
  { id: 'tag_beta', name: 'Beta', color: '#db2777' },
  { id: 'tag_gamma', name: 'Gamma', color: '#ea580c' },
  { id: 'tag_delta', name: 'Delta', color: '#0891b2' },
  { id: 'tag_epsilon', name: 'Epsilon', color: '#4d7c0f' },
  { id: 'tag_zeta', name: 'Zeta', color: '#b45309' },
] as const;

export const GALLERY_FIELDS: readonly Field[] = [
  { ...FIELD_BASE, id: 'field_title', name: 'Title', position: 0, type: 'text', config: {} },
  { ...FIELD_BASE, id: 'field_notes', name: 'Notes', position: 1, type: 'longText', config: {} },
  { ...FIELD_BASE, id: 'field_count', name: 'Count', position: 2, type: 'number', config: {} },
  { ...FIELD_BASE, id: 'field_done', name: 'Done', position: 3, type: 'checkbox', config: {} },
  { ...FIELD_BASE, id: 'field_due', name: 'Due', position: 4, type: 'date', config: {} },
  { ...FIELD_BASE, id: 'field_link', name: 'Link', position: 5, type: 'url', config: {} },
  { ...FIELD_BASE, id: 'field_place', name: 'Place', position: 6, type: 'location', config: {} },
  {
    ...FIELD_BASE,
    id: 'field_status',
    name: 'Status',
    position: 7,
    type: 'select',
    config: {
      options: [...STATUS_OPTIONS],
      deletedOptions: [
        {
          id: 'opt_archived',
          name: 'Archived',
          color: '#64748b',
          deletedAt: '2026-08-01T00:00:00Z',
        },
      ],
    },
  },
  {
    ...FIELD_BASE,
    id: 'field_tags',
    name: 'Tags',
    position: 8,
    type: 'multiSelect',
    config: {
      options: [...TAG_OPTIONS],
      deletedOptions: [
        { id: 'tag_legacy', name: 'Legacy', color: '#6d28d9', deletedAt: '2026-08-01T00:00:00Z' },
      ],
    },
  },
  {
    ...FIELD_BASE,
    id: 'field_files',
    name: 'Files',
    position: 9,
    type: 'attachment',
    config: { maxCount: 5 },
  },
];

const STAMP = '2026-08-14T00:00:00Z';

function record(
  id: string,
  values: LoomTableRecord['values'],
  deletedAt?: string,
): LoomTableRecord {
  return {
    id,
    tableId: 'table_01',
    revision: 1,
    values,
    createdAt: STAMP,
    updatedAt: STAMP,
    ...(deletedAt === undefined ? {} : { deletedAt }),
  };
}

const VALID_VALUES: LoomTableRecord['values'] = {
  field_title: 'Valid record',
  field_notes: 'A short note.',
  field_count: 42,
  field_done: true,
  field_due: '2026-09-01',
  field_link: 'https://example.com/project',
  field_place: {
    label: 'Shanghai office',
    address: 'Century Avenue 100',
    lat: 31.23,
    lng: 121.47,
    precision: 'rooftop',
  },
  field_status: 'opt_doing',
  field_tags: ['tag_alpha', 'tag_beta'],
  field_files: [
    {
      id: 'att_01',
      source: 'managed',
      filename: 'brief.pdf',
      mimeType: 'application/pdf',
      status: 'ready',
      revision: 1,
      createdAt: STAMP,
      updatedAt: STAMP,
    },
  ],
};

export const GALLERY_RECORDS: readonly LoomTableRecord[] = [
  record('record_unset', {}),
  record('record_null', {
    field_title: null,
    field_notes: null,
    field_count: null,
    field_done: null,
    field_due: null,
    field_link: null,
    field_place: null,
    field_status: null,
    field_tags: null,
    field_files: null,
  }),
  record('record_empty', {
    field_title: '',
    field_notes: '',
    field_count: null,
    field_done: false,
    field_due: '',
    field_link: '',
    field_place: {},
    field_status: '',
    field_tags: [],
    field_files: [],
  }),
  record('record_valid', VALID_VALUES),
  record('record_invalid', {
    field_title: 12345,
    field_notes: { unexpected: true },
    field_count: 'not-a-number',
    field_done: 'yes',
    field_due: '2026-13-40',
    field_link: 'javascript:alert(1)',
    field_place: 'not-a-location',
    field_status: 'opt_missing',
    field_tags: ['tag_alpha', 'tag_unknown', 7],
    field_files: [{ filename: 'broken' }],
  }),
  record('record_long', {
    field_title:
      'A very long project title that keeps going and going to exercise the cell truncation and ' +
      'wrapping behaviour of every field renderer in a narrow column layout',
    field_notes:
      'Line one of a long note.\nLine two keeps it going.\nLine three finishes the thought with ' +
      'enough characters to force the renderer to clamp or wrap the value.',
    field_count: 987654321.12345,
    field_link:
      'https://example.com/a/very/long/path/with/many/segments/and-a-long-query-string?param=value',
    field_status: 'opt_doing',
    field_files: [
      {
        id: 'att_02',
        source: 'vault',
        filename:
          'a-very-long-attachment-filename-that-should-truncate-instead-of-breaking-layout.pdf',
        mimeType: 'application/pdf',
        vaultPath: 'attachments/a-very-long-attachment-filename.pdf',
        status: 'ready',
        revision: 1,
        createdAt: STAMP,
        updatedAt: STAMP,
      },
    ],
  }),
  record('record_multi', {
    field_title: 'Overflow record',
    field_tags: [...TAG_OPTIONS.map((option) => option.id), 'tag_legacy', 'tag_orphan'],
    field_status: 'opt_archived',
  }),
  record('record_01', { field_title: 'Alpha project', field_count: 1, field_status: 'opt_todo' }),
  record('record_02', {
    field_title: 'Beta project',
    field_count: 2,
    field_status: 'opt_doing',
    field_place: { label: 'Beijing', lat: 39.9, lng: 116.4 },
  }),
  record('record_03', {
    field_title: 'Gamma project',
    field_count: 3,
    field_status: 'opt_done',
    field_place: { label: 'Shenzhen', lat: 22.54, lng: 114.06 },
  }),
];

export const GALLERY_DELETED_RECORDS: readonly LoomTableRecord[] = [
  record('record_del_01', { field_title: 'Removed draft' }, '2026-08-20T00:00:00Z'),
  record('record_del_02', { field_title: 'Old duplicate' }, '2026-08-21T00:00:00Z'),
];

export function galleryGridConfig(): GridViewConfig {
  return {
    projection: GALLERY_FIELDS.map((field) => field.id),
    columnOrder: GALLERY_FIELDS.map((field) => field.id),
    columnWidths: { field_title: 200 },
    frozenFieldIds: ['field_title'],
    rowHeight: 'standard',
    sort: [{ fieldId: 'field_title', direction: 'asc', nulls: 'last' }],
  };
}

export function galleryMapConfig(): MapViewConfig {
  return {
    locationFieldId: 'field_place',
    center: { lat: 31.23, lng: 121.47 },
    zoom: 9,
  };
}

const VIEW_BASE = {
  tableId: 'table_01',
  revision: 1,
  createdAt: STAMP,
  updatedAt: STAMP,
};

export const GALLERY_GRID_VIEW: Extract<View, { type: 'grid' }> = {
  ...VIEW_BASE,
  id: 'view_grid',
  name: 'All projects',
  type: 'grid',
  config: galleryGridConfig(),
};

export const GALLERY_MAP_VIEW: Extract<View, { type: 'map' }> = {
  ...VIEW_BASE,
  id: 'view_map',
  name: 'Map',
  type: 'map',
  config: galleryMapConfig(),
};

export const GALLERY_VIEWS: readonly View[] = [
  GALLERY_GRID_VIEW,
  GALLERY_MAP_VIEW,
  { ...VIEW_BASE, id: 'view_daily_a', name: 'Daily', type: 'grid', config: galleryGridConfig() },
  { ...VIEW_BASE, id: 'view_daily_b', name: 'Daily', type: 'grid', config: galleryGridConfig() },
];

export const GALLERY_DELETED_VIEW: Extract<View, { type: 'grid' }> = {
  ...VIEW_BASE,
  id: 'view_deleted',
  name: 'Retired view',
  type: 'grid',
  config: galleryGridConfig(),
  revision: 2,
  deletedAt: '2026-08-22T00:00:00Z',
};

export function galleryData(): InMemoryGridData {
  return {
    workspaces: [GALLERY_WORKSPACE],
    bases: [GALLERY_BASE],
    tables: [GALLERY_TABLE],
    fields: GALLERY_FIELDS,
    views: [...GALLERY_VIEWS, GALLERY_DELETED_VIEW],
    records: [...GALLERY_RECORDS, ...GALLERY_DELETED_RECORDS],
  };
}

export function createGalleryState(update: Partial<GridState> = {}): GridState {
  return {
    status: 'ready',
    phase: 'idle',
    workspaces: [GALLERY_WORKSPACE],
    bases: [GALLERY_BASE],
    tables: [GALLERY_TABLE],
    views: [...GALLERY_VIEWS],
    fields: GALLERY_FIELDS,
    selectedWorkspaceId: 'workspace_01',
    selectedBaseId: 'base_01',
    selectedTableId: 'table_01',
    selectedViewId: 'view_grid',
    records: GALLERY_RECORDS,
    hasMore: false,
    nextCursor: null,
    changeCursor: 'change_01',
    totalCount: GALLERY_RECORDS.length,
    unfilteredTotal: GALLERY_RECORDS.length,
    search: '',
    emptyReason: null,
    error: null,
    editStatuses: {},
    conflicts: [],
    editError: null,
    editDrafts: [],
    editErrorRecordId: null,
    saveStatus: 'saved',
    pendingViewIntents: [],
    deletedViews: [],
    deletedViewsStatus: 'idle',
    deletedViewsError: null,
    viewWritePending: [],
    viewWriteIssues: {},
    recordCreateOps: [],
    deletedRecords: [],
    deletedRecordsStatus: 'idle',
    deletedRecordsNextCursor: null,
    deletedRecordsHasMore: false,
    deletedRecordsError: null,
    lastDeletedRecord: null,
    serverHistory: [],
    serverHistoryStatus: 'idle',
    serverHistoryNextCursor: null,
    serverHistoryHasMore: false,
    serverHistoryError: null,
    historyEntries: [],
    fieldAggregations: {},
    aggregateResults: null,
    aggregateStatus: 'idle',
    ...update,
  };
}
