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
import { createUiIcon } from './icons';
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

export type DeletedViewsStatus = 'idle' | 'loading' | 'ready' | 'error';

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
  readonly deletedViews: readonly View[];
  readonly deletedViewsStatus: DeletedViewsStatus;
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
  readonly onManageViews?: () => void | Promise<void>;
  readonly onCloseManageViews?: () => void;
  readonly onRenameView?: (viewId: string, name: string) => Promise<ViewWriteOutcome>;
  readonly onCopyView?: (viewId: string, name: string) => Promise<ViewCopyOutcome>;
  readonly onDeleteView?: (viewId: string) => Promise<ViewWriteOutcome>;
  readonly onRestoreView?: (viewId: string) => Promise<ViewWriteOutcome>;
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

export interface TableShellOptions {
  readonly className?: string;
}

interface CreateDraft {
  name: string;
  type: 'grid' | 'map';
  locationFieldId: string;
}

let shellSequence = 0;

export class TableShell {
  readonly panelId: string;
  readonly #translate: Translator;
  readonly #callbacks: TableShellCallbacks;
  readonly #className: string;
  #lastRoot: HTMLElement | null = null;
  #lastState: TableShellState | null = null;
  #restoreFocusKey: string | null = null;
  #createOpen = false;
  #createPending = false;
  #createError: string | null = null;
  #createDraft: CreateDraft = { name: '', type: 'grid', locationFieldId: '' };
  #manageOpen = false;
  #manageTableId: string | null = null;
  #manageEdit: { viewId: string; mode: 'rename' | 'copy' } | null = null;
  #confirmDeleteId: string | null = null;
  #repairViewId: string | null = null;
  #repairRemovals = new Set<string>();
  #repairLocation = '';
  #manageFormError: string | null = null;
  #tabObserver: ResizeObserver | null = null;
  #overlayDismiss: ((event: PointerEvent) => void) | null = null;
  #contextExpanded = false;

  constructor(
    translate: Translator,
    callbacks: TableShellCallbacks,
    options: TableShellOptions = {},
  ) {
    this.#translate = translate;
    this.#callbacks = callbacks;
    this.#className = options.className ?? 'loom-grid-navigation';
    this.panelId = `loom-view-panel-${++shellSequence}`;
  }

  openCreateForm(preset?: { type?: 'grid' | 'map'; locationFieldId?: string }): void {
    if (this.#callbacks.onCreateView === undefined) return;
    this.#createOpen = true;
    this.#createError = null;
    this.#createDraft = {
      name: this.#createDraft.name,
      type: preset?.type ?? 'grid',
      locationFieldId: preset?.locationFieldId ?? '',
    };
    this.#rerender();
    this.#lastRoot?.querySelector<HTMLElement>('[data-shell-focus="create-name"]')?.focus();
  }

