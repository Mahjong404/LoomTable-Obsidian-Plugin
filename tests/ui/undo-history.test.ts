import { describe, expect, it, vi } from 'vitest';

import { UndoHistory } from '../../src/ui/undo-history';

describe('UndoHistory failure handling', () => {
  it('re-pushes the entry when undo fails so it can be retried', async () => {
    const history = new UndoHistory();
    const command = {
      undo: vi.fn(async (): Promise<void> => {
        throw new Error('offline');
      }),
      redo: vi.fn(async () => {}),
    };
    history.push(command);

    await expect(history.undo()).rejects.toThrow('offline');
    expect(history.canUndo).toBe(true);
    expect(history.canRedo).toBe(false);

    command.undo.mockImplementationOnce(async () => {});
    await expect(history.undo()).resolves.toBe(true);
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(true);
  });

  it('re-pushes the entry when redo fails', async () => {
    const history = new UndoHistory();
    const command = {
      undo: vi.fn(async () => {}),
      redo: vi.fn(async (): Promise<void> => {
        throw new Error('conflict');
      }),
    };
    history.push(command);
    await history.undo();

    await expect(history.redo()).rejects.toThrow('conflict');
    expect(history.canRedo).toBe(true);
    expect(history.canUndo).toBe(false);
  });
});
