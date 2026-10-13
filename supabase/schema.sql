-- ============================================================
-- 玩家村 · 数据库结构
-- 一次设计完整，分期实现功能（第1期只用 profiles）
-- ============================================================

-- ---------- 1. 用户资料 ----------
-- 扩展 Supabase 自带的 auth.users，存放公开资料
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  username    text unique not null,
  display_name text,
  avatar_url  text,
  bio         text,
  -- reader: 只能互动  |  author: 可投稿  |  admin: 可审核
  role        text not null default 'reader'
                check (role in ('reader', 'author', 'admin')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists profiles_role_idx on public.profiles(role);

-- 新用户注册时自动建 profile（用户名默认取邮箱前缀，冲突则加随机后缀）
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
  base_name := coalesce(
    nullif(split_part(new.email, '@', 1), ''),
    'user'
  );
  final_name := base_name;
  -- 用户名冲突时追加数字，最多试 20 次
  while exists (select 1 from public.profiles where username = final_name) loop
    n := n + 1;
    final_name := base_name || n::text;
    exit when n >= 20;
  end loop;

  insert into public.profiles (id, username, display_name)
  values (new.id, final_name, final_name)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- 2. 评论 ----------
create table if not exists public.comments (
  id         bigserial primary key,
  guide_id   text not null,               -- 对应攻略的 slug，如 crimson-desert-beginner-guide
  user_id    uuid not null references public.profiles(id) on delete cascade,
  parent_id  bigint references public.comments(id) on delete cascade,
  content    text not null check (char_length(content) between 1 and 3000),
  status     text not null default 'visible'
               check (status in ('visible', 'pending', 'hidden')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists comments_guide_idx  on public.comments(guide_id, status, created_at desc);
create index if not exists comments_user_idx   on public.comments(user_id, created_at desc);
create index if not exists comments_parent_idx on public.comments(parent_id);

-- ---------- 3. 点赞 ----------
create table if not exists public.guide_likes (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  guide_id   text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, guide_id)
);
create index if not exists guide_likes_guide_idx on public.guide_likes(guide_id);

create table if not exists public.comment_likes (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  comment_id bigint not null references public.comments(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, comment_id)
);

-- ---------- 4. 收藏 ----------
create table if not exists public.bookmarks (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  guide_id   text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, guide_id)
);
create index if not exists bookmarks_user_idx on public.bookmarks(user_id, created_at desc);

-- ---------- 5. 关注（关注作者） ----------
create table if not exists public.follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  author_id   uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (follower_id, author_id),
  check (follower_id <> author_id)
);
create index if not exists follows_author_idx on public.follows(author_id);

-- ---------- 6. 投稿（作者投稿分区） ----------
create table if not exists public.submissions (
  id           bigserial primary key,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  title        text not null,
  game         text not null,
  category     text not null,
  summary      text,
  content_md   text not null,
  status       text not null default 'pending'
                 check (status in ('pending', 'approved', 'rejected', 'published')),
  reviewer_id  uuid references public.profiles(id),
  review_note  text,
  created_at   timestamptz not null default now(),
  reviewed_at  timestamptz
);
create index if not exists submissions_status_idx on public.submissions(status, created_at desc);
create index if not exists submissions_user_idx   on public.submissions(user_id, created_at desc);

-- ---------- 7. 计数视图（避免每次 COUNT 全表） ----------
create or replace view public.guide_stats as
select
  guide_id,
  count(*) filter (where true) as like_count
from public.guide_likes
group by guide_id;

-- ---------- 8. 行级安全（纵深防御） ----------
-- 说明：应用层走 Netlify Functions + service_role，本身绕过 RLS。
-- 这里开启 RLS 是为了防止 anon key 万一泄露时被直接读库。
alter table public.profiles      enable row level security;
alter table public.comments      enable row level security;
alter table public.guide_likes   enable row level security;
alter table public.comment_likes enable row level security;
alter table public.bookmarks     enable row level security;
alter table public.follows       enable row level security;
alter table public.submissions   enable row level security;

-- 公开可读：用户资料与可见评论
drop policy if exists profiles_public_read on public.profiles;
create policy profiles_public_read on public.profiles
  for select using (true);

drop policy if exists comments_public_read on public.comments;
create policy comments_public_read on public.comments
  for select using (status = 'visible');

-- 其余表默认不开放给 anon（应用层用 service_role 访问）

-- ---------- 9. 更新时间戳 ----------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists comments_touch on public.comments;
create trigger comments_touch before update on public.comments
  for each row execute function public.touch_updated_at();
