// POST /api/auth/login
import { db } from '../lib/db.mjs';
import {
  verifyPassword, newToken, hashToken, sessionCookie,
  json, readBody, clientIp,
} from '../lib/auth.mjs';

export const config = { path: '/api/auth/login' };

export default async function handler(request) {
  if (request.method !== 'POST') return json({ error: '方法不允许' }, 405);

  const { email, password } = await readBody(request);
  if (!email || !password) return json({ error: '请填写邮箱和密码' }, 400);

  const sql = db();
  const mail = String(email).trim().toLowerCase();
  const rows = await sql`
    select id, email, password_hash, status from users
     where lower(email) = ${mail} limit 1
  `;
  const u = rows[0];

  // 故意不区分“邮箱不存在”和“密码错误”，避免被用来枚举注册用户
  if (!u || !verifyPassword(password, u.password_hash)) {
    return json({ error: '邮箱或密码不正确' }, 401);
  }
  if (u.status !== 'active') {
    return json({ error: '账号已被锁定，请联系管理员' }, 403);
  }

  const token = newToken();
  await sql`
    insert into sessions (user_id, token_hash, ip, user_agent, expires_at)
    values (${u.id}, ${hashToken(token)}, ${clientIp(request)},
            ${request.headers.get('user-agent') || ''}, now() + interval '30 days')
  `;
  await sql`update users set last_login_at = now() where id = ${u.id}`;

  const prof = await sql`select username, display_name, role from profiles where id = ${u.id} limit 1`;

  return json(
    {
      ok: true,
      user: {
        id: u.id,
        email: u.email,
        username: prof[0]?.username ?? null,
        displayName: prof[0]?.display_name ?? null,
        role: prof[0]?.role ?? 'reader',
      },
    },
    200,
    { 'Set-Cookie': sessionCookie(token) }
  );
}
