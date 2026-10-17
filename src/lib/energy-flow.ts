import type { EnergyFlows } from './calc';
import { dictionaries, type Language } from './calculator-ui';

const escape = (value: string) => value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

// 图形坐标和箭头宽度只用于排版，不表示电量比例。
const icons = {
  solar: '<path d="M-34 8h68l-8-34h-52zM-24-15h48M-29-3h58M-12-26l-4 34M12-26l4 34M0 8v15M-22 23h44"/>',
  home: '<path d="M-35-3L0-30 35-3M-26-9v40h52V-9M-8 31V10H8v21M-19 1h8v8h-8M13 1h8v8h-8"/>',
  battery: '<rect x="-26" y="-30" width="52" height="60" rx="6"/><path d="M-12-30v-7h24v7M-17-14h34M-17 0h34M-17 14h34"/>',
  grid: '<path d="M0-35l-22 66M0-35l22 66M-12 2h24M-17 17h34M-22 31h44M-30-17h60M-23-5h46M-27-17v10M27-17v10M-20-5v10M20-5v10"/>',
};

/** 只把现有首年结果转成 SVG 与文案，不计算任何新的电量或收益指标。 */
export function renderEnergyFlow(flows: EnergyFlows, lang: Language, hasBattery: boolean, batteryOnly = false): string {
  const t = dictionaries[lang];
  const kwh = (key: keyof EnergyFlows) => `${new Intl.NumberFormat(lang === 'zh' ? 'zh-CN' : 'en-AU', {
    maximumFractionDigits: key === 'batteryLossKwh' ? 2 : 1,
  }).format(flows[key])} kWh`;
  const solarLabel = batteryOnly ? t.flowExistingSolar : t.flowSolar;
  const summary = [
    `${t.generation}: ${kwh('generationKwh')}`, `${t.direct}: ${kwh('directKwh')}`, `${t.export}: ${kwh('exportKwh')}`,
    ...(hasBattery ? [`${t.charge}: ${kwh('chargeKwh')}`, `${t.discharge}: ${kwh('dischargeKwh')}`, `${t.batteryLoss}: ${kwh('batteryLossKwh')}`] : []),
  ].join('; ');

  const diagram = (compact: boolean) => {
    const id = compact ? 'energy-flow-compact' : 'energy-flow-wide';
    const icon = (kind: keyof typeof icons, x: number, y: number) => `<g class="flow-icon" transform="translate(${x} ${y})">${icons[kind]}</g>`;
    const node = (kind: keyof typeof icons, x: number, y: number, width: number, height: number, label: string) =>
      `<g class="flow-node flow-node-${kind}" data-flow-node="${kind}"><rect x="${x}" y="${y}" width="${width}" height="${height}" rx="16"/>
        ${icon(kind, x + width / 2, y + (kind === 'solar' ? 43 : 42))}
        <text x="${x + width / 2}" y="${y + (kind === 'solar' ? 83 : height - 16)}" class="flow-node-label">${escape(label)}</text>
        ${kind === 'solar' ? `<text x="${x + width / 2}" y="${y + 108}" class="flow-value" data-flow-value="generationKwh">${escape(kwh('generationKwh'))}</text>` : ''}</g>`;
    const branch = (key: keyof EnergyFlows, label: string, route: readonly [string, number, number], tone: string) => {
      const [path, x, y] = route;
      return `<g class="flow-branch flow-${tone}${flows[key] === 0 ? ' flow-zero' : ''}" data-flow="${key}">
        <path class="flow-line" d="${path}" marker-end="url(#${id}-arrow)"/>
        <rect class="flow-label-bg" x="${x - (compact ? 76 : 112)}" y="${y - 19}" width="${compact ? 152 : 224}" height="53" rx="8"/>
        <text x="${x}" y="${y}" class="flow-label">${escape(label)}</text>
        <text x="${x}" y="${y + 25}" class="flow-value" data-flow-value="${key}">${escape(kwh(key))}</text></g>`;
    };
    const direct = compact ? ['M110 145C68 145 82 220 82 280', 82, 207] as const : ['M200 200C370 200 350 105 748 105', 442, 96] as const;
    const exported = compact ? ['M250 145C300 145 278 220 278 280', 278, 207] as const
      : hasBattery ? ['M115 305V395', 115, 350] as const : ['M200 280C370 280 350 385 748 385', 442, 389] as const;
    const charge = compact ? ['M180 145V530', 180, 423] as const : ['M200 245C320 245 320 300 440 300', 305, 265] as const;
    const discharge = compact ? ['M100 585C44 585 44 440 82 386', 78, 486] as const : ['M600 290C690 290 680 155 748 155', 683, 224] as const;
    const loss = compact ? ['M180 636V704', 180, 751] as const : ['M520 370V445', 520, 483] as const;
    return `<svg class="energy-flow-svg ${compact ? 'flow-compact' : 'flow-wide'}" viewBox="${compact ? (hasBattery ? '0 0 360 795' : '0 0 360 420') : '0 0 960 530'}" role="img" aria-labelledby="${id}-title ${id}-desc" xmlns="http://www.w3.org/2000/svg">
      <title id="${id}-title">${escape(t.flowTitle)}</title><desc id="${id}-desc">${escape(summary)}. ${escape(t.flowNote)}</desc>
      <defs><marker id="${id}-arrow" viewBox="0 0 12 12" refX="11" refY="6" markerWidth="14" markerHeight="14" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M1 1L11 6 1 11z" fill="#526b42"/></marker></defs>
      ${branch('directKwh', t.direct, direct, 'direct')}
      ${branch('exportKwh', t.export, exported, 'export')}
      ${hasBattery ? branch('chargeKwh', t.charge, charge, 'battery') + branch('dischargeKwh', t.discharge, discharge, 'battery') + branch('batteryLossKwh', t.batteryLoss, loss, 'loss') : ''}
      ${compact ? node('solar', 94, 20, 172, 125, solarLabel) + node('home', 10, 280, 144, 106, t.flowHome) + node('grid', 206, 280, 144, 106, t.flowGrid)
        : node('solar', 30, 165, 170, 140, solarLabel) + node('home', 748, 40, 172, 125, t.flowHome)
          + (hasBattery ? node('grid', 30, 395, 170, 125, t.flowGrid) : node('grid', 748, 315, 172, 125, t.flowGrid))}
      ${hasBattery ? (compact ? node('battery', 100, 530, 160, 106, t.flowBattery) : node('battery', 440, 230, 160, 140, t.flowBattery)) : ''}
      ${hasBattery ? `<circle class="flow-loss-end" cx="${compact ? 180 : 520}" cy="${compact ? 711 : 452}" r="7"/>` : ''}
    </svg>`;
  };
  return `<figure class="energy-flow${hasBattery ? '' : ' energy-flow-solar-only'}" data-energy-flow>
    <figcaption><h3>${escape(t.flowTitle)}</h3><p class="hint">${escape(t.flowNote)}</p></figcaption>
    ${diagram(false)}${diagram(true)}
    ${batteryOnly ? `<p class="hint flow-context">${escape(t.flowBatteryOnlyNote)}</p>` : ''}
  </figure>`;
}
