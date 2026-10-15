import { describe, it, expect } from 'vitest';
import zh from '../src/i18n/zh.json';
import en from '../src/i18n/en.json';

// 第 5 步在这里加入手算用例。目前只检查中英文案的键一致。
describe('i18n', () => {
  it('zh 和 en 文案键一致', () => {
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort());
  });
});
