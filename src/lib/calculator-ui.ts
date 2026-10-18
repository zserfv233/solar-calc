import { ZodError, z } from 'zod';
import { annualUsageFromBill, panelStcs, zoneForPostcode, type CalculationInput } from './calc';
import zh from '../i18n/zh.json';
import en from '../i18n/en.json';
import { defaultsVic } from './data';

export const dictionaries = { zh, en };
export type Language = keyof typeof dictionaries;
export type MessageKey = keyof typeof zh;

/** 最小可表示的正数，与引擎的 >0 一致，不额外规定容量/电价下限。 */
export function numberFieldMin(name: string, plan?: string): number {
  return ['importTariffCents', 'solarKw', 'existingSolarKw', 'billDays'].includes(name)
    || (name === 'batteryKwh' && plan === 'battery_only') ? Number.MIN_VALUE : 0;
}

/** 表单和引擎共用 data/ 记录的家用太阳能容量范围。 */
export function numberFieldMax(name: string): number | undefined {
  return name === 'solarKw' || name === 'existingSolarKw'
    ? defaultsVic.values.home_system_scope.solar_capacity_max_kw : undefined;
}

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
  constructor(public key: 'inputError' | 'postcodeError' | 'billError' | 'calculationError'
    | 'positiveInputError' | 'quoteRequiredError' | 'rebateQuoteError' | 'homeSystemRangeError', public field?: string) {
    super(key);
  }
}

/** 保留引擎校验的字段路径；跨字段的报价错误用已有 STC 接口定位，不改变计算结果。 */
export function calculationFormError(cause: unknown, input?: CalculationInput, editedField?: string): FormInputError {
  if (cause instanceof FormInputError) return cause;
  if (cause instanceof ZodError) {
    const issue = cause.issues[0];
    const path = issue?.path[0];
    if (issue?.code === 'too_big' && typeof path === 'string' && numberFieldMax(path) !== undefined) {
      return new FormInputError('homeSystemRangeError', path);
    }
    return new FormInputError('inputError', typeof path === 'string' ? (path === 'mode' ? 'plan' : path) : 'batteryKwh');
  }
  if (cause instanceof RangeError && cause.message === '补贴超过对应报价，请核对报价是否已扣补贴' && input) {
    const solarKw = input.solarKw ?? defaultsVic.values.assumptions_from_plan.solar_size_kw;
    const panel = panelStcs(input.mode === 'battery_only' ? 0 : solarKw, input.postcode, input.installationDate);
    const solarTooLow = input.solarQuote < panel.count * (input.stcPrice ?? defaultsVic.values.stc_price_dollars);
    return new FormInputError('rebateQuoteError', solarTooLow ? 'solarQuote' : 'batteryQuote');
  }
  // 数值溢出可能由多项组合引起，回到最近编辑的字段；恢复表单时定位数值最大的输入供核查。
  const overflow = cause instanceof RangeError && cause.message === '输入过大，计算结果超出数值范围';
  const largest = overflow && input && Object.entries(input).filter((entry): entry is [string, number] => typeof entry[1] === 'number')
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0]?.[0];
  return new FormInputError('calculationError', overflow ? editedField ?? (largest || undefined) : undefined);
}

type ErrorControl = Pick<HTMLElement, 'getAttribute' | 'setAttribute' | 'removeAttribute' | 'focus'>;
export function markFieldInvalid(control: ErrorControl) {
  control.setAttribute('aria-invalid', 'true');
  const descriptions = new Set((control.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean));
  descriptions.add('form-error');
  control.setAttribute('aria-describedby', [...descriptions].join(' '));
  control.focus();
}

export function clearFieldError(control: ErrorControl) {
  control.removeAttribute('aria-invalid');
  const descriptions = (control.getAttribute('aria-describedby') ?? '').split(/\s+/).filter((id) => id && id !== 'form-error');
  if (descriptions.length) control.setAttribute('aria-describedby', descriptions.join(' '));
  else control.removeAttribute('aria-describedby');
}

/** 表单到计算引擎的边界：隐藏的方案字段不计入成本，空白不能自动变成 0。 */
export function readCalculatorForm(form: FormData): CalculationInput {
  const text = (name: string) => String(form.get(name) ?? '').trim();
  const numeric = (name: string) => {
    const value = text(name);
    if (value === '') throw new FormInputError(name.endsWith('Quote') ? 'quoteRequiredError' : 'inputError', name);
    const number = Number(value);
    const min = numberFieldMin(name, text('plan'));
    if (!Number.isFinite(number) || number < min) throw new FormInputError(min > 0 ? 'positiveInputError' : 'inputError', name);
    const max = numberFieldMax(name);
    if (max !== undefined && number > max) throw new FormInputError('homeSystemRangeError', name);
    return number;
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
  if (!Object.hasOwn(defaultsVic.values.vdo_flat_2026_27, distributor)) throw new FormInputError('inputError', 'distributor');
  if (!z.iso.date().safeParse(text('installationDate')).success) throw new FormInputError('inputError', 'installationDate');
  const importTariffCents = numeric('importTariffCents');
  let annualUsageKwh: number;
  if (text('usageMode') === 'bill') {
    const totalDollars = numeric('billTotal');
    const days = numeric('billDays');
    try {
      annualUsageKwh = annualUsageFromBill({ totalDollars, days, distributor, importTariffCents });
    } catch { throw new FormInputError('billError', 'billTotal'); }
  } else if (text('usageMode') === 'annual') annualUsageKwh = numeric('annualUsageKwh');
  else throw new FormInputError('inputError', 'usageMode');
  const quoteFlag = text('quoteIncludesRebate');
  if (quoteFlag !== 'yes' && quoteFlag !== 'no') throw new FormInputError('inputError', 'quoteIncludesRebate');
  const input: CalculationInput = {
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
  if (input.batteryKwh === 0 && input.batteryQuote !== 0) throw new FormInputError('inputError', 'batteryQuote');
  return input;
}
