import type { Language } from './calculator-ui';

export const languageStorageKey = 'solar-calc-language';
type LanguageStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function chooseLanguage(browserLanguage: string, saved: string | null): Language {
  if (saved === 'zh' || saved === 'en') return saved;
  return browserLanguage.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

export function readLanguage(browserLanguage: string, storage?: LanguageStorage): Language {
  try { return chooseLanguage(browserLanguage, storage?.getItem(languageStorageKey) ?? null); }
  catch { return chooseLanguage(browserLanguage, null); }
}

export function saveLanguage(language: Language, storage?: LanguageStorage) {
  try { storage?.setItem(languageStorageKey, language); } catch { /* 私密浏览或禁用存储时不影响导航。 */ }
}
