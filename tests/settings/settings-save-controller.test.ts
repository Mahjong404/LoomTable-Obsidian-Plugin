import { describe, expect, it, vi } from 'vitest';

import { SettingsSaveController } from '../../src/settings/settings-save-controller';

describe('settings save controller', () => {
  it('does not start a second save while the first one is pending', async () => {
    const controller = new SettingsSaveController();
    let resolveFirst: () => void = () => undefined;
    const firstSave = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });
    const save = vi.fn(() => firstSave);
    const rollback = vi.fn();

    const firstRun = controller.run(save, () => undefined);
    await expect(controller.run(save, rollback)).resolves.toBe('busy');
    expect(save).toHaveBeenCalledTimes(1);
    expect(rollback).toHaveBeenCalledOnce();

    resolveFirst();
    await expect(firstRun).resolves.toBe('saved');
  });

  it('rolls back the local settings change when persistence fails', async () => {
    const controller = new SettingsSaveController();
    const rollback = vi.fn();

    await expect(
      controller.run(() => Promise.reject(new Error('storage failed')), rollback),
    ).resolves.toBe('failed');
    expect(rollback).toHaveBeenCalledOnce();
  });
});
