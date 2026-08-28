import { describe, expect, it, vi } from 'vitest';

import type { LoomTableRecord } from '../../src/client/loomtable-client';
import { createTranslator } from '../../src/i18n';
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
    expect(container.querySelector('.loom-map-shell')?.getAttribute('role')).toBe('region');
    expect(container.querySelector('.loom-map-container')?.getAttribute('role')).toBe('region');
    expect(container.querySelector('.loom-map-status')?.getAttribute('aria-live')).toBe('polite');
    expect(container.querySelector('.loom-map-tile-status')?.getAttribute('aria-live')).toBe(
      'polite',
    );
    expect(container.querySelectorAll('select')).toHaveLength(4);
    expect(controller.mount).toHaveBeenCalledTimes(1);
    expect(controller.load).toHaveBeenCalledTimes(1);

    view.destroy();
    expect(controller.dispose).toHaveBeenCalledTimes(1);
    expect(container.childElementCount).toBe(0);
  });

  it('disables Map server actions in offline state', () => {
    const container = document.createElement('div');
    const controller = fakeController();
    const view = new MapView(container, controller as unknown as MapViewController);
    view.mount();

    view.renderState({
      ...initialMapViewState(createMapView()),
      dataStatus: 'offline',
      saveStatus: 'offline-readonly',
    });

    const buttons = [...container.querySelectorAll('button')];
    expect(buttons.find((button) => button.textContent === 'Refresh')?.disabled).toBe(true);
    expect(buttons.find((button) => button.textContent === 'Fit all')?.disabled).toBe(true);
    expect(buttons.find((button) => button.textContent === 'Save current camera')?.disabled).toBe(
      true,
    );
    expect(container.querySelector('.loom-save-status')?.textContent).toContain('Offline');
  });

  it('uses the active Chinese translator for Map chrome and status text', () => {
    const container = document.createElement('div');
    const controller = fakeController();
    const osm = { kind: 'built-in' as const, id: 'osm-standard' as const };
    const view = new MapView(container, controller as unknown as MapViewController, {
      translate: createTranslator('zh-CN'),
      providers: [
        {
          ref: osm,
          displayName: 'OpenStreetMap Standard',
          credentialRequired: false,
        },
      ],
      selectedProvider: osm,
    });

    view.mount();
    view.renderState({
      ...initialMapViewState(createMapView()),
      dataStatus: 'ready',
      tileStatus: 'ready',
      summary: {
        matchedRecordCount: 3,
        renderableRecordCount: 1,
        unlocatedRecordCount: 2,
        unrenderableRecordCount: 0,
      },
    });

    expect([...container.querySelectorAll('button')].map((button) => button.textContent)).toEqual([
      '刷新',
      '适合全部',
      '保存当前视角',
    ]);
    expect(
      container.querySelector<HTMLSelectElement>('select[aria-label="地图瓦片提供方"]'),
    ).not.toBeNull();
    expect(container.querySelector('.loom-map-tile-status')?.textContent).toBe('地图瓦片已就绪。');
    expect(container.querySelector('.loom-map-status')?.textContent).toBe(
      '3 匹配 · 1 可渲染 · 2 未定位 · 0 不可渲染',
    );
    expect(container.querySelector('.loom-map-shell')?.getAttribute('aria-label')).toBe('地图');
    expect(container.querySelector('option')?.textContent).toBe('OpenStreetMap Standard');
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

    expect(container.querySelector('.loom-map-tile-status')?.textContent).toContain(
      'Tile provider error',
    );
    expect(container.querySelector('.loom-map-tile-status .loom-diagnostic')).not.toBeNull();
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
