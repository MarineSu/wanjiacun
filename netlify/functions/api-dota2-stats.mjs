// GET /api/dota2-stats —— 代理 OpenDota 的 heroStats（当前版本英雄胜率）
//
// 为什么不直连：国内网络访问 api.opendota.com 不稳定，且多人同时打开页面会高频抓取被上游限流。
// 缓存策略与本地服务一致：6 小时内存缓存；抓取失败回退上次成功的数据（永不返回空）。
export const config = { path: '/api/dota2-stats' };

const API = 'https://api.opendota.com/api/heroStats';
const TTL = 6 * 3600 * 1000; // 6 小时

// 模块级缓存：同一个函数实例存活期间复用（Netlify 会保持热实例一段时间）
let cache = { data: null, ts: 0 };

const json = (obj) =>
  new Response(JSON.stringify(obj), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });

export default async function handler(request) {
  const now = Date.now();
  const force = new URL(request.url).searchParams.get('force') === '1';

  if (!force && cache.data && now - cache.ts < TTL) {
    return json({ ok: true, source: 'cache', fetched_at: Math.floor(cache.ts / 1000), data: cache.data });
  }

  try {
    const res = await fetch(API, {
      headers: { 'User-Agent': 'wanjiacun-dota2/1.0' },
      signal: AbortSignal.timeout(9000),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) throw new Error('empty payload');
    cache = { data, ts: now };
    return json({ ok: true, source: 'fresh', fetched_at: Math.floor(now / 1000), data });
  } catch (e) {
    if (cache.data) {
      return json({
        ok: true,
        source: 'stale:' + (e.name || 'Error'),
        fetched_at: Math.floor(cache.ts / 1000),
        data: cache.data,
      });
    }
    return json({ ok: false, error: String(e.message || e) });
  }
}
