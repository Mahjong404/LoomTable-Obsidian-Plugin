// Development Gallery scenarios. Every scenario mounts real production
// components (Grid renderer, TableShell, panels, MapView, Detail) backed by
// InMemoryLoomTableClient and typed fakes for host-only capabilities such as
// the map renderer. None of this module ships in the production bundle; the
// Gallery bundle is built separately from src/main.ts.
import type {
  FilterNode,
  LoomTableRecord,
  MapFeature,
  MapViewport,
  MutationRequest,
  MutationResult,
  SortSpec,
} from '../../src/client/loomtable-client';
import { createTranslator, type Translator } from '../../src/i18n';
import { TileProviderRegistry } from '../../src/maps/providers/tile-provider-registry';
import type {
  MapCamera,
  MapRenderer,
  MapRendererEventListener,
} from '../../src/maps/renderer/map-renderer';
import type {
  BuiltInTileProviderId,
  ResolvedTilePlan,
  TileProviderRef,
} from '../../src/maps/providers/tile-provider-schema';
import { confirmDangerousAction } from '../../src/ui/dangerous-action-confirmation';
import { DisplayPanel } from '../../src/ui/display-panel';
import { renderSaveStatus, type ViewSaveStatus } from '../../src/ui/save-status';
import { FilterBuilder } from '../../src/ui/filter-builder';
import { GridViewController, type GridState } from '../../src/ui/grid-view-controller';
import {
  ReadonlyGridRenderer,
  type GridRendererCallbacks,
} from '../../src/ui/readonly-grid-renderer';
import { createRecordCreateForm } from '../../src/ui/record-create-form';
import { createRecordDetail } from '../../src/ui/record-detail';
import { SortPanel } from '../../src/ui/sort-panel';
import { TableShell, type TableShellState } from '../../src/ui/table-shell';
import { MutationQueueRuntime } from '../../src/ui/mutation-queue-runtime';
import { MapView } from '../../src/views/map/map-view';
import { MapViewController } from '../../src/views/map/map-view-controller';
import { InMemoryLoomTableClient } from '../fixtures/in-memory-loomtable-client';
import {
  GALLERY_DELETED_RECORDS,
  GALLERY_DELETED_VIEW,
  GALLERY_FIELDS,
  GALLERY_GRID_VIEW,
  GALLERY_MAP_VIEW,
  GALLERY_RECORDS,
  GALLERY_VIEWS,
  createGalleryState,
  galleryData,
  galleryGridConfig,
  galleryMapConfig,
} from './data';

export interface GalleryMountResult {
  readonly dispose?: () => void;
}

export interface GalleryScenario {
  readonly id: string;
  readonly section: string;
  readonly title: string;
  mount(host: HTMLElement): void | GalleryMountResult | Promise<void | GalleryMountResult>;
}

