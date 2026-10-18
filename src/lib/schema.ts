// 数据校验规则（Zod）。范围来自执行方案「数据文件与校验规则」一节；超出范围时构建失败。
import { z } from 'zod';

const sourceUrl = z.url({ protocol: /^https$/ });
const meta = {
  source: z.union([sourceUrl, z.array(sourceUrl).min(1)]),
  source_note: z.string().optional(),
  last_checked: z.iso.date(),
  checked_by: z.enum(['human', 'ai']),
};

const fraction = z.number().min(0).max(1);

// 按起点排序后，相邻区间不能重叠（允许中间有空档）
const noOverlap = <T>(start: (x: T) => number | string, end: (x: T) => number | string) => (xs: T[]) =>
  [...xs].sort((a, b) => (start(a) < start(b) ? -1 : 1)).every((x, i, arr) => i === 0 || start(x) > end(arr[i - 1]));

export const postcodesSchema = z.object({
  ...meta,
  values: z.object({
    ranges: z
      .array(
        z
          .object({
            from: z.number().int().min(3000).max(8999),
            to: z.number().int().min(3000).max(8999),
            zone: z.number().int().min(1).max(4),
          })
          .refine((r) => r.from <= r.to, '区间起点不能大于终点'),
      )
      .min(1)
      .refine(noOverlap<{ from: number; to: number }>((r) => r.from, (r) => r.to), '邮编区间不能重叠'),
  }),
});

export const stcZonesSchema = z.object({
  ...meta,
  values: z.object({
    zone_ratings: z.record(z.enum(['1', '2', '3', '4']), z.number().min(1.0).max(1.7)),
    deeming_years_by_install_year: z.record(
      z.string().regex(/^\d{4}$/),
      z.number().int().min(0).max(6),
    ),
  }),
});

export const batteryRebateSchema = z.object({
  ...meta,
  values: z.object({
    factor_periods: z
      .array(
        z.object({
          start: z.iso.date(),
          end: z.iso.date(),
          factor: z.number().min(0).max(10),
        }).refine((p) => p.start <= p.end, '系数时间段起点不能晚于终点'),
      )
      .min(1)
      .refine(noOverlap<{ start: string; end: string }>((p) => p.start, (p) => p.end), '系数时间段不能重叠'),
    tiers: z
      .array(
        z.object({
          from_kwh: z.number().min(0),
          to_kwh: z.number().min(0),
          share: fraction,
        }).refine((t) => t.from_kwh < t.to_kwh, '容量档位必须有正的宽度'),
      )
      .min(1)
      .refine((tiers) => tiers.every((t, i) => t.from_kwh === (i === 0 ? 0 : tiers[i - 1].to_kwh)),
        '容量档位必须从 0 开始连续排列，不得重叠或断档'),
    rounding: z.enum(['floor']),
    eligible_from: z.iso.date(),
    tiers_effective_from: z.iso.date(),
    stc_cap_usable_kwh: z.number().positive().max(100),
  }).refine((v) => v.tiers.at(-1)?.to_kwh === v.stc_cap_usable_kwh, '容量档位必须覆盖补贴容量上限'),
});

export const defaultsVicSchema = z.object({
  ...meta,
  values: z
    .object({
      vdo_flat_2026_27: z.record(
        z.string(),
        z.object({
          usage_c_per_kwh: z.number().min(10).max(80),
          supply_dollars_per_day: z.number().min(0),
        }),
      ),
      default_distributor: z.string(),
      annual_usage_kwh: z.number().positive(),
      feed_in_tariff_c_per_kwh: z.number().min(0).max(30),
      stc_price_dollars: z.number().min(0).max(45),
      typical_quotes_after_rebate: z.object({
        ...meta,
        solar_6_6kw_dollars: z.number().min(1000).max(30000),
        battery_10kwh_dollars: z.number().min(1000).max(40000),
        battery_20kwh_dollars: z.number().min(1000).max(60000),
      }),
      battery_warranty: z.object({
        ...meta,
        warranty_years: z.number().int().min(1).max(25),
        end_of_warranty_retention: fraction,
        throughput_mwh_per_usable_kwh: z.number().positive().max(10),
      }),
      battery_expected_life: z.object({
        ...meta,
        lithium_ion_years_min: z.number().int().min(1).max(30),
        lithium_ion_years_max: z.number().int().min(1).max(30),
      })
      .refine((v) => v.lithium_ion_years_min <= v.lithium_ion_years_max, '寿命下限不能大于上限'),
      home_system_scope: z.object({
        ...meta,
        source_note: z.string().trim().min(1),
        solar_capacity_max_kw: z.number().positive(),
      }),
      assumptions_from_plan: z.object({
        daytime_share: z.object({ away: fraction, partly_home: fraction, mostly_home: fraction }),
        solar_size_kw: z.number().positive(),
        existing_solar_size_kw: z.number().positive(),
        battery_usable_kwh: z.number().positive(),
        battery_utilisation_warning: z.object({
          threshold: fraction,
          source_note: z.string().trim().min(1),
        }),
        round_trip_efficiency: z.number().gt(0).max(1),
        panel_degradation_per_year: fraction,
        price_escalation_scenarios: z.array(fraction).min(1),
      }),
    })
    .refine((v) => Object.hasOwn(v.vdo_flat_2026_27, v.default_distributor), '默认配电区必须在电价表里'),
});

const seasonName = z.enum(['summer', 'autumn', 'winter', 'spring']);

export const seasonalVicSchema = z.object({
  ...meta,
  values: z.object({
    seasons: z
      .array(z.object({ name: seasonName, months: z.array(z.number().int().min(1).max(12)).length(3) }))
      .length(4)
      .refine((seasons) => new Set(seasons.map((s) => s.name)).size === 4, '季节名称不能重复')
      .refine((seasons) => new Set(seasons.flatMap((s) => s.months)).size === 12, '季节月份必须完整覆盖 12 个月且不重复'),
    days_in_month: z.array(z.number().int().min(28).max(31)).length(12)
      .refine((days) => days.reduce((a, b) => a + b, 0) === 365, '平均日模型使用平年 365 天'),
    solar_mj_per_m2_day_by_zone: z.partialRecord(
      z.enum(['1', '2', '3', '4']),
      z.object({ station: z.string(), monthly: z.array(z.number().min(0).max(40)).length(12)
        .refine((monthly) => monthly.some((v) => v > 0), '全年日照权重不能为零') }),
    ),
    load_kwh_by_season: z.record(seasonName, z.number().positive()),
  }),
});

/** 跨文件约束必须在运行时加载数据时执行，不能只依赖测试覆盖。 */
export const projectDataSchema = z.object({
  postcodes: postcodesSchema,
  stcZones: stcZonesSchema,
  batteryRebate: batteryRebateSchema,
  defaultsVic: defaultsVicSchema,
  seasonalVic: seasonalVicSchema,
}).superRefine((data, ctx) => {
  for (const zone of new Set(data.postcodes.values.ranges.map((range) => String(range.zone)))) {
    if (!Object.hasOwn(data.seasonalVic.values.solar_mj_per_m2_day_by_zone, zone)) {
      ctx.addIssue({ code: 'custom', path: ['seasonalVic', 'values', 'solar_mj_per_m2_day_by_zone', zone],
        message: `邮编分区 ${zone} 缺少季节日照记录` });
    }
  }
});

