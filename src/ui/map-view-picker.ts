import type { View } from '../client/loomtable-client';
import { ensureButtonLabels } from './a11y';
import type { Translator } from '../i18n';

export type MapViewTargetChoice =
  | { readonly kind: 'open'; readonly viewId: string }
  | { readonly kind: 'create' }
  | { readonly kind: 'cancel' };

let pickerId = 0;

export function chooseMapViewTarget(
  host: HTMLElement,
  matches: readonly View[],
  translate: Translator,
  trigger?: HTMLElement,
): Promise<MapViewTargetChoice> {
  return new Promise((resolve) => {
    const previouslyFocused =
      trigger ??
      (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null);
    const dialog = document.createElement('div');
    dialog.className = 'loom-map-target-picker';
    dialog.setAttribute('role', 'alertdialog');
    dialog.setAttribute('aria-modal', 'true');
    const id = `loom-map-target-picker-${++pickerId}`;
    const title = document.createElement('h2');
    title.id = `${id}-title`;
    dialog.setAttribute('aria-labelledby', title.id);

    const actions = document.createElement('div');
    actions.className = 'loom-map-target-picker-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'loom-button';
    cancel.dataset.action = 'cancel';
    cancel.textContent = translate('common.cancel');

    let firstChoice: HTMLButtonElement | null = null;
    if (matches.length === 0) {
      title.textContent = translate('record.location.openMap');
      const reason = document.createElement('p');
      reason.id = `${id}-description`;
      reason.textContent = translate('map.openIn.none');
      dialog.setAttribute('aria-describedby', reason.id);
      const create = document.createElement('button');
      create.type = 'button';
      create.className = 'loom-button loom-map-target-create';
      create.dataset.action = 'create';
      create.textContent = translate('map.openIn.create');
      create.addEventListener('click', () => finish({ kind: 'create' }));
      dialog.append(title, reason);
      actions.append(create, cancel);
      firstChoice = create;
    } else {
      title.textContent = translate('map.openIn.chooseTitle');
      const list = document.createElement('ul');
      list.className = 'loom-map-target-list';
      for (const view of matches) {
        const item = document.createElement('li');
        const option = document.createElement('button');
        option.type = 'button';
        option.className = 'loom-button loom-map-target-option';
        option.dataset.viewId = view.id;
        option.textContent = view.name;
        option.addEventListener('click', () => finish({ kind: 'open', viewId: view.id }));
        item.append(option);
        list.append(item);
        firstChoice ??= option;
      }
      dialog.append(title, list);
      actions.append(cancel);
    }
    dialog.append(actions);
    ensureButtonLabels(dialog);
    host.append(dialog);

    let settled = false;
    function finish(choice: MapViewTargetChoice): void {
      if (settled) return;
      settled = true;
      dialog.remove();
      if (previouslyFocused?.isConnected) {
        previouslyFocused.focus();
      }
      resolve(choice);
    }
    cancel.addEventListener('click', () => finish({ kind: 'cancel' }));
    dialog.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        finish({ kind: 'cancel' });
      }
    });
    (firstChoice ?? cancel).focus();
  });
}