  render(state: TableShellState): HTMLElement {
    this.#captureFocus();
    this.#lastState = state;
    const root = document.createElement('div');
    root.className = `loom-table-shell ${this.#className}`;
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
      ),
      this.#renderSelect(
        'grid.base',
        state.bases,
        state.selectedBaseId,
        (value) => void this.#callbacks.onBaseChange(value),
      ),
      this.#renderSelect(
        'grid.table',
        state.tables,
        state.selectedTableId,
        (value) => void this.#callbacks.onTableChange(value),
      ),
    );
    const actions = createElement('div', 'loom-shell-actions');
    if (this.#callbacks.onCreateView !== undefined) {
      const addView = document.createElement('button');
      addView.type = 'button';
      addView.className = 'loom-button loom-view-add';
      addView.dataset.shellFocus = 'add-view';
      addView.prepend(createUiIcon('view-add'));
      const addLabel = createElement('span', 'loom-button-label');
      addLabel.textContent = this.#translate('view.add');
      addView.append(addLabel);
      addView.setAttribute('aria-label', this.#translate('view.add'));
      addView.addEventListener('click', () => {
        this.#createOpen = true;
        this.#createError = null;
        this.#rerender();
      });
      actions.append(addView);
    }
    if (this.#callbacks.onManageViews !== undefined) {
      const manage = document.createElement('button');
      manage.type = 'button';
      manage.className = 'loom-button loom-view-manage-toggle';
      manage.dataset.action = 'manage-views';
      manage.dataset.shellFocus = 'manage-views';
      manage.prepend(createUiIcon('view-manage'));
      const manageLabel = createElement('span', 'loom-button-label');
      manageLabel.textContent = this.#translate('view.manage');
      manage.append(manageLabel);
      manage.setAttribute('aria-label', this.#translate('view.manage'));
      manage.setAttribute('aria-expanded', this.#manageOpen ? 'true' : 'false');
      manage.addEventListener('click', () => this.#toggleManage(state));
      actions.append(manage);
    }
    root.append(context, this.#renderTabs(state), actions);
    const intents = this.#renderIntents(state);
    if (intents !== null) root.append(intents);
    if (this.#createOpen && this.#callbacks.onCreateView !== undefined) {
      root.append(this.#renderCreateForm(state));
    }
    if (this.#manageOpen) {
      if (this.#manageTableId !== state.selectedTableId) {
        this.#manageTableId = state.selectedTableId;
        this.#resetManageForms();
        void this.#callbacks.onManageViews?.();
      }
      root.append(this.#renderManagePanel(state));
    }
    ensureButtonLabels(root);
    this.#lastRoot = root;
    this.#syncOverlayDismissal(root);
    root.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (!this.#createOpen && !this.#manageOpen) return;
      event.preventDefault();
      this.#createOpen = false;
      this.#manageOpen = false;
      this.#manageEdit = null;
      this.#rerender();
    });
    return root;
  }

  #syncOverlayDismissal(root: HTMLElement): void {
    const open = this.#createOpen || this.#manageOpen;
    if (!open) {
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
        el.closest('.loom-view-create-form, .loom-view-manage, .loom-shell-actions') !== null
      ) {
        return;
      }
      this.#createOpen = false;
      this.#manageOpen = false;
      this.#manageEdit = null;
      this.#rerender();
    };
    root.ownerDocument.addEventListener('pointerdown', onPointerDown, true);
    this.#overlayDismiss = onPointerDown;
  }

  #toggleManage(state: TableShellState): void {
    this.#manageOpen = !this.#manageOpen;
    if (this.#manageOpen) {
      this.#manageTableId = state.selectedTableId;
      this.#resetManageForms();
      void this.#callbacks.onManageViews?.();
    } else {
      this.#resetManageForms();
      this.#callbacks.onCloseManageViews?.();
    }
    this.#rerender();
  }

  #resetManageForms(): void {
    this.#manageEdit = null;
    this.#confirmDeleteId = null;
    this.#repairViewId = null;
    this.#repairRemovals = new Set();
    this.#repairLocation = '';
    this.#manageFormError = null;
  }

  #renderManagePanel(state: TableShellState): HTMLElement {
    const panel = createElement('section', 'loom-view-manage');
    panel.setAttribute('role', 'region');
    labelContainer(panel, this.#translate('view.manage'));

    const header = createElement('div', 'loom-view-manage-header');
    header.append(createTextElement('h3', this.#translate('view.manage')));
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'loom-button';
    close.dataset.action = 'manage-close';
    close.dataset.shellFocus = 'manage-close';
    close.textContent = this.#translate('view.manage.close');
    close.setAttribute('aria-label', this.#translate('view.manage.close'));
    close.addEventListener('click', () => this.#toggleManage(state));
    header.append(close);
    panel.append(header);

    const activeSection = createElement('div', 'loom-view-manage-active');
    activeSection.append(createTextElement('h4', this.#translate('view.manage.active')));
    const list = createElement('ul', 'loom-view-manage-list');
    const active = state.views.filter((view) => view.deletedAt === undefined);
    for (const view of active) {
      list.append(this.#renderManageRow(view, state));
    }
    activeSection.append(list);
    panel.append(activeSection);

    const deletedSection = createElement('div', 'loom-view-manage-deleted');
    deletedSection.append(createTextElement('h4', this.#translate('view.manage.deleted')));
    if (state.deletedViewsStatus === 'loading' || state.deletedViewsStatus === 'idle') {
      deletedSection.append(createTextElement('p', this.#translate('view.manage.deletedLoading')));
    } else if (state.deletedViewsStatus === 'error') {
      deletedSection.append(createTextElement('p', this.#translate('view.manage.deletedError')));
    } else if (state.deletedViews.length === 0) {
      deletedSection.append(createTextElement('p', this.#translate('view.manage.deletedEmpty')));
    } else {
      const deletedList = createElement('ul', 'loom-view-manage-list');
      for (const view of state.deletedViews) {
        const row = createElement('li', 'loom-view-manage-row');
        row.dataset.viewId = view.id;
        const pending = state.viewWritePending.includes(view.id);
        row.setAttribute('aria-busy', pending ? 'true' : 'false');
        row.append(
          createTextElement('span', `${view.name} · ${viewTypeLabel(view, this.#translate)}`),
        );
        const restore = document.createElement('button');
        restore.type = 'button';
        restore.className = 'loom-button';
        restore.dataset.action = 'restore';
        restore.dataset.shellFocus = `restore:${view.id}`;
        restore.textContent = this.#translate('view.manage.restore');
        restore.disabled = pending || this.#callbacks.onRestoreView === undefined;
        restore.addEventListener('click', () => void this.#runViewWrite('restore', view.id));
        row.append(restore);
        const deletedIssue = this.#renderViewIssue(view.id, state);
        if (deletedIssue !== null) row.append(deletedIssue);
        deletedList.append(row);
      }
      deletedSection.append(deletedList);
    }
    panel.append(deletedSection);
    return panel;
  }

  #renderManageRow(view: View, state: TableShellState): HTMLElement {
    const row = createElement('li', 'loom-view-manage-row');
    row.dataset.viewId = view.id;
    const pending = state.viewWritePending.includes(view.id);
    row.setAttribute('aria-busy', pending ? 'true' : 'false');

    const name = createTextElement(
      'span',
      `${view.name} · ${viewTypeLabel(view, this.#translate)}`,
    );
    name.classList.add('loom-view-manage-name');
    row.append(name);

    const issues = findBrokenViewFieldIds(view, state.fields);
    const broken = issues.queryFieldIds.length + issues.presentationFieldIds.length > 0;
    if (broken) {
      const badge = createTextElement('span', this.#translate('view.manage.broken'));
      badge.classList.add('loom-view-broken');
      row.append(badge);
    }

    const actions = createElement('div', 'loom-view-manage-actions');
    const addAction = (action: string, labelKey: MessageKey, onClick: () => void): void => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'loom-button';
      button.dataset.action = action;
      button.dataset.shellFocus = `${action}:${view.id}`;
      button.textContent = this.#translate(labelKey);
      button.disabled = pending;
      button.addEventListener('click', onClick);
      actions.append(button);
    };
    addAction('rename', 'view.manage.rename', () => {
      this.#manageEdit = { viewId: view.id, mode: 'rename' };
      this.#confirmDeleteId = null;
      this.#repairViewId = null;
      this.#manageFormError = null;
      this.#rerender();
    });
    addAction('copy', 'view.manage.copy', () => {
      this.#manageEdit = { viewId: view.id, mode: 'copy' };
      this.#confirmDeleteId = null;
      this.#repairViewId = null;
      this.#manageFormError = null;
      this.#rerender();
    });
    if (broken) {
      addAction('repair', 'view.manage.repair', () => {
        this.#repairViewId = view.id;
        this.#repairRemovals = new Set();
        this.#repairLocation = '';
        this.#manageEdit = null;
        this.#confirmDeleteId = null;
        this.#manageFormError = null;
        this.#rerender();
      });
    }
    addAction('delete', 'view.manage.delete', () => {
      this.#confirmDeleteId = view.id;
      this.#manageEdit = null;
      this.#repairViewId = null;
      this.#manageFormError = null;
      this.#rerender();
    });
    row.append(actions);

    if (this.#manageEdit?.viewId === view.id) {
      row.append(this.#renderEditForm(view, this.#manageEdit.mode));
    }
    if (this.#confirmDeleteId === view.id) {
      row.append(this.#renderDeleteConfirm(view));
    }
    const issueElement = this.#renderViewIssue(view.id, state);
    if (issueElement !== null) row.append(issueElement);
    if (this.#repairViewId === view.id) {
      row.append(this.#renderRepairForm(view, state, issues));
    }
    return row;
  }

  #renderEditForm(view: View, mode: 'rename' | 'copy'): HTMLElement {
    const form = document.createElement('form');
    form.dataset.manageForm = mode;
    form.className = 'loom-view-manage-form';
    const label = createElement('label', 'loom-view-create-field');
    label.append(document.createTextNode(this.#translate('view.create.name')));
    const input = document.createElement('input');
    input.name = 'view-name';
    input.type = 'text';
    input.required = true;
    input.value = view.name;
    input.dataset.shellFocus = `${mode}-name`;
    label.append(input);
    form.append(label);

    if (this.#manageFormError !== null) {
      const error = createTextElement('p', this.#manageFormError);
      error.classList.add('loom-view-manage-error');
      error.setAttribute('role', 'alert');
      form.append(error);
    }

    const actions = createElement('div', 'loom-view-create-actions');
    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = 'loom-button';
    submit.textContent = this.#translate(
      mode === 'rename' ? 'view.manage.rename' : 'view.manage.copy',
    );
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'loom-button';
    cancel.dataset.action = 'cancel';
    cancel.textContent = this.#translate('common.cancel');
    cancel.addEventListener('click', () => {
      this.#manageEdit = null;
      this.#manageFormError = null;
      this.#rerender();
    });
    actions.append(submit, cancel);
    form.append(actions);

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const normalized = normalizeResourceName(input.value);
      if (!normalized.ok) {
        this.#manageFormError = this.#translate(
          normalized.reason === 'empty'
            ? 'view.create.nameRequired'
            : normalized.reason === 'control-character'
              ? 'view.create.nameControl'
              : 'view.create.nameTooLong',
        );
        this.#rerender();
        return;
      }
      const callback =
        mode === 'rename' ? this.#callbacks.onRenameView : this.#callbacks.onCopyView;
      if (callback === undefined) return;
      void callback(view.id, normalized.name)
        .then((outcome) => this.#handleManageOutcome(view.id, outcome))
        .catch(() => {
          this.#manageFormError = this.#translate('view.manage.formError');
          this.#rerender();
        });
    });
    return form;
  }

  #renderDeleteConfirm(view: View): HTMLElement {
    const box = createElement('div', 'loom-view-manage-confirm');
    box.setAttribute('role', 'alertdialog');
    labelContainer(box, this.#translate('common.confirmationTitle'));
    box.append(
      createTextElement(
        'p',
        this.#translate('view.manage.deleteConfirm').replace('{name}', view.name),
      ),
    );
    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = 'loom-button loom-button-danger';
    confirm.dataset.action = 'delete-confirm';
    confirm.dataset.shellFocus = `delete-confirm:${view.id}`;
    confirm.textContent = this.#translate('view.manage.delete');
    confirm.addEventListener('click', () => void this.#runViewWrite('delete', view.id));
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'loom-button';
    cancel.dataset.action = 'delete-cancel';
    cancel.textContent = this.#translate('common.cancel');
    cancel.addEventListener('click', () => {
      this.#confirmDeleteId = null;
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
    form.dataset.manageForm = 'repair';
    form.className = 'loom-view-manage-form';
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

    if (this.#manageFormError !== null) {
      const error = createTextElement('p', this.#manageFormError);
      error.classList.add('loom-view-manage-error');
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
      this.#manageFormError = null;
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
        .then((outcome) => this.#handleManageOutcome(view.id, outcome))
        .catch(() => {
          this.#manageFormError = this.#translate('view.manage.formError');
          this.#rerender();
        });
    });
    return form;
  }

  #runViewWrite(kind: 'delete' | 'restore' | 'default', viewId: string): Promise<void> {
    const callback =
      kind === 'delete'
        ? this.#callbacks.onDeleteView
        : kind === 'restore'
          ? this.#callbacks.onRestoreView
          : this.#callbacks.onSetDefaultView;
    if (callback === undefined) return Promise.resolve();
    return callback(viewId)
      .then((outcome) => this.#handleManageOutcome(viewId, outcome))
      .catch(() => {
        this.#manageFormError = this.#translate('view.manage.formError');
        this.#rerender();
      });
  }

  #handleManageOutcome(viewId: string, outcome: ViewWriteOutcome | ViewCopyOutcome): void {
    if (outcome.status === 'failed' || outcome.status === 'repair-required') {
      this.#manageFormError = this.#translate(
        outcome.status === 'repair-required'
          ? 'view.manage.repairRequired'
          : 'view.manage.formError',
      );
      this.#rerender();
      return;
    }
    if (this.#manageEdit?.viewId === viewId) this.#manageEdit = null;
    if (this.#confirmDeleteId === viewId) this.#confirmDeleteId = null;
    if (this.#repairViewId === viewId) this.#repairViewId = null;
    this.#manageFormError = null;
    this.#rerender();
  }

  restoreFocus(): boolean {
    if (this.#restoreFocusKey === null || this.#lastRoot === null) return false;
    const key = this.#restoreFocusKey;
    this.#restoreFocusKey = null;
    const target = this.#lastRoot.querySelector<HTMLElement>(`[data-shell-focus="${key}"]`);
    if (target === null) return false;
    target.focus();
    return true;
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
  ): HTMLElement {
    const label = createElement('label', 'loom-grid-select');
    label.append(document.createTextNode(this.#translate(labelKey)));
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
    label.append(select);
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
        this.#openTabContextMenu(view, event.clientX, event.clientY, tablist);
      });
      tablist.append(tab);
    }
    const overflowButton = document.createElement('button');
    overflowButton.type = 'button';
    overflowButton.className = 'loom-view-tab-overflow clickable-icon';
    overflowButton.hidden = true;
    overflowButton.setAttribute('aria-label', this.#translate('view.overflow.label'));
    overflowButton.setAttribute('aria-haspopup', 'menu');
    overflowButton.addEventListener('click', () => {
      this.#openTabOverflowMenu(tablist, overflowButton, state, duplicateNames);
    });
    tablist.append(overflowButton);
    this.#tabObserver?.disconnect();
    if (typeof ResizeObserver === 'function') {
      this.#tabObserver = new ResizeObserver(() => this.#syncTabOverflow(tablist));
      this.#tabObserver.observe(tablist);
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
    return tablist;
  }

  #openTabContextMenu(view: View, x: number, y: number, host: HTMLElement): void {
    const items: ContextMenuItem[] = [
      {
        label: this.#translate('view.manage.rename'),
        icon: 'menu-edit',
        disabled: this.#callbacks.onRenameView === undefined,
        action: () => this.#openManageFor(view, 'rename'),
      },
      {
        label: this.#translate('view.manage.copy'),
        icon: 'menu-copy',
        disabled: this.#callbacks.onCopyView === undefined,
        action: () => this.#openManageFor(view, 'copy'),
      },
      {
        label: this.#translate('view.manage.setDefault'),
        icon: 'view-default',
        disabled: view.isDefault || this.#callbacks.onSetDefaultView === undefined,
        action: () => void this.#runViewWrite('default', view.id),
      },
      {
        label: this.#translate('view.manage.delete'),
        icon: 'menu-delete',
        danger: true,
        disabled: this.#callbacks.onDeleteView === undefined,
        action: () => this.#openManageFor(view, 'delete'),
      },
    ];
    openContextMenu({ items, x, y, host, label: view.name });
  }

  #openManageFor(view: View, edit: 'rename' | 'copy' | 'delete'): void {
    this.#manageOpen = true;
    this.#manageTableId = view.tableId;
    this.#createOpen = false;
    this.#manageEdit = edit === 'delete' ? null : { viewId: view.id, mode: edit };
    this.#confirmDeleteId = edit === 'delete' ? view.id : null;
    this.#repairViewId = null;
    this.#manageFormError = null;
    this.#rerender();
  }

  #syncTabOverflow(tablist: HTMLElement): void {
    const overflowButton = tablist.querySelector<HTMLElement>('.loom-view-tab-overflow');
    if (overflowButton === null) return;
    const tabs = [...tablist.querySelectorAll<HTMLElement>('[role="tab"]')];
    for (const tab of tabs) tab.hidden = false;
    overflowButton.hidden = true;
    const available = tablist.clientWidth;
    if (available <= 0) return;
    const gap = Number.parseFloat(getComputedStyle(tablist).columnGap) || 0;
    const reserve = (overflowButton.offsetWidth || 44) + gap;
    let used = 0;
    const overflowed: HTMLElement[] = [];
    for (const tab of tabs) {
      const selected = tab.getAttribute('aria-selected') === 'true';
      const fits = used + tab.offsetWidth <= available - reserve;
      if (fits || selected) {
        used += tab.offsetWidth + gap;
      } else {
        tab.hidden = true;
        tab.tabIndex = -1;
        overflowed.push(tab);
      }
    }
    if (overflowed.length === 0) return;
    overflowButton.hidden = false;
    overflowButton.textContent = `+${overflowed.length}`;
    overflowButton.dataset.overflowIds = overflowed
      .map((tab) => tab.dataset.viewId ?? '')
      .filter(Boolean)
      .join(',');
  }

  #openTabOverflowMenu(
    tablist: HTMLElement,
    anchor: HTMLElement,
    state: TableShellState,
    duplicateNames: ReadonlySet<string>,
  ): void {
    const ids = (anchor.dataset.overflowIds ?? '').split(',').filter((id) => id.length > 0);
    const views = state.views.filter(
      (view) => view.deletedAt === undefined && ids.includes(view.id),
    );
    if (views.length === 0) return;
    const host = tablist.closest<HTMLElement>('.loom-table-shell') ?? tablist;
    const rect = anchor.getBoundingClientRect();
    openContextMenu({
      items: views.map((view) => ({
        label:
          view.name +
          (duplicateNames.has(view.name) ? ` · ${viewTypeLabel(view, this.#translate)}` : ''),
        icon: view.type === 'map' ? 'view-map' : 'view-grid',
        action: () => void this.#callbacks.onViewChange(view.id),
      })),
      x: rect.left,
      y: rect.bottom + 4,
      host,
      label: this.#translate('view.overflow.label'),
    });
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

  #renderCreateForm(state: TableShellState): HTMLElement {
    const form = document.createElement('form');
    form.className = 'loom-view-create-form';
    labelContainer(form, this.#translate('view.create.title'));

    const nameLabel = createElement('label', 'loom-view-create-field');
    nameLabel.append(document.createTextNode(this.#translate('view.create.name')));
    const nameInput = document.createElement('input');
    nameInput.name = 'view-name';
    nameInput.type = 'text';
    nameInput.required = true;
    nameInput.value = this.#createDraft.name;
    nameInput.dataset.shellFocus = 'create-name';
    nameInput.addEventListener('input', () => {
      this.#createDraft.name = nameInput.value;
    });
    nameLabel.append(nameInput);

    const typeLabel = createElement('label', 'loom-view-create-field');
    typeLabel.append(document.createTextNode(this.#translate('view.create.type')));
    const typeSelect = document.createElement('select');
    typeSelect.name = 'view-type';
    typeSelect.dataset.shellFocus = 'create-type';
    for (const type of ['grid', 'map'] as const) {
      const option = document.createElement('option');
      option.value = type;
      option.textContent = this.#translate(type === 'grid' ? 'view.type.grid' : 'view.type.map');
      option.selected = this.#createDraft.type === type;
      typeSelect.append(option);
    }
    typeSelect.addEventListener('change', () => {
      this.#createDraft.type = typeSelect.value === 'map' ? 'map' : 'grid';
      this.#rerender();
    });
    typeLabel.append(typeSelect);
    form.append(nameLabel, typeLabel);

    const locationFields = state.fields.filter(
      (field) => field.type === 'location' && field.deletedAt === undefined,
    );
    if (this.#createDraft.type === 'map') {
      if (locationFields.length === 1 && this.#createDraft.locationFieldId === '') {
        this.#createDraft.locationFieldId = locationFields[0]?.id ?? '';
      }
      const fieldLabel = createElement('label', 'loom-view-create-field');
      fieldLabel.append(document.createTextNode(this.#translate('view.create.locationField')));
      const fieldSelect = document.createElement('select');
      fieldSelect.name = 'view-location-field';
      fieldSelect.dataset.shellFocus = 'create-field';
      for (const field of locationFields) {
        const option = document.createElement('option');
        option.value = field.id;
        option.textContent = field.name;
        option.selected = this.#createDraft.locationFieldId === field.id;
        fieldSelect.append(option);
      }
      fieldSelect.addEventListener('change', () => {
        this.#createDraft.locationFieldId = fieldSelect.value;
      });
      fieldLabel.append(fieldSelect);
      form.append(fieldLabel);
      if (locationFields.length === 0) {
        form.append(createTextElement('p', this.#translate('view.create.noLocationField')));
      }
    }

    if (this.#createError !== null) {
      const error = createElement('p', 'loom-view-create-error');
      error.setAttribute('role', 'alert');
      error.textContent = this.#createError;
      form.append(error);
    }

    const actions = createElement('div', 'loom-view-create-actions');
    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = 'loom-button';
    submit.textContent = this.#translate('view.create.submit');
    submit.disabled =
      this.#createPending || (this.#createDraft.type === 'map' && locationFields.length === 0);
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'loom-button';
    cancel.dataset.action = 'cancel';
    cancel.dataset.shellFocus = 'create-cancel';
    cancel.textContent = this.#translate('common.cancel');
    cancel.addEventListener('click', () => {
      this.#createOpen = false;
      this.#createPending = false;
      this.#createError = null;
      this.#rerender();
    });
    actions.append(submit, cancel);
    form.append(actions);

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (this.#createPending) return;
      const onCreateView = this.#callbacks.onCreateView;
      if (onCreateView === undefined) return;
      const name = normalizeResourceName(nameInput.value);
      if (!name.ok) {
        this.#createError = this.#translate(
          name.reason === 'empty'
            ? 'view.create.nameRequired'
            : name.reason === 'control-character'
              ? 'view.create.nameControl'
              : 'view.create.nameTooLong',
        );
        this.#rerender();
        return;
      }
      const input: ViewCreateInput = {
        type: this.#createDraft.type,
        name: name.name,
        ...(this.#createDraft.type === 'map'
          ? { locationFieldId: this.#createDraft.locationFieldId }
          : {}),
      };
      this.#createPending = true;
      submit.disabled = true;
      submit.setAttribute('aria-busy', 'true');
      submit.textContent = this.#translate('view.create.pending');
      void onCreateView(input)
        .then((outcome) => {
          this.#createPending = false;
          if (outcome.status === 'failed') {
            this.#createError = this.#translate('view.create.failed');
            this.#rerender();
            return;
          }
          this.#createOpen = false;
          this.#createError = null;
          this.#createDraft = { name: '', type: 'grid', locationFieldId: '' };
          this.#rerender();
        })
        .catch(() => {
          this.#createPending = false;
          this.#createError = this.#translate('view.create.failed');
          this.#rerender();
        });
    });
    return form;
  }
}

function viewTypeLabel(view: View, translate: Translator): string {
  return translate(view.type === 'grid' ? 'view.type.grid' : 'view.type.map');
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
