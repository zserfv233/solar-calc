import { describe, it, expect } from 'vitest';
import { sourcesById } from '../src/lib/sources';
import { defaultsVic, batteryRebate, seasonalVic } from '../src/lib/data';

describe('命名来源与元数据归属', () => {
  it('来源数组重排后每个 ID 仍指向相同的 URL 和日期', () => {
    const data = structuredClone({ defaults: defaultsVic, battery: batteryRebate, seasonal: seasonalVic });
    for (const meta of [data.defaults, data.battery, data.seasonal,
      data.defaults.values.typical_quotes_after_rebate, data.defaults.values.battery_warranty]) {
      if (Array.isArray(meta.source)) meta.source.reverse();
    }
    expect(sourcesById(data)).toEqual(sourcesById());
  });
  it('STC 单价核对日期跟随 defaults 文件，不借用电池政策日期', () => {
    const data = structuredClone({ defaults: defaultsVic, battery: batteryRebate, seasonal: seasonalVic });
    data.battery.last_checked = data.defaults.values.battery_expected_life.last_checked;
    const sources = sourcesById(data);
    expect(sources.stcPrice.owner).toBe('defaults-vic.json');
    expect(sources.stcPrice.last_checked).toBe(data.defaults.last_checked);
    expect(sources.batteryPolicy.last_checked).toBe(data.battery.last_checked);
    expect(new URL(sources.stcPrice.url).hostname).toBe('www.ecovantage.com.au');
  });
});
