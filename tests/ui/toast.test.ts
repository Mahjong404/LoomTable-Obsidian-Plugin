import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTranslator } from '../../src/i18n';
import { createToastStack, pushToast } from '../../src/ui/toast';

const translate = createTranslator('en');

afterEach(() => {
  vi.useRealTimers();
});

describe('toast stack', () => {
  it('renders a toast with kind styling, action, and dismiss button', () => {
    const stack = createToastStack();
    const run = vi.fn();

    pushToast(stack, { kind: 'error', text: 'Boom', action: { label: 'Fix', run } }, translate);

    const toast = stack.querySelector<HTMLElement>('.loom-toast');
    expect(toast?.classList.contains('loom-toast--error')).toBe(true);
    expect(toast?.getAttribute('role')).toBe('alert');
    expect(toast?.querySelector('.loom-toast-text')?.textContent).toBe('Boom');

    const action = toast?.querySelector<HTMLButtonElement>('.loom-toast-action');
    action?.click();
    expect(run).toHaveBeenCalledTimes(1);
    expect(stack.querySelector('.loom-toast')).toBeNull();
  });

  it('auto-dismisses after the default duration and supports manual dismiss', () => {
    vi.useFakeTimers();
    const stack = createToastStack();

    pushToast(stack, { kind: 'info', text: 'First' }, translate);
    const dismiss = pushToast(stack, { kind: 'success', text: 'Second' }, translate);
    expect(stack.querySelectorAll('.loom-toast')).toHaveLength(2);

    dismiss();
    expect(stack.querySelectorAll('.loom-toast')).toHaveLength(1);

    vi.advanceTimersByTime(5000);
    expect(stack.querySelectorAll('.loom-toast')).toHaveLength(0);
  });

  it('keeps at most three toasts, dropping the oldest', () => {
    const stack = createToastStack();
    for (const text of ['a', 'b', 'c', 'd']) {
      pushToast(stack, { kind: 'info', text }, translate);
    }
    const texts = [...stack.querySelectorAll('.loom-toast-text')].map((node) => node.textContent);
    expect(texts).toEqual(['b', 'c', 'd']);
  });

  it('does not run the action after a manual dismiss', () => {
    vi.useFakeTimers();
    const stack = createToastStack();
    const run = vi.fn();
    pushToast(stack, { kind: 'info', text: 'x', action: { label: 'Go', run } }, translate);
    stack.querySelector<HTMLButtonElement>('.loom-toast-dismiss')?.click();
    vi.advanceTimersByTime(60000);
    expect(run).not.toHaveBeenCalled();
  });
});
