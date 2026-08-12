import type { SupportedLocale } from '../settings/plugin-settings';
import { englishMessages, type MessageCatalog, type MessageKey } from './messages';
import { simplifiedChineseMessages } from './zh-cn';

const catalogs: Record<SupportedLocale, MessageCatalog> = {
  en: englishMessages,
  'zh-CN': simplifiedChineseMessages,
};

export type Translator = (key: MessageKey) => string;

export function createTranslator(locale: SupportedLocale): Translator {
  const catalog = catalogs[locale] ?? englishMessages;
  return (key) => catalog[key] ?? englishMessages[key];
}