export const galleryScenarios: readonly GalleryScenario[] = [
  {
    id: 'component-zones',
    section: 'Layout',
    title: 'Navigation & command bar — stable zones (annotated)',
    mount(host) {
      const wrap = block(host, 'loom-gallery-annotated');
      mountStaticShell(wrap);
      return mountStaticGrid(wrap, createGalleryState(), {
        onCellEdit: () => undefined,
        onSearch: () => undefined,
        onApplyFilter: async () => ({ status: 'saved', view: GALLERY_GRID_VIEW }),
        onApplySort: async () => ({ status: 'saved', view: GALLERY_GRID_VIEW }),
        onApplyDisplay: async () => ({ status: 'saved', view: GALLERY_GRID_VIEW }),
        onCreateRecord: async () => GALLERY_RECORDS[0]!,
        onLoadDeletedRecords: () => undefined,
      });
    },
  },
  {
    id: 'component-save-status',
    section: 'Layout',
    title: 'Save status chip — six states at a fixed width',
    mount(host) {
      const translate = createTranslator('en');
      const wrap = block(host, 'loom-gallery-controls');
      const chips = row(wrap, 'Save status');
      const states: readonly ViewSaveStatus[] = [
        'dirty',
        'saving',
        'saved',
        'error',
        'conflict',
        'offline-readonly',
      ];
      for (const status of states) {
        const chip = document.createElement('span');
        chip.className = 'loom-save-status';
        renderSaveStatus(chip, status, translate);
        chips.append(chip);
      }
    },
  },
  {
    id: 'component-detail-panel',
    section: 'Layout',
    title: 'Record detail — right overlay panel instead of a bottom page',
    mount(host) {
      const translate = createTranslator('en');
      const frame = block(host, 'loom-gallery-detail-frame');
      const detailHost = document.createElement('div');
      detailHost.className = 'loom-detail-host';
      frame.append(detailHost);
      const openDetail = (record: LoomTableRecord): void => {
        detailHost.replaceChildren(
          createRecordDetail(record, {
            translate,
            fields: GALLERY_FIELDS,
            primaryFieldId: 'field_title',
            navigation: {
              canNavigate: (recordId, direction) =>
                GALLERY_RECORDS[
                  GALLERY_RECORDS.findIndex((candidate) => candidate.id === recordId) + direction
                ] !== undefined,
              onNavigate: async (recordId, direction) => {
                const index = GALLERY_RECORDS.findIndex((candidate) => candidate.id === recordId);
                const next = GALLERY_RECORDS[index + direction] ?? null;
                if (next !== null) openDetail(next);
                return next;
              },
            },
            callbacks: { onClose: () => detailHost.replaceChildren() },
            confirmDangerousAction: (message, confirmHost, trigger) =>
              confirmDangerousAction(confirmHost, message, translate, trigger),
          }),
        );
      };
      openDetail(GALLERY_RECORDS.find((candidate) => candidate.id === 'record_01')!);
    },
  },
  {
    id: 'controls',
    section: 'Controls',
    title: 'Buttons, inputs, selects and confirmation overlay',
    mount(host) {
      const translate = createTranslator('en');
      const wrap = block(host, 'loom-gallery-controls');

      const buttons = row(wrap, 'Buttons');
      const normal = button('Save', 'loom-button');
      const primary = button('Apply', 'loom-button loom-button-primary');
      const danger = button('Delete view', 'loom-button loom-button-danger');
      const disabled = button('Disabled', 'loom-button');
      disabled.disabled = true;
      const pending = button('Saving…', 'loom-button');
      pending.disabled = true;
      pending.setAttribute('aria-busy', 'true');
      buttons.append(normal, primary, danger, disabled, pending);

      const inputs = row(wrap, 'Inputs');
      const input = document.createElement('input');
      input.className = 'loom-input';
      input.value = 'Editable text';
      input.setAttribute('aria-label', 'Text input');
      const invalid = document.createElement('input');
      invalid.className = 'loom-input';
      invalid.value = '42abc';
      invalid.setAttribute('aria-invalid', 'true');
      invalid.setAttribute('aria-label', 'Invalid input');
      const select = document.createElement('select');
      select.setAttribute('aria-label', 'Select input');
      for (const value of ['First option', 'Second option']) {
        const option = document.createElement('option');
        option.textContent = value;
        select.append(option);
      }
      inputs.append(input, invalid, select);

      const overlays = row(wrap, 'Confirmation overlay');
      const trigger = button('Show destructive confirmation', 'loom-button');
      const status = document.createElement('span');
      status.dataset.role = 'confirm-result';
      trigger.addEventListener('click', () => {
        void confirmDangerousAction(
          wrap,
          'This deletes the Record. The action can be undone from the recycle list.',
          translate,
          trigger,
        ).then((confirmed) => {
          status.textContent = confirmed ? 'Confirmed' : 'Cancelled';
        });
      });
      overlays.append(trigger, status);
    },
  },
  {
    id: 'fields',
    section: 'Fields',
    title: 'All ten field types across unset / null / empty / valid / invalid / long / overflow',
    mount(host) {
      return mountStaticGrid(host, createGalleryState(), { onCellEdit: () => undefined });
    },
  },
  {
    id: 'grid-edit-states',
    section: 'Grid',
    title: 'Cell statuses — draft, queued, saving, error, terminal and conflict',
    mount(host) {
      return mountStaticGrid(
        host,
        createGalleryState({
          editStatuses: {
            record_01: 'queued',
            record_02: 'saving',
            record_03: 'error',
            record_valid: 'terminal',
            record_multi: 'conflict',
          },
          editDrafts: [
            { recordId: 'record_01', fieldId: 'field_title', rawValue: 'Unsaved title' },
          ],
          editError: { message: 'The last save failed.' },
          editErrorRecordId: 'record_03',
          saveStatus: 'error',
          conflicts: [
            {
              clientMutationId: 'mut_90000000000000000000000001',
              failedCommandIndex: 0,
              recordId: 'record_multi',
              expectedRevision: 1,
              currentRevision: 2,
              currentValues: { field_title: 'Server copy' },
              message: 'The Record changed on the Server.',
            },
          ],
        }),
        {
          onCellEdit: () => undefined,
          onRetryEdit: () => undefined,
          onConflictAction: () => undefined,
        },
      );
    },
  },
  {
    id: 'grid-offline',
    section: 'Grid',
    title: 'Offline banner with queued edits',
    mount(host) {
      return mountStaticGrid(
        host,
        createGalleryState({
          status: 'offline',
          editStatuses: { record_01: 'queued' },
          saveStatus: 'error',
        }),
      );
    },
  },
  {
    id: 'grid-empty',
    section: 'Grid',
    title: 'Empty result after filter/search with reset affordance',
    mount(host) {
      return mountStaticGrid(
        host,
        createGalleryState({
          status: 'empty',
          records: [],
          totalCount: 0,
          emptyReason: 'no-match',
          search: 'not-a-project',
        }),
        {
          onSearch: () => undefined,
          onApplyFilter: async () => ({ status: 'saved', view: GALLERY_GRID_VIEW }),
        },
      );
    },
  },
  {
    id: 'grid-recycle',
    section: 'Grid',
    title: 'Deleted-record recycle list, pagination and undo notice',
    mount(host) {
      return mountStaticGrid(
        host,
        createGalleryState({
          deletedRecords: GALLERY_DELETED_RECORDS,
          deletedRecordsStatus: 'ready',
          deletedRecordsHasMore: true,
          deletedRecordsNextCursor: 'cursor:2',
          lastDeletedRecord: GALLERY_DELETED_RECORDS[0]!,
        }),
        {
          onLoadDeletedRecords: () => undefined,
          onLoadMoreDeletedRecords: () => undefined,
          onRestoreRecord: () => undefined,
          onDeleteRecord: () => undefined,
          onUndoDelete: () => undefined,
          onDismissDeleteNotice: () => undefined,
        },
      );
    },
  },
  {
    id: 'grid-interactive',
    section: 'Grid',
    title: 'Live controller — edit, create, delete, undo and recycle against the in-memory client',
    mount: (host) => mountInteractiveGrid(host),
  },
  {
    id: 'shell',
    section: 'View shell',
    title: 'View tabs — duplicate names, pending intent, deleted view, broken config and conflict',
    mount: (host) => mountShell(host),
  },
  {
    id: 'shell-empty',
    section: 'View shell',
    title: 'No View — shell and grid empty state with the create entry',
    mount(host) {
      const shellHost = document.createElement('div');
      host.append(shellHost);
      const translate = createTranslator('en');
      const shell = new TableShell(translate, {
        onWorkspaceChange: () => rerender(),
        onBaseChange: () => rerender(),
        onTableChange: () => rerender(),
        onViewChange: () => rerender(),
        onCreateView: async (input) => {
          const view = await new InMemoryLoomTableClient(galleryData()).createView(
            'table_01',
            { name: input.name, type: 'grid', config: galleryGridConfig() },
            'gallery-empty-shell',
          );
          return { status: 'created', view };
        },
      });
      const shellState: TableShellState = {
        workspaces: [galleryData().workspaces[0]!],
        bases: [galleryData().bases[0]!],
        tables: [galleryData().tables[0]!],
        views: [],
        fields: GALLERY_FIELDS,
        selectedWorkspaceId: 'workspace_01',
        selectedBaseId: 'base_01',
        selectedTableId: 'table_01',
        selectedViewId: null,
        pendingViewIntents: [],
        deletedViews: [],
        deletedViewsStatus: 'idle',
        viewWritePending: [],
        viewWriteIssues: {},
      };
      function rerender(): void {
        shellHost.replaceChildren(shell.render(shellState));
      }
      rerender();
      mountStaticGrid(
        host,
        createGalleryState({
          status: 'empty',
          views: [],
          selectedViewId: null,
          records: [],
          totalCount: 0,
          emptyReason: 'view',
        }),
        {
          onOpenViewCreateForm: () => shell.openCreateForm(),
        },
      );
    },
  },
  {
    id: 'panels',
    section: 'Filter / Sort / Display',
    title: 'Filter builder (nested draft), sort panel and display panel',
    mount(host) {
      const translate = createTranslator('en');
      const draft: FilterNode = {
        kind: 'group',
        operator: 'and',
        children: [
          {
            kind: 'rule',
            fieldId: 'field_status',
            operator: 'is',
            value: 'opt_doing',
          },
          {
            kind: 'group',
            operator: 'or',
            children: [
              {
                kind: 'rule',
                fieldId: 'field_count',
                operator: 'greaterThan',
                value: 10,
              },
              {
                kind: 'rule',
                fieldId: 'field_done',
                operator: 'is',
                value: true,
              },
            ],
          },
        ],
      };
      const filterBuilder = new FilterBuilder(draft, {
        fields: GALLERY_FIELDS,
        translate,
        onApply: () => undefined,
      });
      const sortPanel = new SortPanel(
        [{ fieldId: 'field_title', direction: 'asc', nulls: 'last' }] satisfies SortSpec[],
        {
          fields: GALLERY_FIELDS,
          translate,
          onApply: () => undefined,
        },
      );
      const displayPanel = new DisplayPanel(galleryGridConfig(), {
        fields: GALLERY_FIELDS,
        translate,
        onApply: () => undefined,
      });
      const wrap = block(host, 'loom-gallery-panels');
      wrap.append(
        labeled('Filter builder', filterBuilder.render()),
        labeled('Sort panel', sortPanel.render()),
        labeled('Display panel', displayPanel.render()),
      );
    },
  },
  {
    id: 'filter-unavailable',
    section: 'Filter / Sort / Display',
    title: 'Filter with an operator unavailable for the field type',
    mount(host) {
      const translate = createTranslator('en');
      const invalid: FilterNode = {
        kind: 'rule',
        fieldId: 'field_done',
        operator: 'contains',
        value: 'x',
      };
      const builder = new FilterBuilder(invalid, {
        fields: GALLERY_FIELDS,
        translate,
        onApply: () => undefined,
      });
      host.append(builder.render());
    },
  },
  {
    id: 'detail',
    section: 'Detail',
    title: 'Record detail with navigation, edit affordances and delete action',
    mount(host) {
      const translate = createTranslator('en');
      const records = GALLERY_RECORDS;
      const detailHost = document.createElement('div');
      host.append(detailHost);
      const open = (record: LoomTableRecord): void => {
        detailHost.replaceChildren(
          createRecordDetail(record, {
            translate,
            fields: GALLERY_FIELDS,
            primaryFieldId: 'field_title',
            navigation: {
              canNavigate: (recordId, direction) => {
                const index = records.findIndex((candidate) => candidate.id === recordId);
                const next = index + direction;
                return index >= 0 && next >= 0 && next < records.length;
              },
              onNavigate: async (recordId, direction) => {
                const index = records.findIndex((candidate) => candidate.id === recordId);
                const next = records[index + direction];
                if (next !== undefined) open(next);
                return next ?? null;
              },
            },
            callbacks: {
              onClose: () => detailHost.replaceChildren(),
              onFieldEdit: (_recordId, _fieldId, _value, current) => current,
              onDeleteRecord: () => detailHost.replaceChildren(),
            },
            confirmDangerousAction: (message, hostElement, trigger) =>
              confirmDangerousAction(hostElement, message, translate, trigger),
          }),
        );
      };
      const record = records.find((candidate) => candidate.id === 'record_valid');
      if (record === undefined) throw new Error('Gallery fixture is missing record_valid.');
      open(record);
    },
  },
  {
    id: 'create-form',
    section: 'Record lifecycle',
    title: 'Record create form — validation, busy and cancel states',
    mount(host) {
      const translate = createTranslator('en');
      const form = createRecordCreateForm({
        fields: GALLERY_FIELDS,
        translate,
        confirmDiscard: () => true,
        onSubmit: () => undefined,
        onCancel: () => form.element.remove(),
      });
      host.append(form.element);
    },
  },
  {
    id: 'map-ready',
    section: 'Map',
    title: 'Map view — tiles ready, points, cluster and detail (fake renderer)',
    mount: (host) => mountMap(host, { providerId: 'osm-standard' }),
  },
  {
    id: 'map-provider-error',
    section: 'Map',
    title: 'Map view — missing tile provider configuration',
    mount: (host) => mountMap(host, { missingProvider: true }),
  },
  {
    id: 'layout',
    section: 'Layout',
    title: 'Width variants and a dark-token container',
    mount(host) {
      const widths = block(host, 'loom-gallery-widths');
      for (const width of [360, 640, 1024]) {
        const inner = document.createElement('div');
        const frame = labeled(`${String(width)}px`, inner);
        frame.style.maxWidth = `${String(width)}px`;
        frame.dataset.galleryWidth = String(width);
        mountStaticGrid(inner, createGalleryState());
        widths.append(frame);
      }
      const darkInner = document.createElement('div');
      const dark = labeled('Dark token environment', darkInner);
      dark.classList.add('loom-gallery-dark');
      mountStaticGrid(darkInner, createGalleryState());
      widths.append(dark);
    },
  },
];

