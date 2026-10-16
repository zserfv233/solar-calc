import { describe, it, expect } from 'vitest';
import zh from '../src/i18n/zh.json';
import en from '../src/i18n/en.json';
import {
  annualUsageFromQuarterlyBill,
  batteryStcs,
  calculate,
  panelStcs,
  tariffFor,
  zoneOf,
  type CalcInput,
  type CalcResult,
} from '../src/lib/calc';

// 期望值全部来自 tests/fixtures/hand-calc.md（第 3 步手算，检查点 1 已人工核对），不是 calc.ts 的输出。
// 方案要求误差 < 1%；这里金额按「差额 < 5 分钱」比较，比 1% 更严。

describe('i18n', () => {
  it('zh 和 en 文案键一致', () => {
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort());
  });
});

// 手算的公共输入：Jemena 27.47c，测试用上网电价 5c，STC $38，报价已扣补贴
const base = {
  postcode: 3000,
  installDate: '2026-11-01',
  annualUsageKwh: 5077,
  usageCPerKwh: 27.47,
  feedInCPerKwh: 5,
  stcPrice: 38,
  quoteIncludesRebate: true,
} as const;

const case1: CalcInput = { ...base, mode: 'new_solar', solarKw: 6.6, batteryKwh: 0, occupancy: 'away', solarQuote: 6200, batteryQuote: 0 };
const case2: CalcInput = { ...base, mode: 'new_solar', solarKw: 6.6, batteryKwh: 10, occupancy: 'mostly_home', solarQuote: 6200, batteryQuote: 9240 };
const case3: CalcInput = { ...base, mode: 'battery_only', solarKw: 6.6, batteryKwh: 20, occupancy: 'partly_home', solarQuote: 0, batteryQuote: 16490 };

function ok(input: CalcInput): Extract<CalcResult, { ok: true }> {
  const r = calculate(input);
  if (!r.ok) throw new Error(`计算失败：${r.errors.join(', ')}`);
  return r;
}
const money = (actual: number, expected: number) => expect(actual).toBeCloseTo(expected, 1);
const byEsc = (r: Extract<CalcResult, { ok: true }>, esc: number) => {
  const s = r.scenarios.find((x) => x.escalation === esc);
  if (!s) throw new Error(`没有 ${esc} 的情景`);
  return s;
};

describe('用例 1：墨尔本 6.6 kW，无电池，上班族', () => {
  const r = ok(case1);

  it('第 1 年', () => {
    expect(r.zone).toBe(4);
    money(r.firstYear.selfUseKwh, 1523.1);
    money(r.firstYear.exportKwh, 6297.9);
    expect(r.firstYear.batteryOutKwh).toBe(0);
    money(r.firstYear.saving, 733.29);
    expect(r.firstYear.utilisation).toBeNull();
    expect(r.stc.panel).toBe(39);
    expect(r.stc.battery).toBe(0);
    money(r.netCost, 6200);
  });

  it.each([
    [0, 9, 7246.08, 1046.08, 15, -2016.04],
    [0.03, 9, 7858.56, 1658.56, 13, -1403.56],
    [0.05, 8, 8324.66, 2124.66, 12, -937.47],
  ])('电价年涨 %s：回本、10 年累计和净收益、FiT 0 对比', (esc, pb, cum10, net10, pb0, net10fit0) => {
    const s = byEsc(r, esc);
    expect(s.warranty.paybackYear).toBe(pb);
    money(s.warranty.cumulative10, cum10);
    money(s.warranty.net10, net10);
    expect(s.warranty.batteryYears).toBe(0);
    expect(s.expectedLife).toBeNull();
    expect(s.feedInZero.paybackYear).toBe(pb0);
    money(s.feedInZero.net10, net10fit0);
    expect(s.battery).toBeNull();
  });
});

