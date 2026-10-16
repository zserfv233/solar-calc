import { defaultsVic } from './data';

/** 用户手填电价后，配电区下拉框只影响供电费，不再覆盖买电电价。 */
export class TariffSelection {
  constructor(public userEdited = false) {}
  markUserEdited() { this.userEdited = true; }
  changeDistributor(distributor: string): number | undefined {
    if (this.userEdited) return undefined;
    const tariffs = defaultsVic.values.vdo_flat_2026_27;
    if (!Object.hasOwn(tariffs, distributor)) return undefined;
    return tariffs[distributor].usage_c_per_kwh;
  }
}

/** 只更新未手改的自动报价或空报价；缺少对应参考价时保留原值。 */
export function batteryQuoteForCapacity(currentQuote: string, nextReference: number | null, userEdited: boolean): string {
  if (nextReference === null || (userEdited && currentQuote.trim() !== '')) return currentQuote;
  return String(nextReference);
}