function mountStaticGrid(
  host: HTMLElement,
  state: GridState,
  overrides: Partial<GridRendererCallbacks> = {},
): GalleryMountResult {
  const translate = createTranslator('en');
  const container = document.createElement('div');
  host.append(container);
  const renderer = new ReadonlyGridRenderer(container, translate, {
    onRefresh: () => undefined,
    onLoadMore: () => undefined,
    onRecordOpen: () => undefined,
    confirmDangerousAction: (message, confirmHost, trigger) =>
      confirmDangerousAction(confirmHost, message, translate, trigger),
    ...overrides,
  });
  renderer.render(state);
  return { dispose: () => container.replaceChildren() };
}

function galleryShellState(update: Partial<TableShellState> = {}): TableShellState {
  return {
    workspaces: [galleryData().workspaces[0]!],
    bases: [galleryData().bases[0]!],
    tables: [galleryData().tables[0]!],
    views: GALLERY_VIEWS,
    fields: GALLERY_FIELDS,
    selectedWorkspaceId: 'workspace_01',
    selectedBaseId: 'base_01',
    selectedTableId: 'table_01',
    selectedViewId: 'view_grid',
    pendingViewIntents: [],
    deletedViews: [],
    deletedViewsStatus: 'idle',
    viewWritePending: [],
    viewWriteIssues: {},
    ...update,
  };
}