describe('用例 2：墨尔本 6.6 kW + 10 kWh，基本在家', () => {
  const r = ok(case2);

  it('第 1 年', () => {
    money(r.firstYear.selfUseKwh, 3046.2);
    money(r.firstYear.batteryOutKwh, 1442.6);
    money(r.firstYear.batteryInKwh, 1602.9);
    money(r.firstYear.exportKwh, 3171.9);
    money(r.firstYear.saving, 1391.68);
    expect(r.firstYear.utilisation).toBeCloseTo(0.395, 3);
    expect(r.firstYear.batteryMayBeOversized).toBe(true);
    expect(r.stc.panel).toBe(39);
    expect(r.stc.battery).toBe(68);
    money(r.netCost, 15440);
  });

  it('四季平均一天（夏季）', () => {
    const summer = r.firstYear.seasons.find((x) => x.season === 'summer')!;
    expect(summer.days).toBe(90);
    expect(summer.generationKwh).toBeCloseTo(33.09, 2);
    expect(summer.batteryOutKwh).toBeCloseTo(5.08, 2);
    expect(summer.exportKwh).toBeCloseTo(19.82, 2);
  });

  it.each([
    // 涨幅, 质保期回本, 15 年回本, 10 年累计, 10 年净收益, 质保期放电 MWh, 15 年放电 MWh, FiT 0 回本, FiT 0 净收益
    [0, 12, 12, 13785.12, -1654.88, 14.2, 20.9, 14, -3165.35],
    [0.03, 10, 10, 15578.52, 138.52, 14.2, 20.9, 12, -1371.95],
    [0.05, 10, 10, 16943.14, 1503.14, 14.2, 20.9, 11, -7.33],
  ])('电价年涨 %s：两种寿命口径和 FiT 0', (esc, pbW, pbL, cum10, net10, mwhW, mwhL, pb0, net0) => {
    const s = byEsc(r, esc);
    expect(s.warranty.paybackYear).toBe(pbW);
    expect(s.warranty.batteryYears).toBe(10);
    money(s.warranty.cumulative10, cum10);
    money(s.warranty.net10, net10);
    expect(s.warranty.batteryDischargeKwh / 1000).toBeCloseTo(mwhW, 1);
    expect(s.expectedLife!.paybackYear).toBe(pbL);
    expect(s.expectedLife!.batteryYears).toBe(15);
    expect(s.expectedLife!.batteryDischargeKwh / 1000).toBeCloseTo(mwhL, 1);
    expect(s.feedInZero.paybackYear).toBe(pb0);
    money(s.feedInZero.net10, net0);
  });

  it('0% 涨价时，质保期内未回本（第 12 年才回本，电池只计 10 年）', () => {
    const w = byEsc(r, 0).warranty;
    expect(w.paybackWithinBatteryLife).toBe(false);
    expect(byEsc(r, 0.03).warranty.paybackWithinBatteryLife).toBe(true);
  });

  it.each([
    // 涨幅, 10 年增量省钱, 质保期每度成本, 质保期每度省, 15 年每度成本, 15 年每度省
    [0, 3116.64, 0.65, 0.219, 0.442, 0.219],
    [0.03, 3685.07, 0.65, 0.259, 0.442, 0.284],
    [0.05, 4117.5, 0.65, 0.29, 0.442, 0.337],
  ])('电池部分单独看，电价年涨 %s', (esc, inc10, costW, valW, costL, valL) => {
    const b = byEsc(r, esc).battery!;
    money(b.cost, 9240);
    money(b.warranty.incremental10, inc10);
    expect(b.warranty.paybackYear).toBeNull();
    expect(b.warranty.costPerKwh).toBeCloseTo(costW, 3);
    expect(b.warranty.valuePerKwh).toBeCloseTo(valW, 3);
    expect(b.expectedLife!.paybackYear).toBeNull();
    expect(b.expectedLife!.costPerKwh).toBeCloseTo(costL, 3);
    expect(b.expectedLife!.valuePerKwh).toBeCloseTo(valL, 3);
  });
});

