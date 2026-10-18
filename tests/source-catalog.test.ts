import { describe, expect, it } from 'vitest';
import { batteryRebate, defaultsVic, postcodes, seasonalVic, stcZones } from '../src/lib/data';
import { sourceCatalog, sourceReviewLabel } from '../src/lib/source-catalog';

const documents = { 'postcodes-vic.json': postcodes, 'stc-zones.json': stcZones,
  'battery-rebate.json': batteryRebate, 'defaults-vic.json': defaultsVic, 'seasonal-vic.json': seasonalVic };

describe('来源页的元数据目录', () => {
  it('覆盖所有现有根记录和嵌套记录，不遗漏其他品牌质保链接', () => {
    const records = sourceCatalog();
    expect(records.map((record) => record.id)).toEqual([
      'postcodes-vic.json', 'stc-zones.json', 'battery-rebate.json', 'defaults-vic.json',
      'defaults-vic.json/values/typical_quotes_after_rebate',
      'defaults-vic.json/values/battery_warranty', 'defaults-vic.json/values/battery_expected_life',
      'defaults-vic.json/values/home_system_scope', 'seasonal-vic.json',
    ]);
    expect(records.find((record) => record.id.endsWith('/battery_warranty'))?.urls).toEqual(defaultsVic.values.battery_warranty.source);
  });

  it('单个 URL 与 URL 数组均完整保留，不修改或重排原数据', () => {
    const before = structuredClone(documents);
    const records = sourceCatalog(documents);
    expect(records.find((record) => record.id === 'postcodes-vic.json')?.urls).toEqual([postcodes.source]);
    expect(records.find((record) => record.id === 'seasonal-vic.json')?.urls).toEqual(seasonalVic.source);
    records.find((record) => record.id === 'seasonal-vic.json')!.urls.reverse();
    expect(documents).toEqual(before);
  });

  it('嵌套记录使用自己的核对日期和状态，ai 标记不影响父记录', () => {
    const data = structuredClone(documents);
    data['defaults-vic.json'].values.battery_expected_life.checked_by = 'ai';
    const records = sourceCatalog(data);
    const child = records.find((record) => record.id.endsWith('/battery_expected_life'))!;
    expect(child.lastChecked).toBe(defaultsVic.values.battery_expected_life.last_checked);
    expect(child.checkedBy).toBe('ai');
    expect(records.find((record) => record.id === 'defaults-vic.json')?.checkedBy).toBe(defaultsVic.checked_by);
    expect(sourceReviewLabel(child.checkedBy, 'zh')).toBe('待复核');
    expect(sourceReviewLabel(child.checkedBy, 'en')).toBe('Pending review');
  });

  it('父记录 ai 时不覆盖已人工核对的子记录', () => {
    const data = structuredClone(documents);
    data['defaults-vic.json'].checked_by = 'ai';
    const records = sourceCatalog(data);
    expect(records.find((record) => record.id === 'defaults-vic.json')?.checkedBy).toBe('ai');
    const child = records.find((record) => record.id.endsWith('/battery_warranty'))!;
    expect(child.checkedBy).toBe(defaultsVic.values.battery_warranty.checked_by);
    expect(sourceReviewLabel(child.checkedBy, 'zh')).toBe('人工核对');
    expect(sourceReviewLabel(child.checkedBy, 'en')).toBe('Human reviewed');
  });

  it('新增嵌套元数据能自动收录，不回退或编造元数据', () => {
    const data = { 'defaults-vic.json': { values: { extra: defaultsVic.values.battery_expected_life } } };
    expect(sourceCatalog(data)[0]).toEqual({
      id: 'defaults-vic.json/values/extra', urls: [defaultsVic.values.battery_expected_life.source],
      lastChecked: defaultsVic.values.battery_expected_life.last_checked,
      checkedBy: defaultsVic.values.battery_expected_life.checked_by,
    });
    expect(() => sourceCatalog({ invalid: { source: postcodes.source } })).toThrow('Incomplete source metadata');
  });
});