function mountStaticShell(host: HTMLElement, state?: TableShellState): void {
  const shell = new TableShell(createTranslator('en'), {
    onWorkspaceChange: () => undefined,
    onBaseChange: () => undefined,
    onTableChange: () => undefined,
    onViewChange: () => undefined,
    onCreateView: async () => ({ status: 'created', view: GALLERY_GRID_VIEW }),
    onManageViews: () => undefined,
  });
  host.append(shell.render(state ?? galleryShellState()));
}

async function mountInteractiveGrid(host: HTMLElement): Promise<GalleryMountResult> {
  const translate = createTranslator('en');
  const client = new InMemoryLoomTableClient(galleryData());
  let controller: GridViewController | null = null;
  const runtime = new MutationQueueRuntime({
    load: () => undefined,
    save: () => Promise.resolve(),
    transport: {
      mutate: (tableId: string, request: MutationRequest): Promise<MutationResult> =>
        client.mutate(tableId, request),
    },
    isOnline: () => true,
    isAuthReady: () => true,
    onApplied: () => void controller?.refresh(),
  });
  const scheduler = await runtime.start();
  if (scheduler === null) {
    throw runtime.recoveryError instanceof Error
      ? runtime.recoveryError
      : new Error('The gallery mutation queue failed to start.');
  }
  controller = new GridViewController(client, { mutationQueue: scheduler, translate });
  const grid = controller;

  const navHost = document.createElement('div');
  const layout = document.createElement('div');
  layout.className = 'loom-gallery-split';
  const gridHost = document.createElement('div');
  const detailHost = document.createElement('div');
  detailHost.dataset.role = 'gallery-detail-host';
  layout.append(gridHost, detailHost);
  host.append(navHost, layout);

  const shell = new TableShell(translate, {
    onWorkspaceChange: (id) => grid.selectWorkspace(id),
    onBaseChange: (id) => grid.selectBase(id),
    onTableChange: (id) => grid.selectTable(id),
    onViewChange: (id) => grid.selectView(id),
    onCreateView: (input) => grid.createView(input),
    onRetryViewIntent: (intentId) => grid.retryViewIntent(intentId).then(() => undefined),
    onDismissViewIntent: (intentId) => grid.dismissViewIntent(intentId),
    onManageViews: () => grid.openManageViews(),
    onCloseManageViews: () => grid.closeManageViews(),
    onRenameView: (viewId, name) => grid.renameView(viewId, name),
    onCopyView: (viewId, name) => grid.copyView(viewId, name),
    onDeleteView: (viewId) => grid.deleteView(viewId),
    onRestoreView: (viewId) => grid.restoreView(viewId),
    onSetDefaultView: (viewId) => grid.setDefaultView(viewId),
    onRepairView: (viewId, repair) => grid.repairView(viewId, repair),
    onResolveViewIssue: (viewId, action) => {
      if (action === 'adopt-latest' || action === 're-edit') {
        return grid.resolveViewConflict(viewId, action);
      }
      if (action === 'retry') return grid.retryViewWrite(viewId);
      return grid.dismissViewWriteIssue(viewId);
    },
  });

  const openDetail = async (record: LoomTableRecord): Promise<void> => {
    const fresh = await grid.getRecordForDetail(record);
    detailHost.replaceChildren(
      createRecordDetail(fresh, {
        translate,
        fields: grid.state.fields,
        primaryFieldId: 'field_title',
        navigation: {
          canNavigate: (recordId, direction) => grid.canNavigateRecord(recordId, direction),
          onNavigate: async (recordId, direction) => {
            const next = await grid.navigateRecord(recordId, direction);
            if (next !== null) await openDetail(next);
            return next;
          },
        },
        callbacks: {
          onClose: () => detailHost.replaceChildren(),
          onFieldEdit: (recordId, fieldId, value, current, options) =>
            grid.editCell(
              recordId,
              fieldId,
              value,
              { ...(options?.unset === true ? { unset: true } : {}) },
              current,
            ),
          onDeleteRecord: async (recordId, current) => {
            await grid.deleteRecord(recordId);
            void current;
            detailHost.replaceChildren();
          },
        },
        confirmDangerousAction: (message, confirmHost, trigger) =>
          confirmDangerousAction(confirmHost, message, translate, trigger),
      }),
    );
  };

  const renderer = new ReadonlyGridRenderer(gridHost, translate, {
    onRefresh: () => grid.refresh(),
    onOpenViewCreateForm: () => shell.openCreateForm(),
    onLoadMore: () => grid.loadNextPage(),
    onRecordOpen: (record) => void openDetail(record),
    onCellEdit: (recordId, fieldId, value) =>
      grid.editCell(recordId, fieldId, value).then(() => undefined),
    onConflictAction: (recordId, action) => grid.resolveConflict(recordId, action),
    onRetryEdit: (recordId) => grid.retryEdit(recordId),
    confirmDangerousAction: (message, confirmHost, trigger) =>
      confirmDangerousAction(confirmHost, message, translate, trigger),
    onSearch: (term) => grid.setSearch(term),
    onApplyFilter: (viewId, filter) => grid.applyViewFilter(viewId, filter),
    onApplySort: (viewId, sort) => grid.applyViewSort(viewId, sort),
    onApplyDisplay: (viewId, patch) => grid.applyViewDisplay(viewId, patch),
    onCreateRecord: (values) => grid.createRecord(values),
    onRetryRecordCreate: (operationId) => grid.retryRecordCreate(operationId),
    onDiscardRecordCreate: (operationId) => grid.discardRecordCreate(operationId),
    onDismissRecordCreate: (operationId) => grid.dismissRecordCreate(operationId),
    onDeleteRecord: (recordId) => grid.deleteRecord(recordId).then(() => undefined),
    onRestoreRecord: (recordId) => grid.restoreRecord(recordId).then(() => undefined),
    onUndoDelete: () => grid.undoDelete().then(() => undefined),
    onDismissDeleteNotice: () => grid.dismissDeleteNotice(),
    onLoadDeletedRecords: () => grid.loadDeletedRecords(),
    onLoadMoreDeletedRecords: () => grid.loadMoreDeletedRecords(),
  });
  const unsubscribe = grid.subscribe((state) => {
    renderer.render(state);
    navHost.replaceChildren(
      shell.render({
        workspaces: state.workspaces,
        bases: state.bases,
        tables: state.tables,
        views: state.views,
        fields: state.fields,
        selectedWorkspaceId: state.selectedWorkspaceId,
        selectedBaseId: state.selectedBaseId,
        selectedTableId: state.selectedTableId,
        selectedViewId: state.selectedViewId,
        pendingViewIntents: state.pendingViewIntents.filter(
          (intent) => intent.tableId === state.selectedTableId,
        ),
        deletedViews: state.deletedViews,
        deletedViewsStatus: state.deletedViewsStatus,
        viewWritePending: state.viewWritePending,
        viewWriteIssues: state.viewWriteIssues,
      }),
    );
    shell.restoreFocus();
  });
  await grid.load();
  return {
    dispose: () => {
      unsubscribe();
      grid.dispose();
      gridHost.replaceChildren();
      detailHost.replaceChildren();
      runtime.stop();
    },
  };
}

