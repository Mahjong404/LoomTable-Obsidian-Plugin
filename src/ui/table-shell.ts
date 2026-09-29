import {
  normalizeResourceName,
  type Base,
  type Field,
  type FilterNode,
  type Table,
  type View,
  type Workspace,
} from '../client/loomtable-client';
import type { Translator } from '../i18n';
import type { MessageKey } from '../i18n/messages';
import { ensureButtonLabels, labelContainer } from './a11y';
import { openContextMenu, type ContextMenuItem } from './context-menu';
import { createUiIcon, type UiIconName } from './icons';
import { findBrokenViewFieldIds, type ViewConfigRepairInput } from './view-config-repair';
import type {
  PendingViewCreateIntent,
  ViewCopyOutcome,
  ViewCreateInput,
  ViewCreateOutcome,
  ViewIssueAction,
  ViewWriteIssue,
  ViewWriteOutcome,
} from './view-write-coordinator';

export type { ViewCreateInput, ViewCreateOutcome } from './view-write-coordinator';
export type {
  ViewCopyOutcome,
  ViewIssueAction,
  ViewWriteIssue,
  ViewWriteOutcome,
} from './view-write-coordinator';
export type { ViewConfigRepairInput } from './view-config-repair';

export interface TableShellState {
  readonly workspaces: readonly Workspace[];
  readonly bases: readonly Base[];
  readonly tables: readonly Table[];
  readonly views: readonly View[];
  readonly fields: readonly Field[];
  readonly selectedWorkspaceId: string | null;
  readonly selectedBaseId: string | null;
  readonly selectedTableId: string | null;
  readonly selectedViewId: string | null;
  readonly pendingViewIntents: readonly PendingViewCreateIntent[];
  readonly viewWritePending: readonly string[];
  readonly viewWriteIssues: Readonly<Record<string, ViewWriteIssue>>;
}

export interface TableShellCallbacks {
  readonly onWorkspaceChange: (workspaceId: string) => void | Promise<void>;
  readonly onBaseChange: (baseId: string) => void | Promise<void>;
  readonly onTableChange: (tableId: string) => void | Promise<void>;
  readonly onViewChange: (viewId: string) => void | Promise<void>;
  readonly onCreateView?: (input: ViewCreateInput) => Promise<ViewCreateOutcome>;
  readonly onRetryViewIntent?: (intentId: string) => void | Promise<void>;
  readonly onDismissViewIntent?: (intentId: string) => void | Promise<void>;
  readonly onRenameView?: (viewId: string, name: string) => Promise<ViewWriteOutcome>;
  readonly onCopyView?: (viewId: string, name: string) => Promise<ViewCopyOutcome>;
  readonly onDeleteView?: (viewId: string) => Promise<ViewWriteOutcome>;
  readonly onSetDefaultView?: (viewId: string) => Promise<ViewWriteOutcome>;
  readonly onRepairView?: (
    viewId: string,
    repair: ViewConfigRepairInput,
  ) => Promise<ViewWriteOutcome>;
  readonly onResolveViewIssue?: (
    viewId: string,
    action: ViewIssueAction,
  ) => void | Promise<unknown>;
}

interface InlineEdit {
  readonly viewId: string;
  readonly mode: 'rename' | 'copy';
  value: string;
  error: string | null;
  pending: boolean;
}

let shellSequence = 0;

export class TableShell {
  readonly panelId: string;
  readonly #translate: Translator;
  readonly #callbacks: TableShellCallbacks;
  #lastRoot: HTMLElement | null = null;
  #lastState: TableShellState | null = null;
  #restoreFocusKey: string | null = null;
  #createPickerOpen = false;
  #createFieldPick = false;
  #createPending = false;
  #viewListOpen = false;
  #panelTableId: string | null = null;
  #inlineEdit: InlineEdit | null = null;
  #confirmDeleteId: string | null = null;
  #repairViewId: string | null = null;
  #repairRemovals = new Set<string>();
  #repairLocation = '';
  #panelFormError: string | null = null;
  #overlayDismiss: ((event: PointerEvent) => void) | null = null;
  #contextExpanded = false;

  constructor(translate: Translator, callbacks: TableShellCallbacks) {
    this.#translate = translate;
    this.#callbacks = callbacks;
    this.panelId = `loom-view-panel-${++shellSequence}`;
  }

