import { describe, it, expect } from 'vitest';
import { batteryQuoteForCapacity, quoteForCapacity, TariffSelection } from '../src/lib/form-behavior';

describe('配电区与用户自填电价', () => {
  it('没有手改电价时，选择 Jemena 使用手算公共输入的默认电价', () => {
    expect(new TariffSelection().changeDistributor('Jemena')).toBe(27.47);
  });
  it('手改电价后，连续更换配电区也不再给出覆盖值', () => {
    const choice = new TariffSelection();
    choice.markUserEdited();
    expect(choice.changeDistributor('CitiPower')).toBeUndefined();
    expect(choice.changeDistributor('Jemena')).toBeUndefined();
    expect(choice.userEdited).toBe(true);
  });
  it('语言切换恢复时，继续尊重之前的手改状态', () => {
    const restored = new TariffSelection(true);
    expect(restored.changeDistributor('AusNet Services')).toBeUndefined();
  });
});

describe('电池容量与用户自填报价', () => {
  // 金额取自 hand-calc.md：10/20 kWh 参考价及用例 2 的补贴前电池报价。
  it('用户手填报价后，更换容量仍保留原值', () => {
    expect(batteryQuoteForCapacity('11824', 16490, true)).toBe('11824');
  });
  it('用户手填值恰好等于参考价时，也不能再次被自动覆盖', () => {
    expect(batteryQuoteForCapacity('9240', 16490, true)).toBe('9240');
  });
  it.each([
    ['9240', 16490, '16490'], ['16490', 9240, '9240'],
  ] as const)('未手改的参考报价 %s 随容量更新为 %s', (current, reference, expected) => {
    expect(batteryQuoteForCapacity(current, reference, false)).toBe(expected);
  });
  it('没有参考价时清空自动报价，之后仍可跟随已知容量', () => {
    // 旧期望保留旧容量的价格，会把不匹配的参考价当作新系统报价；改为要求用户填写。
    const cleared = batteryQuoteForCapacity('9240', null, false);
    expect(cleared).toBe('');
    expect(batteryQuoteForCapacity(cleared, 16490, false)).toBe('16490');
  });
  it('没有参考价时也保留用户手填报价', () => {
    expect(batteryQuoteForCapacity('11824', null, true)).toBe('11824');
  });
  it('空报价允许自动填入容量对应的参考价', () => {
    expect(batteryQuoteForCapacity('', 9240, true)).toBe('9240');
    expect(batteryQuoteForCapacity('  ', 16490, false)).toBe('16490');
  });
  it('空报价遇到没有参考价的容量时保持原样', () => {
    expect(batteryQuoteForCapacity('', null, true)).toBe('');
  });
});

describe('太阳能容量与报价采用同一规则', () => {
  it('无匹配参考价时清空自动报价，返回已知容量时恢复参考价', () => {
    const cleared = quoteForCapacity('6200', null, false);
    expect(cleared).toBe('');
    expect(quoteForCapacity(cleared, 6200, false)).toBe('6200');
  });
  it('手填报价即使等于参考价也保留，清空后允许重新自动填入', () => {
    expect(quoteForCapacity('6200', null, true)).toBe('6200');
    expect(quoteForCapacity('', 6200, true)).toBe('6200');
  });
});
