import { describe, expect, it } from 'vitest';
import { calculateProject } from '../src/lib/calc';
import zh from '../src/i18n/zh.json';
import en from '../src/i18n/en.json';

const batteryInput = {
  mode: 'battery_only' as const, postcode: 3000, installationDate: '2026-11-01',
  existingSolarKw: 6.6, batteryKwh: 20, daytimeShare: 'partly_home' as const,
  solarQuote: 0, batteryQuote: 16490,
};

describe('展示信息的适用范围和语言', () => {
  it.each(['2025-06-30', '2031-01-01'])('政策期外 %s 不返回电池补贴资格提示', (installationDate) => {
    expect(calculateProject({ ...batteryInput, installationDate }).notices).toEqual([]);
  });

  it('净收益说明使用在两种语言中都可解析的文案键', () => {
    const result = calculateProject(batteryInput);
    expect(result.netBenefitNote).toBe('netBenefitNote');
    expect(zh[result.netBenefitNote]).toBe('未计维护及资金成本');
    expect(en[result.netBenefitNote]).toBe('Excludes maintenance and financing costs');
  });
});
