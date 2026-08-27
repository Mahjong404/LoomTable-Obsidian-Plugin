import { describe, expect, it, vi } from 'vitest';

import type { LoomTableRecord } from '../../src/client/loomtable-client';
import {
  MutationInvalidationBus,
  subscribeMutationInvalidation,
  type MutationInvalidationEvent,
} from '../../src/ui/mutation-invalidation';

describe('MutationInvalidationBus', () => {
  it('publishes the authoritative Record and opaque cursor to subscribers', () => {
    const bus = new MutationInvalidationBus();
    const listener = vi.fn<(event: MutationInvalidationEvent) => void>();
    const unsubscribe = bus.subscribe(listener);
    const event: MutationInvalidationEvent = {
      tableId: 'table_01',
      recordId: 'record_01',
      record: record(2),
      changeCursor: 'opaque-cursor',
    };

    bus.publish(event);

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(event);
    unsubscribe();
    bus.publish(event);
    expect(listener).toHaveBeenCalledOnce();
  });

  it('routes same-table events to a Map consumer and supports unsubscribe', async () => {
    const bus = new MutationInvalidationBus();
    const consumer = {
      applyMutationInvalidation: vi.fn().mockResolvedValue(undefined),
    };
    const unsubscribe = subscribeMutationInvalidation(bus, 'table_01', consumer);
    const event: MutationInvalidationEvent = {
      tableId: 'table_01',
      recordId: 'record_01',
      record: record(2),
      changeCursor: 'opaque-cursor',
    };

    bus.publish(event);
    bus.publish({ ...event, tableId: 'table_02' });
    await Promise.resolve();

    expect(consumer.applyMutationInvalidation).toHaveBeenCalledOnce();
    expect(consumer.applyMutationInvalidation).toHaveBeenCalledWith(event);

    unsubscribe();
    bus.publish(event);
    await Promise.resolve();
    expect(consumer.applyMutationInvalidation).toHaveBeenCalledOnce();
  });

  it('contains observer failures without changing publication to other listeners', () => {
    const bus = new MutationInvalidationBus();
    const received: MutationInvalidationEvent[] = [];
    bus.subscribe(() => {
      throw new Error('observer failed');
    });
    bus.subscribe((event) => received.push(event));
    const event: MutationInvalidationEvent = {
      tableId: 'table_01',
      recordId: 'record_01',
      record: record(3),
      changeCursor: 'opaque-cursor-2',
    };

    expect(() => bus.publish(event)).not.toThrow();
    expect(received).toEqual([event]);
  });
});

function record(revision: number): LoomTableRecord {
  return {
    id: 'record_01',
    tableId: 'table_01',
    revision,
    values: { field_a: 'server' },
    createdAt: '2026-08-15T00:00:00.000Z',
    updatedAt: '2026-08-15T00:00:00.000Z',
  };
}
