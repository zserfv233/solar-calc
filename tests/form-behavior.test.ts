import { describe, it, expect } from 'vitest';
import { TariffSelection } from '../src/lib/form-behavior';

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
