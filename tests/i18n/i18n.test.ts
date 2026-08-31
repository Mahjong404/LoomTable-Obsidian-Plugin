import { describe, expect, it } from 'vitest';

import { createTranslator } from '../../src/i18n';
import {
  DEFAULT_PLUGIN_SETTINGS,
  LOCALE_PREFERENCES,
  normalizePluginSettings,
  resolveLocale,
} from '../../src/settings/plugin-settings';

describe('i18n', () => {
  it('provides English and Simplified Chinese catalogs', () => {
    expect(createTranslator('en')('view.title')).toBe('LoomTable');
    expect(createTranslator('zh-CN')('connection.empty')).toBe('尚未配置连接档案。');
    expect(createTranslator('zh-CN')('grid.table')).toBe('数据表');
    expect(createTranslator('zh-CN')('record.details')).toBe('记录详情');
    expect(createTranslator('en')('common.openSettings')).toBe('Open Settings');
    expect(createTranslator('zh-CN')('common.openSettings')).toBe('打开设置');
    expect(createTranslator('en')('map.refreshing')).toBe('Refreshing…');
    expect(createTranslator('zh-CN')('map.refreshing')).toBe('正在刷新…');
  });

  it('resolves auto to the current Obsidian language on every translation call', () => {
    let language = 'en';
    const translate = createTranslator('auto', () => language);

    expect(translate('language.auto')).toBe('Follow Obsidian');
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
    expect(LOCALE_PREFERENCES).toEqual(['auto', 'en', 'zh-CN']);
    expect(DEFAULT_PLUGIN_SETTINGS.locale).toBe('auto');
    expect(normalizePluginSettings({ locale: 'auto' }).locale).toBe('auto');
    expect(normalizePluginSettings({ locale: 'en' }).locale).toBe('en');
    expect(normalizePluginSettings({ locale: 'zh-CN' }).locale).toBe('zh-CN');
    expect(normalizePluginSettings({ locale: 'unsupported' }).locale).toBe('auto');
    expect(normalizePluginSettings({}).locale).toBe('auto');
  });
});
