import { describe, expect, it, vi } from 'vitest';

import type { Field, LoomTableRecord } from '../../src/client/loomtable-client';
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
    expect(container.querySelector('.loom-map-status button')).toBeNull();
  });

  it('guards each Map toolbar action while its promise is pending and restores it after reject', async () => {
    const container = document.createElement('div');
    const controller = fakeController();
    const refresh = deferred<void>();
    const fitAll = deferred<void>();
    const saveCamera = deferred<void>();
    controller.refreshCurrentViewport.mockReturnValue(refresh.promise);
    controller.fitAll.mockReturnValue(fitAll.promise);
    controller.saveDefaultCamera.mockReturnValue(saveCamera.promise);
    const view = new MapView(container, controller as unknown as MapViewController, {
      translate: createTranslator('en'),
    });

    view.mount();
    const refreshButton = buttonByText(container, 'Refresh');
    const fitAllButton = buttonByText(container, 'Fit all');
    const saveCameraButton = buttonByText(container, 'Save current camera');
    refreshButton.click();
    refreshButton.click();
    fitAllButton.click();
    fitAllButton.click();
    saveCameraButton.click();
    saveCameraButton.click();

    await vi.waitFor(() => {
      expect(controller.refreshCurrentViewport).toHaveBeenCalledTimes(1);
      expect(controller.fitAll).toHaveBeenCalledTimes(1);
      expect(controller.saveDefaultCamera).toHaveBeenCalledTimes(1);
    });
    expect(refreshButton.disabled).toBe(true);
    expect(refreshButton.getAttribute('aria-busy')).toBe('true');
    expect(refreshButton.getAttribute('aria-label')).toBe('Refreshing…');
    expect(refreshButton.textContent).toBe('Refreshing…');
    expect(fitAllButton.disabled).toBe(true);
    expect(fitAllButton.getAttribute('aria-busy')).toBe('true');
    expect(fitAllButton.textContent).toBe('Fitting all…');
    expect(saveCameraButton.disabled).toBe(true);
    expect(saveCameraButton.getAttribute('aria-busy')).toBe('true');
    expect(saveCameraButton.textContent).toBe('Saving camera…');

    refresh.reject(new Error('refresh failed'));
    fitAll.resolve();
    saveCamera.resolve();
    await vi.waitFor(() => {
      expect(refreshButton.disabled).toBe(false);
      expect(refreshButton.getAttribute('aria-busy')).toBeNull();
      expect(refreshButton.textContent).toBe('Refresh');
      expect(fitAllButton.disabled).toBe(false);
      expect(saveCameraButton.disabled).toBe(false);
    });
  });

  it('does not update a destroyed Map view when an action resolves late', async () => {
    const container = document.createElement('div');
    const controller = fakeController();
    const refresh = deferred<void>();
    controller.refreshCurrentViewport.mockReturnValue(refresh.promise);
    const view = new MapView(container, controller as unknown as MapViewController);

    view.mount();
    buttonByText(container, 'Refresh').click();
    await vi.waitFor(() => expect(controller.refreshCurrentViewport).toHaveBeenCalledTimes(1));
    view.destroy();

    refresh.resolve();
    await expect(Promise.resolve()).resolves.toBeUndefined();
    expect(container.childElementCount).toBe(0);
  });

  it('offers translated settings or retry actions for Map data errors', async () => {
    const settingsContainer = document.createElement('div');
    const settingsController = fakeController();
    const onOpenSettings = vi.fn();
    const settingsView = new MapView(
      settingsContainer,
      settingsController as unknown as MapViewController,
      { translate: createTranslator('zh-CN'), onOpenSettings },
    );
    settingsView.mount();
    settingsView.renderState({
      ...initialMapViewState(createMapView()),
      dataStatus: 'authentication',
      error: { message: 'secret transport detail', code: 'AUTHENTICATION_REQUIRED' },
    });
    const settingsAction =
      settingsContainer.querySelector<HTMLButtonElement>('.loom-map-status button');
    expect(settingsAction?.textContent).toBe('打开设置');
    expect(settingsAction?.getAttribute('aria-label')).toBe('打开设置');
    expect(settingsContainer.querySelector('.loom-map-status')?.textContent).not.toContain(
      'secret transport detail',
    );
    expect(settingsContainer.querySelector('.loom-map-status .loom-diagnostic')).not.toBeNull();
    settingsAction?.click();
    settingsAction?.click();
    await vi.waitFor(() => expect(onOpenSettings).toHaveBeenCalledTimes(1));
    settingsView.renderState({
      ...initialMapViewState(createMapView()),
      dataStatus: 'forbidden',
      error: { message: 'forbidden transport detail', code: 'FORBIDDEN' },
    });
    const forbiddenAction =
      settingsContainer.querySelector<HTMLButtonElement>('.loom-map-status button');
    expect(forbiddenAction?.textContent).toBe('打开设置');
    forbiddenAction?.click();
    await vi.waitFor(() => expect(onOpenSettings).toHaveBeenCalledTimes(2));

    const retryContainer = document.createElement('div');
    const retryController = fakeController();
    const retry = deferred<void>();
    retryController.refreshCurrentViewport.mockReturnValue(retry.promise);
    const retryView = new MapView(retryContainer, retryController as unknown as MapViewController, {
      translate: createTranslator('zh-CN'),
    });
    retryView.mount();
    retryView.renderState({
      ...initialMapViewState(createMapView()),
      dataStatus: 'network',
      error: { message: 'network transport detail', code: 'NETWORK_ERROR' },
    });
    const retryAction = retryContainer.querySelector<HTMLButtonElement>('.loom-map-status button');
    expect(retryAction?.textContent).toBe('重试');
    expect(retryAction?.getAttribute('aria-label')).toBe('重试');
    retryAction?.click();
    retryAction?.click();
    await vi.waitFor(() => expect(retryController.refreshCurrentViewport).toHaveBeenCalledTimes(1));
    expect(retryAction?.disabled).toBe(true);
    expect(retryAction?.getAttribute('aria-busy')).toBe('true');
    expect(retryAction?.textContent).toBe('正在刷新…');
    retry.resolve();
    await vi.waitFor(() => expect(retryAction?.textContent).toBe('重试'));
    retryView.renderState({
      ...initialMapViewState(createMapView()),
      dataStatus: 'server-error',
      error: { message: 'server transport detail', code: 'SERVER_ERROR' },
    });
    const serverRetryAction =
      retryContainer.querySelector<HTMLButtonElement>('.loom-map-status button');
    const serverRetry = deferred<void>();
    retryController.refreshCurrentViewport.mockReturnValue(serverRetry.promise);
    serverRetryAction?.click();
    serverRetryAction?.click();
    await vi.waitFor(() => expect(retryController.refreshCurrentViewport).toHaveBeenCalledTimes(2));
    expect(serverRetryAction?.getAttribute('aria-busy')).toBe('true');
    serverRetry.resolve();
    await vi.waitFor(() => expect(serverRetryAction?.textContent).toBe('重试'));
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
      'Tile loading failed. Retry or choose another provider.',
    );
    expect(container.querySelector('.loom-map-tile-status .loom-diagnostic')).not.toBeNull();
    expect(container.querySelector('.loom-map-record-detail')?.textContent).toContain('record_01');
    expect(container.querySelector('.loom-map-record-detail')?.textContent).toContain('A record');
  });

  it('passes selected-record Attachment downloads through the Detail callback', async () => {
    const container = document.createElement('div');
    const controller = fakeController();
    const attachmentField: Field = {
      id: 'field_attachment',
      tableId: 'table_01',
      name: 'Attachments',
      position: 0,
      schemaVersion: 1,
      revision: 1,
      type: 'attachment',
      config: { maxCount: 10 },
    };
    const record: LoomTableRecord = {
      id: 'record_map',
      tableId: 'table_01',
      revision: 1,
      values: {
        field_attachment: [{ id: 'attachment_1', source: 'vault', filename: 'notes.md' }],
      },
      createdAt: '',
      updatedAt: '',
    };
    const onAttachmentDownload = vi.fn();
    const view = new MapView(container, controller as unknown as MapViewController, {
      translate: createTranslator('en'),
      onAttachmentDownload,
    });

    view.mount();
    view.renderState({
      ...initialMapViewState(createMapView()),
      dataStatus: 'ready',
      fields: [attachmentField],
      selectedRecord: record,
    });

    const download = container.querySelector<HTMLButtonElement>('.loom-attachment-action');
    download?.click();
    await vi.waitFor(() => expect(onAttachmentDownload).toHaveBeenCalledTimes(1));
    expect(onAttachmentDownload).toHaveBeenCalledWith(
      'record_map',
      'field_attachment',
      expect.objectContaining({ id: 'attachment_1', filename: 'notes.md' }),
    );
  });

  it.each([
    [
      'configuration-required',
      '需要配置地图瓦片提供方；请添加所需凭据或选择其他提供方。',
      '打开设置',
    ],
    ['invalid-profile', '地图瓦片提供方配置档无效；请检查名称、缩放范围和署名信息。', '打开设置'],
    [
      'invalid-template',
      '地图瓦片 URL 模板无效；请包含 {z}、{x}、{y}，并仅使用支持的占位符。',
      '打开设置',
    ],
    [
      'invalid-origin',
      '地图瓦片提供方地址无效；非本机地址必须使用 HTTPS，HTTP 仅允许用于 localhost。',
      '打开设置',
    ],
    ['unsupported-crs', '地图瓦片提供方使用了不支持的坐标系；请使用 EPSG:3857。', '打开设置'],
    ['tile-error', '地图瓦片加载失败；请重试或选择其他提供方。', '重试地图瓦片'],
  ] as const)(
    'routes tile error kind %s to translated copy and action',
    async (kind, text, actionText) => {
      const container = document.createElement('div');
      const controller = fakeController();
      const onOpenSettings = vi.fn();
      const onTileRetry = vi.fn();
      const view = new MapView(container, controller as unknown as MapViewController, {
        translate: createTranslator('zh-CN'),
        onOpenSettings,
        onTileRetry,
      });

      view.mount();
      view.renderState({
        ...initialMapViewState(createMapView()),
        dataStatus: 'ready',
        tileStatus: kind === 'tile-error' ? 'error' : 'configuration-required',
        tileError: {
          kind,
          providerId: 'custom-provider',
          message: 'diagnostic detail',
        },
      });

      expect(container.querySelector('.loom-map-tile-status')?.textContent).toContain(text);
      const action = [
        ...container.querySelectorAll<HTMLButtonElement>('.loom-map-tile-status button'),
      ].find((button) => button.textContent === actionText);
      expect(action).not.toBeUndefined();
      action?.click();
      if (kind === 'tile-error') {
        await vi.waitFor(() => expect(onTileRetry).toHaveBeenCalledTimes(1));
      } else {
        await vi.waitFor(() => expect(onOpenSettings).toHaveBeenCalledTimes(1));
      }
      expect(container.querySelector('.loom-map-tile-status')?.textContent).not.toContain(
        'diagnostic detail',
      );
    },
  );

  it('renders Cluster Records as an accessible list instead of raw JSON', () => {
    const container = document.createElement('div');
    const controller = fakeController();
    const record: LoomTableRecord = {
      id: 'record_01',
      tableId: 'table_01',
      revision: 1,
      values: { name: 'Shanghai Office' },
      createdAt: '',
      updatedAt: '',
    };
    const view = new MapView(container, controller as unknown as MapViewController, {
      translate: createTranslator('en'),
      onClusterNextPage: vi.fn(),
      onClusterRetry: vi.fn(),
    });

    view.mount();
    view.renderState({
      ...initialMapViewState(createMapView()),
      clusterStatus: 'ready',
      clusterRecords: [record],
      clusterToken: 'cluster-token',
      clusterCursor: 'next-cursor',
    } as unknown as ReturnType<typeof initialMapViewState>);

    const cluster = container.querySelector<HTMLElement>('.loom-map-cluster-records');
    expect(cluster).not.toBeNull();
    expect(cluster?.querySelector('pre')).toBeNull();
    expect(cluster?.querySelector('[role="list"]')).not.toBeNull();
    expect(cluster?.querySelector('[role="listitem"]')?.textContent).toContain('record_01');
    expect(cluster?.textContent).toContain('Shanghai Office');
    expect(cluster?.textContent).not.toContain('"values"');
    expect(cluster?.querySelector<HTMLButtonElement>('.loom-map-cluster-close')).not.toBeNull();
    expect(cluster?.querySelector<HTMLButtonElement>('.loom-map-cluster-next')).not.toBeNull();
  });

  it('renders MultiSelect Cluster values as shared semantic chips', () => {
    const container = document.createElement('div');
    const controller = fakeController();
    const field: Field = {
      id: 'field_multi',
      tableId: 'table_01',
      name: 'Tags',
      position: 0,
      schemaVersion: 1,
      revision: 1,
      type: 'multiSelect',
      config: {
        options: [{ id: 'option_1', name: 'One', color: '#000000' }],
        deletedOptions: [
          { id: 'option_old', name: 'Old', color: '#000000', deletedAt: '2026-01-01' },
        ],
      },
    };
    const record: LoomTableRecord = {
      id: 'record_01',
      tableId: 'table_01',
      revision: 1,
      values: { field_multi: ['option_old', 'option_1'] },
      createdAt: '',
      updatedAt: '',
    };
    const view = new MapView(container, controller as unknown as MapViewController, {
      translate: createTranslator('en'),
    });

    view.mount();
    view.renderState({
      ...initialMapViewState(createMapView()),
      clusterStatus: 'ready',
      fields: [field],
      clusterRecords: [record],
      clusterToken: 'cluster-token',
      clusterCursor: null,
    } as unknown as ReturnType<typeof initialMapViewState>);

    const cluster = container.querySelector<HTMLElement>('.loom-map-cluster-records');
    const button = cluster?.querySelector<HTMLButtonElement>('.loom-map-cluster-record');
    expect(button?.querySelector('.loom-field-value-chips')).not.toBeNull();
    expect(
      [...(button?.querySelectorAll<HTMLElement>('[role="listitem"]') ?? [])].map(
        (chip) => chip.textContent,
      ),
    ).toEqual(['Old (Deleted option)', 'One']);
    expect(button?.textContent).not.toContain('option_old');
  });

  it('exposes Cluster loading, empty, error, retry, and close states', async () => {
    const container = document.createElement('div');
    const controller = fakeController();
    const onClusterRetry = vi.fn();
    const view = new MapView(container, controller as unknown as MapViewController, {
      translate: createTranslator('zh-CN'),
      onClusterRetry,
    });
    view.mount();

    view.renderState({
      ...initialMapViewState(createMapView()),
      clusterStatus: 'loading',
      clusterToken: 'cluster-token',
      clusterCursor: null,
    } as unknown as ReturnType<typeof initialMapViewState>);
    expect(container.querySelector('.loom-map-cluster-status')?.textContent).toBe(
      '正在加载聚合记录…',
    );

    view.renderState({
      ...initialMapViewState(createMapView()),
      clusterStatus: 'empty',
      clusterToken: 'cluster-token',
      clusterCursor: null,
    } as unknown as ReturnType<typeof initialMapViewState>);
    expect(container.querySelector('.loom-map-cluster-status')?.textContent).toBe(
      '此聚合中没有记录。',
    );

    view.renderState({
      ...initialMapViewState(createMapView()),
      clusterStatus: 'error',
      clusterError: { message: 'cluster diagnostic', code: 'NETWORK_ERROR' },
      clusterToken: 'cluster-token',
      clusterCursor: null,
    } as unknown as ReturnType<typeof initialMapViewState>);
    expect(container.querySelector('.loom-map-cluster-status')?.textContent).toContain(
      '无法加载聚合记录；请重试。',
    );
    expect(container.querySelector('.loom-map-cluster-status')?.textContent).not.toContain(
      'cluster diagnostic',
    );
    container.querySelector<HTMLButtonElement>('.loom-map-cluster-retry')?.click();
    await vi.waitFor(() => expect(onClusterRetry).toHaveBeenCalledTimes(1));

    container.querySelector<HTMLButtonElement>('.loom-map-cluster-close')?.click();
    expect(controller.closeCluster).toHaveBeenCalledTimes(1);
  });

  it('preserves a dirty Location draft when the Map redraws the same Record', () => {
    const container = document.createElement('div');
    const controller = fakeController();
    const locationField = createLocationField();
    const record: LoomTableRecord = {
      id: 'record_01',
      tableId: 'table_01',
      revision: 1,
      values: { field_location: { label: 'Server label', lat: 1, lng: 2 } },
      createdAt: '',
      updatedAt: '',
    };
    const view = new MapView(container, controller as unknown as MapViewController, {
      translate: createTranslator('en'),
      onLocationEdit: vi.fn(),
    });

    view.mount();
    view.renderState({
      ...initialMapViewState(createMapView()),
      dataStatus: 'ready',
      fields: [locationField],
      selectedRecord: record,
    });
    container.querySelector<HTMLButtonElement>('.loom-location-edit')?.click();
    const label = container.querySelector<HTMLInputElement>(
      '.loom-location-editor input[aria-label="Label"]',
    );
    expect(label).not.toBeNull();
    if (label === null) return;
    label.value = 'Unsaved draft';
    label.dispatchEvent(new Event('input', { bubbles: true }));

    view.renderState({
      ...initialMapViewState(createMapView()),
      dataStatus: 'loading',
      fields: [locationField],
      selectedRecord: record,
    });

    const redrawnLabel = container.querySelector<HTMLInputElement>(
      '.loom-location-editor input[aria-label="Label"]',
    );
    expect(redrawnLabel).not.toBeNull();
    expect(redrawnLabel?.value).toBe('Unsaved draft');
    expect(container.querySelector('.loom-location-editor')?.getAttribute('data-dirty')).toBe(
      'true',
    );
  });

  it('keeps a dirty Location draft when changing Records is declined', () => {
    const container = document.createElement('div');
    const controller = fakeController();
    const confirmDiscard = vi.fn().mockReturnValue(false);
    const locationField = createLocationField();
    const record = createLocationRecord('record_01', 'Server label');
    const nextRecord = createLocationRecord('record_02', 'Next label');
    const view = new MapView(container, controller as unknown as MapViewController, {
      translate: createTranslator('en'),
      confirmDiscard,
      onLocationEdit: vi.fn(),
    });

    view.mount();
    view.renderState({
      ...initialMapViewState(createMapView()),
      dataStatus: 'ready',
      fields: [locationField],
      selectedRecord: record,
    });
    container.querySelector<HTMLButtonElement>('.loom-location-edit')?.click();
    const label = container.querySelector<HTMLInputElement>(
      '.loom-location-editor input[aria-label="Label"]',
    );
    expect(label).not.toBeNull();
    if (label === null) return;
    label.value = 'Unsaved draft';
    label.dispatchEvent(new Event('input', { bubbles: true }));

    expect(view.confirmDiscardIfNeeded()).toBe(false);
    expect(confirmDiscard).toHaveBeenCalledWith('Discard unsaved Location changes?');
    view.renderState({
      ...initialMapViewState(createMapView()),
      dataStatus: 'ready',
      fields: [locationField],
      selectedRecord: nextRecord,
    });

    expect(container.querySelector('.loom-location-editor')).not.toBeNull();
    expect(
      container.querySelector<HTMLInputElement>('.loom-location-editor input[aria-label="Label"]')
        ?.value,
    ).toBe('Unsaved draft');
  });

  it('keeps the authoritative Record returned by a Location edit callback', async () => {
    const container = document.createElement('div');
    const controller = fakeController();
    const locationField = createLocationField();
    const record = createLocationRecord('record_01', 'Old label');
    const updatedRecord = {
      ...record,
      revision: 2,
      values: { field_location: { label: 'Saved label', lat: 1, lng: 2 } },
    };
    const onLocationEdit = vi.fn().mockResolvedValue(updatedRecord);
    const view = new MapView(container, controller as unknown as MapViewController, {
      translate: createTranslator('en'),
      onLocationEdit,
    });

    view.mount();
    view.renderState({
      ...initialMapViewState(createMapView()),
      dataStatus: 'ready',
      fields: [locationField],
      selectedRecord: record,
    });
    container.querySelector<HTMLButtonElement>('.loom-location-edit')?.click();
    const form = container.querySelector<HTMLFormElement>('.loom-location-editor');
    expect(form).not.toBeNull();
    if (form === null) return;
    form.querySelector<HTMLInputElement>('input[aria-label="Label"]')!.value = 'Draft label';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    await vi.waitFor(() => expect(onLocationEdit).toHaveBeenCalledTimes(1));
    await vi.waitFor(() =>
      expect(container.querySelector('.loom-map-record-detail')?.textContent).toContain(
        'Saved label',
      ),
    );
    expect(controller.openRecord).toHaveBeenCalledWith('record_01');
  });

  it('does not present Saved when Map camera saving failed', () => {
    const container = document.createElement('div');
    const controller = fakeController();
    const view = new MapView(container, controller as unknown as MapViewController, {
      translate: createTranslator('en'),
    });

    view.mount();
    view.renderState({
      ...initialMapViewState(createMapView()),
      saveStatus: 'error',
    });

    expect(container.querySelector('.loom-save-status')?.textContent).toBe('Save failed');
    expect(container.querySelector('.loom-save-status')?.textContent).not.toBe('Saved');
  });

  it('uses the shared field renderer for structured Cluster previews', () => {
    const container = document.createElement('div');
    const controller = fakeController();
    const attachmentField: Field = {
      id: 'field_attachment',
      tableId: 'table_01',
      name: 'Attachment',
      position: 0,
      schemaVersion: 1,
      revision: 1,
      type: 'attachment',
      config: { maxCount: 10 },
    };
    const record: LoomTableRecord = {
      id: 'record_01',
      tableId: 'table_01',
      revision: 1,
      values: {
        field_attachment: [
          {
            id: 'attachment_1',
            source: 'vault',
            filename: 'notes.md',
            mimeType: 'text/markdown',
            size: 2048,
          },
        ],
      },
      createdAt: '',
      updatedAt: '',
    };
    const view = new MapView(container, controller as unknown as MapViewController, {
      translate: createTranslator('en'),
    });

    view.mount();
    view.renderState({
      ...initialMapViewState(createMapView()),
      clusterStatus: 'ready',
      fields: [attachmentField],
      clusterRecords: [record],
      clusterToken: 'cluster-token',
      clusterCursor: null,
    } as unknown as ReturnType<typeof initialMapViewState>);

    const cluster = container.querySelector<HTMLElement>('.loom-map-cluster-records');
    expect(cluster?.textContent).toContain(
      'notes.md · Source: Vault · Type: text/markdown · Size: 2 KB · Ready',
    );
    expect(cluster?.textContent).not.toContain('attachment_1');
    expect(cluster?.textContent).not.toContain('"filename"');
    expect(cluster?.querySelector('.loom-attachment-list')).toBeNull();
    expect(cluster?.querySelector('.loom-attachment-action')).toBeNull();
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
  closeCluster: ReturnType<typeof vi.fn>;
  openRecord: ReturnType<typeof vi.fn>;
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
    closeCluster: vi.fn(),
    openRecord: vi.fn(),
    dispose: vi.fn(),
  };
  return controller;
}

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
  const button = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (candidate) => candidate.textContent === text,
  );
  if (button === undefined) throw new Error(`Missing button: ${text}`);
  return button;
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
  readonly reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
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

function createLocationField(): Field {
  return {
    id: 'field_location',
    tableId: 'table_01',
    name: 'Location',
    position: 0,
    schemaVersion: 1,
    revision: 1,
    type: 'location',
    config: {},
  };
}

function createLocationRecord(id: string, label: string): LoomTableRecord {
  return {
    id,
    tableId: 'table_01',
    revision: 1,
    values: { field_location: { label, lat: 1, lng: 2 } },
    createdAt: '',
    updatedAt: '',
  };
}
