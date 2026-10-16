import { describe, expect, it } from 'vitest';
import { annualUsageFromBill, calculateProject } from '../src/lib/calc';
import { paybackText, renderResults, money } from '../src/lib/results';
import { readCalculatorForm } from '../src/lib/calculator-ui';

const combined = {
  mode: 'solar' as const, postcode: 3000, installationDate: '2026-11-01', solarKw: 6.6,
  annualUsageKwh: 5077, importTariffCents: 27.47, feedInTariffCents: 5, stcPrice: 38,
  batteryKwh: 10, daytimeShare: 'mostly_home' as const, solarQuote: 6200, batteryQuote: 9240,
};

function formInput(overrides: Record<string, string>) {
  const form = new FormData();
  for (const [name, value] of Object.entries({
    plan: 'solar_battery', postcode: '3000', installationDate: '2026-11-01',
    solarKw: '6.6', batteryKwh: '10', daytimeShare: 'mostly_home',
    distributor: 'Jemena', importTariffCents: '27.47', feedInTariffCents: '5',
    usageMode: 'annual', annualUsageKwh: '5077', solarQuote: '6200', batteryQuote: '9240',
    stcPrice: '38', quoteIncludesRebate: 'yes', ...overrides,
  })) form.set(name, value);
  return readCalculatorForm(form);
}

describe('第 7 步补充手算', () => {
  it('用例 2 的补贴前报价扣回补贴，得到手算净成本', () => {
    // hand-calc.md「第 7 步补充核对」：这些是独立 Python 手算值。
    const result = calculateProject({ ...combined, solarQuote: 7682, batteryQuote: 11824, quoteIncludesRebate: false });
    expect(result.solarCost).toBe(6200);
    expect(result.batteryCost).toBe(9240);
    expect(result.netCost).toBe(15440);
    expect(result.subsidies.panelRebate).toBe(1482);
    expect(result.subsidies.batteryRebate).toBe(2584);
    expect(renderResults(result, { ...combined, quoteIncludesRebate: false }, 'en')).toContain('have been deducted');
  });
  it('真实澳分精度的账单，先扣供电费再反推全年用电', () => {
    expect(annualUsageFromBill({ totalDollars: 458.30, days: 90, distributor: 'Jemena', importTariffCents: 27.47 }))
      .toBeCloseTo(5076.944343, 5);
  });
  it('表单的未扣补贴选项完整接入计算及中英展示', () => {
    const input = formInput({ solarQuote: '7682', batteryQuote: '11824', quoteIncludesRebate: 'no' });
    const result = calculateProject(input);
    expect(result.netCost).toBe(15440);
    for (const lang of ['zh', 'en'] as const) {
      const html = renderResults(result, input, lang);
      expect(html).toContain('$15,440.00');
      expect(html).toContain('$1,391.68');
    }
  });
  it('表单选择账单模式时使用账单反推值，忽略隐藏的全年用电字段', () => {
    const input = formInput({ usageMode: 'bill', billTotal: '458.30', billDays: '90', annualUsageKwh: 'invalid' });
    expect(input.annualUsageKwh).toBeCloseTo(5076.944343, 5);
    const result = calculateProject(input);
    for (const lang of ['zh', 'en'] as const) {
      expect(renderResults(result, input, lang)).toContain('$15,440.00');
    }
  });
  it('电池损耗由引擎提供，与独立手算一致', () => {
    expect(calculateProject(combined).firstYear.batteryLossKwh).toBeCloseTo(160.29, 2);
    const result = calculateProject({ ...combined, mode: 'battery_only', solarQuote: 0,
      existingSolarKw: 6.6, batteryKwh: 20, batteryQuote: 16490, daytimeShare: 'partly_home' });
    expect(result.firstYear.batteryLossKwh).toBeCloseTo(242.23, 2);
    const noBattery = calculateProject({ ...combined, batteryKwh: 0, batteryQuote: 0 });
    expect(noBattery.firstYear.batteryLossKwh).toBe(0);
  });
  it('只加电池的首年省钱明确标为增量，中英文都显示', () => {
    const params = { ...combined, mode: 'battery_only' as const, solarQuote: 0 };
    const result = calculateProject(params);
    expect(renderResults(result, params, 'zh')).toContain('第 1 年预计增量省钱');
    expect(renderResults(result, params, 'en')).toContain('Estimated first-year incremental savings');
  });
  it('整体未回本时，同时说明预测期内整体不回本及电池计收益期限', () => {
    const result = calculateProject({ ...combined, solarQuote: 62000, batteryQuote: 92400 });
    for (const s of result.scenarios) {
      expect(s.paybackYear).toBeNull();
      expect(paybackText(s, 'zh', false)).toContain('30 年预测期内未回本');
      expect(paybackText(s, 'en', false)).toContain('No payback within the 30-year forecast');
      expect(paybackText(s, 'en', false)).toContain('years of battery benefits');
    }
  });
  it('金额统一使用澳洲英语 AUD 货币格式，保留每度指标所需精度', () => {
    expect(money(6200)).toBe('$6,200.00');
    expect(money(0.650, 3)).toBe('$0.650');
  });
});
