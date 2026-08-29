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
    confirm.className = 'loom-button mod-warning';
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
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
      resolve(value);
    };
    cancel.addEventListener('click', () => finish(false));
    confirm.addEventListener('click', () => finish(true));
    dialog.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      finish(false);
    });
    cancel.focus();
  });
}

function nextConfirmationId(): string {
  confirmationId += 1;
  return 'loom-dangerous-confirmation-' + String(confirmationId);
}
