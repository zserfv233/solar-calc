import { describe, it, expect } from 'vitest';
import defaultsVicRaw from '../data/defaults-vic.json';
import { defaultsVicSchema } from '../src/lib/schema';
import * as data from '../src/lib/data';

describe('data/ 校验', () => {
  it('4 个数据文件都能通过校验', () => {
    expect(data.postcodes.values.ranges.length).toBeGreaterThan(0);
    expect(data.stcZones.values.zone_ratings['4']).toBeDefined();
    expect(data.batteryRebate.values.factor_periods.length).toBeGreaterThan(0);
    expect(data.defaultsVic.values.default_distributor).toBeDefined();
  });

  it('超出范围的值会被拒绝', () => {
    const bad = structuredClone(defaultsVicRaw);
    bad.values.stc_price_dollars = 99;
    expect(defaultsVicSchema.safeParse(bad).success).toBe(false);
  });
});
