import { describe, expect, it } from 'vitest';
import { calculateProject } from '../src/lib/calc';
import { FormInputError, readCalculatorForm, referenceQuote } from '../src/lib/calculator-ui';
import { renderResults, paybackText } from '../src/lib/results';

const fields = {
  plan: 'solar_only', postcode: '3000', installationDate: '2026-11-01',
  distributor: 'Jemena', importTariffCents: '27.47', feedInTariffCents: '5',
  usageMode: 'annual', annualUsageKwh: '5077', daytimeShare: 'away', solarKw: '6.6',
  existingSolarKw: '6.6', batteryKwh: '10', solarQuote: '6200', batteryQuote: '9240',
  stcPrice: '38', quoteIncludesRebate: 'yes',
};
function input(overrides: Partial<Record<keyof typeof fields | 'billTotal' | 'billDays', string>> = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries({ ...fields, ...overrides })) form.set(key, value);
  return readCalculatorForm(form);
}

describe('表单接入独立手算用例', () => {
  it('只填入数据中明确给出的参考报价，其他容量留给用户填写', () => {
    expect(referenceQuote('solar', 6.6)).toBe(6200);
    expect(referenceQuote('battery', 10)).toBe(9240);
    expect(referenceQuote('battery', 20)).toBe(16490);
    expect(referenceQuote('battery', 14)).toBeNull();
  });
  // 页面展示期望值均来自 hand-calc.md，不从结果反推。
  it.each([
    [{}, '$733.29', '$6,200.00'],
    [{ plan: 'solar_battery', daytimeShare: 'mostly_home' }, '$1,391.68', '$15,440.00'],
    [{ plan: 'battery_only', batteryKwh: '20', batteryQuote: '16490', daytimeShare: 'partly_home' }, '$477.76', '$16,490.00'],
  ] as const)('读入表单并呈现正确的首年省钱和净成本 %j', (overrides, saving, cost) => {
    const params = input(overrides);
    const result = calculateProject(params);
    for (const language of ['zh', 'en'] as const) {
      const html = renderResults(result, params, language);
      expect(html).toContain(saving);
      expect(html).toContain(cost);
      expect(html).not.toMatch(/Infinity|NaN|undefined/);
      if (language === 'en') expect(html).not.toMatch(/[\u4e00-\u9fff]/);
    }
  });

  it('隐藏字段不参与计算，太阳能和电池成本不会混入另一方案', () => {
    expect(input({ batteryQuote: 'bad', batteryKwh: 'bad' }).batteryQuote).toBe(0);
    expect(input({ plan: 'battery_only', solarQuote: 'bad', solarKw: 'bad' }).solarQuote).toBe(0);
  });

  it.each([{ solarQuote: '' }, { plan: 'invalid' }, { daytimeShare: 'invalid' }, { postcode: '2000' },
    { annualUsageKwh: 'Infinity' }, { quoteIncludesRebate: 'unknown' }])('不把缺失或无效值默认为 0：%j', (invalid) => {
    expect(() => input(invalid)).toThrow(FormInputError);
  });

  it('账单总额低于供电费时给出可本地化错误', () => {
    expect(() => input({ usageMode: 'bill', billTotal: '0', billDays: '90' })).toThrow('billError');
  });

  it('支持未扣补贴报价开关，交由计算引擎处理金额', () => {
    expect(input({ quoteIncludesRebate: 'no' }).quoteIncludesRebate).toBe(false);
  });
});

describe('结果呈现边界', () => {
  it('政策期内显示资格提示，期外不显示，并解释不适用', () => {
    const valid = input({ plan: 'solar_battery' });
    expect(renderResults(calculateProject(valid), valid, 'en')).toContain('data-rebate-notice');
    const outside = { ...valid, installationDate: '2031-01-01' };
    const html = renderResults(calculateProject(outside), outside, 'en');
    expect(html).not.toContain('data-rebate-notice');
    expect(html).toContain('outside the policy data period');
  });

  it('电池未放电时不显示 0 年回本或无穷的每度指标', () => {
    const params = input({ plan: 'battery_only', annualUsageKwh: '0' });
    const result = calculateProject(params);
    const html = renderResults(result, params, 'en');
    expect(html).toContain('No battery discharge');
    expect(html).not.toMatch(/Infinity|NaN|during the 0 years/);
    expect(paybackText(result.scenarios[0], 'zh', true)).toContain('未放电');
  });

  it('用例 2 超过电池计收益期才回本时，保留限制说明和 15 年零 FiT 对比', () => {
    const params = input({ plan: 'solar_battery', daytimeShare: 'mostly_home' });
    const result = calculateProject(params);
    const warranty = result.scenarios.find((s) => s.basis === 'warranty' && s.escalation === 0)!;
    expect(paybackText(warranty, 'en', false)).toContain('after battery benefits end');
    const expectedZero = result.zeroFeedInScenarios.filter((s) => s.basis === 'expected');
    expect(expectedZero.map((s) => paybackText(s, 'en', false))).toEqual(['Year 13', 'Year 11', 'Year 11']);
    const html = renderResults(result, params, 'zh');
    expect(html).toContain('$0.650');
    expect(html).toContain('未计维护及资金成本');
  });
});
