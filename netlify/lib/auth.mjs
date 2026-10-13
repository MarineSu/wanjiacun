// 认证核心：密码哈希、会话管理、Cookie 工具
import { randomBytes, scryptSync, timingSafeEqual, createHash, randomInt } from 'node:crypto';

const COOKIE_NAME = 'pv_session';
const SESSION_DAYS = 30;

// ---------- 密码 ----------

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password, stored) {
  try {
    const [algo, salt, hash] = String(stored).split('$');
    if (algo !== 'scrypt' || !salt || !hash) return false;
    const calc = scryptSync(password, salt, 64);
    const orig = Buffer.from(hash, 'hex');
    return calc.length === orig.length && timingSafeEqual(calc, orig);
  } catch {
    return false;
  }
}

// 密码强度校验：至少 8 位，含字母与数字
export function validatePassword(pw) {
  if (typeof pw !== 'string') return '密码格式不正确';
  if (pw.length < 8) return '密码至少 8 位';
  if (pw.length > 100) return '密码过长';
  if (!/[a-zA-Z]/.test(pw) || !/[0-9]/.test(pw)) return '密码需同时包含字母和数字';
  return null;
}

export function validateEmail(email) {
  if (typeof email !== 'string') return '邮箱格式不正确';
  const e = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) return '邮箱格式不正确';
  if (e.length > 254) return '邮箱过长';
  return null;
}

// ---------- 会话 ----------

export function newToken() {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

export function sessionCookie(token) {
  const maxAge = SESSION_DAYS * 24 * 3600;
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export function clearCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function readToken(request) {
  const raw = request.headers.get('cookie') || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === COOKIE_NAME) return v.join('=') || null;
  }
  return null;
}

// 依据会话 token 取当前用户；无效返回 null
export async function currentUser(sql, request) {
  const token = readToken(request);
  if (!token) return null;
  const rows = await sql`
    select u.id, u.uid, u.phone, u.status,
           p.username, p.display_name, p.avatar_url, p.role,
           s.id as session_id, s.region, s.city
      from sessions s
      join users u    on u.id = s.user_id
      left join profiles p on p.id = u.id
     where s.token_hash = ${hashToken(token)}
       and s.revoked_at is null
       and s.expires_at > now()
     limit 1
  `;
  return rows[0] ?? null;
}

// ---------- 响应工具 ----------

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
}

export async function readBody(request) {
  try {
    const ct = request.headers.get('content-type') || '';
    if (ct.includes('application/json')) return await request.json();
    const text = await request.text();
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}

// ---------- 手机号 ----------

export function normalizePhone(phone) {
  return String(phone ?? '').replace(/\D/g, '');
}

export function validatePhone(phone) {
  const p = normalizePhone(phone);
  if (!p) return '请填写手机号';
  if (!/^1[3-9]\d{9}$/.test(p)) return '请输入 11 位中国大陆手机号';
  return null;
}

// ---------- 短信验证码 ----------

export function newCode() {
  // 6 位数字，使用加密安全随机源
  return String(randomInt(0, 1000000)).padStart(6, '0');
}

export function hashCode(code) {
  return createHash('sha256').update(String(code)).digest('hex');
}

// 从请求头取客户端 IP（Netlify 会带 x-nf-client-connection-ip）
export function clientIp(request) {
  return (
    request.headers.get('x-nf-client-connection-ip') ||
    (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() ||
    null
  );
}
