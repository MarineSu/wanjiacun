// POST /api/auth/register
import { db } from '../lib/db.mjs';
import {
  hashPassword, validateEmail, validatePassword,
  newToken, hashToken, sessionCookie, json, readBody, clientIp,
} from '../lib/auth.mjs';

export const config = { path: '/api/auth/register' };

export default async function handler(request) {
  if (request.method !== 'POST') return json({ error: '方法不允许' }, 405);

  const { email, password } = await readBody(request);

  const emailErr = validateEmail(email);
  if (emailErr) return json({ error: emailErr }, 400);
  const pwErr = validatePassword(password);
  if (pwErr) return json({ error: pwErr }, 400);

  const sql = db();
  const mail = email.trim().toLowerCase();

  const exists = await sql`select 1 from users where lower(email) = ${mail} limit 1`;
  if (exists.length) return json({ error: '该邮箱已注册，请直接登录' }, 409);

  const rows = await sql`
    insert into users (email, password_hash)
    values (${mail}, ${hashPassword(password)})
    returning id, email
  `;
  const user = rows[0];

  // profiles 由数据库触发器 on_user_created 自动创建
  const token = newToken();
  await sql`
    insert into sessions (user_id, token_hash, ip, user_agent, expires_at)
    values (${user.id}, ${hashToken(token)}, ${clientIp(request)},
            ${request.headers.get('user-agent') || ''}, now() + interval '30 days')
  `;

  const prof = await sql`select username, display_name, role from profiles where id = ${user.id} limit 1`;

  return json(
    {
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        username: prof[0]?.username ?? null,
        displayName: prof[0]?.display_name ?? null,
        role: prof[0]?.role ?? 'reader',
      },
    },
    201,
    { 'Set-Cookie': sessionCookie(token) }
  );
}
