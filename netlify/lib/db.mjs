// 数据库连接（Serverless 环境：每次调用一个连接，靠 Supabase 连接池复用）
import postgres from 'postgres';

let _sql = null;

export function db() {
  if (_sql) return _sql;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('缺少环境变量 DATABASE_URL');
  _sql = postgres(url, {
    // Supabase 连接池使用自签中间证书，跳过链校验（连接仍加密）
    ssl: { rejectUnauthorized: false },
    max: 1,
    idle_timeout: 20,
    connect_timeout: 15,
    prepare: false, // 连接池模式下禁用预处理语句
  });
  return _sql;
}