  /**
   * Issues a View create for a caller that already resolved the configuration
   * (e.g. "open this Location Field in a new Map View"). The panel opens so a
   * failure stays visible next to the entry point.
   */
  createView(preset: { type: 'grid' | 'map'; locationFieldId?: string }): void {
    if (this.#callbacks.onCreateView === undefined) return;
    this.#viewListOpen = true;
    this.#panelTableId = this.#lastState?.selectedTableId ?? null;
    this.#createPickerOpen = true;
    this.#createFieldPick = false;
    this.#submitViewCreate(preset.type, preset.locationFieldId);
  }

  /** Opens the All Views popover with the type picker expanded. */
  openViewPicker(): void {
    if (this.#callbacks.onCreateView === undefined) return;
    this.#viewListOpen = true;
    this.#panelTableId = this.#lastState?.selectedTableId ?? null;
    this.#createPickerOpen = true;
    this.#createFieldPick = false;
    this.#panelFormError = null;
    this.#rerender();
  }

  render(state: TableShellState): HTMLElement {
    this.#captureFocus();
    this.#lastState = state;
    const root = document.createElement('div');
    root.className = 'loom-table-shell';
    root.setAttribute('role', 'group');
    labelContainer(root, this.#translate('grid.status'));
    const context = createElement('div', 'loom-shell-context');
    context.classList.toggle('loom-shell-context-open', this.#contextExpanded);
    const crumb = [
      state.workspaces.find((item) => item.id === state.selectedWorkspaceId)?.name,
      state.bases.find((item) => item.id === state.selectedBaseId)?.name,
      state.tables.find((item) => item.id === state.selectedTableId)?.name,
    ]
      .filter((name): name is string => name !== undefined && name !== '')
      .join(' / ');
    const contextToggle = createElement('button', 'loom-shell-context-toggle');
    contextToggle.type = 'button';
    contextToggle.textContent = crumb;
    contextToggle.setAttribute('aria-expanded', this.#contextExpanded ? 'true' : 'false');
    contextToggle.setAttribute('aria-label', this.#translate('grid.context.expand'));
    contextToggle.addEventListener('click', () => {
      this.#contextExpanded = !this.#contextExpanded;
      this.#rerender();
    });
    context.append(contextToggle);
    context.append(
      this.#renderSelect(
        'grid.workspace',
        state.workspaces,
        state.selectedWorkspaceId,
        (value) => void this.#callbacks.onWorkspaceChange(value),
        { muted: true },
      ),
      contextSeparator(),
      this.#renderSelect(
        'grid.base',
        state.bases,
        state.selectedBaseId,
        (value) => void this.#callbacks.onBaseChange(value),
        { muted: true },
      ),
      contextSeparator(),
      this.#renderSelect(
        'grid.table',
        state.tables,
        state.selectedTableId,
        (value) => void this.#callbacks.onTableChange(value),
        { icon: 'view-grid' },
      ),
    );
    const row = createElement('div', 'loom-shell-row');
    row.append(context, this.#renderViewListToggle(state), this.#renderTabs(state));
    root.append(row);
    const intents = this.#renderIntents(state);
    if (intents !== null) root.append(intents);
    if (this.#viewListOpen) {
      if (this.#panelTableId !== state.selectedTableId) {
        this.#panelTableId = state.selectedTableId;
        this.#resetPanelForms();
      }
      root.append(this.#renderViewPanel(state));
    }
    ensureButtonLabels(root);
    this.#lastRoot = root;
    this.#syncOverlayDismissal(root);
    root.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (this.#createFieldPick || this.#createPickerOpen) {
        event.preventDefault();
        if (this.#createFieldPick) {
          this.#createFieldPick = false;
        } else {
          this.#createPickerOpen = false;
        }
        this.#rerender();
        this.#lastRoot?.querySelector<HTMLElement>('[data-shell-focus="view-create"]')?.focus();
        return;
      }
      if (!this.#viewListOpen) return;
      event.preventDefault();
      this.#closeViewPanel();
      this.#rerender();
      this.#focusViewListToggle();
    });
    return root;
  }

  #syncOverlayDismissal(root: HTMLElement): void {
    if (!this.#viewListOpen) {
      if (this.#overlayDismiss !== null) {
        root.ownerDocument.removeEventListener('pointerdown', this.#overlayDismiss, true);
        this.#overlayDismiss = null;
      }
      return;
    }
    if (this.#overlayDismiss !== null) return;
    const onPointerDown = (event: PointerEvent) => {
      const el = event.target instanceof Element ? event.target : null;
      if (
        el !== null &&
        el.closest('.loom-view-panel, .loom-view-list-toggle, .loom-context-menu') !== null
      ) {
        return;
      }
      this.#closeViewPanel();
      this.#rerender();
    };
    root.ownerDocument.addEventListener('pointerdown', onPointerDown, true);
    this.#overlayDismiss = onPointerDown;
  }

  #toggleViewPanel(state: TableShellState): void {
    this.#viewListOpen = !this.#viewListOpen;
    if (this.#viewListOpen) {
      this.#panelTableId = state.selectedTableId;
      this.#resetPanelForms();
    } else {
      this.#resetPanelForms();
    }
    this.#rerender();
    if (this.#viewListOpen) {
      this.#lastRoot?.querySelector<HTMLElement>('.loom-view-panel .loom-view-panel-item')?.focus();
    }
  }

  #closeViewPanel(): void {
    this.#viewListOpen = false;
    this.#resetPanelForms();
  }

  #focusViewListToggle(): void {
    this.#lastRoot?.querySelector<HTMLElement>('[data-shell-focus="view-list"]')?.focus();
  }

  #resetPanelForms(): void {
    this.#inlineEdit = null;
    this.#confirmDeleteId = null;
    this.#repairViewId = null;
    this.#repairRemovals = new Set();
    this.#repairLocation = '';
    this.#panelFormError = null;
    this.#createPickerOpen = false;
    this.#createFieldPick = false;
  }

  #renderViewPanel(state: TableShellState): HTMLElement {
    const panel = createElement('section', 'loom-view-panel');
    labelContainer(panel, this.#translate('view.list'));

    const list = createElement('ul', 'loom-view-panel-list');
    list.setAttribute('role', 'list');
    const active = state.views.filter((view) => view.deletedAt === undefined);
    const duplicateNames = new Set(
      active.map((view) => view.name).filter((name, index, names) => names.indexOf(name) !== index),
    );
    for (const view of active) {
      list.append(this.#renderViewPanelRow(view, state, duplicateNames.has(view.name)));
    }
    panel.append(list);

    const divider = createElement('div', 'loom-view-panel-divider');
    divider.setAttribute('aria-hidden', 'true');
    panel.append(divider);

    const actions = createElement('div', 'loom-view-panel-actions');
    if (this.#callbacks.onCreateView !== undefined) {
      const create = document.createElement('button');
      create.type = 'button';
      create.className = 'loom-view-panel-create';
      create.dataset.action = 'create-view';
      create.dataset.shellFocus = 'view-create';
      create.prepend(createUiIcon('view-add'));
      const label = createElement('span', 'loom-view-panel-create-label');
      label.textContent = this.#translate('view.list.create');
      create.append(label);
      create.setAttribute('aria-label', this.#translate('view.list.create'));
      create.setAttribute('aria-expanded', this.#createPickerOpen ? 'true' : 'false');
      create.disabled = this.#createPending;
      create.setAttribute('aria-busy', this.#createPending ? 'true' : 'false');
      create.addEventListener('click', () => this.#toggleCreatePicker());
      actions.append(create);
      if (this.#createPickerOpen) {
        actions.append(this.#renderCreatePicker(state));
      }
    }
    if (this.#panelFormError !== null) {
      const error = createTextElement('p', this.#panelFormError);
      error.classList.add('loom-view-panel-error');
      error.setAttribute('role', 'alert');
      actions.append(error);
    }
    panel.append(actions);
    return panel;
  }

  #renderViewPanelRow(view: View, state: TableShellState, duplicateName: boolean): HTMLElement {
    const row = createElement('li', 'loom-view-panel-row');
    row.dataset.viewId = view.id;
    const pending = state.viewWritePending.includes(view.id);
    row.setAttribute('aria-busy', pending ? 'true' : 'false');

    const issues = findBrokenViewFieldIds(view, state.fields);
    const broken = issues.queryFieldIds.length + issues.presentationFieldIds.length > 0;
    const editing = this.#inlineEdit?.viewId === view.id;

    if (editing && this.#inlineEdit !== null) {
      row.append(this.#renderInlineEdit(view, this.#inlineEdit));
    } else {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'loom-view-panel-item';
      item.dataset.shellFocus = `view-item:${view.id}`;
      item.disabled = pending;
      if (view.id === state.selectedViewId) {
        item.classList.add('is-current');
        item.setAttribute('aria-current', 'true');
      }
      item.append(createUiIcon(view.type === 'map' ? 'view-map' : 'view-grid'));
      const label = createTextElement(
        'span',
        view.name + (duplicateName ? ` · ${viewTypeLabel(view, this.#translate)}` : ''),
      );
      label.classList.add('loom-view-panel-name');
      item.append(label);
      item.addEventListener('click', () => {
        this.#closeViewPanel();
        void this.#callbacks.onViewChange(view.id);
        this.#rerender();
      });
      row.append(item);

      if (broken) {
        const badge = createTextElement('span', this.#translate('view.manage.broken'));
        badge.classList.add('loom-view-broken');
        row.append(badge);
      }

      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'loom-view-panel-more clickable-icon';
      more.dataset.action = 'view-more';
      more.dataset.shellFocus = `view-more:${view.id}`;
      more.setAttribute('aria-haspopup', 'menu');
      more.setAttribute('aria-label', this.#translate('view.more'));
      more.append(createUiIcon('menu-ellipsis'));
      more.disabled = pending;
      more.addEventListener('click', (event) => {
        event.stopPropagation();
        this.#openRowMenu(view, more, row, broken);
      });
      row.append(more);
    }

    const issueElement = this.#renderViewIssue(view.id, state);
    if (issueElement !== null) row.append(issueElement);
    if (this.#confirmDeleteId === view.id) {
      row.append(this.#renderDeleteConfirm(view));
    }
    if (this.#repairViewId === view.id) {
      row.append(this.#renderRepairForm(view, state, issues));
    }
    return row;
  }

  #openRowMenu(view: View, anchor: HTMLElement, host: HTMLElement, broken: boolean): void {
    const items: (ContextMenuItem | 'separator')[] = [
      {
        label: this.#translate('view.manage.rename'),
        icon: 'menu-edit',
        disabled: this.#callbacks.onRenameView === undefined,
        dataAction: 'rename',
        action: () => this.#startInlineEdit(view, 'rename'),
      },
      {
        label: this.#translate('view.manage.copy'),
        icon: 'menu-duplicate',
        disabled: this.#callbacks.onCopyView === undefined,
        dataAction: 'copy',
        action: () => this.#startInlineEdit(view, 'copy'),
      },
      {
        label: this.#translate('view.manage.setDefault'),
        icon: 'view-default',
        disabled: view.isDefault || this.#callbacks.onSetDefaultView === undefined,
        dataAction: 'set-default',
        action: () => void this.#runViewAction('default', view.id),
      },
    ];
    if (broken) {
      items.push({
        label: this.#translate('view.manage.repair'),
        icon: 'menu-edit',
        disabled: this.#callbacks.onRepairView === undefined,
        dataAction: 'repair',
        action: () => {
          this.#repairViewId = view.id;
          this.#repairRemovals = new Set();
          this.#repairLocation = '';
          this.#inlineEdit = null;
          this.#confirmDeleteId = null;
          this.#panelFormError = null;
          this.#rerender();
        },
      });
    }
    items.push('separator', {
      label: this.#translate('view.manage.delete'),
      icon: 'menu-delete',
      danger: true,
      disabled: this.#callbacks.onDeleteView === undefined,
      dataAction: 'delete',
      action: () => {
        this.#confirmDeleteId = view.id;
        this.#inlineEdit = null;
        this.#repairViewId = null;
        this.#panelFormError = null;
        this.#rerender();
        this.#lastRoot
          ?.querySelector<HTMLElement>(`[data-shell-focus="delete-confirm:${view.id}"]`)
          ?.focus();
      },
    });
    const rect = anchor.getBoundingClientRect();
    openContextMenu({
      items,
      x: rect.right,
      y: rect.bottom + 4,
      align: 'end',
      host: host.closest<HTMLElement>('.loom-view-panel') ?? host,
      trigger: anchor,
      label: view.name,
    });
  }

  #startInlineEdit(view: View, mode: 'rename' | 'copy'): void {
    const active = (this.#lastState?.views ?? []).filter((item) => item.deletedAt === undefined);
    const names = new Set(active.map((item) => item.name));
    const value = mode === 'rename' ? view.name : nextAvailableViewName(view.name, names);
    this.#inlineEdit = { viewId: view.id, mode, value, error: null, pending: false };
    this.#confirmDeleteId = null;
    this.#repairViewId = null;
    this.#panelFormError = null;
    this.#rerender();
    const input = this.#lastRoot?.querySelector<HTMLInputElement>(
      '[data-shell-focus="inline-edit"]',
    );
    input?.focus();
    input?.select();
  }

  #renderInlineEdit(view: View, edit: InlineEdit): HTMLElement {
    const form = document.createElement('form');
    form.dataset.panelForm = edit.mode;
    form.className = 'loom-view-inline-edit';
    form.append(createUiIcon(view.type === 'map' ? 'view-map' : 'view-grid'));
    const input = document.createElement('input');
    input.name = 'view-name';
    input.type = 'text';
    input.required = true;
    input.value = edit.value;
    input.dataset.shellFocus = 'inline-edit';
    input.setAttribute('aria-label', this.#translate('view.create.name'));
    input.addEventListener('input', () => {
      edit.value = input.value;
    });
    form.append(input);

    if (edit.error !== null) {
      const error = createTextElement('p', edit.error);
      error.classList.add('loom-view-panel-error');
      error.setAttribute('role', 'alert');
      form.append(error);
    }

    input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        const viewId = view.id;
        this.#inlineEdit = null;
        this.#restoreFocusKey = `view-item:${viewId}`;
        this.#rerender();
      }
    });
    input.addEventListener('blur', () => {
      // A blur fired by detaching the input (panel rerender while a commit is
      // in flight) is not a user blur; only commit on a connected input.
      if (!input.isConnected) return;
      if (this.#inlineEdit !== edit) return;
      this.#commitInlineEdit(view, edit, input.value);
    });
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      this.#commitInlineEdit(view, edit, input.value);
    });
    return form;
  }

  #commitInlineEdit(view: View, edit: InlineEdit, rawValue: string): void {
    if (edit.pending || this.#inlineEdit !== edit) return;
    const normalized = normalizeResourceName(rawValue);
    if (!normalized.ok) {
      edit.error = this.#translate(
        normalized.reason === 'empty'
          ? 'view.create.nameRequired'
          : normalized.reason === 'control-character'
            ? 'view.create.nameControl'
            : 'view.create.nameTooLong',
      );
      this.#rerender();
      return;
    }
    if (edit.mode === 'rename' && normalized.name === view.name) {
      this.#inlineEdit = null;
      this.#restoreFocusKey = `view-item:${view.id}`;
      this.#rerender();
      return;
    }
    const callback =
      edit.mode === 'rename' ? this.#callbacks.onRenameView : this.#callbacks.onCopyView;
    if (callback === undefined) return;
    const viewId = view.id;
    edit.pending = true;
    void callback(viewId, normalized.name)
      .then((outcome) => {
        edit.pending = false;
        if (outcome.status === 'failed' || outcome.status === 'repair-required') {
          edit.error = this.#translate(
            outcome.status === 'repair-required'
              ? 'view.manage.repairRequired'
              : 'view.manage.formError',
          );
          this.#rerender();
          return;
        }
        this.#inlineEdit = null;
        this.#restoreFocusKey = `view-item:${viewId}`;
        this.#rerender();
      })
      .catch(() => {
        edit.pending = false;
        edit.error = this.#translate('view.manage.formError');
        this.#rerender();
      });
  }

  #toggleCreatePicker(): void {
    this.#createPickerOpen = !this.#createPickerOpen;
    this.#createFieldPick = false;
    this.#panelFormError = null;
    this.#rerender();
    if (this.#createPickerOpen) {
      this.#lastRoot?.querySelector<HTMLElement>('[data-shell-focus="create-type:grid"]')?.focus();
    }
  }

  #pickCreateType(type: 'grid' | 'map', locationFields: readonly Field[]): void {
    if (type === 'grid') {
      this.#submitViewCreate('grid');
      return;
    }
    if (locationFields.length === 0) return;
    if (locationFields.length === 1) {
      this.#submitViewCreate('map', locationFields[0]?.id);
      return;
    }
    this.#createFieldPick = true;
    this.#rerender();
    this.#lastRoot?.querySelector<HTMLElement>('[data-shell-focus="create-field"]')?.focus();
  }

  /**
   * Selecting a type (or a Location Field for a Map View) is the create intent;
   * the request is issued immediately with the smallest free default name.
   * A failure keeps the picker open so the same choice can be retried; an
   * unresolved outcome stays owned by the pending-intent strip, never retried
   * blindly here.
   */
  #submitViewCreate(type: 'grid' | 'map', locationFieldId?: string): void {
    const state = this.#lastState;
    const onCreateView = this.#callbacks.onCreateView;
    if (state === null || onCreateView === undefined || this.#createPending) return;
    const active = state.views.filter((view) => view.deletedAt === undefined);
    const name = nextAvailableViewName(
      this.#translate(type === 'grid' ? 'view.create.defaultName' : 'view.create.defaultMapName'),
      new Set(active.map((view) => view.name)),
    );
    this.#createPending = true;
    this.#panelFormError = null;
    this.#rerender();
    void onCreateView({
      type,
      name,
      ...(type === 'map' && locationFieldId !== undefined ? { locationFieldId } : {}),
    })
      .then((outcome) => {
        this.#createPending = false;
        if (outcome.status === 'failed') {
          this.#panelFormError = this.#translate('view.create.failed');
          this.#rerender();
          return;
        }
        this.#closeViewPanel();
        this.#rerender();
      })
      .catch(() => {
        this.#createPending = false;
        this.#panelFormError = this.#translate('view.create.failed');
        this.#rerender();
      });
  }

  #renderCreatePicker(state: TableShellState): HTMLElement {
    const picker = createElement('div', 'loom-view-type-picker');
    picker.setAttribute('role', 'group');
    labelContainer(picker, this.#translate('view.list.create'));
    const locationFields = state.fields.filter(
      (field) => field.type === 'location' && field.deletedAt === undefined,
    );
    picker.append(
      this.#renderTypeOption('grid', this.#translate('view.create.defaultName'), () =>
        this.#pickCreateType('grid', locationFields),
      ),
      this.#renderTypeOption(
        'map',
        this.#translate('view.create.defaultMapName'),
        () => this.#pickCreateType('map', locationFields),
        locationFields.length === 0,
      ),
    );
    if (locationFields.length === 0) {
      const note = createElement('p', 'loom-view-type-note');
      note.textContent = this.#translate('view.create.noLocationField');
      picker.append(note);
    }
    if (this.#createFieldPick) {
      const list = createElement('div', 'loom-view-field-list');
      list.setAttribute('role', 'group');
      labelContainer(list, this.#translate('view.create.locationField'));
      for (const field of locationFields) {
        const option = document.createElement('button');
        option.type = 'button';
        option.className = 'loom-view-field-option';
        option.dataset.action = `create-map:${field.id}`;
        option.dataset.shellFocus = 'create-field';
        option.disabled = this.#createPending;
        option.textContent = field.name;
        option.addEventListener('click', () => this.#submitViewCreate('map', field.id));
        list.append(option);
      }
      picker.append(list);
    }
    return picker;
  }

  #renderTypeOption(
    type: 'grid' | 'map',
    label: string,
    action: () => void,
    disabled = false,
  ): HTMLButtonElement {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'loom-view-type-option';
    option.dataset.action = `create-type:${type}`;
    option.dataset.shellFocus = `create-type:${type}`;
    option.disabled = disabled || this.#createPending;
    option.setAttribute('aria-busy', this.#createPending ? 'true' : 'false');
    option.append(createUiIcon(type === 'map' ? 'view-map' : 'view-grid'));
    const text = createElement('span', 'loom-view-type-option-label');
    text.textContent = label;
    option.append(text);
    option.setAttribute('aria-label', label);
    option.addEventListener('click', action);
    return option;
  }

  #renderDeleteConfirm(view: View): HTMLElement {
    const box = createElement('div', 'loom-view-panel-confirm');
    box.setAttribute('role', 'alertdialog');
    labelContainer(box, this.#translate('common.confirmationTitle'));
    box.append(
      createTextElement(
        'p',
        this.#translate('view.manage.deleteConfirm').replace('{name}', view.name),
      ),
    );
    if (this.#panelFormError !== null) {
      const error = createTextElement('p', this.#panelFormError);
      error.classList.add('loom-view-panel-error');
      error.setAttribute('role', 'alert');
      box.append(error);
    }
    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = 'loom-button loom-button-danger';
    confirm.dataset.action = 'delete-confirm';
    confirm.dataset.shellFocus = `delete-confirm:${view.id}`;
    confirm.textContent = this.#translate('view.manage.delete');
    confirm.addEventListener('click', () => void this.#runViewAction('delete', view.id));
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'loom-button';
    cancel.dataset.action = 'delete-cancel';
    cancel.dataset.shellFocus = `delete-cancel:${view.id}`;
    cancel.textContent = this.#translate('common.cancel');
    cancel.addEventListener('click', () => {
      this.#confirmDeleteId = null;
      this.#panelFormError = null;
      this.#restoreFocusKey = `view-more:${view.id}`;
      this.#rerender();
    });
    box.append(confirm, cancel);
    return box;
  }

  #renderViewIssue(viewId: string, state: TableShellState): HTMLElement | null {
    const issue = state.viewWriteIssues[viewId];
    if (issue === undefined) return null;
    const box = createElement('div', 'loom-view-issue');
    box.setAttribute('role', 'status');
    const key =
      issue.kind === 'conflict'
        ? 'view.manage.issue.conflict'
        : issue.kind === 'unresolved'
          ? 'view.manage.issue.unresolved'
          : 'view.manage.issue.error';
    box.append(createTextElement('p', this.#translate(key).replace('{message}', issue.message)));
    const resolve = this.#callbacks.onResolveViewIssue;
    if (resolve !== undefined) {
      const actions =
        issue.kind === 'conflict'
          ? (['adopt-latest', 're-edit'] as const)
          : issue.kind === 'unresolved'
            ? (['retry', 'dismiss'] as const)
            : (['dismiss'] as const);
      for (const action of actions) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'loom-button';
        button.dataset.action =
          action === 'adopt-latest'
            ? 'issue-adopt'
            : action === 're-edit'
              ? 'issue-reedit'
              : action === 'retry'
                ? 'issue-retry'
                : 'issue-dismiss';
        button.dataset.shellFocus = `issue-${action}:${viewId}`;
        button.textContent = this.#translate(
          action === 'adopt-latest'
            ? 'view.manage.issue.adopt'
            : action === 're-edit'
              ? 'view.manage.issue.reedit'
              : action === 'retry'
                ? 'view.manage.issue.retry'
                : 'view.manage.issue.dismiss',
        );
        button.addEventListener('click', () => void resolve(viewId, action));
        box.append(button);
      }
    }
    return box;
  }

  #renderRepairForm(
    view: View,
    state: TableShellState,
    issues: { queryFieldIds: readonly string[]; presentationFieldIds: readonly string[] },
  ): HTMLElement {
    const form = document.createElement('form');
    form.dataset.panelForm = 'repair';
    form.className = 'loom-view-panel-form';
    labelContainer(form, this.#translate('view.manage.repair.title'));
    form.append(createTextElement('h5', this.#translate('view.manage.repair.title')));

    const fieldNames = new Map(state.fields.map((field) => [field.id, field.name]));
    const usages = repairUsages(view);
    for (const fieldId of issues.queryFieldIds) {
      if (view.type === 'map' && fieldId === view.config.locationFieldId) continue;
      const item = createElement('label', 'loom-view-repair-ref');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.name = 'repair-remove';
      checkbox.value = fieldId;
      checkbox.checked = this.#repairRemovals.has(fieldId);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) this.#repairRemovals.add(fieldId);
        else this.#repairRemovals.delete(fieldId);
      });
      const usage = usages.get(fieldId)?.join(', ') ?? '';
      item.append(
        checkbox,
        document.createTextNode(
          `${fieldNames.get(fieldId) ?? fieldId}${usage === '' ? '' : ` · ${usage}`} — ${this.#translate('view.manage.repair.remove')}`,
        ),
      );
      form.append(item);
    }

    if (view.type === 'map' && issues.queryFieldIds.includes(view.config.locationFieldId)) {
      const locationLabel = createElement('label', 'loom-view-repair-ref');
      locationLabel.append(document.createTextNode(this.#translate('view.manage.repair.location')));
      const select = document.createElement('select');
      select.name = 'repair-location';
      for (const field of state.fields) {
        if (field.deletedAt !== undefined || field.type !== 'location') continue;
        const option = document.createElement('option');
        option.value = field.id;
        option.textContent = field.name;
        option.selected = this.#repairLocation === field.id;
        select.append(option);
      }
      select.addEventListener('change', () => {
        this.#repairLocation = select.value;
      });
      locationLabel.append(select);
      form.append(locationLabel);
    }

    if (issues.presentationFieldIds.length > 0) {
      form.append(createTextElement('p', this.#translate('view.manage.repair.presentationHint')));
    }

    if (this.#panelFormError !== null) {
      const error = createTextElement('p', this.#panelFormError);
      error.classList.add('loom-view-panel-error');
      error.setAttribute('role', 'alert');
      form.append(error);
    }

    const actions = createElement('div', 'loom-view-create-actions');
    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = 'loom-button';
    submit.textContent = this.#translate('view.manage.repair.submit');
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'loom-button';
    cancel.dataset.action = 'cancel';
    cancel.textContent = this.#translate('common.cancel');
    cancel.addEventListener('click', () => {
      this.#repairViewId = null;
      this.#panelFormError = null;
      this.#rerender();
    });
    actions.append(submit, cancel);
    form.append(actions);

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const onRepairView = this.#callbacks.onRepairView;
      if (onRepairView === undefined) return;
      const input: ViewConfigRepairInput = {
        removeFieldIds: [...this.#repairRemovals],
      };
      if (
        view.type === 'map' &&
        issues.queryFieldIds.includes(view.config.locationFieldId) &&
        this.#repairLocation !== ''
      ) {
        (input as { locationFieldId?: string }).locationFieldId = this.#repairLocation;
      }
      void onRepairView(view.id, input)
        .then((outcome) => this.#handlePanelOutcome(view.id, outcome))
        .catch(() => {
          this.#panelFormError = this.#translate('view.manage.formError');
          this.#rerender();
        });
    });
    return form;
  }

  #runViewAction(kind: 'delete' | 'default', viewId: string): Promise<void> {
    const callback =
      kind === 'delete' ? this.#callbacks.onDeleteView : this.#callbacks.onSetDefaultView;
    if (callback === undefined) return Promise.resolve();
    return callback(viewId)
      .then((outcome) => this.#handlePanelOutcome(viewId, outcome, kind))
      .catch(() => {
        this.#panelFormError = this.#translate('view.manage.formError');
        this.#rerender();
      });
  }

  #handlePanelOutcome(
    viewId: string,
    outcome: ViewWriteOutcome | ViewCopyOutcome,
    kind?: 'delete' | 'default',
  ): void {
    if (outcome.status === 'failed' || outcome.status === 'repair-required') {
      this.#panelFormError = this.#translate(
        outcome.status === 'repair-required'
          ? 'view.manage.repairRequired'
          : 'view.manage.formError',
      );
      this.#rerender();
      return;
    }
    if (this.#inlineEdit?.viewId === viewId) this.#inlineEdit = null;
    if (this.#confirmDeleteId === viewId) this.#confirmDeleteId = null;
    if (this.#repairViewId === viewId) this.#repairViewId = null;
    this.#panelFormError = null;
    this.#restoreFocusKey = kind === 'delete' ? 'view-list' : `view-more:${viewId}`;
    this.#rerender();
  }

  restoreFocus(): boolean {
    this.#positionViewPanel();
    if (this.#restoreFocusKey === null || this.#lastRoot === null) return false;
    const key = this.#restoreFocusKey;
    this.#restoreFocusKey = null;
    const target = this.#lastRoot.querySelector<HTMLElement>(`[data-shell-focus="${key}"]`);
    if (target === null) return false;
    target.focus();
    return true;
  }

  /**
   * Anchors the All Views popover to its trigger (bottom + 4px), clamped to the
   * owning pane (.view-content) and flipped above the trigger when the space
   * below is too small. Runs after every mount/rerender; rects are only
   * measurable once the root is connected.
   */
  #positionViewPanel(): void {
    const root = this.#lastRoot;
    if (root === null || !root.isConnected || !this.#viewListOpen) return;
    const panel = root.querySelector<HTMLElement>('.loom-view-panel');
    const toggle = root.querySelector<HTMLElement>('.loom-view-list-toggle');
    if (panel === null || toggle === null) return;
    const shellRect = root.getBoundingClientRect();
    const triggerRect = toggle.getBoundingClientRect();
    const pane = root.closest('.view-content');
    const bounds = pane?.getBoundingClientRect() ?? {
      top: 0,
      left: 0,
      right: root.ownerDocument.documentElement.clientWidth,
      bottom: root.ownerDocument.documentElement.clientHeight,
    };
    const margin = 4;
    const minLeft = bounds.left - shellRect.left + margin;
    const maxLeft = bounds.right - shellRect.left - panel.offsetWidth - margin;
    const left = Math.min(
      Math.max(triggerRect.left - shellRect.left, minLeft),
      Math.max(maxLeft, minLeft),
    );
    const spaceBelow = bounds.bottom - margin - (triggerRect.bottom + margin);
    const spaceAbove = triggerRect.top - margin - bounds.top - margin;
    const flipped = panel.offsetHeight > spaceBelow && spaceAbove > spaceBelow;
    const maxHeight = Math.max(flipped ? spaceAbove : spaceBelow, 96);
    const top = flipped
      ? triggerRect.top - shellRect.top - Math.min(panel.offsetHeight, maxHeight) - margin
      : triggerRect.bottom - shellRect.top + margin;
    panel.style.insetInlineStart = `${left}px`;
    panel.style.top = `${top}px`;
    panel.style.maxHeight = `${maxHeight}px`;
  }

  #captureFocus(): void {
    const active = document.activeElement;
    if (
      this.#lastRoot === null ||
      !(active instanceof HTMLElement) ||
      !this.#lastRoot.contains(active)
    ) {
      this.#restoreFocusKey = null;
      return;
    }
    this.#restoreFocusKey = active.dataset.shellFocus ?? null;
  }

  #rerender(): void {
    const previous = this.#lastRoot;
    if (previous === null || this.#lastState === null) return;
    const next = this.render(this.#lastState);
    if (previous.isConnected) previous.replaceWith(next);
    this.restoreFocus();
  }

  #renderSelect<T extends { id: string; name: string }>(
    labelKey: 'grid.workspace' | 'grid.base' | 'grid.table',
    resources: readonly T[],
    selectedId: string | null,
    onChange: (value: string) => void,
    options?: { readonly muted?: boolean; readonly icon?: UiIconName },
  ): HTMLElement {
    const label = createElement('label', 'loom-grid-select');
    if (options?.muted === true) label.classList.add('loom-grid-select-muted');
    const labelText = createTextElement('span', this.#translate(labelKey));
    labelText.classList.add('loom-grid-select-label');
    label.append(labelText);
    if (options?.icon !== undefined) {
      const icon = createUiIcon(options.icon);
      icon.classList.add('loom-grid-select-icon');
      label.append(icon);
    }
    const field = createElement('span', 'loom-grid-select-field');
    const select = document.createElement('select');
    select.setAttribute('aria-label', this.#translate(labelKey));
    select.dataset.shellFocus = `select:${labelKey}`;
    for (const resource of resources) {
      const option = document.createElement('option');
      option.value = resource.id;
      option.textContent = resource.name;
      option.selected = resource.id === selectedId;
      select.append(option);
    }
    select.disabled = resources.length === 0;
    select.addEventListener('change', () => onChange(select.value));
    const caret = createUiIcon('caret-down');
    caret.classList.add('loom-grid-select-caret');
    caret.setAttribute('aria-hidden', 'true');
    field.append(select, caret);
    label.append(field);
    return label;
  }

  #renderTabs(state: TableShellState): HTMLElement {
    const tablist = createElement('div', 'loom-view-tabs');
    tablist.setAttribute('role', 'tablist');
    labelContainer(tablist, this.#translate('view.tabs'));
    const active = state.views.filter((view) => view.deletedAt === undefined);
    const duplicateNames = new Set(
      active.map((view) => view.name).filter((name, index, names) => names.indexOf(name) !== index),
    );
    for (const view of active) {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'loom-view-tab';
      tab.setAttribute('role', 'tab');
      tab.dataset.viewId = view.id;
      tab.dataset.shellFocus = `tab:${view.id}`;
      const selected = view.id === state.selectedViewId;
      tab.setAttribute('aria-selected', selected ? 'true' : 'false');
      tab.setAttribute('aria-controls', this.panelId);
      tab.tabIndex = selected ? 0 : -1;
      tab.append(createUiIcon(view.type === 'map' ? 'view-map' : 'view-grid'));
      tab.append(
        createTextElement(
          'span',
          view.name +
            (duplicateNames.has(view.name) ? ` · ${viewTypeLabel(view, this.#translate)}` : ''),
        ),
      );
      tab.addEventListener('click', () => void this.#callbacks.onViewChange(view.id));
      tab.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        this.#openTabContextMenu(view, event.clientX, event.clientY, tablist, tab);
      });
      tablist.append(tab);
    }
    tablist.addEventListener('keydown', (event) => {
      const allTabs = [...tablist.querySelectorAll<HTMLElement>('[role="tab"]')].filter(
        (tab) => !tab.hidden,
      );
      const current = allTabs.indexOf(document.activeElement as HTMLElement);
      if (current < 0 || allTabs.length === 0) return;
      let next = -1;
      if (event.key === 'ArrowRight') next = (current + 1) % allTabs.length;
      else if (event.key === 'ArrowLeft') next = (current - 1 + allTabs.length) % allTabs.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = allTabs.length - 1;
      if (next < 0) return;
      event.preventDefault();
      allTabs.forEach((tab, index) => {
        tab.tabIndex = index === next ? 0 : -1;
      });
      allTabs[next]?.focus();
    });
    // The selected tab must stay discoverable inside the scrollable strip.
    const selectedTab = tablist.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    if (selectedTab !== null && typeof selectedTab.scrollIntoView === 'function') {
      window.setTimeout(() => {
        if (selectedTab.isConnected) {
          selectedTab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }
      }, 0);
    }
    return tablist;
  }

  #openTabContextMenu(
    view: View,
    x: number,
    y: number,
    host: HTMLElement,
    trigger: HTMLElement,
  ): void {
    const items: ContextMenuItem[] = [
      {
        label: this.#translate('view.manage.rename'),
        icon: 'menu-edit',
        disabled: this.#callbacks.onRenameView === undefined,
        action: () => this.#openViewPanelFor(view, 'rename'),
      },
      {
        label: this.#translate('view.manage.copy'),
        icon: 'menu-duplicate',
        disabled: this.#callbacks.onCopyView === undefined,
        action: () => this.#openViewPanelFor(view, 'copy'),
      },
      {
        label: this.#translate('view.manage.setDefault'),
        icon: 'view-default',
        disabled: view.isDefault || this.#callbacks.onSetDefaultView === undefined,
        action: () => void this.#runViewAction('default', view.id),
      },
      {
        label: this.#translate('view.manage.delete'),
        icon: 'menu-delete',
        danger: true,
        disabled: this.#callbacks.onDeleteView === undefined,
        action: () => this.#openViewPanelFor(view, 'delete'),
      },
    ];
    openContextMenu({ items, x, y, host, trigger, label: view.name });
  }

  #openViewPanelFor(view: View, action: 'rename' | 'copy' | 'delete'): void {
    this.#viewListOpen = true;
    this.#panelTableId = view.tableId;
    this.#createPickerOpen = false;
    this.#createFieldPick = false;
    this.#confirmDeleteId = action === 'delete' ? view.id : null;
    this.#repairViewId = null;
    this.#panelFormError = null;
    if (action === 'delete') {
      this.#inlineEdit = null;
      this.#rerender();
      this.#lastRoot
        ?.querySelector<HTMLElement>(`[data-shell-focus="delete-confirm:${view.id}"]`)
        ?.focus();
      return;
    }
    const active = (this.#lastState?.views ?? []).filter((item) => item.deletedAt === undefined);
    const names = new Set(active.map((item) => item.name));
    const value = action === 'rename' ? view.name : nextAvailableViewName(view.name, names);
    this.#inlineEdit = { viewId: view.id, mode: action, value, error: null, pending: false };
    this.#rerender();
    const input = this.#lastRoot?.querySelector<HTMLInputElement>(
      '[data-shell-focus="inline-edit"]',
    );
    input?.focus();
    input?.select();
  }

  #renderViewListToggle(state: TableShellState): HTMLElement {
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'loom-button loom-shell-action loom-view-list-toggle';
    toggle.dataset.action = 'view-list';
    toggle.dataset.shellFocus = 'view-list';
    toggle.setAttribute('aria-label', this.#translate('view.list'));
    toggle.setAttribute('aria-haspopup', 'true');
    toggle.setAttribute('aria-expanded', this.#viewListOpen ? 'true' : 'false');
    toggle.append(createUiIcon('view-list'));
    const label = createElement('span', 'loom-button-label');
    label.textContent = this.#translate('view.list');
    toggle.append(label);
    toggle.addEventListener('click', () => this.#toggleViewPanel(state));
    return toggle;
  }

  #renderIntents(state: TableShellState): HTMLElement | null {
    if (state.pendingViewIntents.length === 0) return null;
    const box = createElement('div', 'loom-view-intents');
    box.setAttribute('role', 'region');
    labelContainer(box, this.#translate('view.tabs'));
    for (const intent of state.pendingViewIntents) {
      const item = createElement('div', 'loom-view-intent');
      item.append(
        createTextElement(
          'p',
          this.#translate('view.unresolved').replace('{name}', intent.request.name),
        ),
      );
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'loom-button';
      retry.dataset.action = 'retry-intent';
      retry.textContent = this.#translate('view.unresolvedRetry');
      retry.addEventListener('click', () => {
        if (retry.disabled) return;
        retry.disabled = true;
        retry.setAttribute('aria-busy', 'true');
        retry.textContent = this.#translate('view.unresolvedRetrying');
        void Promise.resolve(this.#callbacks.onRetryViewIntent?.(intent.intentId))
          .catch(() => undefined)
          .finally(() => {
            retry.disabled = false;
            retry.removeAttribute('aria-busy');
            retry.textContent = this.#translate('view.unresolvedRetry');
          });
      });
      const dismiss = document.createElement('button');
      dismiss.type = 'button';
      dismiss.className = 'loom-button';
      dismiss.dataset.action = 'dismiss-intent';
      dismiss.textContent = this.#translate('view.unresolvedDismiss');
      dismiss.addEventListener(
        'click',
        () => void this.#callbacks.onDismissViewIntent?.(intent.intentId),
      );
      item.append(retry, dismiss);
      box.append(item);
    }
    return box;
  }
}

function contextSeparator(): HTMLElement {
  const separator = createElement('span', 'loom-shell-context-sep');
  separator.textContent = '/';
  separator.setAttribute('aria-hidden', 'true');
  return separator;
}

function viewTypeLabel(view: View, translate: Translator): string {
  return translate(view.type === 'grid' ? 'view.type.grid' : 'view.type.map');
}

function nextAvailableViewName(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  let index = 2;
  while (taken.has(`${base} ${index}`)) index += 1;
  return `${base} ${index}`;
}

function repairUsages(view: View): Map<string, string[]> {
  const usages = new Map<string, string[]>();
  const add = (fieldId: string, usage: string): void => {
    const list = usages.get(fieldId) ?? [];
    if (!list.includes(usage)) list.push(usage);
    usages.set(fieldId, list);
  };
  const scanFilter = (node: FilterNode | undefined): void => {
    if (node === undefined) return;
    if (node.kind === 'rule') {
      add(node.fieldId, 'Filter');
      return;
    }
    for (const child of node.children) scanFilter(child);
  };
  if (view.type === 'grid') {
    for (const fieldId of view.config.projection) add(fieldId, 'Projection');
    for (const sort of view.config.sort) add(sort.fieldId, 'Sort');
    scanFilter(view.config.filter);
    for (const fieldId of view.config.columnOrder) add(fieldId, 'Order');
    for (const fieldId of Object.keys(view.config.columnWidths)) add(fieldId, 'Width');
    for (const fieldId of view.config.frozenFieldIds) add(fieldId, 'Frozen');
  } else {
    add(view.config.locationFieldId, 'Location');
    scanFilter(view.config.filter);
  }
  return usages;
}

function createElement<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tagName);
  element.className = className;
  return element;
}

function createTextElement<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  text: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tagName);
  element.textContent = text;
  return element;
}
