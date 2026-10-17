import { defineConfig } from 'vitest/config';

export default defineConfig({
  // 默认忽略 CSS；允许对比度测试通过 ?raw 读取实际颜色。
  test: { css: { include: [/calculator\.css/] } },
});
