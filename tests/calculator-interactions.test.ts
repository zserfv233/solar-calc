/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import template from '../src/components/Calculator.astro?raw';
import { defaultsVic } from '../src/lib/data';
import { numberFieldMax, numberFieldMin, type Language } from '../src/lib/calculator-ui';

// 无新增 DOM 依赖：执行真实页面脚本，用最小表单接口覆盖事件、禁用状态、提示和聚焦。
// 原生 number 输入的 min/max/required 另由模板契约检查，财务结果仍由既有手算测试负责。
const NativeFormData = globalThis.FormData;
class Control {
  disabled = false;
  hidden = true;
  checked = true;
  textContent = '';
  innerHTML = '';
  attributes = new Map<string, string>();
  listeners = new Map<string, (event: { target?: Control; preventDefault(): void }) => void>();
  focus = vi.fn();
  scrollIntoView = vi.fn();
  constructor(public name = '', public value = '', public type = 'number') {}
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  removeAttribute(name: string) { this.attributes.delete(name); }
  closest() { return { firstChild: { textContent: this.name } }; }
  addEventListener(name: string, listener: (event: { target?: Control; preventDefault(): void }) => void) { this.listeners.set(name, listener); }
  get validity() {
    const valueMissing = this.type !== 'hidden' && this.value === '';
    const rangeUnderflow = this.type === 'number' && this.value !== '' && Number(this.value) < Number(this.getAttribute('min') ?? 0);
    const max = this.getAttribute('max');
    const rangeOverflow = this.type === 'number' && this.value !== '' && max !== null && Number(this.value) > Number(max);
    return { valueMissing, rangeUnderflow, rangeOverflow, valid: this.disabled || !(valueMissing || rangeUnderflow || rangeOverflow) };
  }
}

let controls: Record<string, Control>;
let elements: Record<string, Control>;
let emit: (name: string, field?: string, value?: string) => void;
let session: Map<string, string>;

async function boot(language: Language = 'zh') {
  vi.resetModules();
  const d = defaultsVic.values;
  const a = d.assumptions_from_plan;
  const initial = {
    plan: 'solar_only', postcode: '3000', installationDate: '2026-11-01', distributor: d.default_distributor,
    importTariffCents: String(d.vdo_flat_2026_27[d.default_distributor].usage_c_per_kwh),
    feedInTariffCents: String(d.feed_in_tariff_c_per_kwh), usageMode: 'annual', annualUsageKwh: String(d.annual_usage_kwh),
    billTotal: '', billDays: '', daytimeShare: 'away', solarKw: String(a.solar_size_kw),
    existingSolarKw: String(a.existing_solar_size_kw), batteryKwh: String(a.battery_usable_kwh),
    solarQuote: String(d.typical_quotes_after_rebate.solar_6_6kw_dollars),
    batteryQuote: String(d.typical_quotes_after_rebate.battery_10kwh_dollars),
    stcPrice: String(d.stc_price_dollars), quoteIncludesRebate: 'yes', solarQuoteEdited: '',
  };
  controls = Object.fromEntries(Object.entries(initial).map(([name, value]) => {
    const tag = template.match(new RegExp(`<input\\b[^>]*name="${name}"[^>]*>`))?.[0];
    const type = tag?.match(/type="([^"]+)"/)?.[1] ?? 'select';
    const control = new Control(name, value, type);
    if (type === 'number') control.setAttribute('min', String(numberFieldMin(name)));
    const max = numberFieldMax(name);
    if (max !== undefined) control.setAttribute('max', String(max));
    if (name.endsWith('Quote')) control.setAttribute('aria-describedby', `${name.startsWith('solar') ? 'solar' : 'battery'}-quote-required`);
    return [name, control];
  }));
  const groups: Record<string, string[]> = {
    '[data-new-solar]': ['solarKw'], '[data-existing-solar]': ['existingSolarKw'],
    '[data-battery-field]': ['batteryKwh'], '[data-solar-quote]': ['solarQuote'], '[data-battery-quote]': ['batteryQuote'],
    '[data-annual-field]': ['annualUsageKwh'], '[data-bill-fields]': ['billTotal', 'billDays'],
  };
  const form = Object.assign(new Control(), {
    elements: { namedItem: (name: string) => controls[name] },
    querySelector(selector: string) {
      if (groups[selector]) return { hidden: false, querySelectorAll: () => groups[selector].map((name) => controls[name]) };
      if (selector === 'input:invalid, select:invalid') return Object.values(controls).find((control) => !control.validity.valid);
      if (selector === 'button[type="submit"]') return elements.button;
      const name = selector.match(/^\[name="([^"]+)"\]$/)?.[1];
      return name ? controls[name] : null;
    },
    querySelectorAll: (selector: string) => Object.values(controls).filter((control) => selector !== '[aria-invalid="true"]' || control.getAttribute('aria-invalid') === 'true'),
    checkValidity: () => Object.values(controls).every((control) => control.validity.valid),
  });
  elements = Object.fromEntries(['#results', '#result-content', '#form-error', '#supply-charge', '#language-switch',
    '#results-heading', '#solar-quote-required', '#battery-quote-required', 'button'].map((id) => [id, new Control()]));
  vi.stubGlobal('document', { body: { dataset: { language } }, querySelector: (selector: string) => selector === '#calculator-form' ? form : elements[selector] });
  vi.stubGlobal('CSS', { escape: (value: string) => value });
  vi.stubGlobal('window', { localStorage: { setItem: vi.fn() }, matchMedia: () => ({ matches: true }) });
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => session.get(key) ?? null,
    setItem: (key: string, value: string) => session.set(key, value), removeItem: (key: string) => session.delete(key),
  });
  vi.stubGlobal('FormData', class extends NativeFormData {
    constructor(source?: typeof form) {
      super();
      if (source) for (const control of Object.values(controls)) if (!control.disabled) this.set(control.name, control.value);
    }
  });
  emit = (name, field, value) => {
    const target = field ? controls[field] : undefined;
    if (target && value !== undefined) target.value = value;
    form.listeners.get(name)?.({ target, preventDefault() {} });
  };
  await import('../src/scripts/calculator');
  controls.installationDate.value = '2026-11-01';
}

