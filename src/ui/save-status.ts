import type { Translator } from '../i18n';

export type ViewSaveStatus =
  'dirty' | 'saving' | 'saved' | 'error' | 'conflict' | 'offline-readonly';

export function describeSaveStatus(status: ViewSaveStatus, translate: Translator): string {
  if (status === 'dirty') return translate('saveStatus.dirty');
  if (status === 'saving') return translate('saveStatus.saving');
  if (status === 'error') return translate('saveStatus.error');
  if (status === 'conflict') return translate('saveStatus.conflict');
  if (status === 'offline-readonly') return translate('saveStatus.offline');
  return translate('saveStatus.saved');
}

const collapseTimers = new WeakMap<HTMLElement, number>();

export function renderSaveStatus(
  element: HTMLElement,
  status: ViewSaveStatus,
  translate: Translator,
): void {
  const previousTimer = collapseTimers.get(element);
  if (previousTimer !== undefined) window.clearTimeout(previousTimer);
  const message = describeSaveStatus(status, translate);
  element.dataset.status = status;
  element.setAttribute('aria-live', 'polite');
  element.setAttribute('aria-label', message);
  element.title = message;
  element.textContent = message;
  if (status === 'saved') {
    const timer = window.setTimeout(() => {
      if (element.dataset.status === 'saved') element.textContent = '✓';
      collapseTimers.delete(element);
    }, 1_200);
    collapseTimers.set(element, timer);
  } else {
    collapseTimers.delete(element);
  }
}
