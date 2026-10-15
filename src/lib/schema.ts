// 数据校验规则（Zod）。范围来自执行方案「数据文件与校验规则」一节；超出范围时构建失败。
import { z } from 'zod';

const meta = {
  source: z.union([z.url(), z.array(z.url()).min(1)]),
  source_note: z.string().optional(),
  last_checked: z.iso.date(),
  checked_by: z.enum(['human', 'ai']),
};

const fraction = z.number().min(0).max(1);

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
      .min(1),
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
        }),
      )
      .min(1),
    tiers: z
      .array(
        z.object({
          from_kwh: z.number().min(0),
          to_kwh: z.number().min(0),
          share: fraction,
        }),
      )
      .min(1),
    rounding: z.enum(['floor']),
  }),
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
      assumptions_from_plan: z.object({
        daytime_share: z.object({ away: fraction, partly_home: fraction, mostly_home: fraction }),
        solar_size_kw: z.number().positive(),
        existing_solar_size_kw: z.number().positive(),
        battery_usable_kwh: z.number().positive(),
        round_trip_efficiency: fraction,
        panel_degradation_per_year: fraction,
        price_escalation_scenarios: z.array(fraction).min(1),
      }),
    })
    .refine((v) => v.default_distributor in v.vdo_flat_2026_27, '默认配电区必须在电价表里'),
});
