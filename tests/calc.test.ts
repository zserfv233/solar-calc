import { describe, it, expect } from 'vitest';
import zh from '../src/i18n/zh.json';
import en from '../src/i18n/en.json';
import { annualUsageFromBill, batteryStcs, calculateProject, panelStcs, zoneForPostcode, type CalculationInput } from '../src/lib/calc';
import { defaultsVic, postcodes } from '../src/lib/data';

describe('i18n', () => {
  it('zh 和 en 文案键一致', () => {
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort());
  });
});

// 数值均抄自 hand-calc.md 的公共输入、三个用例及其 0/3/5% 表。
// 保留已四舍五入的手算数值，绝不通过计算模块生成期望值。
const common = {
  postcode: 3000, installationDate: '2026-11-01', solarKw: 6.6, existingSolarKw: 6.6,
  annualUsageKwh: 5077, importTariffCents: 27.47, feedInTariffCents: 5,
  stcPrice: 38, quoteIncludesRebate: true,
};
const cases = [
  {
    name: '用例 1：无电池，上班族',
    input: { ...common, mode: 'solar', batteryKwh: 0, daytimeShare: 'away', solarQuote: 6200, batteryQuote: 0 },
    saving: 733.29, utilisation: null, panelStcs: 39, batteryStcs: 0,
    direct: 1523.1, discharge: 0, charge: 0, exported: 6297.9,
    paybacks: [9, 9, 8], savings: [7246.08, 7858.56, 8324.66],
    nets: [1046.08, 1658.56, 2124.66], zeroFitPaybacks: [15, 13, 12],
    zeroFitNets: [-2016.04, -1403.56, -937.47],
    zeroFitExpectedPaybacks: [15, 13, 12], benefitYears: [null, null], oversized: false,
    // hand-calc.md 的 STC 张数 × 公共输入 $38；独立推导金额。
    panelRebate: 1482, batteryRebate: 0,
    dischargeMwh: [0, 0], costs: [null, null], averageSavings: [[], []], incremental: [],
  },
  {
    name: '用例 2：太阳能加 10 kWh 电池，基本在家',
    input: { ...common, mode: 'solar', batteryKwh: 10, daytimeShare: 'mostly_home', solarQuote: 6200, batteryQuote: 9240 },
    saving: 1391.68, utilisation: 0.395, panelStcs: 39, batteryStcs: 68,
    direct: 3046.2, discharge: 1442.6, charge: 1602.9, exported: 3171.9,
    paybacks: [12, 10, 10], savings: [13785.12, 15578.52, 16943.14],
    nets: [-1654.88, 138.52, 1503.14], zeroFitPaybacks: [14, 12, 11],
    zeroFitNets: [-3165.35, -1371.95, -7.33],
    zeroFitExpectedPaybacks: [13, 11, 11], benefitYears: [10, 15], oversized: true,
    panelRebate: 1482, batteryRebate: 2584,
    dischargeMwh: [14.2, 20.9], costs: [0.650, 0.442],
    averageSavings: [[0.219, 0.259, 0.290], [0.219, 0.284, 0.337]],
    incremental: [3116.64, 3685.07, 4117.50],
  },
  {
    name: '用例 3：已有太阳能，只加 20 kWh 电池，部分在家',
    input: { ...common, mode: 'battery_only', batteryKwh: 20, daytimeShare: 'partly_home', solarQuote: 0, batteryQuote: 16490 },
    saving: 477.76, utilisation: 0.299, panelStcs: 0, batteryStcs: 119,
    direct: 2284.6, discharge: 2180.1, charge: 2422.3, exported: 3114.0,
    paybacks: [null, null, null], savings: [4732.74, 5597.73, 6255.83],
    nets: [-11757.26, -10892.27, -10234.17], zeroFitPaybacks: [null, null, null],
    zeroFitNets: [-10557.46, -9692.47, -9034.37],
    zeroFitExpectedPaybacks: [null, null, null], benefitYears: [10, 15], oversized: true,
    panelRebate: 0, batteryRebate: 4522,
    dischargeMwh: [21.6, 32.2], costs: [0.764, 0.512],
    averageSavings: [[0.219, 0.259, 0.290], [0.219, 0.285, 0.339]],
    incremental: [4732.74, 5597.73, 6255.83],
  },
] satisfies { name: string; input: CalculationInput; [key: string]: unknown }[];

