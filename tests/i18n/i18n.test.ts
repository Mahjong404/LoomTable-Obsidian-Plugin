import { describe, expect, it } from 'vitest';

import { createTranslator } from '../../src/i18n';

describe('i18n', () => {
  it('provides English and Simplified Chinese catalogs', () => {
    expect(createTranslator('en')('view.title')).toBe('LoomTable');
    expect(createTranslator('zh-CN')('connection.empty')).toBe('尚未配置连接档案。');
  });
});
