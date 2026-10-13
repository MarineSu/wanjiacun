// Vercel 适配层：把 Vercel 的 Node 风格 (req, res) 适配成 Web 标准 Request/Response。
// 这样同一份业务 handler 既能跑在 Netlify Functions，也能跑在 Vercel Functions，
// 业务代码零改动、零分叉。

export function adaptWebHandler(webHandler) {
  return async function vercelHandler(req, res) {
    try {
      const proto = String(req.headers['x-forwarded-proto'] || 'https')
        .split(',')[0].trim();
      const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
      const url = `${proto}://${host}${req.url}`;

      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (v == null) continue;
        if (Array.isArray(v)) v.forEach((x) => headers.append(k, String(x)));
        else headers.set(k, String(v));
      }

      let body;
      if (!['GET', 'HEAD'].includes(req.method)) {
        if (typeof req.body === 'string') body = req.body;
        else if (req.body != null) body = JSON.stringify(req.body);
        if (body && !headers.has('content-type')) {
          headers.set('content-type', 'application/json');
        }
      }

      const request = new Request(url, { method: req.method, headers, body });
      const response = await webHandler(request);

      res.statusCode = response.status;
      response.headers.forEach((value, key) => res.setHeader(key, value));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (err) {
      // 兜底：任何未捕获异常都返回 JSON，避免前端拿到 HTML 错误页
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
      }
      res.end(JSON.stringify({ error: `服务器内部错误：${String(err?.message ?? err).slice(0, 120)}` }));
    }
  };
}
