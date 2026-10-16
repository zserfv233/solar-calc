// 计算逻辑（纯函数，不碰页面）。所有政策、价格和质保数字都从 data/ 读取（经 ./data 校验）。
// 模型与 tests/fixtures/hand_calc.py 一致：四季各一个平均日，乘天数加总成全年；电池默认每天充满，
// 按稳定状态计算（B_out = min(E×η, C_n, L_night)，B = B_out/η）；逐年计算面板衰减、电价上涨和电池容量衰减。
import { batteryRebate, defaultsVic, postcodes, seasonalVic, stcZones } from './data';

/** 逐年计算多少年。用例 1 在上网电价为 0 时第 15 年才回本，所以要比电池寿命长得多。 */
const HORIZON_YEARS = 30;
/** 电池利用率低于这个值时提示「电池可能偏大」（2026-10-15 与用户确定）。 */
const UTILISATION_WARNING_BELOW = 0.6;

export type Occupancy = keyof typeof defaultsVic.values.assumptions_from_plan.daytime_share;
export type Mode = 'new_solar' | 'battery_only';
type Season = (typeof seasonalVic.values.seasons)[number]['name'];

export interface CalcInput {
  postcode: number | string;
  /** 预计安装日期，YYYY-MM-DD */
  installDate: string;
  annualUsageKwh: number;
  occupancy: Occupancy;
  /** new_solar：新装太阳能（可带电池）；battery_only：已有太阳能，只加电池，只算电池带来的增量 */
  mode: Mode;
  /** 新装系统大小；battery_only 时是已有系统大小 */
  solarKw: number;
  /** 电池可用容量（放电端），0 表示不装电池 */
  batteryKwh: number;
  solarQuote: number;
  batteryQuote: number;
  /** 报价是否已经扣了 STC 补贴（默认是） */
  quoteIncludesRebate: boolean;
  usageCPerKwh: number;
  feedInCPerKwh: number;
  stcPrice: number;
}

export type CalcError =
  | 'postcode_not_vic'
  | 'install_date_invalid'
  | 'annual_usage_invalid'
  | 'solar_kw_invalid'
  | 'battery_kwh_invalid'
  | 'quote_invalid'
  | 'price_invalid';
export type CalcWarning = 'panel_stc_not_applicable' | 'battery_stc_not_applicable';

export interface SeasonDay {
  season: Season;
  days: number;
  generationKwh: number;
  dayLoadKwh: number;
  nightLoadKwh: number;
  selfUseKwh: number;
  surplusKwh: number;
  batteryOutKwh: number;
  batteryInKwh: number;
  exportKwh: number;
}

export interface Simulation {
  /** 累计省钱第一次达到净成本的年份；30 年内没有就是 null */
  paybackYear: number | null;
  /** 回本年份不晚于电池计收益的最后一年（无电池时只看是否回本） */
  paybackWithinBatteryLife: boolean;
  cumulative10: number;
  /** 10 年净收益，未计维护及资金成本 */
  net10: number;
  /** 电池计收益的年数（质保年限、预期寿命、吞吐上限先到者） */
  batteryYears: number;
  batteryDischargeKwh: number;
  /** 第 1–30 年的累计省钱 */
  cumulative: number[];
}

export interface BatteryView {
  incremental10: number;
  /** 电池带来的累计增量省钱第一次达到电池成本的年份；电池计收益期间达不到就是 null */
  paybackYear: number | null;
  /** 电池成本 ÷ 计收益期间累计放电量（思路同 HOMER 电池损耗成本） */
  costPerKwh: number;
  /** 同一期间电池带来的累计增量省钱 ÷ 同一期间累计放电量 */
  valuePerKwh: number;
}

export interface Scenario {
  escalation: number;
  warranty: Simulation;
  /** 按预期寿命上端（政府指南 10–15 年的 15 年）；无电池时为 null */
  expectedLife: Simulation | null;
  /** 同样输入、上网电价为 0（只算质保期） */
  feedInZero: Simulation;
  /** 电池部分单独看；无电池时为 null */
  battery: { cost: number; warranty: BatteryView; expectedLife: BatteryView } | null;
}

export type CalcResult =
  | { ok: false; errors: CalcError[] }
  | {
      ok: true;
      zone: number;
      zoneRating: number;
      warnings: CalcWarning[];
      stc: { panel: number; battery: number; batteryEligibleKwh: number; rebateDollars: number };
      netCost: number;
      firstYear: {
        seasons: SeasonDay[];
        selfUseKwh: number;
        batteryOutKwh: number;
        batteryInKwh: number;
        exportKwh: number;
        saving: number;
        /** 全年平均每天放电 ÷ 可用容量；无电池为 null */
        utilisation: number | null;
        batteryMayBeOversized: boolean;
      };
      scenarios: Scenario[];
    };

