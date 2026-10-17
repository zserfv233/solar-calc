import { defaultsVic } from '../lib/data';
import { calculateProject, type CalculationInput } from '../lib/calc';
import { calculationFormError, clearFieldError, FormInputError, markFieldInvalid, message, numberFieldMin, readCalculatorForm, referenceQuote, type Language } from '../lib/calculator-ui';
import { money, renderResults } from '../lib/results';
import { saveLanguage } from '../lib/language';
import { batteryQuoteForCapacity, quoteForCapacity, TariffSelection } from '../lib/form-behavior';

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
let batteryQuoteUserEdited = false;
let lastEditedField: string | undefined;

function updateQuoteHints() {
  for (const [system, capacity] of [['solar', 'solarKw'], ['battery', 'batteryKwh']] as const) {
    document.querySelector<HTMLElement>(`#${system}-quote-required`)!.hidden =
      field(`${system}Quote`).value.trim() !== '' || referenceQuote(system, Number(field(capacity).value)) !== null;
  }
}

function toggle(selector: string, visible: boolean) {
  const group = form.querySelector<HTMLElement>(selector)!;
  group.hidden = !visible;
  group.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select').forEach((input) => { input.disabled = !visible; });
}

function updateFields() {
  const plan = value('plan');
  field('batteryKwh').setAttribute('min', String(numberFieldMin('batteryKwh', plan)));
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
  updateQuoteHints();
}

function invalidate() {
  results.hidden = true;
  hasResult = false;
  error.hidden = true;
  form.querySelectorAll<HTMLElement>('[aria-invalid="true"]').forEach(clearFieldError);
}

function calculate(scroll: boolean) {
  invalidate();
  let input: CalculationInput | undefined;
  try {
    if (!form.checkValidity()) {
      const invalid = form.querySelector<HTMLInputElement | HTMLSelectElement>('input:invalid, select:invalid')!;
      const key = invalid.validity.valueMissing && invalid.name.endsWith('Quote') ? 'quoteRequiredError'
        : invalid.validity.rangeUnderflow && numberFieldMin(invalid.name, value('plan')) > 0 ? 'positiveInputError' : 'inputError';
      throw new FormInputError(key, invalid.name);
    }
    input = readCalculatorForm(new FormData(form));
    const result = calculateProject(input);
    content.innerHTML = renderResults(result, input, lang);
    results.hidden = false;
    hasResult = true;
    if (scroll) {
      document.querySelector<HTMLElement>('#results-heading')!.focus({ preventScroll: true });
      results.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    }
  } catch (cause) {
    const edited = lastEditedField && !field(lastEditedField).disabled ? lastEditedField : undefined;
    const problem = calculationFormError(cause, input, edited);
    const control = problem.field ? form.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${CSS.escape(problem.field)}"]`) : null;
    const label = control?.closest('label')?.firstChild?.textContent?.trim();
    error.textContent = `${label ? `${label}: ` : ''}${message(lang, problem.key)}`;
    error.hidden = false;
    if (control && !control.disabled) markFieldInvalid(control);
    else error.focus();
  }
}

form.addEventListener('submit', (event) => { event.preventDefault(); calculate(true); });
form.addEventListener('input', (event) => {
  const target = event.target as HTMLInputElement;
  if (target.type === 'number') lastEditedField = target.name;
  if ((event.target as HTMLInputElement).name === 'importTariffCents') tariffSelection.markUserEdited();
  if ((event.target as HTMLInputElement).name === 'batteryQuote') batteryQuoteUserEdited = true;
  // 标记属于表单状态，现有通用语言切换代码会原样转移；不改变存储读写逻辑。
  if (target.name === 'solarQuote') field('solarQuoteEdited').value = 'yes';
  invalidate();
  updateQuoteHints();
});
form.addEventListener('change', (event) => {
  invalidate();
  const target = event.target as HTMLInputElement | HTMLSelectElement;
  if (target.name === 'distributor') {
    const tariff = tariffSelection.changeDistributor(target.value);
    if (tariff !== undefined) field('importTariffCents').value = String(tariff);
  }
  // 只匹配 data/ 明确给出的参考价，不插值；无匹配时不能沿用旧容量的自动价。
  if (target.name === 'solarKw') {
    const quote = field('solarQuote');
    const next = quoteForCapacity(quote.value, referenceQuote('solar', Number(target.value)), field('solarQuoteEdited').value === 'yes');
    if (next !== quote.value) {
      quote.value = next;
      field('solarQuoteEdited').value = '';
    }
  }
  if (target.name === 'batteryKwh') {
    const quote = field('batteryQuote');
    const next = batteryQuoteForCapacity(quote.value, referenceQuote('battery', Number(target.value)), batteryQuoteUserEdited);
    if (next !== quote.value) {
      quote.value = next;
      batteryQuoteUserEdited = false;
    }
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
    sessionStorage.setItem(storageKey, JSON.stringify({ entries, hasResult, tariffUserEdited: tariffSelection.userEdited, batteryQuoteUserEdited }));
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
      // 新版保留手改标记；兼容旧版切换记录时，非当前参考价视为用户报价。
      const restoredQuote = field('batteryQuote').value;
      const restoredReference = referenceQuote('battery', Number(field('batteryKwh').value));
      batteryQuoteUserEdited = 'batteryQuoteUserEdited' in parsed && typeof parsed.batteryQuoteUserEdited === 'boolean'
        ? parsed.batteryQuoteUserEdited
        : restoredQuote.trim() !== '' && (restoredReference === null || Number(restoredQuote) !== restoredReference);
    }
  }
} catch { /* 存储不可用或内容无效时使用表单默认值。 */ }
updateFields();
// JS 未加载时禁用提交，避免浏览器把输入作为普通表单上传。
form.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled = false;
if (restoreResult) calculate(false);
