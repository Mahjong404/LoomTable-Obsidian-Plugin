import { createLoomButton, type LoomButtonHandle } from './loom-button';
import type { UiIconName } from './icons';

export interface ToolbarToggleState {
  readonly open: boolean;
  /** Count is validated by the domain consumer; Open never implies Active. */
  readonly count: number;
  readonly accessibleLabel: string;
  readonly disabled?: boolean;
}

export interface ToolbarToggleOptions extends ToolbarToggleState {
  readonly label: string;
  readonly icon?: UiIconName;
  readonly onActivate: () => void;
}

export interface ToolbarToggleHandle {
  readonly element: HTMLButtonElement;
  update(state: Partial<ToolbarToggleState>): void;
  dispose(): void;
}

export function createToolbarToggle(options: ToolbarToggleOptions): ToolbarToggleHandle {
  const control: LoomButtonHandle = createLoomButton({
    label: options.label,
    size: 'compact',
    variant: 'quiet',
    ...(options.icon === undefined ? {} : { leadingIcon: options.icon }),
    onActivate: options.onActivate,
  });
  const element = control.element;
  element.classList.add('loom-grid-query-toggle');
  const count = document.createElement('span');
  count.className = 'loom-grid-query-count';
  count.setAttribute('aria-hidden', 'true');
  element.insertBefore(count, element.querySelector('.loom-control-trailing'));
  let state: ToolbarToggleState = options;
  let disposed = false;
  const update = (patch: Partial<ToolbarToggleState>): void => {
    if (disposed) return;
    state = { ...state, ...patch };
    control.update({
      accessibleLabel: state.accessibleLabel,
      disabled: state.disabled === true,
      trailingIcon: state.open ? 'caret-down' : null,
    });
    element.setAttribute('aria-expanded', String(state.open));
    element.dataset.active = String(state.count > 0);
    count.hidden = state.count <= 0;
    count.textContent = state.count > 0 ? String(state.count) : '';
  };
  update({});
  return {
    element,
    update,
    dispose: () => {
      disposed = true;
      control.dispose();
    },
  };
}
