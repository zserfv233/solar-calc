import { describe, expect, it } from 'vitest';
import { calculateProject, type EnergyFlows } from '../src/lib/calc';
import { renderEnergyFlow } from '../src/lib/energy-flow';
import { renderResults } from '../src/lib/results';

// 沿用 hand-calc.md 三个用例的首年电量、损耗和公共输入，无新增数值期望。
const common = { postcode: 3000, installationDate: '2026-11-01', solarKw: 6.6, existingSolarKw: 6.6,
  annualUsageKwh: 5077, importTariffCents: 27.47, feedInTariffCents: 5, stcPrice: 38 };
const fixtures = [
  { name: '无电池', input: { ...common, mode: 'solar' as const, batteryKwh: 0, daytimeShare: 'away' as const, solarQuote: 6200, batteryQuote: 0 },
    values: { generationKwh: '7,821', directKwh: '1,523.1', exportKwh: '6,297.9' } },
  { name: '太阳能加电池', input: { ...common, mode: 'solar' as const, batteryKwh: 10, daytimeShare: 'mostly_home' as const, solarQuote: 6200, batteryQuote: 9240 },
    values: { generationKwh: '7,821', directKwh: '3,046.2', chargeKwh: '1,602.9', dischargeKwh: '1,442.6', exportKwh: '3,171.9', batteryLossKwh: '160.29' } },
  { name: '已有太阳能只加电池', input: { ...common, mode: 'battery_only' as const, batteryKwh: 20, daytimeShare: 'partly_home' as const, solarQuote: 0, batteryQuote: 16490 },
    values: { generationKwh: '7,821', directKwh: '2,284.6', chargeKwh: '2,422.3', dischargeKwh: '2,180.1', exportKwh: '3,114', batteryLossKwh: '242.23' } },
];

describe('首年能量流 SVG', () => {
  it.each(fixtures)('$name：中英文图都展示已有手算电量', ({ input, values }) => {
    const result = calculateProject(input);
    for (const lang of ['zh', 'en'] as const) {
      const html = renderResults(result, input, lang);
      expect(html).toContain('data-energy-flow');
      for (const [key, expected] of Object.entries(values)) {
        expect(html).toContain(`data-flow-value="${key}">${expected} kWh</text>`);
      }
      if (input.batteryKwh === 0) {
        expect(html).not.toContain('data-flow-node="battery"');
        expect(html).not.toContain('data-flow="chargeKwh"');
      }
      if (lang === 'en') expect(html).not.toMatch(/[\u4e00-\u9fff]/);
    }
  });

  it('只加电池时明确图区全系统电量与增量省钱的区别', () => {
    const input = fixtures[2].input;
    const result = calculateProject(input);
    expect(renderResults(result, input, 'zh')).toContain('图中包含已有太阳能的完整电量去向');
    expect(renderResults(result, input, 'en')).toContain('incremental benefit of adding a battery');
    expect(renderResults(result, input, 'en')).toContain('Existing solar');
  });

  it('零电量路径用虚线状态表示，不产生归一化除零', () => {
    const zero: EnergyFlows = { generationKwh: 0, directKwh: 0, chargeKwh: 0, dischargeKwh: 0, exportKwh: 0, batteryLossKwh: 0 };
    const html = renderEnergyFlow(zero, 'en', true);
    expect(html).toContain('flow-zero');
    expect(html).toContain('0 kWh</text>');
    expect(html).not.toMatch(/NaN|Infinity|undefined/);
  });

  it('桌面和手机视图有独立且有效的无障碍标题、描述及箭头 ID', () => {
    const result = calculateProject(fixtures[1].input);
    const html = renderEnergyFlow(result.firstYear, 'en', true);
    const ids = Array.from(html.matchAll(/\bid="([^"]+)"/g), (match) => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const match of html.matchAll(/aria-labelledby="([^"]+)"/g)) {
      for (const id of match[1].split(' ')) expect(ids).toContain(id);
    }
    for (const match of html.matchAll(/url\(#([^)]+)\)/g)) expect(ids).toContain(match[1]);
    expect(html).toContain('class="energy-flow-svg flow-compact"');
    expect(html).toContain('class="energy-flow-svg flow-wide"');
    expect(html).toContain('grid imports are not shown');
  });

  it('渲染仅使用传入的引擎字段，保持输入对象不变', () => {
    const result = calculateProject(fixtures[1].input);
    const flows = Object.freeze({ ...result.firstYear, batteryLossKwh: 0 });
    const html = renderEnergyFlow(flows, 'en', true);
    expect(html).toContain('data-flow-value="batteryLossKwh">0 kWh</text>');
    expect(flows.batteryLossKwh).toBe(0);
  });
});
