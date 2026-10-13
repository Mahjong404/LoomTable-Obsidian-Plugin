import { createUiIcon, type UiIconName } from './icons';

export type LoomControlSize = 'compact' | 'default';
export type LoomButtonVariant = 'quiet' | 'neutral' | 'primary' | 'danger';

export interface LoomButtonState {
  readonly label: string;
  readonly accessibleLabel?: string;
  readonly size?: LoomControlSize;
  readonly variant?: LoomButtonVariant;
  readonly leadingIcon?: UiIconName | null;
  readonly trailingIcon?: UiIconName | null;
  readonly disabled?: boolean;
  readonly busy?: boolean;
}

export interface LoomButtonOptions extends LoomButtonState {
  readonly onActivate: () => void;
  /** Async consumers reserve the Loading slot before their first submission. */
  readonly reserveBusySpace?: boolean;
}

export interface LoomButtonHandle {
  readonly element: HTMLButtonElement;
  update(state: Partial<LoomButtonState>): void;
  dispose(): void;
}

/** Native activation only. The consumer owns promises, errors and business state. */
export function createLoomButton(options: LoomButtonOptions): LoomButtonHandle {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = 'loom-button loom-control';
  const leading = document.createElement('span');
  leading.className = 'loom-control-leading';
  const label = document.createElement('span');
  label.className = 'loom-button-label';
  const trailing = document.createElement('span');
  trailing.className = 'loom-control-trailing';
  const loading = document.createElement('span');
  loading.className = 'loom-control-loading';
  loading.setAttribute('aria-hidden', 'true');
  loading.append(createUiIcon('spinner'));
  element.append(leading, label, trailing, loading);
  let state: LoomButtonState = options;
  let disposed = false;
  const setIcon = (slot: HTMLElement, icon: UiIconName | null | undefined): void => {
    slot.replaceChildren();
    slot.hidden = icon == null;
    if (icon != null) slot.append(createUiIcon(icon));
  };
  const update = (patch: Partial<LoomButtonState>): void => {
    if (disposed) return;
    state = { ...state, ...patch };
    element.dataset.size = state.size ?? 'default';
    element.dataset.variant = state.variant ?? 'neutral';
    element.setAttribute('aria-label', state.accessibleLabel ?? state.label);
    element.setAttribute('aria-busy', String(state.busy === true));
    element.disabled = state.disabled === true || state.busy === true;
    label.textContent = state.label;
    setIcon(leading, state.leadingIcon);
    setIcon(trailing, state.trailingIcon);
    loading.hidden = options.reserveBusySpace !== true && state.busy !== true;
    loading.dataset.busy = String(state.busy === true);
  };
  const activate = (): void => {
    if (!disposed && !element.disabled) options.onActivate();
  };
  element.addEventListener('click', activate);
  update({});
  return {
    element,
    update,
    dispose() {
      if (disposed) return;
      disposed = true;
      element.removeEventListener('click', activate);
      element.remove();
    },
  };
}
