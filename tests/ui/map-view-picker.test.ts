import { afterEach, describe, expect, it } from 'vitest';
import type { View } from '../../src/client/loomtable-client';
import { chooseMapViewTarget } from '../../src/ui/map-view-picker';
import { createTranslator } from '../../src/i18n';

function createMapView(id: string, name: string): View {
  return {
    id,
    tableId: 'table_01',
    name,
    type: 'map',
    config: { locationFieldId: 'field_location' },
    revision: 1,
    createdAt: '',
    updatedAt: '',
  };
}

describe('chooseMapViewTarget', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('lists matching Map Views and resolves the chosen view', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const matches = [createMapView('view_a', 'Office Map'), createMapView('view_b', 'Depots')];
    const choice = chooseMapViewTarget(host, matches, createTranslator('en'));

    const dialog = host.querySelector<HTMLElement>('.loom-map-target-picker');
    expect(dialog?.getAttribute('role')).toBe('alertdialog');
    const options = [...dialog!.querySelectorAll<HTMLButtonElement>('.loom-map-target-option')];
    expect(options.map((option) => option.textContent)).toEqual(['Office Map', 'Depots']);
    expect(document.activeElement).toBe(options[0]);
    options[1]?.click();
    await expect(choice).resolves.toEqual({ kind: 'open', viewId: 'view_b' });
    expect(host.querySelector('.loom-map-target-picker')).toBeNull();
  });

  it('shows the reason and a create entry when no Map View matches', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const choice = chooseMapViewTarget(host, [], createTranslator('en'));

    const dialog = host.querySelector<HTMLElement>('.loom-map-target-picker');
    expect(dialog?.textContent).toContain('No active Map View uses this Location Field.');
    dialog?.querySelector<HTMLButtonElement>('.loom-map-target-create')?.click();
    await expect(choice).resolves.toEqual({ kind: 'create' });
  });

  it('resolves cancel on Escape and restores focus to the trigger', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();
    const choice = chooseMapViewTarget(
      host,
      [createMapView('view_a', 'A'), createMapView('view_b', 'B')],
      createTranslator('en'),
      trigger,
    );
    host
      .querySelector('.loom-map-target-picker')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await expect(choice).resolves.toEqual({ kind: 'cancel' });
    expect(document.activeElement).toBe(trigger);
  });
});
