import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// SEO 关键配置：静态输出 + sitemap + 压缩 HTML
export default defineConfig({
  site: 'https://wanjiacun.com',
  integrations: [
    sitemap({
      // 登录/注册页对搜索者没有价值，不提交给搜索引擎
      filter: (page) => !/\/(login|register)\/?$/.test(page),
    }),
  ],
  build: {
    format: 'directory', // /games/xxx/ 形式，对 SEO 更友好
  },
  compressHTML: true,
  trailingSlash: 'always',
});