function mountShell(host: HTMLElement): GalleryMountResult {
  const translate = createTranslator('en');
  const client = new InMemoryLoomTableClient(galleryData());
  let state: TableShellState = {
    workspaces: [galleryData().workspaces[0]!],
    bases: [galleryData().bases[0]!],
    tables: [galleryData().tables[0]!],
    views: [
      ...GALLERY_VIEWS,
      {
        ...GALLERY_GRID_VIEW,
        id: 'view_broken',
        name: 'Broken projection',
        config: { ...galleryGridConfig(), projection: ['field_title', 'field_missing'] },
      },
    ],
    fields: GALLERY_FIELDS,
    selectedWorkspaceId: 'workspace_01',
    selectedBaseId: 'base_01',
    selectedTableId: 'table_01',
    selectedViewId: 'view_grid',
    pendingViewIntents: [
      {
        intentId: 'intent_01',
        tableId: 'table_01',
        request: { name: 'Queued view', type: 'grid', config: galleryGridConfig() },
        createdAt: '2026-08-24T00:00:00Z',
      },
    ],
    deletedViews: [],
    deletedViewsStatus: 'idle',
    viewWritePending: ['view_daily_a'],
    viewWriteIssues: {
      view_daily_b: {
        kind: 'conflict',
        message: 'The View changed on the Server.',
        latestView: {
          ...GALLERY_VIEWS.find((view) => view.id === 'view_daily_b')!,
          name: 'Daily (server)',
          revision: 3,
        },
      },
      view_map: {
        kind: 'error',
        message: 'The View could not be saved.',
      },
    },
  };
  const shell = new TableShell(translate, {
    onWorkspaceChange: () => rerender(),
    onBaseChange: () => rerender(),
    onTableChange: () => rerender(),
    onViewChange: (viewId) => {
      state = { ...state, selectedViewId: viewId };
      rerender();
    },
    onCreateView: async (input) => {
      const request =
        input.type === 'map'
          ? {
              name: input.name,
              type: 'map' as const,
              config: galleryMapConfig(),
            }
          : {
              name: input.name,
              type: 'grid' as const,
              config: galleryGridConfig(),
            };
      const view = await client.createView(
        'table_01',
        request,
        `gallery-${String(state.views.length)}`,
      );
      state = { ...state, views: [...state.views, view], selectedViewId: view.id };
      rerender();
      return { status: 'created', view };
    },
    onManageViews: async () => {
      state = { ...state, deletedViews: [GALLERY_DELETED_VIEW], deletedViewsStatus: 'ready' };
      rerender();
    },
    onCloseManageViews: () => undefined,
    onRenameView: async (viewId, name) => {
      const view = state.views.find((candidate) => candidate.id === viewId);
      if (view === undefined) return { status: 'deleted' };
      const saved = await client.updateView(
        viewId,
        view.type === 'map'
          ? {
              name,
              type: 'map',
              config: view.config,
              expectedRevision: view.revision,
            }
          : {
              name,
              type: 'grid',
              config: view.config,
              expectedRevision: view.revision,
            },
      );
      state = {
        ...state,
        views: state.views.map((candidate) => (candidate.id === viewId ? saved : candidate)),
      };
      rerender();
      return { status: 'saved', view: saved };
    },
    onCopyView: async (viewId, name) => {
      const view = state.views.find((candidate) => candidate.id === viewId);
      if (view === undefined) {
        return { status: 'failed', kind: 'not-found', error: { message: 'Missing view.' } };
      }
      const copy = await client.createView(
        'table_01',
        view.type === 'map'
          ? { name, type: 'map', config: view.config }
          : { name, type: 'grid', config: view.config },
        `gallery-copy-${viewId}`,
      );
      state = { ...state, views: [...state.views, copy] };
      rerender();
      return { status: 'created', view: copy };
    },
    onDeleteView: async (viewId) => {
      const view = state.views.find((candidate) => candidate.id === viewId);
      if (view === undefined) return { status: 'deleted' };
      await client.deleteView(viewId, view.revision);
      state = {
        ...state,
        views: state.views.filter((candidate) => candidate.id !== viewId),
        deletedViews: [
          ...state.deletedViews,
          { ...view, revision: view.revision + 1, deletedAt: '2026-08-25T00:00:00Z' },
        ],
      };
      rerender();
      return { status: 'deleted' };
    },
    onRestoreView: async (viewId) => {
      const deleted = state.deletedViews.find((candidate) => candidate.id === viewId);
      if (deleted === undefined) return { status: 'deleted' };
      const restored = await client.restoreView(viewId, deleted.revision);
      state = {
        ...state,
        deletedViews: state.deletedViews.filter((candidate) => candidate.id !== viewId),
        views: [...state.views, restored],
      };
      rerender();
      return { status: 'saved', view: restored };
    },
    onRetryViewIntent: () => {
      state = { ...state, pendingViewIntents: [] };
      rerender();
      return Promise.resolve();
    },
    onDismissViewIntent: () => {
      state = { ...state, pendingViewIntents: [] };
      rerender();
      return Promise.resolve();
    },
    onResolveViewIssue: (viewId) => {
      const issues = { ...state.viewWriteIssues };
      delete issues[viewId];
      state = {
        ...state,
        viewWriteIssues: issues,
        viewWritePending: state.viewWritePending.filter((id) => id !== viewId),
      };
      rerender();
    },
    onRepairView: async (viewId, repair) => {
      const view = state.views.find((candidate) => candidate.id === viewId);
      if (view === undefined || view.type !== 'grid') return { status: 'deleted' };
      const removed = new Set(repair.removeFieldIds ?? []);
      const config: typeof view.config = {
        ...view.config,
        projection: view.config.projection.filter((id) => !removed.has(id)),
        columnOrder: view.config.columnOrder.filter((id) => !removed.has(id)),
      };
      const saved = await client.updateView(viewId, {
        type: 'grid',
        config,
        expectedRevision: view.revision,
      });
      state = {
        ...state,
        views: state.views.map((candidate) => (candidate.id === viewId ? saved : candidate)),
      };
      rerender();
      return { status: 'saved', view: saved };
    },
  });

  const container = document.createElement('div');
  host.append(container);
  function rerender(): void {
    container.replaceChildren(shell.render(state));
  }
  rerender();
  return { dispose: () => container.replaceChildren() };
}

