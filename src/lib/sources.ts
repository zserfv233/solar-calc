import { batteryRebate, defaultsVic, seasonalVic } from './data';

const documents = { defaults: defaultsVic, battery: batteryRebate, seasonal: seasonalVic };
type Metadata = { source: string | string[]; last_checked: string; source_note?: string };

/** 来源只在这里按语义注册一次。URL 与核对日期始终取自同一份所属数据。 */
export function sourcesById(data = documents) {
  const entry = (owner: string, meta: Metadata, host: string, path = '') => {
    const urls = typeof meta.source === 'string' ? [meta.source] : meta.source;
    const url = urls.find((source) => {
      const parsed = new URL(source);
      return parsed.hostname === host && parsed.pathname.includes(path);
    });
    if (!url) throw new Error(`Missing source: ${owner} / ${host} / ${path}`);
    return { url, owner, last_checked: meta.last_checked, source_note: meta.source_note };
  };
  const d = data.defaults;
  const values = d.values;
  return {
    vdo: entry('defaults-vic.json', d, 'www.esc.vic.gov.au', 'victorian-default-offer'),
    usage: entry('defaults-vic.json', d, 'www.aer.gov.au'),
    feedIn: entry('defaults-vic.json', d, 'www.esc.vic.gov.au', 'minimum-feed-tariff'),
    solarQuote: entry('defaults-vic.json/typical_quotes_after_rebate', values.typical_quotes_after_rebate, 'www.solarchoice.net.au'),
    batteryQuote: entry('defaults-vic.json/typical_quotes_after_rebate', values.typical_quotes_after_rebate, 'www.energymatters.com.au'),
    stcPrice: entry('defaults-vic.json', d, 'www.ecovantage.com.au'),
    batteryPolicy: entry('battery-rebate.json', data.battery, 'cer.gov.au', 'calculate-small-scale-technology-certificate-entitlements'),
    seasonal: entry('seasonal-vic.json', data.seasonal, 'www.bom.gov.au', '086338'),
    batteryWarranty: entry('defaults-vic.json/battery_warranty', values.battery_warranty, 'saegroup.com.au', 'BYD-Battery-Box-Premium-HVS-HVM-Limited-Warranty-Letter-AU-v1.0.pdf'),
    batteryLife: entry('defaults-vic.json/battery_expected_life', values.battery_expected_life, 'www.energy.gov.au'),
  };
}
