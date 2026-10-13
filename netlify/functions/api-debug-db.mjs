// 临时诊断端点：查看函数实际读到的 DATABASE_URL 结构（密码脱敏）
// 定位完问题后删除
export const config = { path: '/api/debug-db' };

export default async function handler() {
  const raw = process.env.DATABASE_URL || '';
  const pgpw = process.env.PGPASSWORD || '';
  const info = {
    // 密码来源诊断
    hasPGPASSWORD: pgpw.length > 0,
    pgPasswordLength: pgpw.length,
    hasDatabaseUrl: raw.length > 0,
    // 密码优先级：PGPASSWORD 优先于 DATABASE_URL
    activeSource: pgpw ? 'PGPASSWORD' : (raw ? 'DATABASE_URL' : '无'),
    envExists: raw.length > 0,
    rawLength: raw.length,
    // 脱敏：把密码部分替换成 ***
    masked: raw.replace(/:([^:@/]+)@/, ':***@'),
    hasLeadingSpace: raw !== raw.trimStart(),
    hasTrailingSpace: raw !== raw.trimEnd(),
    hasQuotes: raw.startsWith('"') || raw.startsWith("'"),
  };

  try {
    const u = new URL(raw.trim());
    info.parsed = {
      protocol: u.protocol,
      username: u.username,          // 关键：看是否包含 .figtuerbcoxacxhpbkfj
      hostname: u.hostname,
      port: u.port,
      database: u.pathname.replace(/^\//, ''),
      passwordLength: decodeURIComponent(u.password || '').length,
      passwordFirst2: decodeURIComponent(u.password || '').slice(0, 2),
    };
  } catch (e) {
    info.parseError = String(e);
  }

  // 再看 postgres.js 最终用什么用户名去连
  try {
    const { default: postgres } = await import('postgres');
    const sql = postgres(raw.trim(), {
      ssl: { rejectUnauthorized: false },
      max: 1,
      connect_timeout: 10,
      prepare: false,
    });
    info.pgOptions = {
      user: sql.options?.user ?? '(不暴露)',
      host: (sql.options?.host || []).join(',') || '(不暴露)',
      port: (sql.options?.port || []).join(',') || '(不暴露)',
      database: sql.options?.database ?? '(不暴露)',
    };
    await sql.end({ timeout: 1 }).catch(() => {});
  } catch (e) {
    info.pgError = String(e).slice(0, 200);
  }

  // 实际连接测试：能连上就说明密码对了
  try {
    const { db } = await import('../lib/db.mjs');
    const sql = db();
    const r = await sql`select current_user as who, now() as ts`;
    info.connectionTest = { ok: true, currentUser: r[0].who, time: String(r[0].ts) };
  } catch (e) {
    info.connectionTest = { ok: false, error: String(e).slice(0, 220) };
  }

  return new Response(JSON.stringify(info, null, 2), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
