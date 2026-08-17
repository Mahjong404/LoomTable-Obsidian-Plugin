import {
  resolveLocale,
  type LocalePreference,
  type SupportedLocale,
} from '../settings/plugin-settings';
import { englishMessages, type MessageCatalog, type MessageKey } from './messages';
import { simplifiedChineseMessages } from './zh-cn';

const catalogs: Record<SupportedLocale, MessageCatalog> = {
  en: englishMessages,
  'zh-CN': simplifiedChineseMessages,
};

export type Translator = (key: MessageKey) => string;

export function createTranslator(
  preference: LocalePreference,
  getLanguage: () => string = () => 'en',
): Translator {
  return (key) => {
    const catalog = catalogs[resolveLocale(preference, getLanguage())] ?? englishMessages;
    return catalog[key] ?? englishMessages[key];
  };
}
