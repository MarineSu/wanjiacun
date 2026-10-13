// 数据库连接（Serverless 环境：每次调用一个连接，靠 Supabase 连接池复用）
import postgres from 'postgres';

// 非敏感字段：主机与用户名可硬编码；密码永远只从环境变量读
const DEFAULTS = {
  host: 'aws-0-ap-southeast-1.pooler.supabase.com',
  port: 5432,
  user: 'postgres.figtuerbcoxacxhpbkfj',
  database: 'postgres',
};

let _sql = null;

export function db() {
  if (_sql) return _sql;

  const common = {
    // Supabase 连接池使用自签中间证书，跳过链校验（连接仍加密）
    ssl: { rejectUnauthorized: false },
    max: 1,
    idle_timeout: 20,
    connect_timeout: 15,
    prepare: false, // 连接池模式下禁用预处理语句
  };

  if (process.env.PGPASSWORD) {
    // 推荐：密码单独一个变量，避免整串连接串被改写
    _sql = postgres({
      host: process.env.PGHOST || DEFAULTS.host,
      port: Number(process.env.PGPORT || DEFAULTS.port),
      user: process.env.PGUSER || DEFAULTS.user,
      password: process.env.PGPASSWORD,
      database: process.env.PGDATABASE || DEFAULTS.database,
      ...common,
    });
  } else if (process.env.DATABASE_URL) {
    _sql = postgres(process.env.DATABASE_URL.trim(), common);
  } else {
    throw new Error('缺少数据库配置：请设置 PGPASSWORD（推荐）或 DATABASE_URL');
  }

  return _sql;
}
