import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTranslator } from '../../src/i18n';
import {
  confirmDangerousAction,
  runAfterDangerousConfirmation,
} from '../../src/ui/dangerous-action-confirmation';

afterEach(() => {
  document.body.replaceChildren();
});

describe('dangerous action confirmation', () => {
  it('contains Tab focus and returns focus after cancel', async () => {
    const host = document.createElement('div');
    const trigger = document.createElement('button');
    document.body.append(trigger, host);
    trigger.focus();

    const result = confirmDangerousAction(
      host,
      'Delete Office tiles?',
      createTranslator('en'),
      trigger,
    );
    const dialog = host.querySelector<HTMLElement>('[role="alertdialog"]');
    const cancel = host.querySelector<HTMLButtonElement>('[data-action="cancel"]');
    const confirm = host.querySelector<HTMLButtonElement>('[data-action="confirm"]');
    expect(dialog).not.toBeNull();
    expect(cancel).not.toBeNull();
    expect(confirm).not.toBeNull();
    if (dialog === null || cancel === null || confirm === null) return;

    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBe(dialog.querySelector('h2')?.id);
    expect(dialog.getAttribute('aria-describedby')).toBe(dialog.querySelector('p')?.id);
    expect(document.activeElement).toBe(cancel);

    const forward = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    });
    cancel.dispatchEvent(forward);
    expect(forward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(confirm);

    const backward = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
      shiftKey: true,
    });
    confirm.dispatchEvent(backward);
    expect(backward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(cancel);

    cancel.click();
    await expect(result).resolves.toBe(false);
    expect(dialog.isConnected).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it('returns focus after confirm and runs side effects only after confirmation', async () => {
    const host = document.createElement('div');
    const trigger = document.createElement('button');
    document.body.append(trigger, host);
    trigger.focus();
    const result = confirmDangerousAction(
      host,
      'Delete the profile?',
      createTranslator('en'),
      trigger,
    );
    host.querySelector<HTMLButtonElement>('[data-action="confirm"]')?.click();

    await expect(result).resolves.toBe(true);
    expect(document.activeElement).toBe(trigger);

    const action = vi.fn();
    await expect(runAfterDangerousConfirmation(async () => false, action)).resolves.toBe(false);
    expect(action).not.toHaveBeenCalled();
    await expect(runAfterDangerousConfirmation(async () => true, action)).resolves.toBe(true);
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape without running the dangerous action', async () => {
    const host = document.createElement('div');
    const trigger = document.createElement('button');
    document.body.append(trigger, host);
    trigger.focus();
    const result = confirmDangerousAction(
      host,
      'Delete the profile?',
      createTranslator('en'),
      trigger,
    );
    const dialog = host.querySelector<HTMLElement>('[role="alertdialog"]');
    expect(dialog).not.toBeNull();
    if (dialog === null) return;

    dialog.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    await expect(result).resolves.toBe(false);
    expect(document.activeElement).toBe(trigger);
  });
});
