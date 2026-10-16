import { describe, expect, it } from 'vitest';
import { chooseLanguage, readLanguage, saveLanguage, languageStorageKey } from '../src/lib/language';

describe('首访语言与手选偏好', () => {
  it.each([['zh', 'zh'], ['zh-CN', 'zh'], ['zh-Hant-TW', 'zh'], ['ZH-hk', 'zh'],
    ['en-AU', 'en'], ['fr', 'en'], ['', 'en']])('%s → %s', (browser, expected) => {
    expect(chooseLanguage(browser, null)).toBe(expected);
  });
  it('有效的手选偏好优先；未知存储值不参与路由', () => {
    expect(chooseLanguage('en-AU', 'zh')).toBe('zh');
    expect(chooseLanguage('zh-CN', 'en')).toBe('en');
    expect(chooseLanguage('fr', '//example.com')).toBe('en');
  });
  it('持久存储仅写入语言，不写入其他用户输入', () => {
    const store = new Map<string, string>();
    const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value); } };
    saveLanguage('zh', storage);
    expect([...store]).toEqual([[languageStorageKey, 'zh']]);
    expect(readLanguage('en-AU', storage)).toBe('zh');
  });
  it('存储被禁用时正常回退到浏览器语言', () => {
    const unavailable = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(readLanguage('zh-CN', unavailable)).toBe('zh');
    expect(() => saveLanguage('en', unavailable)).not.toThrow();
  });
});
