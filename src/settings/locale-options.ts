import type { Translator } from '../i18n';
import type { MessageKey } from '../i18n/messages';
import { LOCALE_PREFERENCES, type LocalePreference } from './plugin-settings';

const LOCALE_LABEL_KEYS: Record<LocalePreference, MessageKey> = {
  auto: 'language.auto',
  en: 'language.english',
  'zh-CN': 'language.zhCN',
};

export function getLocaleOptions(t: Translator): Record<LocalePreference, string> {
  return Object.fromEntries(
    LOCALE_PREFERENCES.map((locale) => [locale, t(LOCALE_LABEL_KEYS[locale])]),
  ) as Record<LocalePreference, string>;
}