function matchesHandCalc(actual: number, expected: number) {
  if (expected === 0) expect(actual).toBe(expected);
  else expect(Math.abs(actual - expected) / Math.abs(expected)).toBeLessThan(0.01);
}

describe.each(cases)('$name（独立手算，误差小于 1%）', (fixture) => {
  it('第 1 年电量、省钱、放电端利用率和 STC 一致', () => {
    const result = calculateProject(fixture.input);
    matchesHandCalc(result.firstYear.savings, fixture.saving);
    matchesHandCalc(result.firstYear.directKwh, fixture.direct);
    matchesHandCalc(result.firstYear.dischargeKwh, fixture.discharge);
    matchesHandCalc(result.firstYear.chargeKwh, fixture.charge);
    matchesHandCalc(result.firstYear.exportKwh, fixture.exported);
    if (fixture.utilisation === null) expect(result.utilisation).toBeNull();
    else matchesHandCalc(result.utilisation!, fixture.utilisation);
    expect(result.subsidies.panel.count).toBe(fixture.panelStcs);
    expect(result.subsidies.battery.count).toBe(fixture.batteryStcs);
    expect(result.subsidies.panelRebate).toBe(fixture.panelRebate);
    expect(result.subsidies.batteryRebate).toBe(fixture.batteryRebate);
    // hand-calc.md 三个用例均明确列出第 1 年全年发电为 7,821.0 kWh。
    expect(result.firstYear.generationKwh).toBeCloseTo(7821.0);
    expect(result.batteryMayBeOversized).toBe(fixture.oversized);
    expect(result.netCost).toBe(fixture.input.solarQuote + fixture.input.batteryQuote);
  });

  it('两套寿命、三个涨价情景、FiT 为零和电池增量结果一致', () => {
    const result = calculateProject(fixture.input);
    for (const [lifeIndex, basis] of ['warranty', 'expected'].entries()) {
      const scenarios = result.scenarios.filter((s) => s.basis === basis);
      scenarios.forEach((s, i) => {
        expect(s.years[0].generationKwh).toBeCloseTo(7821.0);
        expect(s.battery.benefitYears).toBe(fixture.benefitYears[lifeIndex]);
        expect(s.paybackYear).toBe(fixture.paybacks[i]);
        matchesHandCalc(s.tenYearSavings, fixture.savings[i]);
        matchesHandCalc(s.tenYearNetBenefit, fixture.nets[i]);
        matchesHandCalc(s.battery.cumulativeDischargeKwh / 1000, fixture.dischargeMwh[lifeIndex]);
        if (fixture.input.batteryKwh > 0) {
          matchesHandCalc(s.battery.costPerKwh!, fixture.costs[lifeIndex]!);
          matchesHandCalc(s.battery.averageSavingsPerKwh!, fixture.averageSavings[lifeIndex][i]);
          matchesHandCalc(s.battery.tenYearIncrementalSavings, fixture.incremental[i]);
          expect(s.battery.incrementalPaybackYear).toBeNull();
        }
      });
      const zeroFit = result.zeroFeedInScenarios.filter((s) => s.basis === basis);
      expect(zeroFit).toHaveLength(fixture.zeroFitPaybacks.length);
      zeroFit.forEach((s, i) => {
        expect(s.paybackYear).toBe((basis === 'warranty' ? fixture.zeroFitPaybacks : fixture.zeroFitExpectedPaybacks)[i]);
        expect(s.battery.benefitYears).toBe(fixture.benefitYears[lifeIndex]);
        matchesHandCalc(s.tenYearNetBenefit, fixture.zeroFitNets[i]);
      });
    }
  });
});

