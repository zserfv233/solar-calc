import type { CalculationInput, calculateProject, ScenarioResult } from './calc';
import { dictionaries, message, type Language } from './calculator-ui';

type Result = ReturnType<typeof calculateProject>;
export const money = (value: number, digits = 2) => new Intl.NumberFormat('en-AU', {
  style: 'currency', currency: 'AUD', minimumFractionDigits: digits, maximumFractionDigits: digits,
}).format(value);
export const number = (value: number, lang: Language, digits = 1) => new Intl.NumberFormat(lang === 'zh' ? 'zh-CN' : 'en-AU', {
  maximumFractionDigits: digits,
}).format(value);
const percent = (value: number, lang: Language) => new Intl.NumberFormat(lang === 'zh' ? 'zh-CN' : 'en-AU', {
  style: 'percent', maximumFractionDigits: 1,
}).format(value);
const escape = (value: string) => value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function paybackText(s: ScenarioResult, lang: Language, batteryOnly: boolean, incremental = false): string {
  const m = (key: Parameters<typeof message>[1], args?: Record<string, string | number>) => message(lang, key, args);
  if ((incremental || batteryOnly) && s.battery.status === 'no_discharge') return m('noDischarge');
  const year = incremental ? s.battery.incrementalPaybackYear : s.paybackYear;
  const benefits = s.battery.benefitYears;
  if (year === null && !incremental && !batteryOnly) {
    return m('noPayback', { years: s.years.length }) + (benefits === null ? '' : ` · ${m('batteryNoPayback', { years: benefits })}`);
  }
  if (benefits !== null && (year === null || year > benefits)) {
    return m('batteryNoPayback', { years: benefits }) + (year === null ? '' : ` · ${m('afterBattery', { year })}`);
  }
  return year === null ? m('noPayback', { years: s.years.length }) : m('yearNumber', { year });
}

/** 只渲染计算结果和本地字典；所有文本经转义，输入不插入 HTML。 */
export function renderResults(result: Result, input: CalculationInput, lang: Language): string {
  const t = dictionaries[lang];
  const e = escape;
  const m = (key: Parameters<typeof message>[1], args?: Record<string, string | number>) => e(message(lang, key, args));
  const metric = (label: string, value: string) => `<div class="metric"><dt>${e(label)}</dt><dd>${e(value)}</dd></div>`;
  const batteryOnly = input.mode === 'battery_only';
  const hasBattery = input.batteryKwh > 0;
  const firstYear = result.firstYear;
  const energy = [
    [t.generation, firstYear.generationKwh], [t.direct, firstYear.directKwh],
    [t.discharge, firstYear.dischargeKwh], [t.export, firstYear.exportKwh],
    ...(hasBattery ? [[t.charge, firstYear.chargeKwh], [t.batteryLoss, firstYear.batteryLossKwh]] as const : []),
  ] as const;
  const policy = ([['panel', t.panelStcs, result.subsidies.panelRebate], ['battery', t.batteryStcs, result.subsidies.batteryRebate]] as const)
    .filter(([kind]) => result.subsidies[kind].reason !== 'no_system')
    .map(([kind, label, value]) => `<div><dt>${e(label)}</dt><dd>${m('stcCount', { count: result.subsidies[kind].count, amount: money(value) })}</dd>${
      result.subsidies[kind].reason === 'outside_policy' ? `<p class="notice">${e(t.notApplicable)}</p>` : ''}</div>`).join('');
  const bases = hasBattery ? ['warranty', 'expected'] as const : ['warranty'] as const;
  const groups = bases.map((basis) => {
    const scenarios = result.scenarios.filter((s) => s.basis === basis);
    const title = hasBattery ? message(lang, basis === 'warranty' ? 'warrantyBasis' : 'expectedBasis', { years: scenarios[0].batteryLifeYears }) : t.solarOnly;
    const cards = scenarios.map((s) => {
      const zero = result.zeroFeedInScenarios.find((z) => z.basis === basis && z.escalation === s.escalation)!;
      const perKwh = (value: number | null) => value === null ? '—' : message(lang, 'perKwh', { value: money(value, 3) });
      return `<article class="scenario"><h4>${m('escalation', { rate: percent(s.escalation, lang) })}</h4>
        <dl>${metric(t.payback, paybackText(s, lang, batteryOnly))}${metric(t.tenYearNet, money(s.tenYearNetBenefit))}</dl>
        <div class="zero-fit"><h5>${e(t.zeroFit)}</h5><p>${m('zeroFitHint', { payback: paybackText(zero, lang, batteryOnly), net: money(zero.tenYearNetBenefit) })}</p></div>
        ${hasBattery ? `<details class="battery-details"><summary>${e(t.batteryDetail)}</summary>
          ${s.battery.status === 'no_discharge' ? `<p>${e(t.noDischarge)}</p>` : `<p>${m('benefitYears', { years: s.battery.benefitYears ?? '—' })}</p>
          <p>${m('dischargeTotal', { value: number(s.battery.cumulativeDischargeKwh, lang) })}</p>
          <dl>${metric(t.incrementalPayback, paybackText(s, lang, true, true))}${metric(t.incrementalSavings, money(s.battery.tenYearIncrementalSavings))}
          ${metric(t.costPerKwh, perKwh(s.battery.costPerKwh))}${metric(t.savedPerKwh, perKwh(s.battery.averageSavingsPerKwh))}</dl>`}</details>` : ''}</article>`;
    }).join('');
    return `<section class="basis"><h3>${e(title)}</h3>${basis === 'expected' ? `<p class="hint">${e(t.expectedNote)}</p>` : ''}<div class="scenario-grid">${cards}</div></section>`;
  }).join('');
  return `<div class="result-summary"><div><span class="eyebrow">${e(batteryOnly ? t.firstYearIncrementalSavings : t.firstYearSavings)}</span><p class="saving" data-first-year>${e(money(firstYear.savings))}<small>AUD</small></p><p>${m('zone', { zone: result.zone })}</p></div>
    <dl>${metric(t.netCost, money(result.netCost))}${metric(t.utilisation, result.utilisation === null ? t.noBattery : percent(result.utilisation, lang))}</dl>
    ${hasBattery ? `<p class="hint">${e(t.utilisationHint)}</p>` : ''}
    ${result.batteryMayBeOversized ? `<p class="notice">${e(t.oversized)}</p>` : ''}</div>
    <div class="result-facts"><section><h3>${e(t.energyTitle)}</h3><dl class="energy-totals">${energy.map(([label, value]) => metric(label, `${number(value, lang)} kWh`)).join('')}</dl></section>
    <section><h3>${e(t.subsidies)}</h3><dl class="subsidy-totals">${policy}</dl><p class="hint">${e(input.quoteIncludesRebate !== false ? t.rebateIncluded : t.rebateDeducted)}</p>
    ${result.notices.map((key) => `<p class="notice" data-rebate-notice>${e(t[key])}</p>`).join('')}</section></div>
    <section class="sensitivity"><h2>${e(t.sensitivity)}</h2><p class="hint">${e(t.escalationNote)}</p>${groups}<p class="net-note">${e(t[result.netBenefitNote])}</p></section>`;
}
