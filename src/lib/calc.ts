import { z } from 'zod';
import { batteryRebate, defaultsVic, postcodes, seasonalVic, stcZones } from './data';

const defaults = defaultsVic.values;
const assumptions = defaults.assumptions_from_plan;
const warranty = defaults.battery_warranty;
const seasonal = seasonalVic.values;
const rebate = batteryRebate.values;
const daysPerYear = seasonal.days_in_month.reduce((a, b) => a + b, 0);
// 报表期限与独立手算一致；不代表组件寿命。政策、价格及衰减参数均从 data/ 读取。
const forecastYears = 30;
const netBenefitYears = 10;
const nonNegative = z.number().nonnegative();
const inputSchema = z.object({
  mode: z.enum(['solar', 'battery_only']),
  postcode: z.number().int(),
  installationDate: z.iso.date(),
  solarKw: z.number().positive().default(assumptions.solar_size_kw),
  existingSolarKw: z.number().positive().default(assumptions.existing_solar_size_kw),
  batteryKwh: nonNegative,
  daytimeShare: z.enum(['away', 'partly_home', 'mostly_home']),
  annualUsageKwh: nonNegative.default(defaults.annual_usage_kwh),
  distributor: z.string().default(defaults.default_distributor),
  importTariffCents: z.number().positive().optional(),
  feedInTariffCents: nonNegative.default(defaults.feed_in_tariff_c_per_kwh),
  stcPrice: nonNegative.default(defaults.stc_price_dollars),
  solarQuote: nonNegative,
  batteryQuote: nonNegative,
  quoteIncludesRebate: z.boolean().default(true),
}).superRefine((v, ctx) => {
  if (!Object.hasOwn(defaults.vdo_flat_2026_27, v.distributor)) {
    ctx.addIssue({ code: 'custom', path: ['distributor'], message: '未知的维州配电区' });
  }
  if (v.mode === 'battery_only' && (v.batteryKwh === 0 || v.solarQuote !== 0)) {
    ctx.addIssue({ code: 'custom', message: '只加电池须填写电池容量，且不计已有太阳能的成本' });
  }
  if (v.batteryKwh === 0 && v.batteryQuote !== 0) {
    ctx.addIssue({ code: 'custom', path: ['batteryQuote'], message: '无电池方案不能包含电池报价' });
  }
});

/** 报价分开输入，便于计算电池的增量成本；金额为 AUD，电价为 c/kWh。 */
export type CalculationInput = z.input<typeof inputSchema>;
type Input = z.output<typeof inputSchema>;
type Zone = keyof typeof stcZones.values.zone_ratings;
type SeasonName = typeof seasonal.seasons[number]['name'];

export interface StcEntitlement {
  count: number;
  applicable: boolean;
  reason: 'applicable' | 'no_system' | 'outside_policy';
}

/** 同时检查邮编区间的起点和终点；仅接受 data/ 已收录的维州邮编。 */
export function zoneForPostcode(postcode: number): Zone {
  z.number().int().parse(postcode);
  const range = postcodes.values.ranges.find((r) => r.from <= postcode && postcode <= r.to);
  if (!range) throw new RangeError('邮编不在已收录的维州范围内');
  return String(range.zone) as Zone;
}

export function batteryStcs(capacityKwh: number, installationDate: string): StcEntitlement {
  // TODO（v0.2）：新增标称容量输入及 5–100 kWh 的真正资格检查。
  // v0.1 仅在结果中提示该限制；当前参数为可用容量，不能代替标称容量检查。
  nonNegative.parse(capacityKwh);
  z.iso.date().parse(installationDate);
  if (capacityKwh === 0) return { count: 0, applicable: false, reason: 'no_system' };
  const period = rebate.factor_periods.find((p) => p.start <= installationDate && installationDate <= p.end);
  if (!period || installationDate < rebate.eligible_from) {
    return { count: 0, applicable: false, reason: 'outside_policy' };
  }
  const capped = Math.min(capacityKwh, rebate.stc_cap_usable_kwh);
  const effective = installationDate < rebate.tiers_effective_from ? capped : rebate.tiers.reduce(
    (sum, tier) => sum + Math.max(0, Math.min(capped, tier.to_kwh) - tier.from_kwh) * tier.share, 0,
  );
  return { count: Math.floor(effective * period.factor), applicable: true, reason: 'applicable' };
}