interface GalleryMapOptions {
  readonly providerId?: BuiltInTileProviderId;
  readonly missingProvider?: boolean;
}

export class GalleryMapRenderer implements MapRenderer {
  listener: MapRendererEventListener | null = null;
  tilePlan: ResolvedTilePlan | null = null;
  camera: MapCamera | null = null;
  features: readonly MapFeature[] = [];
  #container: HTMLElement | null = null;

  mount(container: HTMLElement, listener: MapRendererEventListener): void {
    this.#container = container;
    this.listener = listener;
    container.classList.add('loom-gallery-fake-map');
    container.dataset.role = 'fake-map';
    const controls = document.createElement('div');
    controls.className = 'loom-gallery-map-controls';
    const emit = (label: string, run: () => void): void => {
      const control = document.createElement('button');
      control.type = 'button';
      control.className = 'loom-button';
      control.dataset.role = 'map-fake-control';
      control.textContent = label;
      control.addEventListener('click', run);
      controls.append(control);
    };
    emit('Tiles ready', () =>
      listener.tileReady?.({ providerId: this.tilePlan?.providerId ?? 'osm-standard' }),
    );
    emit('Tile error', () =>
      listener.tileError?.({
        kind: 'tile',
        providerId: this.tilePlan?.providerId ?? 'osm-standard',
        message: 'The tile request failed.',
      }),
    );
    emit('Select point', () => {
      const point = this.features.find((feature) => feature.kind === 'point');
      if (point !== undefined && point.kind === 'point') listener.pointSelected?.(point.recordId);
    });
    emit('Select cluster', () => {
      const cluster = this.features.find((feature) => feature.kind === 'cluster');
      if (cluster !== undefined && cluster.kind === 'cluster') {
        listener.clusterSelected?.(cluster.clusterId);
      }
    });
    emit('Move camera', () =>
      listener.cameraChanged?.({ center: { lat: 39.9, lng: 116.4 }, zoom: 11 }),
    );
    emit('Resize', () => listener.rendererSizeChanged?.({ width: 640, height: 480 }));
    container.append(controls);
    const featureHost = document.createElement('div');
    featureHost.dataset.role = 'map-feature-host';
    container.append(featureHost);
    this.#renderFeatures();
    listener.rendererSizeChanged?.({ width: 800, height: 600 });
  }