const A = defaultsVic.values.assumptions_from_plan;
const W = defaultsVic.values.battery_warranty;
const LIFE = defaultsVic.values.battery_expected_life;

// ---------- 邮编、补贴 ----------

/** 维州邮编 → STC 分区；不是维州邮编或格式不对时返回 null。 */
export function zoneOf(postcode: number | string): number | null {
  const s = String(postcode).trim();
  if (!/^\d{4}$/.test(s)) return null;
  const pc = Number(s);
  return postcodes.values.ranges.find((r) => r.from <= pc && pc <= r.to)?.zone ?? null;
}

function isIsoDate(d: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const t = new Date(`${d}T00:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d;
}

/** 太阳能板 STC = ⌊P × R × 视同年限⌋；安装年份不在视同年限表里时不适用。 */
export function panelStcs(kw: number, zone: number, installDate: string): { count: number; applicable: boolean } {
  const years = stcZones.values.deeming_years_by_install_year[installDate.slice(0, 4)];
  if (years === undefined) return { count: 0, applicable: false };
  const R = stcZones.values.zone_ratings[String(zone) as '1' | '2' | '3' | '4'];
  return { count: Math.floor(kw * R * years), applicable: true };
}

/**
 * 电池 STC：2025-07-01 起才有；2026-05-01 前按全部可用容量计，之后按三档；最多计 50 kWh；向下取整。
 * 系数表以外的日期不适用。
 */
export function batteryStcs(kwh: number, installDate: string): { count: number; eligibleKwh: number; applicable: boolean } {
  const v = batteryRebate.values;
  const period = v.factor_periods.find((p) => p.start <= installDate && installDate <= p.end);
  const applicable = period !== undefined && installDate >= v.eligible_from;
  if (kwh <= 0 || !applicable) return { count: 0, eligibleKwh: 0, applicable };
  const capped = Math.min(kwh, v.stc_cap_usable_kwh);
  const eligibleKwh =
    installDate < v.tiers_effective_from
      ? capped
      : v.tiers.reduce((sum, t) => sum + t.share * Math.max(0, Math.min(capped, t.to_kwh) - t.from_kwh), 0);
  return { count: Math.floor(period.factor * eligibleKwh), eligibleKwh, applicable };
}

// ---------- 电量 ----------

interface SeasonShare {
  season: Season;
  days: number;
  generationShare: number;
  loadShare: number;
}

/** 每季的天数、发电占全年比例（BOM 月日照 × 天数）、用电占全年比例（AER 四季用电）。 */
function seasonShares(zone: number): SeasonShare[] {
  const sv = seasonalVic.values;
  const solar = sv.solar_mj_per_m2_day_by_zone[String(zone) as '1' | '2' | '3' | '4'];
  if (!solar) throw new Error(`分区 ${zone} 没有季节日照数据`);
  const mj = solar.monthly;
  const dm = sv.days_in_month;
  const totalMj = mj.reduce((sum, x, m) => sum + x * dm[m], 0);
  const totalLoad = Object.values(sv.load_kwh_by_season).reduce((a, b) => a + b, 0);
  return sv.seasons.map((s) => {
    const ms = s.months.map((m) => m - 1);
    return {
      season: s.name,
      days: ms.reduce((sum, m) => sum + dm[m], 0),
      generationShare: ms.reduce((sum, m) => sum + mj[m] * dm[m], 0) / totalMj,
      loadShare: sv.load_kwh_by_season[s.name] / totalLoad,
    };
  });
}

interface YearFlows {
  selfUse: number;
  batteryIn: number;
  batteryOut: number;
  exported: number;
  seasons: SeasonDay[];
}

/** 一年的电量（kWh/年）：每季按平均一天算，再乘天数加总。 */
function yearFlows(
  shares: SeasonShare[],
  generationYear: number,
  annualUsage: number,
  dayShare: number,
  capacity: number,
): YearFlows {
  const eta = A.round_trip_efficiency;
  const out: YearFlows = { selfUse: 0, batteryIn: 0, batteryOut: 0, exported: 0, seasons: [] };
  for (const s of shares) {
    const G = (generationYear * s.generationShare) / s.days;
    const L = (annualUsage * s.loadShare) / s.days;
    const Lday = L * dayShare;
    const Lnight = L - Lday;
    const D = Math.min(G, Lday);
    const E = G - D;
    const Bout = capacity > 0 ? Math.min(E * eta, capacity, Lnight) : 0;
    const B = Bout / eta;
    const X = E - B;
    out.selfUse += s.days * D;
    out.batteryIn += s.days * B;
    out.batteryOut += s.days * Bout;
    out.exported += s.days * X;
    out.seasons.push({
      season: s.season,
      days: s.days,
      generationKwh: G,
      dayLoadKwh: Lday,
      nightLoadKwh: Lnight,
      selfUseKwh: D,
      surplusKwh: E,
      batteryOutKwh: Bout,
      batteryInKwh: B,
      exportKwh: X,
    });
  }
  return out;
}

// ---------- 逐年 ----------

interface Prepared {
  mode: Mode;
  shares: SeasonShare[];
  generationYear: number;
  annualUsage: number;
  dayShare: number;
  capacity: number;
  usage: number;
  feedIn: number;
  netCost: number;
}

function yearSaving(p: Prepared, f: YearFlows, price: number, feedIn: number): number {
  return p.mode === 'new_solar'
    ? (f.selfUse + f.batteryOut) * price + f.exported * feedIn
    : f.batteryOut * price - f.batteryIn * feedIn;
}

function simulate(p: Prepared, escalation: number, lifeYears: number, feedIn: number, capacity = p.capacity): Simulation {
  const limitKwh = capacity * W.throughput_mwh_per_usable_kwh * 1000;
  let cum = 0;
  let discharged = 0;
  let batteryYears = 0;
  let paybackYear: number | null = null;
  const cumulative: number[] = [];
  for (let n = 1; n <= HORIZON_YEARS; n++) {
    const gen = p.generationYear * (1 - A.panel_degradation_per_year) ** (n - 1);
    const price = p.usage * (1 + escalation) ** (n - 1);
    let Cn = 0;
    if (capacity > 0 && n <= lifeYears && discharged < limitKwh) {
      Cn = Math.max(0, capacity * (1 - ((1 - W.end_of_warranty_retention) * (n - 1)) / W.warranty_years));
    }
    const withBattery = yearFlows(p.shares, gen, p.annualUsage, p.dayShare, Cn);
    // 吞吐上限在年中触发时，当年只有 k 的部分有电池
    const k = withBattery.batteryOut > 0 ? Math.min(1, (limitKwh - discharged) / withBattery.batteryOut) : 0;
    if (k > 0) batteryYears = n;
    const without = yearFlows(p.shares, gen, p.annualUsage, p.dayShare, 0);
    cum += k * yearSaving(p, withBattery, price, feedIn) + (1 - k) * yearSaving(p, without, price, feedIn);
    discharged += k * withBattery.batteryOut;
    if (paybackYear === null && cum >= p.netCost) paybackYear = n;
    cumulative.push(cum);
  }
  return {
    paybackYear,
    paybackWithinBatteryLife: paybackYear !== null && (capacity <= 0 || paybackYear <= batteryYears),
    cumulative10: cumulative[9],
    net10: cumulative[9] - p.netCost,
    batteryYears,
    batteryDischargeKwh: discharged,
    cumulative,
  };
}

function batteryView(p: Prepared, cost: number, escalation: number, lifeYears: number): BatteryView {
  const withB = simulate(p, escalation, lifeYears, p.feedIn);
  // 只加电池时，省的钱本身就是增量；新装太阳能时减去同样太阳能、没有电池的情况
  const withoutB = p.mode === 'new_solar' ? simulate(p, escalation, lifeYears, p.feedIn, 0).cumulative : null;
  const inc = withB.cumulative.map((c, i) => c - (withoutB ? withoutB[i] : 0));
  // 电池停止计收益后增量不再增加，所以增量回本只可能出现在电池计收益的年份里
  const idx = inc.findIndex((x) => x >= cost);
  const discharged = withB.batteryDischargeKwh;
  return {
    incremental10: inc[9],
    paybackYear: idx >= 0 ? idx + 1 : null,
    costPerKwh: discharged > 0 ? cost / discharged : Number.POSITIVE_INFINITY,
    valuePerKwh: discharged > 0 ? inc[lifeYears - 1] / discharged : 0,
  };
}

// ---------- 输入辅助 ----------

export type Distributor = keyof typeof defaultsVic.values.vdo_flat_2026_27;

/** 配电区的维州默认电价（VDO 2026–27，含 GST），给页面的配电区下拉框用。 */
export function tariffFor(distributor: Distributor): { usageCPerKwh: number; supplyDollarsPerDay: number } {
  const t = defaultsVic.values.vdo_flat_2026_27[distributor];
  return { usageCPerKwh: t.usage_c_per_kwh, supplyDollarsPerDay: t.supply_dollars_per_day };
}

/**
 * 用一个季度的电费反推年用电量：先扣掉这个季度的供电费（每天供电费 × 365/4 天），
 * 剩下的除以电价得到季度用电，再乘 4。电费不够付供电费时返回 null。
 * 只按一个季度推算，没有考虑季节差异（冬季电费会推高全年用电），页面上要提示。
 */
export function annualUsageFromQuarterlyBill(
  billDollars: number,
  tariff: { usageCPerKwh: number; supplyDollarsPerDay: number },
): number | null {
  const energyDollars = billDollars - tariff.supplyDollarsPerDay * (365 / 4);
  if (!Number.isFinite(energyDollars) || energyDollars <= 0 || tariff.usageCPerKwh <= 0) return null;
  return (energyDollars / (tariff.usageCPerKwh / 100)) * 4;
}

// ---------- 入口 ----------

const nonNeg = (x: number) => Number.isFinite(x) && x >= 0;

export function calculate(input: CalcInput): CalcResult {
  const errors: CalcError[] = [];
  const zone = zoneOf(input.postcode);
  if (zone === null) errors.push('postcode_not_vic');
  if (!isIsoDate(input.installDate)) errors.push('install_date_invalid');
  if (!(Number.isFinite(input.annualUsageKwh) && input.annualUsageKwh > 0)) errors.push('annual_usage_invalid');
  if (!(Number.isFinite(input.solarKw) && input.solarKw > 0)) errors.push('solar_kw_invalid');
  if (!nonNeg(input.batteryKwh) || (input.mode === 'battery_only' && input.batteryKwh <= 0)) errors.push('battery_kwh_invalid');
  if (!nonNeg(input.solarQuote) || !nonNeg(input.batteryQuote)) errors.push('quote_invalid');
  if (!nonNeg(input.usageCPerKwh) || !nonNeg(input.feedInCPerKwh) || !nonNeg(input.stcPrice)) errors.push('price_invalid');
  if (errors.length > 0 || zone === null) return { ok: false, errors };

  const hasBattery = input.batteryKwh > 0;
  const warnings: CalcWarning[] = [];

  // 补贴：只加电池时，已有的太阳能板不再有 STC
  const panel = input.mode === 'new_solar' ? panelStcs(input.solarKw, zone, input.installDate) : { count: 0, applicable: true };
  const batt = hasBattery ? batteryStcs(input.batteryKwh, input.installDate) : { count: 0, eligibleKwh: 0, applicable: true };
  if (!panel.applicable) warnings.push('panel_stc_not_applicable');
  if (!batt.applicable) warnings.push('battery_stc_not_applicable');

  const deduct = input.quoteIncludesRebate ? 0 : 1;
  const panelRebate = deduct * panel.count * input.stcPrice;
  const batteryRebateDollars = deduct * batt.count * input.stcPrice;
  const solarCost = input.mode === 'new_solar' ? Math.max(0, input.solarQuote - panelRebate) : 0;
  const batteryCost = hasBattery ? Math.max(0, input.batteryQuote - batteryRebateDollars) : 0;

  const zoneRating = stcZones.values.zone_ratings[String(zone) as '1' | '2' | '3' | '4'];
  const p: Prepared = {
    mode: input.mode,
    shares: seasonShares(zone),
    generationYear: input.solarKw * zoneRating * 1000,
    annualUsage: input.annualUsageKwh,
    dayShare: A.daytime_share[input.occupancy],
    capacity: input.batteryKwh,
    usage: input.usageCPerKwh / 100,
    feedIn: input.feedInCPerKwh / 100,
    netCost: solarCost + batteryCost,
  };

  const y1 = yearFlows(p.shares, p.generationYear, p.annualUsage, p.dayShare, p.capacity);
  const utilisation = hasBattery ? y1.batteryOut / 365 / p.capacity : null;

  const scenarios: Scenario[] = A.price_escalation_scenarios.map((esc) => ({
    escalation: esc,
    warranty: simulate(p, esc, W.warranty_years, p.feedIn),
    expectedLife: hasBattery ? simulate(p, esc, LIFE.lithium_ion_years_max, p.feedIn) : null,
    feedInZero: simulate(p, esc, W.warranty_years, 0),
    battery: hasBattery
      ? {
          cost: batteryCost,
          warranty: batteryView(p, batteryCost, esc, W.warranty_years),
          expectedLife: batteryView(p, batteryCost, esc, LIFE.lithium_ion_years_max),
        }
      : null,
  }));

  return {
    ok: true,
    zone,
    zoneRating,
    warnings,
    stc: {
      panel: panel.count,
      battery: batt.count,
      batteryEligibleKwh: batt.eligibleKwh,
      rebateDollars: panelRebate + batteryRebateDollars,
    },
    netCost: p.netCost,
    firstYear: {
      seasons: y1.seasons,
      selfUseKwh: y1.selfUse,
      batteryOutKwh: y1.batteryOut,
      batteryInKwh: y1.batteryIn,
      exportKwh: y1.exported,
      saving: yearSaving(p, y1, p.usage, p.feedIn),
      utilisation,
      batteryMayBeOversized: utilisation !== null && utilisation < UTILISATION_WARNING_BELOW,
    },
    scenarios,
  };
}
