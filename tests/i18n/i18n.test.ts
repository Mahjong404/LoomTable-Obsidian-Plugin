import { describe, expect, it } from 'vitest';

import { createTranslator } from '../../src/i18n';
import {
  DEFAULT_PLUGIN_SETTINGS,
  normalizePluginSettings,
  resolveLocale,
} from '../../src/settings/plugin-settings';

describe('i18n', () => {
  it('provides English and Simplified Chinese catalogs', () => {
    expect(createTranslator('en')('view.title')).toBe('LoomTable');
    expect(createTranslator('zh-CN')('connection.empty')).toBe('尚未配置连接档案。');
  });

  it('resolves auto to the current Obsidian language on every translation call', () => {
    let language = 'en';
    const translate = createTranslator('auto', () => language);

    expect(translate('language.auto')).toBe('Obsidian language (auto)');
    language = 'zh-CN';
    expect(translate('language.auto')).toBe('跟随 Obsidian（自动）');
  });

  it.each([
    ['zh', 'zh-CN'],
    ['zh-TW', 'zh-CN'],
    ['fr', 'en'],
    ['', 'en'],
  ] as const)('resolves Obsidian language %s to %s', (language, expected) => {
    expect(resolveLocale('auto', language)).toBe(expected);
  });

  it('defaults new settings to auto and preserves explicit legacy locale values', () => {
    expect(DEFAULT_PLUGIN_SETTINGS.locale).toBe('auto');
    expect(normalizePluginSettings({ locale: 'en' }).locale).toBe('en');
    expect(normalizePluginSettings({ locale: 'zh-CN' }).locale).toBe('zh-CN');
    expect(normalizePluginSettings({ locale: 'unsupported' }).locale).toBe('auto');
    expect(normalizePluginSettings({}).locale).toBe('auto');
  });
});
