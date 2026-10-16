import { annualUsageFromBill, zoneForPostcode, type CalculationInput } from './calc';
import zh from '../i18n/zh.json';
import en from '../i18n/en.json';
import { defaultsVic } from './data';

export const dictionaries = { zh, en };
export type Language = keyof typeof dictionaries;
export type MessageKey = keyof typeof zh;

/** 容量取自报价字段的单位标记；只匹配已有参考项，不插值或估算报价。 */
export function referenceQuote(system: 'solar' | 'battery', size: number): number | null {
  for (const [key, value] of Object.entries(defaultsVic.values.typical_quotes_after_rebate)) {
    const match = key.match(/^(solar|battery)_([\d_]+)(kw|kwh)_dollars$/);
    if (match && match[1] === system && Number(match[2].replaceAll('_', '.')) === size && typeof value === 'number') return value;
  }
  return null;
}

export function message(lang: Language, key: MessageKey, values: Record<string, string | number> = {}) {
  return dictionaries[lang][key].replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? `{${name}}`));
}

export class FormInputError extends Error {
  constructor(public key: 'inputError' | 'postcodeError' | 'billError', public field?: string) {
    super(key);
  }
}

/** 表单到计算引擎的边界：隐藏的方案字段不计入成本，空白不能自动变成 0。 */
export function readCalculatorForm(form: FormData): CalculationInput {
  const text = (name: string) => String(form.get(name) ?? '').trim();
  const numeric = (name: string) => {
    const value = text(name);
    if (value === '' || !Number.isFinite(Number(value))) throw new FormInputError('inputError', name);
    return Number(value);
  };
  const plan = text('plan');
  if (!['solar_only', 'solar_battery', 'battery_only'].includes(plan)) throw new FormInputError('inputError', 'plan');
  const daytimeShare = text('daytimeShare');
  if (daytimeShare !== 'away' && daytimeShare !== 'partly_home' && daytimeShare !== 'mostly_home') {
    throw new FormInputError('inputError', 'daytimeShare');
  }
  const postcode = text('postcode');
  if (!/^\d{4}$/.test(postcode)) throw new FormInputError('postcodeError', 'postcode');
  try { zoneForPostcode(Number(postcode)); } catch { throw new FormInputError('postcodeError', 'postcode'); }
  const distributor = text('distributor');
  const importTariffCents = numeric('importTariffCents');
  let annualUsageKwh: number;
  if (text('usageMode') === 'bill') {
    try {
      annualUsageKwh = annualUsageFromBill({ totalDollars: numeric('billTotal'), days: numeric('billDays'), distributor, importTariffCents });
    } catch { throw new FormInputError('billError', 'billTotal'); }
  } else if (text('usageMode') === 'annual') annualUsageKwh = numeric('annualUsageKwh');
  else throw new FormInputError('inputError', 'usageMode');
  const quoteFlag = text('quoteIncludesRebate');
  if (quoteFlag !== 'yes' && quoteFlag !== 'no') throw new FormInputError('inputError', 'quoteIncludesRebate');
  return {
    mode: plan === 'battery_only' ? 'battery_only' : 'solar',
    postcode: Number(postcode), installationDate: text('installationDate'), distributor,
    solarKw: plan === 'battery_only' ? undefined : numeric('solarKw'),
    existingSolarKw: plan === 'battery_only' ? numeric('existingSolarKw') : undefined,
    batteryKwh: plan === 'solar_only' ? 0 : numeric('batteryKwh'),
    daytimeShare, annualUsageKwh, importTariffCents, feedInTariffCents: numeric('feedInTariffCents'),
    solarQuote: plan === 'battery_only' ? 0 : numeric('solarQuote'),
    batteryQuote: plan === 'solar_only' ? 0 : numeric('batteryQuote'),
    stcPrice: numeric('stcPrice'), quoteIncludesRebate: quoteFlag === 'yes',
  };
}
