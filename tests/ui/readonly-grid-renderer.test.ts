import { describe, expect, it, vi } from 'vitest';

import type {
  Field,
  GridViewConfig,
  LoomTableRecord,
  View,
} from '../../src/client/loomtable-client';
import { createTranslator } from '../../src/i18n';
import { ReadonlyGridRenderer, getVirtualRowRange } from '../../src/ui/readonly-grid-renderer';
import type { GridState } from '../../src/ui/grid-view-controller';

describe('ReadonlyGridRenderer', () => {
  it('renders only the fixed-height viewport window for a large result page', () => {
    const container = document.createElement('div');
    const callbacks = rendererCallbacks();
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), callbacks);

    renderer.render(createState(1_000));

    expect(container.querySelectorAll('.loom-grid-row')).toHaveLength(14);
    expect(container.querySelectorAll('[aria-readonly="true"]')).not.toHaveLength(0);
    expect(container.querySelector('.loom-grid-viewport')).not.toBeNull();
  });

  it('exposes a keyboard detail entry for a read-only row', () => {
    const container = document.createElement('div');
    const callbacks = rendererCallbacks();
    const renderer = new ReadonlyGridRenderer(container, createTranslator('en'), callbacks);

    renderer.render(createState(1));
    const row = container.querySelector<HTMLElement>('.loom-grid-row');
    row?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(callbacks.onRecordOpen).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'record_01' }),
    );
  });

  it('keeps a visible status when the data source is offline', () => {
    const container = document.createElement('div');
    const renderer = new ReadonlyGridRenderer(
      container,
      createTranslator('en'),
      rendererCallbacks(),
    );
    const state = createState(0, { status: 'offline', error: { message: 'offline' } });

    renderer.render(state);

    expect(container.querySelector('.loom-grid-status')?.textContent).toContain('offline');
  });
});

describe('getVirtualRowRange', () => {
  it('keeps the rendered range bounded and overscanned', () => {
    expect(getVirtualRowRange(20_000, 3_600, 360, 36)).toEqual({ start: 96, end: 114 });
    expect(getVirtualRowRange(4, 0, 360, 36)).toEqual({ start: 0, end: 4 });
  });
});

function rendererCallbacks() {
  return {
    onRefresh: vi.fn(),
    onWorkspaceChange: vi.fn(),
    onBaseChange: vi.fn(),
    onTableChange: vi.fn(),
    onViewChange: vi.fn(),
    onLoadMore: vi.fn(),
    onRecordOpen: vi.fn(),
  };
}

function createState(recordCount: number, update: Partial<GridState> = {}): GridState {
  const config: GridViewConfig = {
    projection: ['field_name'],
    columnOrder: ['field_name'],
    columnWidths: { field_name: 180 },
    frozenFieldIds: [],
    rowHeight: 'standard',
    sort: [],
  };
  const view: Extract<View, { type: 'grid' }> = {
    id: 'view_01',
    tableId: 'table_01',
    name: 'Grid',
    type: 'grid',
    config,
    revision: 1,
    createdAt: '2026-08-14T00:00:00Z',
    updatedAt: '2026-08-14T00:00:00Z',
  };
  const field: Field = {
    id: 'field_name',
    tableId: 'table_01',
    name: 'Name',
    position: 0,
    schemaVersion: 1,
    revision: 1,
    type: 'text',
    config: {},
  };
  const records: readonly LoomTableRecord[] = Array.from({ length: recordCount }, (_, index) => ({
    id: `record_${String(index + 1).padStart(2, '0')}`,
    tableId: 'table_01',
    revision: 1,
    values: { field_name: `Record ${index + 1}` },
    createdAt: '2026-08-14T00:00:00Z',
    updatedAt: '2026-08-14T00:00:00Z',
  }));
  return {
    status: 'ready',
    phase: 'idle',
    workspaces: [
      { id: 'workspace_01', name: 'Personal', revision: 1, createdAt: '', updatedAt: '' },
    ],
    bases: [
      {
        id: 'base_01',
        workspaceId: 'workspace_01',
        name: 'Notes',
        revision: 1,
        createdAt: '',
        updatedAt: '',
      },
    ],
    tables: [
      {
        id: 'table_01',
        baseId: 'base_01',
        name: 'Projects',
        primaryFieldId: 'field_name',
        revision: 1,
        createdAt: '',
        updatedAt: '',
      },
    ],
    views: [view],
    fields: [field],
    selectedWorkspaceId: 'workspace_01',
    selectedBaseId: 'base_01',
    selectedTableId: 'table_01',
    selectedViewId: 'view_01',
    records,
    hasMore: false,
    nextCursor: null,
    changeCursor: 'change_01',
    totalCount: recordCount,
    emptyReason: null,
    error: null,
    ...update,
  };
}
