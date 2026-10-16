import { defaultsVic } from '../lib/data';
import { calculateProject } from '../lib/calc';
import { FormInputError, message, readCalculatorForm, referenceQuote, type Language } from '../lib/calculator-ui';
import { money, renderResults } from '../lib/results';
import { saveLanguage } from '../lib/language';
import { TariffSelection } from '../lib/form-behavior';

const lang: Language = document.body.dataset.language === 'en' ? 'en' : 'zh';
const form = document.querySelector<HTMLFormElement>('#calculator-form')!;
const results = document.querySelector<HTMLElement>('#results')!;
const content = document.querySelector<HTMLElement>('#result-content')!;
const error = document.querySelector<HTMLElement>('#form-error')!;
const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement;
const value = (name: string) => new FormData(form).get(name)?.toString() ?? '';
const d = defaultsVic.values;
let hasResult = false;
const tariffSelection = new TariffSelection();

function toggle(selector: string, visible: boolean) {
  const group = form.querySelector<HTMLElement>(selector)!;
  group.hidden = !visible;
  group.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select').forEach((input) => { input.disabled = !visible; });
}

function updateFields() {
  const plan = value('plan');
  toggle('[data-new-solar]', plan !== 'battery_only');
  toggle('[data-existing-solar]', plan === 'battery_only');
  toggle('[data-battery-field]', plan !== 'solar_only');
  toggle('[data-solar-quote]', plan !== 'battery_only');
  toggle('[data-battery-quote]', plan !== 'solar_only');
  const bill = value('usageMode') === 'bill';
  toggle('[data-annual-field]', !bill);
  toggle('[data-bill-fields]', bill);
  if (!Object.hasOwn(d.vdo_flat_2026_27, value('distributor'))) field('distributor').value = d.default_distributor;
  const tariff = d.vdo_flat_2026_27[value('distributor')];
  document.querySelector('#supply-charge')!.textContent = message(lang, 'supplyCharge', { value: money(tariff.supply_dollars_per_day, 4) });
}

function invalidate() {
  results.hidden = true;
  hasResult = false;
  error.hidden = true;
}

function calculate(scroll: boolean) {
  error.hidden = true;
  results.hidden = true;
  hasResult = false;
  try {
    if (!form.checkValidity()) {
      form.querySelector<HTMLInputElement>(':invalid')?.focus();
      throw new FormInputError('inputError');
    }
    const input = readCalculatorForm(new FormData(form));
    const result = calculateProject(input);
    content.innerHTML = renderResults(result, input, lang);
    results.hidden = false;
    hasResult = true;
    if (scroll) {
      document.querySelector<HTMLElement>('#results-heading')!.focus({ preventScroll: true });
      results.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    }
  } catch (cause) {
    error.textContent = message(lang, cause instanceof FormInputError ? cause.key : 'calculationError');
    error.hidden = false;
    if (cause instanceof FormInputError && cause.field) form.querySelector<HTMLElement>(`[name="${CSS.escape(cause.field)}"]`)?.focus();
  }
}

form.addEventListener('submit', (event) => { event.preventDefault(); calculate(true); });
form.addEventListener('input', (event) => {
  if ((event.target as HTMLInputElement).name === 'importTariffCents') tariffSelection.markUserEdited();
  invalidate();
});
form.addEventListener('change', (event) => {
  invalidate();
  const target = event.target as HTMLInputElement | HTMLSelectElement;
  if (target.name === 'distributor') {
    const tariff = tariffSelection.changeDistributor(target.value);
    if (tariff !== undefined) field('importTariffCents').value = String(tariff);
  }
  // 改太阳能容量保留已填报价；不根据系统大小推测用户的安装报价。
  // 电池参考报价仍只匹配数据中明确对应的容量，不插值。
  if (target.name === 'batteryKwh') {
    field('batteryQuote').value = String(referenceQuote('battery', Number(target.value)) ?? '');
  }
  updateFields();
});

// 仅在用户切换语言时短暂保存到本标签页的 sessionStorage；另一页读取后立即移除。
// 输入不放到 URL、不发送到服务器；localStorage 另仅存语言偏好。
const storageKey = 'solar-calc-language-transfer';
document.querySelector('#language-switch')!.addEventListener('click', () => {
  try { saveLanguage(lang === 'zh' ? 'en' : 'zh', window.localStorage); } catch { /* 存储不可用时仍可切换。 */ }
  try {
    const entries = Array.from(form.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select'))
      .filter((input) => input.type !== 'radio' || (input as HTMLInputElement).checked)
      .map((input) => [input.name, input.value]);
    sessionStorage.setItem(storageKey, JSON.stringify({ entries, hasResult, tariffUserEdited: tariffSelection.userEdited }));
  } catch { /* 浏览器禁用存储时仍允许正常切换页面。 */ }
});

// 用用户本地日期，避免 UTC 日期边界让安装日提前或推后一天。
const today = new Date();
field('installationDate').value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
let restoreResult = false;
try {
  const saved = sessionStorage.getItem(storageKey);
  sessionStorage.removeItem(storageKey);
  if (saved) {
    const parsed: unknown = JSON.parse(saved);
    if (parsed && typeof parsed === 'object' && 'entries' in parsed && Array.isArray(parsed.entries)) {
      for (const pair of parsed.entries) {
        if (!Array.isArray(pair) || pair.length !== 2 || pair.some((part) => typeof part !== 'string')) continue;
        const [name, stored] = pair;
        for (const input of Array.from(form.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select'))) {
          if (input.name !== name) continue;
          if (input.type === 'radio') (input as HTMLInputElement).checked = input.value === stored;
          else input.value = stored;
        }
      }
      restoreResult = 'hasResult' in parsed && parsed.hasResult === true;
      if ('tariffUserEdited' in parsed && parsed.tariffUserEdited === true) tariffSelection.markUserEdited();
    }
  }
} catch { /* 存储不可用或内容无效时使用表单默认值。 */ }
updateFields();
// JS 未加载时禁用提交，避免浏览器把输入作为普通表单上传。
form.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled = false;
if (restoreResult) calculate(false);
