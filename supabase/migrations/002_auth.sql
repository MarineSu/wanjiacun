-- ============================================================
-- 玩家村 · 迁移 002：自建认证（账号 + 会话）
-- 说明：不用 Supabase Auth（其服务域名 *.supabase.co 国内不可达），
--       改为自建账号体系，直连 Postgres。profiles 改引 public.users。
-- ============================================================

-- ---------- 1. 账号表 ----------
create table if not exists public.users (
  id            uuid primary key default gen_random_uuid(),
  email         text unique not null,
  password_hash text not null,
  created_at    timestamptz not null default now(),
  last_login_at timestamptz,
  -- 状态：active 正常 / locked 锁定
  status        text not null default 'active' check (status in ('active', 'locked'))
);

create index if not exists users_email_idx on public.users(lower(email));

-- ---------- 2. 会话表（支持异地登录检测） ----------
create table if not exists public.sessions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users(id) on delete cascade,
  -- 只存 token 的哈希，原 token 只存在于用户 cookie 里
  token_hash text unique not null,
  ip         text,
  user_agent text,
  region     text,   -- 归属省
  city       text,   -- 归属市（异地登录判定用）
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);

create index if not exists sessions_user_idx  on public.sessions(user_id, created_at desc);
create index if not exists sessions_token_idx on public.sessions(token_hash);

-- ---------- 3. profiles 改引 public.users ----------
-- 当前 profiles 引用 auth.users，改成引用自建 users
alter table public.profiles drop constraint if exists profiles_id_fkey;
alter table public.profiles
  add constraint profiles_id_fkey
  foreign key (id) references public.users(id) on delete cascade;

-- ---------- 4. 注册触发器改挂到 public.users ----------
drop trigger if exists on_auth_user_created on auth.users;

drop trigger if exists on_user_created on public.users;
create trigger on_user_created
  after insert on public.users
  for each row execute function public.handle_new_user();

-- ---------- 5. 这两张表不对 anon 开放 ----------
alter table public.users    enable row level security;
alter table public.sessions enable row level security;
-- 不建任何 policy = 默认拒绝所有 anon 访问（应用层用直连，不受影响）

-- ---------- 6. 会话清理辅助（可选，后续用 cron 调用） ----------
create or replace function public.purge_expired_sessions()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  delete from public.sessions
   where expires_at < now() or revoked_at is not null;
  get diagnostics n = row_count;
  return n;
end;
$$;