  setTilePlan(plan: ResolvedTilePlan): void {
    this.tilePlan = plan;
    this.listener?.tileLoading?.({ providerId: plan.providerId, layerCount: plan.layers.length });
    if (this.#container !== null) this.#container.dataset.provider = plan.providerId;
  }

  setCamera(camera: MapCamera): void {
    this.camera = camera;
  }

  fitBounds(_bounds: MapViewport): void {}

  setFeatures(features: readonly MapFeature[]): void {
    this.features = features;
    this.#renderFeatures();
  }

  invalidateSize(): void {}

  destroy(): void {
    this.listener = null;
    this.#container = null;
  }

  getViewport(): MapViewport {
    return { boxes: [{ west: 110, south: 20, east: 130, north: 42 }] };
  }

  getPixelSize(): { readonly width: number; readonly height: number } {
    return { width: 800, height: 600 };
  }

  #renderFeatures(): void {
    const featureHost = this.#container?.querySelector<HTMLElement>(
      '[data-role="map-feature-host"]',
    );
    if (featureHost === null || featureHost === undefined) return;
    featureHost.replaceChildren(
      ...this.features.map((feature) => {
        const element = document.createElement('div');
        element.dataset.role = 'map-feature';
        element.dataset.featureKind = feature.kind;
        element.dataset.featureId = feature.kind === 'point' ? feature.recordId : feature.clusterId;
        element.textContent =
          feature.kind === 'point' ? feature.primaryFieldText : String(feature.pointCount);
        return element;
      }),
    );
  }
}