describe('电池 STC（CLAUDE.md「电池 STC 边界核对值」表）', () => {
  it.each([
    [20, '2026-04-30', 168], [20, '2026-05-01', 119],
    [14, '2026-11-01', 95], [28, '2026-11-01', 152],
    [50, '2026-11-01', 174], [60, '2026-11-01', 174],
    [20, '2025-06-30', 0], [20, '2031-01-01', 0],
  ] as const)('%s kWh，%s → %s 张', (capacity, date, expected) => {
    expect(batteryStcs(capacity, date).count).toBe(expected);
  });
});

describe('2027–2030 半年政策及 2031 退出边界', () => {
  // 已独立核对 AGENTS.md 参数：面板 floor(6.6 × 1.185 × 视同年限)；
  // 电池计入容量 14 + 6 × 60% = 17.6 kWh，再乘各期系数并向下取整。
  // 期望值为用户给出的数值，不从计算函数输出生成。
  it.each([
    ['2026-12-31', 39, 119],
    ['2027-01-01', 31, 100], ['2027-07-01', 31, 91],
    ['2028-01-01', 23, 80], ['2028-07-01', 23, 72],
    ['2029-01-01', 15, 63], ['2029-07-01', 15, 54],
    ['2030-01-01', 7, 45], ['2030-07-01', 7, 36],
    ['2031-01-01', 0, 0],
  ] as const)('%s：面板 %s 张 / 电池 %s 张', (date, panels, batteries) => {
    expect(panelStcs(6.6, 3000, date).count).toBe(panels);
    expect(batteryStcs(20, date).count).toBe(batteries);
    const result = calculateProject({ ...cases[1].input, batteryKwh: 20, installationDate: date });
    expect(result.subsidies.panel.count).toBe(panels);
    expect(result.subsidies.battery.count).toBe(batteries);
  });
});

describe('电池标称容量资格提示', () => {
  it('有电池的计算结果提供中英文提示，资格逻辑保持不变', () => {
    // 方案 2：可用容量与标称容量不等价；这里仅提示，不用可用容量代替资格检查。
    for (const batteryKwh of [1, 20, 101]) {
      const result = calculateProject({ ...cases[2].input, batteryKwh });
      expect(result.notices).toEqual(['batteryRebateEligibilityNotice']);
      expect(result.subsidies.battery.applicable).toBe(true);
      for (const key of result.notices) {
        expect(zh[key]).toBe('电池补贴只适用于标称容量 5–100 kWh 的电池。');
        expect(en[key]).toBe('The battery rebate only applies to batteries with a nominal capacity of 5–100 kWh.');
      }
    }
    expect(calculateProject(cases[0].input).notices).toEqual([]);
  });
});

