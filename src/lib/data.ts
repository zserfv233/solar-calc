// 读取 data/ 并按 schema.ts 校验。页面和计算只通过这里拿数字；校验不过，构建直接失败。
import postcodesRaw from '../../data/postcodes-vic.json';
import stcZonesRaw from '../../data/stc-zones.json';
import batteryRebateRaw from '../../data/battery-rebate.json';
import defaultsVicRaw from '../../data/defaults-vic.json';
import seasonalVicRaw from '../../data/seasonal-vic.json';
import { projectDataSchema } from './schema';

export const { postcodes, stcZones, batteryRebate, defaultsVic, seasonalVic } = projectDataSchema.parse({
  postcodes: postcodesRaw,
  stcZones: stcZonesRaw,
  batteryRebate: batteryRebateRaw,
  defaultsVic: defaultsVicRaw,
  seasonalVic: seasonalVicRaw,
});
