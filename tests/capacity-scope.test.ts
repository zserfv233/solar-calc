import { describe, expect, it, vi } from 'vitest';
import defaultsRaw from '../data/defaults-vic.json';
import { calculateProject, panelStcs, type CalculationInput } from '../src/lib/calc';
import { calculationFormError, message, readCalculatorForm } from '../src/lib/calculator-ui';
import { defaultsVicSchema } from '../src/lib/schema';
import { sourceCatalog } from '../src/lib/source-catalog';

// 容量边界是用户确认、CER 来源支持的范围要求；不新增财务结果期望值。
const fields = {
  plan: 'solar_only', postcode: '3000', installationDate: '2026-11-01',
  distributor: 'Jemena', importTariffCents: '27.47', feedInTariffCents: '5',
  usageMode: 'annual', annualUsageKwh: '5077', daytimeShare: 'away', solarKw: '6.6',
  existingSolarKw: '6.6', batteryKwh: '20', solarQuote: '6200', batteryQuote: '16490',
  stcPrice: '38', quoteIncludesRebate: 'yes',
};
function formInput(plan: string, field: string, capacity: number) {
  const form = new FormData();
  for (const [name, value] of Object.entries({ ...fields, plan, [field]: String(capacity) })) form.set(name, value);
  return readCalculatorForm(form);
}

describe.each([
  ['solarKw', 'solar_only'], ['solarKw', 'solar_battery'], ['existingSolarKw', 'battery_only'],
])('%s 的家用计算范围', (field, plan) => {
  it('表单和计算入口接受 100 kW', () => {
    const input = formInput(plan, field, 100);
    expect(input[field as 'solarKw' | 'existingSolarKw']).toBe(100);
    expect(() => calculateProject(input)).not.toThrow();
  });

  it.each([100.01, 101])('表单拒绝 %s kW，保留具体字段与双语错误键', (capacity) => {
    expect(() => formInput(plan, field, capacity)).toThrow();
    try { formInput(plan, field, capacity); }
    catch (cause) { expect(calculationFormError(cause)).toMatchObject({ key: 'homeSystemRangeError', field }); }
  });

  it.each([100.01, 101])('绕过表单直接计算也拒绝 %s kW，并映射至对应字段', (capacity) => {
    const input: CalculationInput = { ...formInput(plan, field, 100), [field]: capacity };
    expect(() => calculateProject(input)).toThrow();
    try { calculateProject(input); }
    catch (cause) {
      const error = calculationFormError(cause, input);
      expect(error).toMatchObject({ key: 'homeSystemRangeError', field });
      expect(message('zh', error.key)).toBe('超出家用计算范围');
      expect(message('en', error.key)).toBe('Outside the home-system range of this calculator');
    }
  });
});

it('单独调用面板 STC 入口也遵守范围上限，保留无面板路径', () => {
  expect(() => panelStcs(100, 3000, '2026-11-01')).not.toThrow();
  expect(panelStcs(0, 3000, '2026-11-01').reason).toBe('no_system');
  for (const capacity of [100.01, 101]) expect(() => panelStcs(capacity, 3000, '2026-11-01')).toThrow();
});

describe('容量范围数据与元数据', () => {
  it('上限与 CER 来源独立记录核对日期和 ai 状态，来源页可收录', () => {
    const scope = defaultsVicSchema.parse(defaultsRaw).values.home_system_scope;
    expect(scope.solar_capacity_max_kw).toBe(100);
    expect(scope.last_checked).toBe('2026-10-18');
    expect(scope.checked_by).toBe('ai');
    expect(sourceCatalog().find((record) => record.id.endsWith('/home_system_scope'))).toMatchObject({
      urls: scope.source, lastChecked: scope.last_checked, checkedBy: 'ai',
    });
  });

  it.each([0, -1, Infinity, NaN])('无效上限 %s 被数据 schema 拒绝', (limit) => {
    const data = structuredClone(defaultsRaw);
    data.values.home_system_scope.solar_capacity_max_kw = limit;
    expect(defaultsVicSchema.safeParse(data).success).toBe(false);
  });

  it('数据变更会同步约束表单与计算入口，不依赖代码中写死的容量', async () => {
    const input = formInput('solar_only', 'solarKw', 100);
    const data = structuredClone(defaultsRaw);
    // 仅为数据加载测试缩小范围，不代表实际政策或新的财务期望值。
    const limit = data.values.home_system_scope.solar_capacity_max_kw / 2;
    data.values.home_system_scope.solar_capacity_max_kw = limit;
    vi.resetModules();
    vi.doMock('../data/defaults-vic.json', () => ({ default: data }));
    try {
      const ui = await import('../src/lib/calculator-ui');
      const calc = await import('../src/lib/calc');
      for (const field of ['solarKw', 'existingSolarKw']) expect(ui.numberFieldMax(field)).toBe(limit);
      expect(() => calc.calculateProject({ ...input, solarKw: limit })).not.toThrow();
      expect(() => calc.calculateProject(input)).toThrow();
      expect(() => calc.calculateProject({ ...input, mode: 'battery_only', solarQuote: 0, batteryKwh: 20,
        batteryQuote: 16490, solarKw: undefined, existingSolarKw: 100 })).toThrow();
      expect(() => calc.panelStcs(100, input.postcode, input.installationDate)).toThrow();
      const form = new FormData();
      for (const [name, value] of Object.entries({ ...fields, solarKw: '100' })) form.set(name, value);
      expect(() => ui.readCalculatorForm(form)).toThrow('homeSystemRangeError');
    } finally {
      vi.doUnmock('../data/defaults-vic.json');
      vi.resetModules();
    }
  });
});
