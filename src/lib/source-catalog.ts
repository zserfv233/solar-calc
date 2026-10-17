import { batteryRebate, defaultsVic, postcodes, seasonalVic, stcZones } from './data';
import { dictionaries, type Language } from './calculator-ui';

const documents = {
  'postcodes-vic.json': postcodes,
  'stc-zones.json': stcZones,
  'battery-rebate.json': batteryRebate,
  'defaults-vic.json': defaultsVic,
  'seasonal-vic.json': seasonalVic,
};

export interface SourceRecord {
  id: string;
  urls: string[];
  lastChecked: string;
  checkedBy: 'human' | 'ai';
}

/** 遍历已校验的数据，包括嵌套元数据；不继承父记录的日期或复核状态。 */
export function sourceCatalog(data: Record<string, unknown> = documents): SourceRecord[] {
  const records: SourceRecord[] = [];
  function visit(value: unknown, id: string) {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach((child, index) => visit(child, `${id}/${index}`));
      return;
    }
    const node = value as Record<string, unknown>;
    if ('source' in node) {
      const urls = typeof node.source === 'string' ? [node.source] : node.source;
      if (!Array.isArray(urls) || urls.length === 0 || urls.some((url) => typeof url !== 'string')
        || typeof node.last_checked !== 'string' || (node.checked_by !== 'human' && node.checked_by !== 'ai')) {
        throw new Error(`Incomplete source metadata: ${id}`);
      }
      for (const url of urls) {
        if (!['https:', 'http:'].includes(new URL(url).protocol)) throw new Error(`Unsupported source URL: ${id}`);
      }
      records.push({ id, urls: [...urls], lastChecked: node.last_checked, checkedBy: node.checked_by });
    }
    for (const [key, child] of Object.entries(node)) visit(child, `${id}/${key}`);
  }
  for (const [file, value] of Object.entries(data)) visit(value, file);
  return records;
}

export function sourceReviewLabel(checkedBy: SourceRecord['checkedBy'], lang: Language): string {
  return dictionaries[lang][checkedBy === 'ai' ? 'sourcePendingReview' : 'sourceHumanReviewed'];
}
