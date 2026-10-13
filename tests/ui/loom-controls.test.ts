import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLoomButton } from '../../src/ui/loom-button';
import { createToolbarToggle } from '../../src/ui/toolbar-toggle';
import { openContextMenu, closeActiveContextMenu } from '../../src/ui/context-menu';
import { openFieldEditor } from '../../src/ui/field-editor-panel';
import { createTranslator } from '../../src/i18n';
import { mountControlShowcase } from '../gallery/control-showcase';

afterEach(() => {
  closeActiveContextMenu();
  document.body.replaceChildren();
});

describe('production Loom controls', () => {
  it('activates only by native click, ignoring synthetic keydown duplication', () => {
    const action = vi.fn();
    const control = createLoomButton({ label: 'Save', onActivate: action });
    document.body.append(control.element);
    control.element.focus();
    control.element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(action).not.toHaveBeenCalled(); // jsdom has no native keyboard default action.
    control.element.click();
    expect(action).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(control.element);
    control.dispose();
  });
  it('blocks disabled/busy re-entry and restores the consumer disabled state', () => {
    const action = vi.fn();
    const control = createLoomButton({
      label: 'Save',
      disabled: true,
      reserveBusySpace: true,
      onActivate: action,
    });
    control.element.dispatchEvent(new MouseEvent('click'));
    control.update({ busy: true });
    control.element.dispatchEvent(new MouseEvent('click'));
    control.update({ busy: false });
    expect(control.element.disabled).toBe(true);
    control.update({ disabled: false });
    control.element.click();
    expect(action).toHaveBeenCalledTimes(1);
    control.dispose();
  });
  it('preserves mounted label/slots across busy and failure recovery', () => {
    const control = createLoomButton({
      label: 'Save',
      reserveBusySpace: true,
      onActivate: () => {},
    });
    const label = control.element.querySelector('.loom-button-label');
    const loading = control.element.querySelector<HTMLElement>('.loom-control-loading')!;
    expect(loading.hidden).toBe(false);
    control.update({ busy: true });
    expect(control.element.getAttribute('aria-busy')).toBe('true');
    expect(control.element.querySelector('.loom-button-label')).toBe(label);
    expect(label?.textContent).toBe('Save');
    control.update({ busy: false });
    expect(loading.hidden).toBe(false);
    expect(control.element.querySelector('.loom-control-loading')).toBe(loading);
    expect(control.element.disabled).toBe(false);
    control.dispose();
  });
  it('removes action ownership permanently on dispose', () => {
    const action = vi.fn();
    const control = createLoomButton({ label: 'Save', onActivate: action });
    document.body.append(control.element);
    control.dispose();
    control.dispose();
    control.update({ label: 'Late', disabled: false });
    control.element.click();
    expect(action).not.toHaveBeenCalled();
    expect(control.element.isConnected).toBe(false);
    expect(control.element.textContent).toBe('Save');
  });
  it('updates accessible labels and icon slots without rebuilding the button', () => {
    const control = createLoomButton({
      label: 'Filter',
      leadingIcon: 'tool-filter',
      onActivate: () => {},
    });
    const button = control.element;
    control.update({
      label: 'Sort',
      accessibleLabel: 'Sort, two rules',
      trailingIcon: 'caret-down',
      leadingIcon: null,
    });
    expect(control.element).toBe(button);
    expect(button.getAttribute('aria-label')).toBe('Sort, two rules');
    expect(button.querySelector<HTMLElement>('.loom-control-leading')?.hidden).toBe(true);
    expect(button.querySelector('.loom-control-trailing svg')).not.toBeNull();
    control.dispose();
  });
  it('controls Open and Active independently and exposes numeric count', () => {
    const control = createToolbarToggle({
      label: 'Filter',
      open: true,
      count: 0,
      accessibleLabel: 'Filter',
      onActivate: () => {},
    });
    expect(control.element.getAttribute('aria-expanded')).toBe('true');
    expect(control.element.dataset.active).toBe('false');
    expect(control.element.querySelector('.loom-control-trailing svg')).not.toBeNull();
    control.update({ count: 2, accessibleLabel: 'Filter, 2 conditions' });
    expect(control.element.dataset.active).toBe('true');
    expect(control.element.querySelector('.loom-grid-query-count')?.textContent).toBe('2');
    expect(control.element.getAttribute('aria-label')).toBe('Filter, 2 conditions');
    control.update({ open: false });
    expect(control.element.dataset.active).toBe('true');
    expect(control.element.querySelector('.loom-control-trailing svg')).toBeNull();
    control.dispose();
    control.update({ open: true });
    expect(control.element.getAttribute('aria-expanded')).toBe('false');
  });
  it('does not turn command current markers into radio semantics', () => {
    const host = document.createElement('div');
    document.body.append(host);
    openContextMenu({
      host,
      x: 0,
      y: 0,
      width: 180,
      label: 'Menu',
      items: [
        { label: 'Current command', current: true, action: () => {} },
        { label: 'Choice', checkable: 'radio', checked: true, action: () => {} },
        { label: 'Multi', checkable: 'checkbox', checked: false, action: () => {} },
      ],
    });
    const items = document.querySelectorAll('.loom-context-menu-item');
    expect(items[0]?.getAttribute('role')).toBe('menuitem');
    expect(items[0]?.hasAttribute('aria-checked')).toBe(false);
    expect(items[1]?.getAttribute('aria-checked')).toBe('true');
    expect(items[2]?.getAttribute('aria-checked')).toBe('false');
  });
  it('refreshes portal owner overrides and removes stale copied values', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const setAccent = (accent: string): void => host.style.setProperty('--loom-accent', accent);
    setAccent('red');
    openContextMenu({
      host,
      x: 0,
      y: 0,
      label: 'Menu',
      items: [{ label: 'Action', action: () => {} }],
    });
    const menu = document.querySelector<HTMLElement>('.loom-context-menu')!;
    expect(menu.style.getPropertyValue('--loom-accent')).toBe('red');
    setAccent('blue');
    await vi.waitFor(() => expect(menu.style.getPropertyValue('--loom-accent')).toBe('blue'));
    host.style.removeProperty('--loom-accent');
    await vi.waitFor(() => expect(menu.style.getPropertyValue('--loom-accent')).toBe(''));
  });
  it('uses the same mounted Submit control through pending, failed retry and success', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    let reject!: (reason: Error) => void;
    const submit = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((_, fail) => {
            reject = fail;
          }),
      )
      .mockResolvedValueOnce(undefined);
    const close = openFieldEditor({
      host,
      x: 0,
      y: 0,
      mode: 'create',
      translate: createTranslator('en'),
      onSubmit: submit,
    });
    const input = host.querySelector<HTMLInputElement>('.loom-field-editor-name')!;
    input.value = 'Keep draft';
    input.dispatchEvent(new Event('input'));
    const button = host.querySelector<HTMLButtonElement>('.loom-field-editor-submit')!;
    const label = button.querySelector('.loom-button-label')!;
    button.click();
    button.dispatchEvent(new MouseEvent('click'));
    expect(submit).toHaveBeenCalledTimes(1);
    expect(button.getAttribute('aria-busy')).toBe('true');
    reject(new Error('Synthetic failure'));
    await vi.waitFor(() => expect(button.disabled).toBe(false));
    expect(input.value).toBe('Keep draft');
    expect(button.querySelector('.loom-button-label')).toBe(label);
    button.click();
    await vi.waitFor(() => expect(button.isConnected).toBe(false));
    expect(submit).toHaveBeenCalledTimes(2);
    close();
  });
  it('disposes the same-source showcase including its body-mounted menu', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const mounted = mountControlShowcase(host);
    const menu = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.getAttribute('aria-label') === '菜单',
    )!;
    menu.click();
    expect(document.querySelector('.loom-context-menu')).not.toBeNull();
    mounted.dispose();
    mounted.dispose();
    menu.click();
    expect(document.querySelector('.loom-context-menu')).toBeNull();
    expect(host.childElementCount).toBe(0);
  });
});