export function panelStcs(solarKw: number, postcode: number, installationDate: string): StcEntitlement {
  nonNegative.parse(solarKw);
  z.iso.date().parse(installationDate);
  const zone = zoneForPostcode(postcode);
  if (solarKw === 0) return { count: 0, applicable: false, reason: 'no_system' };
  const years = stcZones.values.deeming_years_by_install_year[installationDate.slice(0, 4)];
  if (years === undefined || years === 0) return { count: 0, applicable: false, reason: 'outside_policy' };
  return { count: finite(Math.floor(solarKw * stcZones.values.zone_ratings[zone] * years)), applicable: true, reason: 'applicable' };
}

export interface EnergyFlows {
  generationKwh: number;
  directKwh: number;
  chargeKwh: number;
  dischargeKwh: number;
  batteryLossKwh: number;
  exportKwh: number;
}

export interface SeasonFlows extends EnergyFlows {
  name: SeasonName;
  days: number;
  daytimeLoadKwh: number;
  nighttimeLoadKwh: number;
}

export interface YearResult extends EnergyFlows {
  year: number;
  savings: number;
  incrementalSavings: number;
  cumulativeSavings: number;
  cumulativeIncrementalSavings: number;
  cumulativeDischargeKwh: number;
  batteryFraction: number;
}

export interface ScenarioResult {
  basis: 'warranty' | 'expected';
  batteryLifeYears: number;
  escalation: number;
  paybackYear: number | null;
  tenYearSavings: number;
  tenYearNetBenefit: number;
  years: YearResult[];
  battery: {
    status: 'no_battery' | 'no_discharge' | 'discharging';
    benefitYears: number | null;
    cumulativeDischargeKwh: number;
    tenYearIncrementalSavings: number;
    incrementalPaybackYear: number | null;
    costPerKwh: number | null;
    averageSavingsPerKwh: number | null;
  };
}

function finite(value: number): number {
  if (!Number.isFinite(value)) throw new RangeError('输入过大，计算结果超出数值范围');
  return value;
}

function seasonWeights(zone: Zone) {
  const station = seasonal.solar_mj_per_m2_day_by_zone[zone];
  if (!station) throw new RangeError('该分区缺少季节日照数据');
  const totalSun = station.monthly.reduce((sum, sun, i) => sum + sun * seasonal.days_in_month[i], 0);
  const totalLoad = Object.values(seasonal.load_kwh_by_season).reduce((a, b) => a + b, 0);
  return seasonal.seasons.map((s) => ({
    name: s.name,
    days: s.months.reduce((sum, m) => sum + seasonal.days_in_month[m - 1], 0),
    generationShare: s.months.reduce((sum, m) => sum + station.monthly[m - 1] * seasonal.days_in_month[m - 1], 0) / totalSun,
    loadShare: seasonal.load_kwh_by_season[s.name] / totalLoad,
  }));
}

/** 四季各一个平均日。年用电比例与发电比例分开，不先把全年压成一天。 */
function yearFlows(input: Input, weights: ReturnType<typeof seasonWeights>, generationKwh: number, capacity: number) {
  const seasons: SeasonFlows[] = weights.map((s) => {
    const generation = generationKwh * s.generationShare / s.days;
    const load = input.annualUsageKwh * s.loadShare / s.days;
    const day = load * assumptions.daytime_share[input.daytimeShare];
    const night = load - day;
    const direct = Math.min(generation, day);
    const surplus = generation - direct;
    const discharge = Math.min(surplus * assumptions.round_trip_efficiency, capacity, night);
    const charge = discharge / assumptions.round_trip_efficiency;
    return { name: s.name, days: s.days, generationKwh: generation, daytimeLoadKwh: day,
      nighttimeLoadKwh: night, directKwh: direct, chargeKwh: charge, dischargeKwh: discharge, batteryLossKwh: charge - discharge,
      exportKwh: Math.max(0, surplus - charge) };
  });
  const sum = (key: keyof EnergyFlows) => finite(seasons.reduce((total, s) => total + s[key] * s.days, 0));
  return { generationKwh: sum('generationKwh'), directKwh: sum('directKwh'), chargeKwh: sum('chargeKwh'),
    dischargeKwh: sum('dischargeKwh'), batteryLossKwh: sum('batteryLossKwh'), exportKwh: sum('exportKwh'), seasons };
}

