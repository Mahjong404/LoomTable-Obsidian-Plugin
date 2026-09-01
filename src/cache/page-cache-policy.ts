export const RECORD_PAGE_CACHE_SOFT_MAX_BYTES = 64 * 1024 * 1024;
export const RECORD_PAGE_CACHE_MAX_PAGES = 256;

export interface CachedPageDescriptor {
  readonly byteSize: number;
  readonly hasUncommittedMutation: boolean;
}

export function canPersistRecordPage(page: CachedPageDescriptor): boolean {
  return page.byteSize >= 0 && !page.hasUncommittedMutation;
}
