-- ============================================================
-- 玩家村 · 迁移 003：手机号 + 短信验证码登录，并加入 UID
-- 设计要点：
--   1. UID 纯数字，从 12500 递增（与陪玩平台规则一致）
--   2. 公开界面只显示 UID 与用户名，不出现手机号
--   3. 用户名由 UID 生成（如「玩家12500」），不从手机号派生，避免泄露
--   4. email / password_hash 放宽为可空（验证码登录不需要密码）
-- ============================================================

-- ---------- 1. UID 序列 ----------
create sequence if not exists public.uid_seq start with 12500 increment by 1;

-- ---------- 2. users 表改造 ----------
alter table public.users add column if not exists phone text;
alter table public.users add column if not exists uid   integer;

-- 历史行补 UID（当前无数据，保留以防万一）
update public.users set uid = nextval('public.uid_seq') where uid is null;

alter table public.users alter column uid   set default nextval('public.uid_seq');
alter table public.users alter column email         drop not null;
alter table public.users alter column password_hash drop not null;

-- 唯一性
create unique index if not exists users_uid_key_uniq
  on public.users(uid);
create unique index if not exists users_phone_key_uniq
  on public.users(phone) where phone is not null;

-- UID 必须为正
alter table public.users drop constraint if exists users_uid_positive;
alter table public.users add constraint users_uid_positive check (uid >= 12500);

-- ---------- 3. 验证码表 ----------
create table if not exists public.verification_codes (
  id         bigserial primary key,
  phone      text not null,
  -- 只存验证码哈希，不存明文
  code_hash  text not null,
  ip         text,
  -- 发送场景：register / login / bind
  scene      text not null default 'login'
               check (scene in ('register', 'login', 'bind')),
  used_at    timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

-- 累计验证失败次数（超过上限即作废，防暴力猜测 6 位码）
alter table public.verification_codes add column if not exists attempts integer not null default 0;

create index if not exists vcodes_phone_idx on public.verification_codes(phone, created_at desc);
create index if not exists vcodes_ip_idx    on public.verification_codes(ip, created_at desc);

alter table public.verification_codes enable row level security;

-- ---------- 4. 注册触发器：用户名由 UID 生成 ----------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  base_name text;
  final_name text;
  n int := 0;
begin
  -- 用 UID 命名，不泄露手机号
  base_name := '玩家' || coalesce(new.uid::text, '00000');
  final_name := base_name;

  while exists (select 1 from public.profiles where username = final_name) loop
    n := n + 1;
    final_name := base_name || '_' || n::text;
    exit when n >= 20;
  end loop;

  insert into public.profiles (id, username, display_name, uid)
  values (new.id, final_name, final_name, new.uid)
  on conflict (id) do nothing;

  return new;
end;
$$;

-- ---------- 5. profiles 冗余存一份 UID（公开页展示用，避免每次联表） ----------
alter table public.profiles add column if not exists uid integer;
create index if not exists profiles_uid_idx on public.profiles(uid);

-- ---------- 6. 验证码清理函数 ----------
create or replace function public.purge_expired_codes()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  delete from public.verification_codes
   where expires_at < now() - interval '1 day';
  get diagnostics n = row_count;
  return n;
end;
$$;