function simulate(input: Input, weights: ReturnType<typeof seasonWeights>, annualGeneration: number,
  netCost: number, batteryCost: number, basis: ScenarioResult['basis'], life: number, escalation: number,
  importPrice: number, feedInPrice: number): ScenarioResult {
  const throughputLimit = finite(input.batteryKwh * warranty.throughput_mwh_per_usable_kwh * 1000);
  let cumulativeDischargeKwh = 0, cumulativeSavings = 0, cumulativeIncrementalSavings = 0;
  let benefitYears: number | null = null, paybackYear: number | null = null;
  let incrementalPaybackYear: number | null = null;
  const years: YearResult[] = [];
  for (let year = 1; year <= forecastYears; year++) {
    const generation = annualGeneration * (1 - assumptions.panel_degradation_per_year) ** (year - 1);
    const price = finite(importPrice * (1 + escalation) ** (year - 1));
    const capacity = year <= life && cumulativeDischargeKwh < throughputLimit
      ? Math.max(0, input.batteryKwh * (1 - (1 - warranty.end_of_warranty_retention) * (year - 1) / warranty.warranty_years)) : 0;
    const withoutBattery = yearFlows(input, weights, generation, 0);
    const withBattery = yearFlows(input, weights, generation, capacity);
    // 吞吐上限在年中触发：用 k 混合有电池和无电池的电量，而非丢掉剩余太阳能收益。
    const k = withBattery.dischargeKwh > 0
      ? Math.min(1, Math.max(0, throughputLimit - cumulativeDischargeKwh) / withBattery.dischargeKwh) : 0;
    const dischargeKwh = withBattery.dischargeKwh * k;
    const chargeKwh = withBattery.chargeKwh * k;
    const exportKwh = withBattery.exportKwh * k + withoutBattery.exportKwh * (1 - k);
    const directKwh = withoutBattery.directKwh;
    const incrementalSavings = finite(dischargeKwh * price - chargeKwh * feedInPrice);
    // 此处都是全年电量，等于 365 × 全年平均每日增量，不再重复乘 365。
    const savings = input.mode === 'battery_only' ? incrementalSavings
      : finite((directKwh + dischargeKwh) * price + exportKwh * feedInPrice);
    cumulativeDischargeKwh += dischargeKwh;
    cumulativeSavings = finite(cumulativeSavings + savings);
    cumulativeIncrementalSavings = finite(cumulativeIncrementalSavings + incrementalSavings);
    if (dischargeKwh > 0) benefitYears = year;
    if (paybackYear === null && cumulativeSavings >= netCost) paybackYear = year;
    if (input.batteryKwh > 0 && dischargeKwh > 0 && incrementalPaybackYear === null && cumulativeIncrementalSavings >= batteryCost) {
      incrementalPaybackYear = year;
    }
    years.push({ year, generationKwh: generation, directKwh, chargeKwh, dischargeKwh, batteryLossKwh: finite(chargeKwh - dischargeKwh), exportKwh,
      savings, incrementalSavings, cumulativeSavings, cumulativeIncrementalSavings, cumulativeDischargeKwh, batteryFraction: k });
  }
  const tenYear = years[netBenefitYears - 1];
  const lifetime = years[life - 1];
  const hasOutput = cumulativeDischargeKwh > 0;
  return { basis, batteryLifeYears: life, escalation,
    paybackYear: input.mode === 'battery_only' && !hasOutput ? null : paybackYear,
    tenYearSavings: tenYear.cumulativeSavings, tenYearNetBenefit: finite(tenYear.cumulativeSavings - netCost), years,
    battery: {
      status: input.batteryKwh === 0 ? 'no_battery' : hasOutput ? 'discharging' : 'no_discharge',
      benefitYears, cumulativeDischargeKwh,
      tenYearIncrementalSavings: tenYear.cumulativeIncrementalSavings, incrementalPaybackYear,
      costPerKwh: hasOutput ? finite(batteryCost / cumulativeDischargeKwh) : null,
      averageSavingsPerKwh: hasOutput ? finite(lifetime.cumulativeIncrementalSavings / cumulativeDischargeKwh) : null,
    } };
}