beforeEach(async () => { session = new Map(); await boot(); });
afterEach(() => vi.unstubAllGlobals());

describe('页面报价与字段错误事件', () => {
  it.each([['solarKw', 'solarQuote', '#solar-quote-required'], ['batteryKwh', 'batteryQuote', '#battery-quote-required']])(
    '%s 换到无参考价容量，清空自动价、显示提示并要求填写', (size, quote, hint) => {
      emit('change', 'plan', 'solar_battery');
      emit('change', size, '14');
      expect(controls[quote].value).toBe('');
      expect(elements[hint].hidden).toBe(false);
      emit('submit');
      expect(controls[quote].focus).toHaveBeenCalled();
      expect(controls[quote].getAttribute('aria-invalid')).toBe('true');
      expect(controls[quote].getAttribute('aria-describedby')).toContain('form-error');
      expect(elements['#form-error'].textContent).toContain('实际安装报价');
    },
  );

  it.each([['solarKw', 'solarQuote'], ['batteryKwh', 'batteryQuote']])('手填 %s 报价后不清空；编辑后移除错误且保留原提示关联', (size, quote) => {
    emit('change', 'plan', 'solar_battery');
    emit('change', size, '14');
    emit('submit');
    emit('input', quote, '6200');
    expect(controls[quote].getAttribute('aria-invalid')).toBeNull();
    expect(controls[quote].getAttribute('aria-describedby')).not.toContain('form-error');
    expect(controls[quote].getAttribute('aria-describedby')).toContain('quote-required');
    emit('change', size, '20');
    expect(controls[quote].value).toBe('6200');
  });

  it('未手改的电池报价跟随已知容量', () => {
    emit('change', 'plan', 'solar_battery');
    emit('change', 'batteryKwh', '20');
    expect(controls.batteryQuote.value).toBe('16490');
  });

  it('太阳能手填值恰好等于参考价，现有语言转移后仍保留', async () => {
    emit('input', 'solarQuote', '6200');
    elements['#language-switch'].listeners.get('click')?.({ preventDefault() {} });
    await boot();
    emit('change', 'solarKw', '14');
    expect(controls.solarQuote.value).toBe('6200');
  });

  it.each(['importTariffCents', 'solarKw'])('原生范围错误 %s 聚焦、设 aria-invalid，修正后可计算', (name) => {
    const original = controls[name].value;
    emit('input', name, '0');
    emit('submit');
    expect(controls[name].focus).toHaveBeenCalled();
    expect(controls[name].getAttribute('aria-invalid')).toBe('true');
    expect(elements['#form-error'].textContent).toContain('大于 0');
    emit('input', name, original);
    emit('submit');
    expect(elements['#results'].hidden).toBe(false);
    expect(controls[name].getAttribute('aria-invalid')).toBeNull();
  });

  it('补贴前报价错误由引擎返回后定位至对应报价', () => {
    emit('change', 'quoteIncludesRebate', 'no');
    emit('input', 'solarQuote', '0');
    emit('submit');
    expect(controls.solarQuote.focus).toHaveBeenCalled();
    expect(controls.solarQuote.getAttribute('aria-invalid')).toBe('true');
    expect(elements['#form-error'].textContent).toContain('补贴前报价');
  });

  it('有限但组合后溢出的输入由引擎拒绝，并定位最近编辑的字段', () => {
    emit('change', 'plan', 'battery_only');
    emit('change', 'daytimeShare', 'partly_home');
    emit('input', 'batteryQuote', '1.7e308');
    emit('input', 'feedInTariffCents', '1e305');
    emit('submit');
    expect(elements['#results'].hidden).toBe(true);
    expect(controls.feedInTariffCents.focus).toHaveBeenCalled();
    expect(controls.feedInTariffCents.getAttribute('aria-invalid')).toBe('true');
    expect(elements['#form-error'].textContent).toContain('输入过大');
  });

  it('只加电池时动态最小值拒绝零容量', () => {
    emit('change', 'plan', 'battery_only');
    emit('input', 'batteryKwh', '0');
    emit('submit');
    expect(Number(controls.batteryKwh.getAttribute('min'))).toBeGreaterThan(0);
    expect(controls.batteryKwh.getAttribute('aria-invalid')).toBe('true');
  });
});

