// 短信发送抽象层：服务商可插拔
//
// 通过环境变量 SMS_PROVIDER 选择：
//   aliyun  —— 阿里云短信（需 ALIYUN_ACCESS_KEY_ID / _SECRET / _SMS_SIGN_NAME / _SMS_TEMPLATE_CODE）
//   tencent —— 腾讯云短信（预留，需要时补实现）
//   http    —— 任意 HTTP 网关（需 SMS_HTTP_URL，可选 SMS_HTTP_TOKEN）
//   dev     —— 开发模式：不真发，验证码直接返回给调用方（仅供联调，禁止在生产开启）
//
// 返回：{ ok: true, provider, devCode? }
import { createHmac, randomUUID } from 'node:crypto';

// 阿里云要求的 percentEncode（比 encodeURIComponent 更严格）
const pe = (s) => encodeURIComponent(String(s))
  .replace(/\+/g, '%20')
  .replace(/\*/g, '%2A')
  .replace(/%7E/g, '~');

async function sendAliyun(phone, code) {
  const keyId = process.env.ALIYUN_ACCESS_KEY_ID;
  const keySecret = process.env.ALIYUN_ACCESS_KEY_SECRET;
  const signName = process.env.ALIYUN_SMS_SIGN_NAME;
  const templateCode = process.env.ALIYUN_SMS_TEMPLATE_CODE;

  const missing = Object.entries({
    ALIYUN_ACCESS_KEY_ID: keyId,
    ALIYUN_ACCESS_KEY_SECRET: keySecret,
    ALIYUN_SMS_SIGN_NAME: signName,
    ALIYUN_SMS_TEMPLATE_CODE: templateCode,
  }).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) throw new Error(`阿里云短信配置缺失: ${missing.join(', ')}`);

  const params = {
    AccessKeyId: keyId,
    Action: 'SendSms',
    Format: 'JSON',
    PhoneNumbers: phone,
    RegionId: 'cn-hangzhou',
    SignName: signName,
    SignatureMethod: 'HMAC-SHA1',
    SignatureNonce: randomUUID(),
    SignatureVersion: '1.0',
    TemplateCode: templateCode,
    TemplateParam: JSON.stringify({ code }),
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    Version: '2017-05-25',
  };

  const qs = Object.keys(params).sort()
    .map((k) => `${pe(k)}=${pe(params[k])}`).join('&');
  const stringToSign = `GET&%2F&${pe(qs)}`;
  const signature = createHmac('sha1', `${keySecret}&`)
    .update(stringToSign).digest('base64');

  const url = `https://dysmsapi.aliyuncs.com/?Signature=${pe(signature)}&${qs}`;
  const res = await fetch(url, { method: 'GET' });
  const data = await res.json().catch(() => ({}));

  if (data.Code !== 'OK') {
    throw new Error(`阿里云短信发送失败: ${data.Code || res.status} ${data.Message || ''}`);
  }
  return { ok: true, provider: 'aliyun', bizId: data.BizId };
}

// 阿里云「短信认证」(号码认证 PNVS) —— 个人实名即可用、免资质、免签名审核
// 这是目前国内唯一对个人开发者开放的正规验证码通道
async function sendPnv(phone, code) {
  const keyId = process.env.ALIYUN_ACCESS_KEY_ID;
  const keySecret = process.env.ALIYUN_ACCESS_KEY_SECRET;
  const signName = process.env.PNVS_SIGN_NAME;
  const templateCode = process.env.PNVS_TEMPLATE_CODE;

  const missing = Object.entries({
    ALIYUN_ACCESS_KEY_ID: keyId,
    ALIYUN_ACCESS_KEY_SECRET: keySecret,
    PNVS_SIGN_NAME: signName,
    PNVS_TEMPLATE_CODE: templateCode,
  }).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) throw new Error(`短信认证配置缺失: ${missing.join(', ')}`);

  const params = {
    AccessKeyId: keyId,
    Action: 'SendSmsVerifyCode',
    CodeLength: 6,
    DuplicatePolicy: 1,                 // 同号码重复发送时，旧验证码失效
    Format: 'JSON',
    Interval: 60,                       // 平台侧频控，与我们自己的限流形成双保险
    PhoneNumber: phone,
    ReturnVerifyCode: true,             // 让响应回传验证码，我们存哈希自行校验
    SignName: signName,
    SignatureMethod: 'HMAC-SHA1',
    SignatureNonce: randomUUID(),
    SignatureVersion: '1.0',
    TemplateCode: templateCode,
    TemplateParam: JSON.stringify({ code: '##code##', min: '6' }),
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    ValidTime: 300,
    Version: '2017-05-25',
  };

  const qs = Object.keys(params).sort()
    .map((k) => `${pe(k)}=${pe(params[k])}`).join('&');
  const stringToSign = `GET&%2F&${pe(qs)}`;
  const signature = createHmac('sha1', `${keySecret}&`)
    .update(stringToSign).digest('base64');

  const url = `https://dypnsapi.aliyuncs.com/?Signature=${pe(signature)}&${qs}`;
  const res = await fetch(url, { method: 'GET' });
  const data = await res.json().catch(() => ({}));

  if (data.Code !== 'OK') {
    throw new Error(`短信认证发送失败: ${data.Code || res.status} ${data.Message || ''}`);
  }
  return {
    ok: true,
    provider: 'aliyun-pnvs',
    bizId: data.Model?.BizId,
    // 阿里云生成的验证码（ReturnVerifyCode=true 时返回）
    verifyCode: data.Model?.VerifyCode,
  };
}

async function sendHttp(phone, code) {
  const url = process.env.SMS_HTTP_URL;
  if (!url) throw new Error('缺少 SMS_HTTP_URL');

  let extra = {};
  try { extra = JSON.parse(process.env.SMS_HTTP_EXTRA || '{}'); } catch { /* 忽略 */ }

  const headers = { 'Content-Type': 'application/json' };
  if (process.env.SMS_HTTP_TOKEN) {
    headers.Authorization = `Bearer ${process.env.SMS_HTTP_TOKEN}`;
  }

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ phone, code, ...extra }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`短信网关返回 ${res.status} ${t.slice(0, 120)}`);
  }
  return { ok: true, provider: 'http' };
}

export async function sendSmsCode(phone, code) {
  const provider = (process.env.SMS_PROVIDER || '').toLowerCase().trim();

  if (provider === 'aliyun') return sendAliyun(phone, code);
  // 个人开发者走这个：阿里云「短信认证」，免企业资质
  if (provider === 'aliyun-pnvs' || provider === 'pnvs') return sendPnv(phone, code);
  if (provider === 'http') return sendHttp(phone, code);
  if (provider === 'dev') {
    // 仅供联调：不真发短信，把验证码回给调用方
    console.log(`[SMS-DEV] ${phone} -> ${code}`);
    return { ok: true, provider: 'dev', devCode: code };
  }
  if (provider === 'tencent') {
    throw new Error('腾讯云短信尚未实现，请先用 aliyun 或 http');
  }

  throw new Error('短信服务未配置：请设置环境变量 SMS_PROVIDER（aliyun / http / dev）');
}

export function smsProviderName() {
  return (process.env.SMS_PROVIDER || '').toLowerCase().trim() || '(未配置)';
}
