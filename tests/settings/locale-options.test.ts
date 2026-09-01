import { describe, expect, it } from 'vitest';

import { createTranslator } from '../../src/i18n';
import { getLocaleOptions } from '../../src/settings/locale-options';

describe('locale setting options', () => {
  it('passes all three persisted locale values to the settings dropdown', () => {
    expect(getLocaleOptions(createTranslator('en'))).toEqual({
      auto: 'Follow Obsidian',
      en: 'English',
      'zh-CN': '简体中文',
    });
  });

  it('uses the translated Follow Obsidian label in Simplified Chinese', () => {
    expect(getLocaleOptions(createTranslator('zh-CN'))).toEqual({
      auto: '跟随 Obsidian（自动）',
      en: 'English',
      'zh-CN': '简体中文',
    });
  });
});
