// POST /api/auth/logout
import { db } from '../lib/db.mjs';
import { readToken, hashToken, clearCookie, json } from '../lib/auth.mjs';

export const config = { path: '/api/auth/logout' };

export default async function handler(request) {
  const token = readToken(request);
  if (token) {
    try {
      const sql = db();
      await sql`update sessions set revoked_at = now() where token_hash = ${hashToken(token)}`;
    } catch {
      // 即便数据库报错，也要清掉浏览器 cookie
    }
  }
  return json({ ok: true }, 200, { 'Set-Cookie': clearCookie() });
}
