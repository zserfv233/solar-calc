import { describe, it, expect } from 'vitest';
import defaultsVicRaw from '../data/defaults-vic.json';
import { defaultsVicSchema } from '../src/lib/schema';
import * as data from '../src/lib/data';

describe('data/ 校验', () => {
  it('5 个数据文件都能通过校验', () => {
    expect(data.postcodes.values.ranges.length).toBeGreaterThan(0);
    expect(data.stcZones.values.zone_ratings['4']).toBeDefined();
    expect(data.batteryRebate.values.factor_periods.length).toBeGreaterThan(0);
    expect(data.defaultsVic.values.default_distributor).toBeDefined();
    expect(data.seasonalVic.values.seasons.length).toBe(4);
  });

  it('邮编表里出现的每个分区都有季节日照数据', () => {
    const zones = new Set(data.postcodes.values.ranges.map((r) => String(r.zone)));
    for (const z of zones) {
      expect(data.seasonalVic.values.solar_mj_per_m2_day_by_zone[z as '3' | '4']).toBeDefined();
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
});