describe('用例 3：已有 6.6 kW，只加 20 kWh，部分在家', () => {
  const r = ok(case3);

  it('第 1 年（只算电池带来的增量）', () => {
    money(r.firstYear.batteryOutKwh, 2180.1);
    money(r.firstYear.batteryInKwh, 2422.3);
    money(r.firstYear.saving, 477.76);
    expect(r.firstYear.utilisation).toBeCloseTo(0.299, 3);
    expect(r.stc.panel).toBe(0);
    expect(r.stc.battery).toBe(119);
    money(r.netCost, 16490);
  });

  it.each([
    [0, 4732.74, -11757.26, 21.6, 32.2, -10557.46, 0.764, 0.219, 0.512, 0.219],
    [0.03, 5597.73, -10892.27, 21.6, 32.2, -9692.47, 0.764, 0.259, 0.512, 0.285],
    [0.05, 6255.83, -10234.17, 21.6, 32.2, -9034.37, 0.764, 0.29, 0.512, 0.339],
  ])('电价年涨 %s：电池寿命内都不回本', (esc, cum10, net10, mwhW, mwhL, net0, costW, valW, costL, valL) => {
    const s = byEsc(r, esc);
    expect(s.warranty.paybackYear).toBeNull();
    expect(s.expectedLife!.paybackYear).toBeNull();
    expect(s.warranty.paybackWithinBatteryLife).toBe(false);
    money(s.warranty.cumulative10, cum10);
    money(s.warranty.net10, net10);
    expect(s.warranty.batteryDischargeKwh / 1000).toBeCloseTo(mwhW, 1);
    expect(s.expectedLife!.batteryDischargeKwh / 1000).toBeCloseTo(mwhL, 1);
    money(s.feedInZero.net10, net0);
    const b = s.battery!;
    money(b.warranty.incremental10, cum10);
    expect(b.warranty.costPerKwh).toBeCloseTo(costW, 3);
    expect(b.warranty.valuePerKwh).toBeCloseTo(valW, 3);
    expect(b.expectedLife!.costPerKwh).toBeCloseTo(costL, 3);
    expect(b.expectedLife!.valuePerKwh).toBeCloseTo(valL, 3);
  });
});

describe('电池 STC 边界（hand-calc.md 最后一张表）', () => {
  it.each([
    [20, '2026-04-30', 20, 168],
    [20, '2026-05-01', 17.6, 119],
    [14, '2026-11-01', 14, 95],
    [28, '2026-11-01', 22.4, 152],
    [50, '2026-11-01', 25.7, 174],
    [60, '2026-11-01', 25.7, 174],
    [20, '2025-06-30', 0, 0],
    [20, '2031-01-01', 0, 0],
  ])('%s kWh，%s 安装', (kwh, date, eligible, count) => {
    const b = batteryStcs(kwh, date);
    expect(b.eligibleKwh).toBeCloseTo(eligible, 6);
    expect(b.count).toBe(count);
  });

  it('无电池为 0 张', () => {
    expect(batteryStcs(0, '2026-11-01').count).toBe(0);
  });
});

describe('太阳能板 STC', () => {
  it('⌊P×R×视同年限⌋，2026 年 5 年、2027 年 4 年', () => {
    expect(panelStcs(6.6, 4, '2026-11-01').count).toBe(39); // 6.6×1.185×5 = 39.1
    expect(panelStcs(6.6, 4, '2027-01-01').count).toBe(31); // 6.6×1.185×4 = 31.3
  });
  it('视同年限表以外的年份不适用', () => {
    expect(panelStcs(6.6, 4, '2031-01-01')).toEqual({ count: 0, applicable: false });
  });
});