// 以下测试只检查边界行为、单位和守恒性质，不引入新的财务数值期望。
describe('无放电和异常输入', () => {
  it('极端报价和上网电价导致最终净收益减法溢出时明确报错', () => {
    expect(() => calculateProject({ ...cases[2].input,
      batteryQuote: 1.7e308, feedInTariffCents: 1e305,
    })).toThrow(RangeError);
  });

  it('年用电为零时，电池无放电；计收益年数和每度指标为空，不出现 0 年或非有限值', () => {
    const result = calculateProject({ ...cases[2].input, annualUsageKwh: 0 });
    for (const s of [...result.scenarios, ...result.zeroFeedInScenarios]) {
      expect(s.battery.status).toBe('no_discharge');
      expect(s.battery.benefitYears).toBeNull();
      expect(s.battery.costPerKwh).toBeNull();
      expect(s.battery.averageSavingsPerKwh).toBeNull();
      expect(s.battery.incrementalPaybackYear).toBeNull();
      expect(s.paybackYear).toBeNull();
      expect(Number.isFinite(s.tenYearNetBenefit)).toBe(true);
    }
  });

  it('太阳能很小时没有余电，也不会把电池计收益期写成 0 年', () => {
    const result = calculateProject({ ...cases[2].input, existingSolarKw: Number.EPSILON });
    expect(result.scenarios.every((s) => s.battery.status === 'no_discharge' && s.battery.benefitYears === null)).toBe(true);
  });

  it.each([
    { postcode: 2000 }, { postcode: 4000 }, { postcode: 7999 }, { postcode: 9000 },
    { postcode: 3000.5 }, { installationDate: '2026-02-30' },
    { batteryKwh: -1 }, { annualUsageKwh: -1 }, { solarKw: 0 },
    { importTariffCents: 0 }, { feedInTariffCents: -1 }, { solarQuote: -1 },
    { stcPrice: Number.NaN }, { solarKw: Number.POSITIVE_INFINITY },
    { solarKw: Number.MAX_VALUE }, { distributor: 'toString' },
  ])('拒绝不合法输入 %j', (invalid) => {
    expect(() => calculateProject({ ...cases[1].input, ...invalid })).toThrow();
  });

  it('所有维州邮编区间的起止点都按数据表匹配', () => {
    for (const r of postcodes.values.ranges) {
      expect(zoneForPostcode(r.from)).toBe(String(r.zone));
      expect(zoneForPostcode(r.to)).toBe(String(r.zone));
    }
  });

  it('政策表外明确返回不适用，计算仍可使用用户已扣补贴报价', () => {
    const result = calculateProject({ ...cases[1].input, installationDate: '2031-01-01' });
    expect(result.subsidies.panel.reason).toBe('outside_policy');
    expect(result.subsidies.battery.reason).toBe('outside_policy');
    expect(result.subsidies.battery.applicable).toBe(false);
    expect(() => panelStcs(6.6, 3000, 'invalid')).toThrow();
    expect(() => batteryStcs(-1, common.installationDate)).toThrow();
  });
});

