import { describe, expect, it } from 'vitest';

import {
  RECORD_PAGE_CACHE_MAX_PAGES,
  RECORD_PAGE_CACHE_SOFT_MAX_BYTES,
  canPersistRecordPage,
} from '../../src/cache/page-cache-policy';

describe('record page cache policy', () => {
  it('locks the approved soft limits', () => {
    expect(RECORD_PAGE_CACHE_SOFT_MAX_BYTES).toBe(64 * 1024 * 1024);
    expect(RECORD_PAGE_CACHE_MAX_PAGES).toBe(256);
  });

  it('never persists a page containing an uncommitted mutation', () => {
    expect(canPersistRecordPage({ byteSize: 10, hasUncommittedMutation: true })).toBe(false);
    expect(canPersistRecordPage({ byteSize: 10, hasUncommittedMutation: false })).toBe(true);
  });
});
