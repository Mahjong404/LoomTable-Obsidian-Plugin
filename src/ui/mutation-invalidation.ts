import type { LoomTableRecord } from '../client/loomtable-client';

export interface MutationInvalidationEvent {
  readonly tableId: string;
  readonly recordId: string;
  readonly record: LoomTableRecord;
  readonly changeCursor: string;
}

export type MutationInvalidationListener = (event: MutationInvalidationEvent) => void;

export class MutationInvalidationBus {
  readonly #listeners = new Set<MutationInvalidationListener>();

  subscribe(listener: MutationInvalidationListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  publish(event: MutationInvalidationEvent): void {
    for (const listener of this.#listeners) {
      try {
        listener(event);
      } catch {
        // A refresh observer must not change the mutation result.
      }
    }
  }
}
