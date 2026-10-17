import { describe, it, expect, vi } from 'vitest';
import defaultsVicRaw from '../data/defaults-vic.json';
import postcodesRaw from '../data/postcodes-vic.json';
import batteryRaw from '../data/battery-rebate.json';
import seasonalRaw from '../data/seasonal-vic.json';
import { batteryRebateSchema, defaultsVicSchema, postcodesSchema, projectDataSchema, seasonalVicSchema } from '../src/lib/schema';
import * as data from '../src/lib/data';

describe('data/ 校验', () => {
  it('5 个数据文件都能通过校验', () => {
    expect(data.postcodes.values.ranges.length).toBeGreaterThan(0);
    expect(data.stcZones.values.zone_ratings['4']).toBeDefined();
    expect(data.batteryRebate.values.factor_periods.length).toBeGreaterThan(0);
    expect(data.defaultsVic.values.default_distributor).toBeDefined();
    expect(data.seasonalVic.values.seasons.length).toBe(4);
  });

  it('HTTPS 单链接、链接数组和现有全部数据（含嵌套来源）通过校验', () => {
    expect(postcodesSchema.safeParse(postcodesRaw).success).toBe(true);
    expect(postcodesSchema.safeParse({ ...postcodesRaw, source: [postcodesRaw.source] }).success).toBe(true);
    expect(projectDataSchema.safeParse(data).success).toBe(true);
  });

  it.each([
    postcodesRaw.source.replace(/^https:/, 'http:'),
    postcodesRaw.source.replace(/^https:/, 'ftp:'),
    'javascript:alert(1)', 'data:text/html,test', 'file:///tmp/source',
    postcodesRaw.source.replace(/^https:/, ''), 'not a URL',
  ])('来源拒绝非 HTTPS 或无效 URL：%s（单链接及数组）', (source) => {
    expect(postcodesSchema.safeParse({ ...postcodesRaw, source }).success).toBe(false);
    expect(postcodesSchema.safeParse({ ...postcodesRaw, source: [postcodesRaw.source, source] }).success).toBe(false);
  });

  it.each(['typical_quotes_after_rebate', 'battery_warranty', 'battery_expected_life'] as const)(
    '嵌套元数据 %s 同样拒绝非 HTTPS 来源', (key) => {
      const bad = structuredClone(defaultsVicRaw);
      const source = postcodesRaw.source.replace(/^https:/, 'http:');
      const meta = bad.values[key];
      meta.source = Array.isArray(meta.source) ? [source] : source;
      expect(defaultsVicSchema.safeParse(bad).success).toBe(false);
    },
  );

  it('邮编表里出现的每个分区都有季节日照数据', () => {
    const zones = new Set(data.postcodes.values.ranges.map((r) => String(r.zone)));
    for (const z of zones) {
      expect(data.seasonalVic.values.solar_mj_per_m2_day_by_zone[z as '3' | '4']).toBeDefined();
    }
  });

  it.each(['3', '4'])('单文件合法但缺少分区 %s 日照时，跨文件校验拒绝', (zone) => {
    const seasonalVic = structuredClone(seasonalRaw);
    Reflect.deleteProperty(seasonalVic.values.solar_mj_per_m2_day_by_zone, zone);
    expect(seasonalVicSchema.safeParse(seasonalVic).success).toBe(true);
    const result = projectDataSchema.safeParse({ ...data, seasonalVic });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].path).toEqual(['seasonalVic', 'values', 'solar_mj_per_m2_day_by_zone', zone]);
  });

  it('缺少日照记录时数据模块加载直接失败，使页面构建不能继续', async () => {
    const incomplete = structuredClone(seasonalRaw);
    Reflect.deleteProperty(incomplete.values.solar_mj_per_m2_day_by_zone, '4');
    vi.resetModules();
    vi.doMock('../data/seasonal-vic.json', () => ({ default: incomplete }));
    try {
      await expect(import('../src/lib/data')).rejects.toThrow('邮编分区 4 缺少季节日照记录');
    } finally {
      vi.doUnmock('../data/seasonal-vic.json');
      vi.resetModules();
    }
  });

  it('四个季节正好覆盖 12 个月', () => {
    const months = data.seasonalVic.values.seasons.flatMap((s) => s.months).sort((a, b) => a - b);
    expect(months).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it('超出范围的值会被拒绝', () => {
    const bad = structuredClone(defaultsVicRaw);
    bad.values.stc_price_dollars = 99;
    expect(defaultsVicSchema.safeParse(bad).success).toBe(false);
  });

  it('低利用率提示阈值在 0–1 内合法，越界及非有限值会被拒绝', () => {
    const withWarning = (threshold: number, source_note = '用户确认的提示阈值') => ({
      ...defaultsVicRaw, values: { ...defaultsVicRaw.values, assumptions_from_plan: {
        ...defaultsVicRaw.values.assumptions_from_plan,
        battery_utilisation_warning: { threshold, source_note },
      } },
    });
    for (const value of [0, 0.6, 1]) {
      expect(defaultsVicSchema.safeParse(withWarning(value)).success).toBe(true);
    }
    for (const value of [-0.01, 1.01, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(defaultsVicSchema.safeParse(withWarning(value)).success).toBe(false);
    }
    expect(defaultsVicSchema.safeParse(withWarning(0.6, '')).success).toBe(false);
    expect(defaultsVicSchema.safeParse(withWarning(0.6, '   ')).success).toBe(false);
  });

  it('效率为 0、寿命下限大于上限、邮编区间重叠都会被拒绝', () => {
    const eff = structuredClone(defaultsVicRaw);
    eff.values.assumptions_from_plan.round_trip_efficiency = 0;
    expect(defaultsVicSchema.safeParse(eff).success).toBe(false);

    const life = structuredClone(defaultsVicRaw);
    life.values.battery_expected_life.lithium_ion_years_min = 20;
    expect(defaultsVicSchema.safeParse(life).success).toBe(false);

    const pc = structuredClone(postcodesRaw);
    pc.values.ranges.push({ ...pc.values.ranges[0], zone: 3 });
    expect(postcodesSchema.safeParse(pc).success).toBe(false);
  });

  it('human、ai 两种复核标记合法，未知标记拒绝', () => {
    for (const checked_by of ['human', 'ai']) {
      expect(defaultsVicSchema.safeParse({ ...defaultsVicRaw, checked_by }).success).toBe(true);
    }
    expect(defaultsVicSchema.safeParse({ ...defaultsVicRaw, checked_by: 'unknown' }).success).toBe(false);
  });

  it('邮编区间倒置、默认配电区不在电价表中会拒绝', () => {
    const bad = structuredClone(postcodesRaw);
    bad.values.ranges[0].from = bad.values.ranges[0].to + 1;
    expect(postcodesSchema.safeParse(bad).success).toBe(false);
    expect(defaultsVicSchema.safeParse({ ...defaultsVicRaw, values: {
      ...defaultsVicRaw.values, default_distributor: 'toString',
    } }).success).toBe(false);
  });

  it('电池系数的倒置、重叠日期和越界系数拒绝', () => {
    const reversed = structuredClone(batteryRaw);
    reversed.values.factor_periods[0].start = '2026-01-01';
    expect(batteryRebateSchema.safeParse(reversed).success).toBe(false);
    const overlap = structuredClone(batteryRaw);
    overlap.values.factor_periods[1].start = overlap.values.factor_periods[0].end;
    expect(batteryRebateSchema.safeParse(overlap).success).toBe(false);
    const factor = structuredClone(batteryRaw);
    factor.values.factor_periods[0].factor = -1;
    expect(batteryRebateSchema.safeParse(factor).success).toBe(false);
  });

  it('电池容量档位倒置、重叠、断档、未覆盖补贴上限会拒绝', () => {
    for (const change of [
      (v: typeof batteryRaw.values) => { v.tiers[0].to_kwh = v.tiers[0].from_kwh; },
      (v: typeof batteryRaw.values) => { v.tiers[1].from_kwh -= 1; },
      (v: typeof batteryRaw.values) => { v.tiers[1].from_kwh += 1; },
      (v: typeof batteryRaw.values) => { v.tiers.at(-1)!.to_kwh -= 1; },
    ]) {
      const bad = structuredClone(batteryRaw);
      change(bad.values);
      expect(batteryRebateSchema.safeParse(bad).success).toBe(false);
    }
  });

  it('重复季节、重复月份、零日照权重及非平年天数会拒绝', () => {
    const names = structuredClone(seasonalRaw);
    names.values.seasons[1].name = names.values.seasons[0].name;
    expect(seasonalVicSchema.safeParse(names).success).toBe(false);
    const months = structuredClone(seasonalRaw);
    months.values.seasons[1].months[0] = months.values.seasons[0].months[0];
    expect(seasonalVicSchema.safeParse(months).success).toBe(false);
    const sun = structuredClone(seasonalRaw);
    sun.values.solar_mj_per_m2_day_by_zone['4'].monthly.fill(0);
    expect(seasonalVicSchema.safeParse(sun).success).toBe(false);
    const days = structuredClone(seasonalRaw);
    days.values.days_in_month[1] = 29;
    expect(seasonalVicSchema.safeParse(days).success).toBe(false);
  });
});
