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

/** 手填报价保留；自动报价必须匹配新容量，无参考项时清空，交给用户填写。 */
export function quoteForCapacity(currentQuote: string, nextReference: number | null, userEdited: boolean): string {
  if (userEdited && currentQuote.trim() !== '') return currentQuote;
  return nextReference === null ? '' : String(nextReference);
}

export { quoteForCapacity as batteryQuoteForCapacity };