async function mountMap(
  host: HTMLElement,
  options: GalleryMapOptions,
): Promise<GalleryMountResult> {
  const translate = createTranslator('en');
  const client = new InMemoryLoomTableClient(galleryData());
  const renderer = new GalleryMapRenderer();
  const registry = new TileProviderRegistry();
  const credentials = { get: () => null };
  const provider: TileProviderRef =
    options.missingProvider === true
      ? { kind: 'custom', profileId: 'profile_missing' }
      : { kind: 'built-in', id: options.providerId ?? 'osm-standard' };
  const controller = new MapViewController(client, GALLERY_MAP_VIEW, GALLERY_FIELDS, {
    renderer,
    registry,
    credentials,
    provider,
    viewport: renderer,
    debounceMs: 0,
    primaryFieldId: 'field_title',
  });
  const view = new MapView(host, controller, {
    translate,
    providers: registry.list(),
    selectedProvider: provider,
    onProviderChange: () => undefined,
    onOpenSettings: () => undefined,
    onClusterNextPage: () => controller.loadNextClusterPage(),
    onClusterRetry: () => controller.retryCluster(),
    onTileRetry: () => controller.retryTiles(),
  });
  view.mount();
  return {
    dispose: () => view.destroy(),
  };
}

function block(host: HTMLElement, className: string): HTMLElement {
  const element = document.createElement('div');
  element.className = className;
  host.append(element);
  return element;
}

function row(host: HTMLElement, label: string): HTMLElement {
  const content = document.createElement('div');
  const element = document.createElement('div');
  element.className = 'loom-gallery-row';
  element.append(labeled(label, content));
  host.append(element);
  return content;
}

function labeled(label: string, content: HTMLElement): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'loom-gallery-labeled';
  const caption = document.createElement('h4');
  caption.className = 'loom-gallery-caption';
  caption.textContent = label;
  wrap.append(caption, content);
  return wrap;
}

function button(label: string, className: string): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = className;
  element.textContent = label;
  return element;
}
