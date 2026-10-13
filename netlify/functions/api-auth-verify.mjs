// POST /api/auth/verify —— 用验证码登录；手机号不存在则自动注册
import { db } from '../lib/db.mjs';
import {
  validatePhone, normalizePhone, hashCode,
  newToken, hashToken, sessionCookie, json, readBody, clientIp,
} from '../lib/auth.mjs';

export const config = { path: '/api/auth/verify' };

const MAX_ATTEMPTS = 5; // 同一验证码最多试错次数（防暴力猜测）

export default async function handler(request) {
  if (request.method !== 'POST') return json({ error: '方法不允许' }, 405);

  const { phone, code } = await readBody(request);
  const phoneErr = validatePhone(phone);
  if (phoneErr) return json({ error: phoneErr }, 400);
  if (!/^\d{6}$/.test(String(code ?? '').trim())) {
    return json({ error: '请输入 6 位数字验证码' }, 400);
  }

  const p = normalizePhone(phone);
  const c = String(code).trim();
  const sql = db();

  // ---------- 取最近一条未使用的验证码 ----------
  const rows = await sql`
    select id, code_hash, attempts
      from verification_codes
     where phone = ${p} and used_at is null and expires_at > now()
     order by created_at desc
     limit 1
  `;
  const rec = rows[0];
  if (!rec) return json({ error: '验证码已过期，请重新获取' }, 400);
  if (rec.attempts >= MAX_ATTEMPTS) {
    return json({ error: '错误次数过多，请重新获取验证码' }, 429);
  }

  if (rec.code_hash !== hashCode(c)) {
    await sql`update verification_codes set attempts = attempts + 1 where id = ${rec.id}`;
    const left = MAX_ATTEMPTS - (rec.attempts + 1);
    return json({ error: `验证码不正确${left > 0 ? `，还可尝试 ${left} 次` : ''}` }, 400);
  }

  // 一次性使用
  await sql`update verification_codes set used_at = now() where id = ${rec.id}`;

  // ---------- 找用户，没有就注册 ----------
  let user = (await sql`select id, phone, uid from users where phone = ${p} limit 1`)[0];
  let isNew = false;

  if (!user) {
    try {
      user = (await sql`
        insert into users (phone) values (${p})
        returning id, phone, uid
      `)[0];
      isNew = true;
    } catch {
      // 并发注册兜底：再查一次
      user = (await sql`select id, phone, uid from users where phone = ${p} limit 1`)[0];
      if (!user) return json({ error: '注册失败，请重试' }, 500);
    }
  }

  // ---------- 建会话 ----------
  const token = newToken();
  await sql`
    insert into sessions (user_id, token_hash, ip, user_agent, expires_at)
    values (${user.id}, ${hashToken(token)}, ${clientIp(request)},
            ${request.headers.get('user-agent') || ''}, now() + interval '30 days')
  `;
  await sql`update users set last_login_at = now() where id = ${user.id}`;

  const prof = (await sql`
    select username, display_name, role, uid from profiles where id = ${user.id} limit 1
  `)[0];

  return json(
    {
      ok: true,
      isNew,
      user: {
        id: user.id,
        uid: user.uid,
        username: prof?.username ?? null,
        displayName: prof?.display_name ?? null,
        role: prof?.role ?? 'reader',
      },
    },
    200,
    { 'Set-Cookie': sessionCookie(token) }
  );
}
