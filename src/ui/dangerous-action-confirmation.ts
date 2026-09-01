import type { Translator } from '../i18n';

let confirmationId = 0;

export function confirmDangerousAction(
  host: HTMLElement,
  message: string,
  translate: Translator,
  trigger?: HTMLElement,
): Promise<boolean> {
  return new Promise((resolve) => {
    const previouslyFocused =
      trigger ??
      (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null);
    const dialog = document.createElement('div');
    dialog.className = 'loom-dangerous-confirmation';
    dialog.setAttribute('role', 'alertdialog');
    dialog.setAttribute('aria-modal', 'true');
    const id = nextConfirmationId();
    const title = document.createElement('h2');
    title.id = id + '-title';
    title.textContent = translate('common.confirmationTitle');
    const description = document.createElement('p');
    description.id = id + '-description';
    description.textContent = message;
    dialog.setAttribute('aria-labelledby', title.id);
    dialog.setAttribute('aria-describedby', description.id);

    const actions = document.createElement('div');
    actions.className = 'loom-dangerous-confirmation-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'loom-button';
    cancel.dataset.action = 'cancel';
    cancel.textContent = translate('common.cancel');
    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = 'loom-button loom-button-danger';
    confirm.dataset.variant = 'danger';
    confirm.dataset.action = 'confirm';
    confirm.textContent = translate('common.confirm');
    actions.append(cancel, confirm);
    dialog.append(title, description, actions);
    host.append(dialog);

    let settled = false;
    const finish = (value: boolean): void => {
      if (settled) return;
      settled = true;
      dialog.remove();
      if (previouslyFocused?.isConnected) {
        previouslyFocused.focus();
      } else if (host.isConnected) {
        if (!host.hasAttribute('tabindex')) host.setAttribute('tabindex', '-1');
        host.focus();
      }
      resolve(value);
    };
    cancel.addEventListener('click', () => finish(false));
    confirm.addEventListener('click', () => finish(true));
    dialog.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        finish(false);
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = getFocusableElements(dialog);
      if (focusable.length === 0) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      const active = document.activeElement;
      const currentIndex = active instanceof HTMLElement ? focusable.indexOf(active) : -1;
      const nextIndex = event.shiftKey
        ? currentIndex <= 0
          ? focusable.length - 1
          : currentIndex - 1
        : currentIndex === -1 || currentIndex === focusable.length - 1
          ? 0
          : currentIndex + 1;
      event.preventDefault();
      event.stopPropagation();
      focusable[nextIndex]?.focus();
    });
    cancel.focus();
  });
}

export async function runAfterDangerousConfirmation(
  confirm: () => Promise<boolean>,
  action: () => void | Promise<void>,
): Promise<boolean> {
  if (!(await confirm())) return false;
  await action();
  return true;
}

function getFocusableElements(dialog: HTMLElement): HTMLElement[] {
  return [
    ...dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ].filter(
    (element) => !element.hasAttribute('hidden') && element.getAttribute('aria-hidden') !== 'true',
  );
}

function nextConfirmationId(): string {
  confirmationId += 1;
  return 'loom-dangerous-confirmation-' + String(confirmationId);
}
