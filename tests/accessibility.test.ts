/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import css from '../src/styles/calculator.css?raw';
import zh from '../src/i18n/zh.json';
import en from '../src/i18n/en.json';

function color(selector: string, property: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rule = css.match(new RegExp(`(?:^|\\n)\\s*${escaped} \\{([^}]+)\\}`))?.[1];
  const hex = rule?.match(new RegExp(`(?:^|;)\\s*${property}: (#[0-9a-f]{6})(?:;|$)`))?.[1];
  if (!hex) throw new Error(`Missing ${selector} ${property}`);
  return hex;
}
function luminance(hex: string) {
  const linear = [1, 3, 5].map((offset) => {
    const channel = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

describe('小字对比度与文案清理', () => {
  it.each(['.hero .eyebrow', 'footer'])('%s 对实际页面背景的 WCAG 对比度至少为 4.5:1', (selector) => {
    const foreground = luminance(color(selector, 'color'));
    const background = luminance(color(':root', 'background'));
    const ratio = (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it.each(['comingSoon', 'errorTitle', 'fieldError'])('移除未用文案键 %s，中英键仍一致', (key) => {
    expect(Object.hasOwn(zh, key)).toBe(false);
    expect(Object.hasOwn(en, key)).toBe(false);
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort());
  });
});