describe('增量口径和能量边界', () => {
  it('用例 2 的四季平均日与手算逐行一致', () => {
    const result = calculateProject(cases[1].input);
    // hand-calc.md「用例 2」：天数、G、L_day、L_night、D、B_out、B、X。
    const rows = [
      [90, 33.09, 7.62, 5.08, 7.62, 5.08, 5.64, 19.82],
      [92, 16.76, 7.60, 5.07, 7.60, 5.07, 5.63, 3.54],
      [92, 11.13, 10.47, 6.98, 10.47, 0.59, 0.66, 0],
      [91, 25.02, 7.67, 5.11, 7.67, 5.11, 5.68, 11.67],
    ];
    result.firstYear.seasons.forEach((s, i) => {
      [s.days, s.generationKwh, s.daytimeLoadKwh, s.nighttimeLoadKwh, s.directKwh,
        s.dischargeKwh, s.chargeKwh, s.exportKwh].forEach((actual, j) => matchesHandCalc(actual, rows[i][j]));
    });
  });

  it('省略价格等可选项时从 data/ 取默认值，已扣补贴为默认口径', () => {
    const explicit = calculateProject({ ...cases[1].input,
      feedInTariffCents: defaultsVic.values.feed_in_tariff_c_per_kwh });
    const implicit = calculateProject({ ...cases[1].input, annualUsageKwh: undefined,
      importTariffCents: undefined, feedInTariffCents: undefined, quoteIncludesRebate: undefined });
    expect(implicit).toEqual(explicit);
    const distributor = Object.keys(defaultsVic.values.vdo_flat_2026_27)[0];
    const chosen = calculateProject({ ...cases[1].input, distributor, importTariffCents: undefined });
    const manual = calculateProject({ ...cases[1].input,
      importTariffCents: defaultsVic.values.vdo_flat_2026_27[distributor].usage_c_per_kwh });
    expect(chosen.firstYear).toEqual(manual.firstYear);
  });

  it('未扣补贴报价与相同净报价的结果一致；补贴超过报价时拒绝', () => {
    const net = calculateProject(cases[1].input);
    const gross = calculateProject({ ...cases[1].input, quoteIncludesRebate: false,
      solarQuote: cases[1].input.solarQuote + net.subsidies.panelRebate,
      batteryQuote: cases[1].input.batteryQuote + net.subsidies.batteryRebate });
    expect(gross.netCost).toBe(net.netCost);
    expect(gross.scenarios).toEqual(net.scenarios);
    expect(() => calculateProject({ ...cases[1].input, quoteIncludesRebate: false, batteryQuote: 0 })).toThrow();
  });

  it('既有光伏使用 existingSolarKw；电池增量等于同一家庭有电池减无电池', () => {
    const combined = calculateProject(cases[1].input);
    const solar = calculateProject({ ...cases[1].input, batteryKwh: 0, batteryQuote: 0 });
    const battery = calculateProject({ ...cases[1].input, mode: 'battery_only', solarQuote: 0 });
    const ignoredNewSolarSize = calculateProject({ ...cases[2].input, solarKw: 14 });
    expect(ignoredNewSolarSize.firstYear).toEqual(calculateProject(cases[2].input).firstYear);
    combined.scenarios.forEach((s, i) => {
      s.years.forEach((y, j) => {
        expect(y.savings - solar.scenarios[i].years[j].savings).toBeCloseTo(y.incrementalSavings);
        expect(battery.scenarios[i].years[j].savings).toBeCloseTo(y.incrementalSavings);
      });
    });
  });

  it('高日照、高夜间负荷下年中达到吞吐上限，剩余时间仍按无电池发电', () => {
    const input = { ...cases[1].input, solarKw: common.solarKw * 10, annualUsageKwh: common.annualUsageKwh * 10 };
    const result = calculateProject(input);
    const baseline = calculateProject({ ...input, batteryKwh: 0, batteryQuote: 0 });
    const limit = input.batteryKwh * defaultsVic.values.battery_warranty.throughput_mwh_per_usable_kwh * 1000;
    result.scenarios.filter((s) => s.basis === 'expected').forEach((s) => {
      expect(s.years.some((y) => y.batteryFraction > 0 && y.batteryFraction < 1)).toBe(true);
      expect(s.battery.cumulativeDischargeKwh).toBeCloseTo(limit);
      const solarScenario = baseline.scenarios.find((b) => b.basis === s.basis && b.escalation === s.escalation)!;
      for (const y of s.years) {
        expect(y.cumulativeDischargeKwh).toBeLessThanOrEqual(limit);
        expect(y.directKwh + y.chargeKwh + y.exportKwh).toBeCloseTo(y.generationKwh);
        if (y.year > s.battery.benefitYears!) expect(y.savings).toBeCloseTo(solarScenario.years[y.year - 1].savings);
      }
    });
  });

  it('账单反推会先扣供电费；合成账单恢复手算公共输入的 5077 kWh', () => {
    const days = 90; // 手算夏季的账期天数；只做反推往返，不编造财务标准答案。
    const tariff = defaultsVic.values.vdo_flat_2026_27[defaultsVic.values.default_distributor];
    const bill = common.annualUsageKwh * days / 365 * common.importTariffCents / 100 + tariff.supply_dollars_per_day * days;
    expect(annualUsageFromBill({ totalDollars: bill, days })).toBeCloseTo(common.annualUsageKwh);
    expect(() => annualUsageFromBill({ totalDollars: bill, days: 0 })).toThrow();
    expect(() => annualUsageFromBill({ totalDollars: 0, days })).toThrow();
  });
});
