import type { LoomTableRecord } from '../client/loomtable-client';

export interface MutationInvalidationEvent {
  readonly tableId: string;
  readonly recordId: string;
  readonly record: LoomTableRecord;
  readonly changeCursor: string;
}

export type MutationInvalidationListener = (event: MutationInvalidationEvent) => void;

export interface MutationInvalidationConsumer {
  applyMutationInvalidation(event: MutationInvalidationEvent): void | Promise<void>;
}

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

export function subscribeMutationInvalidation(
  bus: MutationInvalidationBus,
  tableId: string,
  consumer: MutationInvalidationConsumer,
): () => void {
  return bus.subscribe((event) => {
    if (event.tableId !== tableId) return;
    try {
      const result = consumer.applyMutationInvalidation(event);
      void Promise.resolve(result).catch(() => undefined);
    } catch {
      // A consumer failure must not change the invalidation publication.
    }
  });
}
