import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTranslator } from '../../src/i18n';
import { openFieldEditor, type FieldEditorSubmit } from '../../src/ui/field-editor-panel';

function fixture(): { host: HTMLElement; trigger: HTMLButtonElement } {
  const host = document.createElement('div');
  const trigger = document.createElement('button');
  trigger.type = 'button';
  host.append(trigger);
  document.body.append(host);
  return { host, trigger };
}

function openCreate(
  host: HTMLElement,
  trigger: HTMLElement,
  onSubmit: (input: FieldEditorSubmit) => void | Promise<void>,
): () => void {
  return openFieldEditor({
    mode: 'create',
    x: 10,
    y: 20,
    host,
    trigger,
    translate: createTranslator('en'),
    onSubmit,
  });
}

function fillName(host: HTMLElement, name: string): void {
  const input = host.querySelector<HTMLInputElement>('.loom-field-editor-name');
  input!.value = name;
  input!.dispatchEvent(new Event('input', { bubbles: true }));
}

function submitPanel(host: HTMLElement): void {
  host.querySelector<HTMLButtonElement>('.loom-field-editor-submit')?.click();
}

afterEach(() => {
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  document.body.replaceChildren();
});

describe('openFieldEditor', () => {
  it('keeps the dialog open while the submit is in flight and ignores re-entry', async () => {
    const { host, trigger } = fixture();
    let resolveSubmit!: () => void;
    const onSubmit = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSubmit = resolve;
        }),
    );
    openCreate(host, trigger, onSubmit);
    fillName(host, 'Notes');
    submitPanel(host);

    const panel = host.querySelector<HTMLElement>('.loom-field-editor');
    expect(panel).not.toBeNull();
    expect(panel?.dataset.submitting).toBe('true');
    submitPanel(host);
    expect(onSubmit).toHaveBeenCalledTimes(1);

    resolveSubmit();
    await vi.waitFor(() => {
      expect(host.querySelector('.loom-field-editor')).toBeNull();
    });
  });

  it('keeps the draft and reports the failure when the submit rejects', async () => {
    const { host, trigger } = fixture();
    const onSubmit = vi
      .fn()
      .mockRejectedValueOnce(new Error('Field management is unavailable while offline.'))
      .mockResolvedValueOnce(undefined);
    openCreate(host, trigger, onSubmit);
    fillName(host, 'Notes');
    submitPanel(host);

    await vi.waitFor(() => {
      expect(host.querySelector('.loom-field-editor [role="alert"]')?.textContent).toBe(
        'Field management is unavailable while offline.',
      );
    });
    const panel = host.querySelector<HTMLElement>('.loom-field-editor');
    expect(panel).not.toBeNull();
    expect(panel?.dataset.submitting ?? 'false').toBe('false');
    expect(host.querySelector<HTMLInputElement>('.loom-field-editor-name')?.value).toBe('Notes');

    // Retry with the retained draft: the second submit reaches the callback
    // and closes the dialog on success.
    submitPanel(host);
    await vi.waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(2);
      expect(host.querySelector('.loom-field-editor')).toBeNull();
    });
  });

  it('shows a generic failure message when the rejection carries no message', async () => {
    const { host, trigger } = fixture();
    openCreate(host, trigger, vi.fn().mockRejectedValueOnce(new Error('')));
    fillName(host, 'Notes');
    submitPanel(host);

    await vi.waitFor(() => {
      const alert = host.querySelector('.loom-field-editor [role="alert"]');
      expect(alert?.textContent?.length ?? 0).toBeGreaterThan(0);
    });
    expect(host.querySelector('.loom-field-editor')).not.toBeNull();
  });

  it('blocks an empty name with an inline error instead of submitting', () => {
    const { host, trigger } = fixture();
    const onSubmit = vi.fn(async () => undefined);
    openCreate(host, trigger, onSubmit);
    submitPanel(host);

    expect(onSubmit).not.toHaveBeenCalled();
    const name = host.querySelector<HTMLInputElement>('.loom-field-editor-name');
    expect(name?.getAttribute('aria-invalid')).toBe('true');
    expect(host.querySelector('.loom-field-editor [role="alert"]')?.textContent ?? '').not.toBe('');
    expect(host.querySelector('.loom-field-editor')).not.toBeNull();
  });

  it('closes on outside pointerdown without moving focus back to the trigger', () => {
    const { host, trigger } = fixture();
    const elsewhere = document.createElement('button');
    host.append(elsewhere);
    openCreate(
      host,
      trigger,
      vi.fn(async () => undefined),
    );
    elsewhere.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(host.querySelector('.loom-field-editor')).toBeNull();
    expect(document.activeElement).not.toBe(trigger);
  });

  it('returns focus to the trigger on Escape', () => {
    const { host, trigger } = fixture();
    openCreate(
      host,
      trigger,
      vi.fn(async () => undefined),
    );
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(host.querySelector('.loom-field-editor')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('keeps close() idempotent', () => {
    const { host, trigger } = fixture();
    const close = openCreate(
      host,
      trigger,
      vi.fn(async () => undefined),
    );
    close();
    expect(() => close()).not.toThrow();
    expect(host.querySelector('.loom-field-editor')).toBeNull();
  });
});
