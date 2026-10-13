// POST /api/auth/send-code —— 发送登录/注册验证码
import { db } from '../lib/db.mjs';
import { sendSmsCode } from '../lib/sms.mjs';
import {
  validatePhone, normalizePhone, newCode, hashCode,
  json, readBody, clientIp,
} from '../lib/auth.mjs';

export const config = { path: '/api/auth/send-code' };

const CODE_TTL_MIN = 5;
const RESEND_INTERVAL_SEC = 60;   // 同一手机号最短重发间隔
const PER_PHONE_DAILY = 10;       // 同一手机号每日上限
const PER_IP_DAILY = 40;          // 同一 IP 每日上限（防被刷）

export default async function handler(request) {
  if (request.method !== 'POST') return json({ error: '方法不允许' }, 405);

  const { phone } = await readBody(request);
  const phoneErr = validatePhone(phone);
  if (phoneErr) return json({ error: phoneErr }, 400);

  const p = normalizePhone(phone);
  const ip = clientIp(request) || 'unknown';

  let sql;
  try {
    sql = db();
  } catch (e) {
    return json({ error: '服务暂时不可用，请稍后重试' }, 503);
  }

  // ---------- 频率限制 ----------
  const [recent] = await sql`
    select count(*)::int as n from verification_codes
     where phone = ${p} and created_at > now() - ${`${RESEND_INTERVAL_SEC} seconds`}::interval
  `;
  if (recent.n > 0) {
    return json({ error: `验证码已发送，请 ${RESEND_INTERVAL_SEC} 秒后再试` }, 429);
  }

  const [phoneDay] = await sql`
    select count(*)::int as n from verification_codes
     where phone = ${p} and created_at > now() - interval '1 day'
  `;
  if (phoneDay.n >= PER_PHONE_DAILY) {
    return json({ error: '该手机号今日获取次数已达上限，请明天再试' }, 429);
  }

  const [ipDay] = await sql`
    select count(*)::int as n from verification_codes
     where ip = ${ip} and created_at > now() - interval '1 day'
  `;
  if (ipDay.n >= PER_IP_DAILY) {
    return json({ error: '当前网络今日请求过于频繁，请明天再试' }, 429);
  }

  // ---------- 生成并保存（只存哈希） ----------
  const code = newCode();
  await sql`
    insert into verification_codes (phone, code_hash, ip, scene, expires_at)
    values (${p}, ${hashCode(code)}, ${ip}, 'login',
            now() + ${`${CODE_TTL_MIN} minutes`}::interval)
  `;

  // ---------- 发送 ----------
  try {
    const r = await sendSmsCode(p, code);
    const payload = { ok: true, ttl: CODE_TTL_MIN * 60 };
    // 只有号码在开发白名单里才回传验证码（未配置白名单则永不回传）
    const allow = (process.env.SMS_DEV_ALLOW || '')
      .split(',').map((s) => s.trim()).filter(Boolean);
    if (r.devCode && allow.includes(p)) payload.devCode = r.devCode;
    return json(payload, 200);
  } catch (e) {
    return json({ error: `短信发送失败：${String(e.message).slice(0, 100)}` }, 502);
  }
}
