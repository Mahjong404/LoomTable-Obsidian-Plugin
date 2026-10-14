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
        createTranslator('en')('field.submit.failed'),
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

  it('locks every draft control while the submit is in flight', async () => {
    // M3 — pending submit must freeze the draft: name, description, type
    // picker, option editors and the submit action are all disabled, so no
    // edit can be silently discarded by a late success.
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
    const controls = panel!.querySelectorAll<
      HTMLInputElement | HTMLSelectElement | HTMLButtonElement | HTMLTextAreaElement
    >('input, select, button, textarea');
    expect(controls.length).toBeGreaterThan(0);
    for (const control of controls) expect(control.disabled).toBe(true);

    resolveSubmit();
    await vi.waitFor(() => expect(host.querySelector('.loom-field-editor')).toBeNull());
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('restores draft editing after a failed submit and permits retry', async () => {
    const { host, trigger } = fixture();
    let rejectSubmit!: (error: unknown) => void;
    const onSubmit = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((_resolve, reject) => {
            rejectSubmit = reject;
          }),
      )
      .mockResolvedValueOnce(undefined);
    openCreate(host, trigger, onSubmit);
    fillName(host, 'Notes');
    submitPanel(host);

    rejectSubmit(new Error('boom'));
    await vi.waitFor(() => {
      const panel = host.querySelector<HTMLElement>('.loom-field-editor');
      expect(panel?.dataset.submitting).toBeUndefined();
    });
    const name = host.querySelector<HTMLInputElement>('.loom-field-editor-name');
    expect(name?.disabled).toBe(false);
    expect(name?.value).toBe('Notes');
    expect(host.querySelector('.loom-field-editor [role="alert"]')).not.toBeNull();

    submitPanel(host);
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
  });

  it('releases listeners and the palette when the owner host disconnects', async () => {
    // M4/N1 — owner unload (view switch, pane teardown) detaches the host:
    // the editor must close itself, drop its document listeners and dispose
    // the child palette without stealing focus.
    const { host, trigger } = fixture();
    openCreate(
      host,
      trigger,
      vi.fn(async () => undefined),
    );
    const panel = host.querySelector<HTMLElement>('.loom-field-editor');
    expect(panel).not.toBeNull();
    const name = host.querySelector<HTMLElement>('.loom-field-editor-name');
    name?.focus();

    host.remove();
    await vi.waitFor(() => {
      expect(document.querySelector('.loom-field-editor')).toBeNull();
    });
    // The dead editor no longer traps Tab or touches focus.
    expect(document.activeElement).not.toBe(trigger);
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
    );
  });

  it('releases the palette listener on pick, replace and parent close', async () => {
    // N1 — the palette is a parent-owned child: only one mounted at a time,
    // detached DOM never survives with a live capture listener.
    const { host, trigger } = fixture();
    openCreate(
      host,
      trigger,
      vi.fn(async () => undefined),
    );
    const typeItems = () => [...host.querySelectorAll<HTMLElement>('.loom-field-editor-type')];
    const selectItem = typeItems().find(
      (el) => el.querySelector('.loom-field-editor-type-name')?.textContent === 'Select',
    );
    selectItem?.click();
    await vi.waitFor(() => {
      expect(host.querySelector('.loom-field-editor-option-list')).not.toBeNull();
    });
    // New fields start without options — add two rows to exercise swatches.
    const addOption = () =>
      host.querySelector<HTMLButtonElement>('.loom-field-editor-option-add')?.click();
    addOption();
    addOption();

    // Scope to the row's own swatch — palette choices share the class but
    // sit one level deeper inside the palette div.
    const swatches = () =>
      host.querySelectorAll<HTMLButtonElement>(
        '.loom-field-editor-option-row > .loom-field-editor-swatch',
      );
    swatches()[0]?.click();
    expect(host.querySelectorAll('.loom-field-editor-palette')).toHaveLength(1);
    // Reopen on the other option — the first palette must be dismissed, not
    // stacked.
    swatches()[1]?.click();
    expect(host.querySelectorAll('.loom-field-editor-palette')).toHaveLength(1);

    host.querySelector<HTMLButtonElement>('.loom-field-editor-palette button')?.click();
    expect(host.querySelectorAll('.loom-field-editor-palette')).toHaveLength(0);
    // A document-level pointerdown after dismissal is a no-op, not a zombie.
    document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(host.querySelectorAll('.loom-field-editor-palette')).toHaveLength(0);
  });
});
