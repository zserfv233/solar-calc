// 读取 data/ 并按 schema.ts 校验。页面和计算只通过这里拿数字；校验不过，构建直接失败。
import postcodesRaw from '../../data/postcodes-vic.json';
import stcZonesRaw from '../../data/stc-zones.json';
import batteryRebateRaw from '../../data/battery-rebate.json';
import defaultsVicRaw from '../../data/defaults-vic.json';
import seasonalVicRaw from '../../data/seasonal-vic.json';
import {
  batteryRebateSchema,
  defaultsVicSchema,
  postcodesSchema,
  seasonalVicSchema,
  stcZonesSchema,
} from './schema';

export const postcodes = postcodesSchema.parse(postcodesRaw);
export const stcZones = stcZonesSchema.parse(stcZonesRaw);
export const batteryRebate = batteryRebateSchema.parse(batteryRebateRaw);
export const defaultsVic = defaultsVicSchema.parse(defaultsVicRaw);
export const seasonalVic = seasonalVicSchema.parse(seasonalVicRaw);