export function calculateProject(rawInput: CalculationInput) {
  const input = inputSchema.parse(rawInput);
  const zone = zoneForPostcode(input.postcode);
  const solarKw = input.mode === 'battery_only' ? input.existingSolarKw : input.solarKw;
  const panel = panelStcs(input.mode === 'battery_only' ? 0 : solarKw, input.postcode, input.installationDate);
  const battery = batteryStcs(input.batteryKwh, input.installationDate);
  const panelRebate = finite(panel.count * input.stcPrice);
  const batteryRebateDollars = finite(battery.count * input.stcPrice);
  const solarCost = input.solarQuote - (input.quoteIncludesRebate ? 0 : panelRebate);
  const batteryCost = input.batteryQuote - (input.quoteIncludesRebate ? 0 : batteryRebateDollars);
  if (solarCost < 0 || batteryCost < 0) throw new RangeError('补贴超过对应报价，请核对报价是否已扣补贴');
  const netCost = finite(solarCost + batteryCost);
  const annualGeneration = finite(solarKw * stcZones.values.zone_ratings[zone] * 1000);
  const importPrice = (input.importTariffCents ?? defaults.vdo_flat_2026_27[input.distributor].usage_c_per_kwh) / 100;
  const weights = seasonWeights(zone);
  const lifetimes = [
    { basis: 'warranty' as const, life: warranty.warranty_years },
    { basis: 'expected' as const, life: defaults.battery_expected_life.lithium_ion_years_max },
  ];
  const run = (feedInPrice: number) => lifetimes.flatMap(({ basis, life }) => assumptions.price_escalation_scenarios.map(
    (escalation) => simulate(input, weights, annualGeneration, netCost, batteryCost, basis, life, escalation, importPrice, feedInPrice),
  ));
  const scenarios = run(input.feedInTariffCents / 100);
  const firstYearFlows = yearFlows(input, weights, annualGeneration, input.batteryKwh);
  const utilisation = input.batteryKwh > 0 ? firstYearFlows.dischargeKwh / daysPerYear / input.batteryKwh : null;
  return { zone, netCost, solarCost, batteryCost,
    subsidies: { panel, battery, panelRebate, batteryRebate: batteryRebateDollars },
    firstYear: { ...firstYearFlows, savings: scenarios[0].years[0].savings },
    utilisation,
    batteryMayBeOversized: utilisation !== null && utilisation < assumptions.battery_utilisation_warning.threshold,
    scenarios, zeroFeedInScenarios: run(0),
    // 页面按当前语言从 i18n 字典读取提示文案。
    notices: battery.applicable ? ['batteryRebateEligibilityNotice' as const] : [],
    netBenefitNote: 'netBenefitNote' as const,
  };
}

/** 季度电费反推全年用电：先扣供电费，账期天数必须取自实际账单。 */
export function annualUsageFromBill(bill: { totalDollars: number; days: number; distributor?: string; importTariffCents?: number }) {
  const days = z.number().positive().parse(bill.days);
  const total = nonNegative.parse(bill.totalDollars);
  const distributor = bill.distributor ?? defaults.default_distributor;
  if (!Object.hasOwn(defaults.vdo_flat_2026_27, distributor)) throw new RangeError('未知的维州配电区');
  const tariff = defaults.vdo_flat_2026_27[distributor];
  const price = z.number().positive().parse(bill.importTariffCents ?? tariff.usage_c_per_kwh) / 100;
  const usageCharge = total - tariff.supply_dollars_per_day * days;
  if (usageCharge < 0) throw new RangeError('账单总额低于供电费，无法反推用电量');
  return finite(usageCharge / price * daysPerYear / days);
}
