import { describe, expect, it, vi } from 'vitest';

import type { LoomTableRecord } from '../../src/client/loomtable-client';
import type { MapViewController } from '../../src/views/map/map-view-controller';
import { initialMapViewState } from '../../src/views/map/map-view-model';
import { MapView } from '../../src/views/map/map-view';

describe('MapView', () => {
  it('mounts the navigation, map container and controller lifecycle seam', () => {
    const container = document.createElement('div');
    const controller = fakeController();
    const view = new MapView(container, controller as unknown as MapViewController, {
      navigation: {
        workspaces: [
          { id: 'workspace_01', name: 'Workspace', revision: 1, createdAt: '', updatedAt: '' },
        ],
        bases: [],
        tables: [],
        views: [],
        selectedWorkspaceId: 'workspace_01',
        selectedBaseId: null,
        selectedTableId: null,
        selectedViewId: null,
        onWorkspaceChange: vi.fn(),
        onBaseChange: vi.fn(),
        onTableChange: vi.fn(),
        onViewChange: vi.fn(),
      },
    });

    view.mount();

    expect(container.querySelector('.loom-map-navigation')).not.toBeNull();
    expect(container.querySelector('.loom-map-container')).not.toBeNull();
    expect(container.querySelectorAll('select')).toHaveLength(4);
    expect(controller.mount).toHaveBeenCalledTimes(1);
    expect(controller.load).toHaveBeenCalledTimes(1);

    view.destroy();
    expect(controller.dispose).toHaveBeenCalledTimes(1);
    expect(container.childElementCount).toBe(0);
  });

  it('keeps selected Record details visible independently of tile status', () => {
    const container = document.createElement('div');
    const controller = fakeController();
    const view = new MapView(container, controller as unknown as MapViewController);
    view.mount();
    const record: LoomTableRecord = {
      id: 'record_01',
      tableId: 'table_01',
      revision: 1,
      values: { name: 'A record' },
      createdAt: '',
      updatedAt: '',
    };

    view.renderState({
      ...initialMapViewState(createMapView()),
      dataStatus: 'ready',
      tileStatus: 'error',
      tileError: { kind: 'tile-error', providerId: 'osm-standard', message: 'Tile failed.' },
      selectedRecord: record,
    });

    expect(container.querySelector('.loom-map-tile-status')?.textContent).toContain('Tile failed');
    expect(container.querySelector('.loom-map-record-detail')?.textContent).toContain('record_01');
    expect(container.querySelector('.loom-map-record-detail')?.textContent).toContain('A record');
  });
});

function fakeController(): {
  readonly state: ReturnType<typeof initialMapViewState>;
  readonly subscribe: ReturnType<typeof vi.fn>;
  mount: ReturnType<typeof vi.fn>;
  load: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  refreshCurrentViewport: ReturnType<typeof vi.fn>;
  fitAll: ReturnType<typeof vi.fn>;
  saveDefaultCamera: ReturnType<typeof vi.fn>;
  loadNextClusterPage: ReturnType<typeof vi.fn>;
} {
  const state = initialMapViewState(createMapView());
  const controller = {
    state,
    subscribe: vi.fn((listener: (value: typeof state) => void) => {
      listener(state);
      return () => undefined;
    }),
    mount: vi.fn(),
    load: vi.fn(),
    refreshCurrentViewport: vi.fn(),
    fitAll: vi.fn(),
    saveDefaultCamera: vi.fn(),
    loadNextClusterPage: vi.fn(),
    dispose: vi.fn(),
  };
  return controller;
}

function createMapView() {
  return {
    id: 'view_map',
    tableId: 'table_01',
    name: 'Map',
    type: 'map' as const,
    config: { locationFieldId: 'field_location' },
    revision: 1,
    createdAt: '',
    updatedAt: '',
  };
}