describe('邮编', () => {
  it('按区间起止都能匹配', () => {
    expect(zoneOf(3000)).toBe(4);
    expect(zoneOf(3035)).toBe(4);
    expect(zoneOf(3036)).toBe(3);
    expect(zoneOf(3550)).toBe(3); // Bendigo
    expect(zoneOf('3350')).toBe(3); // Ballarat，字符串也接受
    expect(zoneOf(8999)).toBe(4);
  });
  it('非维州或格式不对的邮编返回 null', () => {
    for (const pc of [2000, 2999, 4000, 7999, 9000, 3000.5, 'abc', '']) expect(zoneOf(pc)).toBeNull();
  });
  it('calculate 拒绝非维州邮编', () => {
    const r = calculate({ ...case1, postcode: 2000 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toContain('postcode_not_vic');
  });
});

describe('其他边界', () => {
  it('上网电价为 0：主结果等于 FiT 0 对比', () => {
    const r = ok({ ...case1, feedInCPerKwh: 0 });
    expect(byEsc(r, 0).warranty.paybackYear).toBe(15);
    money(byEsc(r, 0).warranty.net10, -2016.04);
  });

  it('报价未扣补贴：净成本减去 STC × 单价', () => {
    // 用例 2：39 张板 + 68 张电池，×$38 = $4,066
    const r = ok({ ...case2, quoteIncludesRebate: false, solarQuote: 6200 + 39 * 38, batteryQuote: 9240 + 68 * 38 });
    money(r.netCost, 15440);
    expect(r.stc.rebateDollars).toBe(107 * 38);
    // 电池部分的成本也只扣电池的 STC
    money(byEsc(r, 0).battery!.cost, 9240);
  });

  it('报价已扣补贴：不再减', () => {
    expect(ok(case2).stc.rebateDollars).toBe(0);
  });

  it('补贴不会把净成本减成负数', () => {
    expect(ok({ ...case1, quoteIncludesRebate: false, solarQuote: 100 }).netCost).toBe(0);
  });

  it('安装日期超出政策期间时给出提示', () => {
    const r = ok({ ...case2, installDate: '2031-01-01', quoteIncludesRebate: false, solarQuote: 6200, batteryQuote: 9240 });
    expect(r.stc.panel).toBe(0);
    expect(r.stc.battery).toBe(0);
    expect(r.warnings).toEqual(expect.arrayContaining(['panel_stc_not_applicable', 'battery_stc_not_applicable']));
    money(r.netCost, 15440);
  });

  it('2025-07-01 之前安装，电池没有 STC', () => {
    const r = ok({ ...case2, installDate: '2025-06-30' });
    expect(r.stc.battery).toBe(0);
    expect(r.warnings).toContain('battery_stc_not_applicable');
  });

  it('日期格式不对时拒绝', () => {
    for (const d of ['2026-13-01', '2026/11/01', '']) {
      const r = calculate({ ...case1, installDate: d });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors).toContain('install_date_invalid');
    }
  });

  it('负数或缺少的数字被拒绝', () => {
    const r = calculate({ ...case2, batteryKwh: -1, annualUsageKwh: Number.NaN });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toEqual(expect.arrayContaining(['battery_kwh_invalid', 'annual_usage_invalid']));
  });

  it('只加电池但电池为 0 时拒绝', () => {
    const r = calculate({ ...case3, batteryKwh: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toContain('battery_kwh_invalid');
  });

  it('利用率不超过 100%', () => {
    const r = ok({ ...case2, batteryKwh: 2 });
    expect(r.firstYear.utilisation!).toBeLessThanOrEqual(1);
    expect(r.firstYear.batteryMayBeOversized).toBe(false);
  });

  it('吞吐上限在年中触发：电池计收益年数少于寿命，累计放电正好等于上限', () => {
    // 2 kWh 小电池每天都充满放空，3 MWh/kWh 的上限 6 MWh 会在第 10 年前用完
    const w = byEsc(ok({ ...case2, batteryKwh: 2 }), 0).expectedLife!;
    expect(w.batteryYears).toBeLessThan(15);
    expect(w.batteryDischargeKwh).toBeCloseTo(6000, 6);
  });

  it('不写死数字：同一输入换配电区电价，结果跟着变', () => {
    const a = ok(case1).firstYear.saving;
    const b = ok({ ...case1, usageCPerKwh: 31.98 }).firstYear.saving;
    expect(b).toBeGreaterThan(a);
  });
});

describe('从季度电费反推年用电', () => {
  it('先扣供电费再除以电价', () => {
    // 手算：Jemena 供电费 1.2713 × 91.25 天 = $116.01；($400 − 116.01) ÷ $0.2747 = 1,033.8 kWh/季度；× 4 = 4,135.3 kWh
    expect(annualUsageFromQuarterlyBill(400, tariffFor('Jemena'))).toBeCloseTo(4135.3, 0);
  });
  it('电费不够付供电费时返回 null', () => {
    expect(annualUsageFromQuarterlyBill(100, tariffFor('Jemena'))).toBeNull();
  });
  it('配电区电价来自 data/', () => {
    expect(tariffFor('AusNet Services')).toEqual({ usageCPerKwh: 31.98, supplyDollarsPerDay: 1.2824 });
  });
});
