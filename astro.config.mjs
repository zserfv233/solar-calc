import { defineConfig } from 'astro/config';

export default defineConfig({
  i18n: {
    locales: ['zh', 'en'],
    defaultLocale: 'zh',
    routing: { prefixDefaultLocale: true, redirectToDefaultLocale: false },
  },
});
