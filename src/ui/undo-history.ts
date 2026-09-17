export interface UndoEntryMeta {
  readonly kind: 'edit' | 'create' | 'delete' | 'restore';
  readonly recordId: string;
  readonly fieldId?: string;
  readonly fieldName?: string;
  readonly before?: unknown;
  readonly after?: unknown;
  readonly recordTitle: string;
  readonly at: string;
}

export interface UndoCommand {
  readonly label?: string;
  readonly meta?: UndoEntryMeta;
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

  /** Recorded mutation entries, newest first. */
  get entries(): readonly UndoEntryMeta[] {
    const entries: UndoEntryMeta[] = [];
    for (const command of [...this.#undoStack].reverse()) {
      if (command.meta !== undefined) entries.push(command.meta);
    }
    return entries;
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

  /**
   * Undoes every entry newer than `index` plus the entry itself — the
   * "undo this step" action in the change-log panel. `index` is in the
   * newest-first `entries` ordering.
   */
  async undoUntil(index: number): Promise<void> {
    const remaining = this.#undoStack.length - 1 - index;
    if (remaining < 0) return;
    while (this.#undoStack.length > remaining) {
      if (!(await this.undo())) break;
    }
  }

  clear(): void {
    this.#undoStack = [];
    this.#redoStack = [];
  }
}
