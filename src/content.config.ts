import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// 游戏库：每款游戏一个 md，攻略挂在其下
const games = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/games' }),
  schema: z.object({
    title: z.string(),
    aliases: z.array(z.string()).default([]), // 别名，用于搜索与 SEO
    platforms: z.array(z.string()),
    genres: z.array(z.string()),
    releaseYear: z.number(),
    developer: z.string().optional(),
    publisher: z.string().optional(),
    summary: z.string(), // 120 字内，用于 meta description
    cover: z.string().optional(),
  }),
});

// 攻略：正文是 SEO 主体，字数越多越容易被收录
const guides = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/guides' }),
  schema: z.object({
    title: z.string(),
    game: z.string(), // 对应 games 的 id
    category: z.enum([
      '新手指南', '进阶技巧', 'Boss攻略', '装备配装',
      '剧情解析', '成就收集', '资源刷取', '其他',
    ]),
    tags: z.array(z.string()).default([]),
    author: z.string().default('编辑部'),
    publishedAt: z.coerce.date(),
    updatedAt: z.coerce.date().optional(),
    summary: z.string(),
    cover: z.string().optional(),
    draft: z.boolean().default(false),
  }),
});

export const collections = { games, guides };
