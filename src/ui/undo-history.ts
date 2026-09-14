export interface UndoCommand {
  readonly label?: string;
  undo(): Promise<void>;
  redo(): Promise<void>;
}

export class UndoHistory {
  #undoStack: UndoCommand[] = [];
  #redoStack: UndoCommand[] = [];
  #applying = false;

  get canUndo(): boolean {
    return this.#undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.#redoStack.length > 0;
  }

  get isApplying(): boolean {
    return this.#applying;
  }

  push(command: UndoCommand): void {
    this.#undoStack.push(command);
    this.#redoStack = [];
  }

  async undo(): Promise<boolean> {
    const command = this.#undoStack.pop();
    if (command === undefined || this.#applying) return false;
    this.#applying = true;
    try {
      await command.undo();
    } finally {
      this.#applying = false;
    }
    this.#redoStack.push(command);
    return true;
  }

  async redo(): Promise<boolean> {
    const command = this.#redoStack.pop();
    if (command === undefined || this.#applying) return false;
    this.#applying = true;
    try {
      await command.redo();
    } finally {
      this.#applying = false;
    }
    this.#undoStack.push(command);
    return true;
  }

  clear(): void {
    this.#undoStack = [];
    this.#redoStack = [];
  }
}
