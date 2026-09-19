import type { Translator } from '../i18n';

export type ToastKind = 'info' | 'success' | 'error';

export interface ToastOptions {
  readonly kind: ToastKind;
  readonly text: string;
  readonly action?: {
    readonly label: string;
    readonly run: () => void;
  };
  readonly durationMs?: number;
}

const TOAST_DURATION_MS = 5000;
const TOAST_LIMIT = 3;

/**
 * Creates the toast stack element. The element is owned by the caller and may
 * be re-appended across re-renders; live toasts keep their dismiss timers.
 */
export function createToastStack(): HTMLElement {
  const stack = document.createElement('div');
  stack.className = 'loom-toast-stack';
  return stack;
}

/**
 * Pushes a lightweight transient toast onto `stack`. At most TOAST_LIMIT
 * toasts are kept, oldest removed. Returns a dismiss callback.
 */
export function pushToast(
  stack: HTMLElement,
  options: ToastOptions,
  translate: Translator,
): () => void {
  while (stack.childElementCount >= TOAST_LIMIT) {
    stack.firstElementChild?.remove();
  }

  const toast = document.createElement('div');
  toast.className = `loom-toast loom-toast--${options.kind}`;
  toast.setAttribute('role', options.kind === 'error' ? 'alert' : 'status');
  const text = document.createElement('span');
  text.className = 'loom-toast-text';
  text.textContent = options.text;
  toast.append(text);

  let dismissed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const dismiss = (): void => {
    if (dismissed) return;
    dismissed = true;
    if (timer !== null) clearTimeout(timer);
    toast.remove();
  };

  if (options.action !== undefined) {
    const action = options.action;
    const actionButton = document.createElement('button');
    actionButton.type = 'button';
    actionButton.className = 'loom-toast-action';
    actionButton.textContent = action.label;
    actionButton.addEventListener('click', () => {
      dismiss();
      action.run();
    });
    toast.append(actionButton);
  }
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'loom-toast-dismiss clickable-icon';
  close.setAttribute('aria-label', translate('toast.dismiss'));
  close.textContent = '×';
  close.addEventListener('click', () => dismiss());
  toast.append(close);

  stack.append(toast);
  timer = setTimeout(dismiss, options.durationMs ?? TOAST_DURATION_MS);
  return dismiss;
}