it('模板中正数字段使用统一下限；允许小数账期以匹配引擎', () => {
  for (const name of ['importTariffCents', 'solarKw', 'existingSolarKw', 'billDays']) {
    expect(template).toMatch(new RegExp(`name="${name}" type="number" min=\\{numberFieldMin\\("${name}"\\)\\}[^>]* step="any"`));
  }
});

describe.each(['solarKw', 'existingSolarKw'])('%s 页面容量范围', (name) => {
  it('100 kW 可提交，模板上限来自数据', () => {
    expect(template).toContain(`max={numberFieldMax("${name}")}`);
    if (name === 'existingSolarKw') emit('change', 'plan', 'battery_only');
    emit('input', 'solarQuote', '6200');
    emit('change', name, '100');
    emit('submit');
    expect(controls[name].getAttribute('max')).toBe('100');
    expect(elements['#form-error'].hidden).toBe(true);
    expect(elements['#results'].hidden).toBe(false);
  });

  it.each([
    ['zh', '100.01'], ['zh', '101'], ['en', '100.01'], ['en', '101'],
  ] as const)('%s 页面拒绝 %s kW，显示范围提示、聚焦并关联对应字段', async (language, capacity) => {
    await boot(language);
    if (name === 'existingSolarKw') emit('change', 'plan', 'battery_only');
    emit('input', name, capacity);
    emit('submit');
    expect(elements['#results'].hidden).toBe(true);
    expect(elements['#form-error'].hidden).toBe(false);
    expect(elements['#form-error'].textContent).toContain(language === 'zh'
      ? '超出家用计算范围' : 'Outside the home-system range of this calculator');
    expect(controls[name].focus).toHaveBeenCalled();
    expect(controls[name].getAttribute('aria-invalid')).toBe('true');
    expect(controls[name].getAttribute('aria-describedby')).toContain('form-error');
    emit('input', name, '100');
    expect(controls[name].getAttribute('aria-invalid')).toBeNull();
  });
});
