-- CONNECTLY PRO MIGRATION
-- Run once AFTER the original Connectly V2 SQL and the earlier V3 migration, if you ran it.
-- Safe to re-run because objects use IF NOT EXISTS / drop policy patterns.

create extension if not exists pgcrypto;

alter table public.profiles add column if not exists gender text default '';
alter table public.profiles add column if not exists looking_for text not null default 'everyone';
alter table public.profiles add column if not exists min_age int not null default 18;
alter table public.profiles add column if not exists max_age int not null default 100;
alter table public.profiles add column if not exists status_text text default '';
alter table public.profiles add column if not exists last_seen timestamptz default now();

create table if not exists public.profile_photos (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  storage_path text not null unique,
  public_url text not null,
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.profile_photos enable row level security;

create table if not exists public.profile_comments (
  id bigint generated always as identity primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check(length(body) between 1 and 500),
  created_at timestamptz not null default now()
);
alter table public.profile_comments enable row level security;

create table if not exists public.profile_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  min_age int not null default 18,
  max_age int not null default 100,
  preferred_gender text not null default 'everyone',
  updated_at timestamptz not null default now()
);
alter table public.profile_preferences enable row level security;

create table if not exists public.notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete cascade,
  type text not null,
  text text not null,
  link text,
  read boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.notifications enable row level security;

-- Photos: public read, owner manages own objects.
insert into storage.buckets(id,name,public)
values('profile-media','profile-media',true)
on conflict(id) do update set public=true;

drop policy if exists "profile media public read" on storage.objects;
create policy "profile media public read" on storage.objects
for select using(bucket_id='profile-media');

drop policy if exists "profile media owner insert" on storage.objects;
create policy "profile media owner insert" on storage.objects
for insert to authenticated
with check(bucket_id='profile-media' and (storage.foldername(name))[1]=auth.uid()::text);

drop policy if exists "profile media owner update" on storage.objects;
create policy "profile media owner update" on storage.objects
for update to authenticated
using(bucket_id='profile-media' and (storage.foldername(name))[1]=auth.uid()::text)
with check(bucket_id='profile-media' and (storage.foldername(name))[1]=auth.uid()::text);

drop policy if exists "profile media owner delete" on storage.objects;
create policy "profile media owner delete" on storage.objects
for delete to authenticated
using(bucket_id='profile-media' and (storage.foldername(name))[1]=auth.uid()::text);

drop policy if exists "photos readable" on public.profile_photos;
create policy "photos readable" on public.profile_photos
for select to authenticated using(
  user_id=auth.uid() or not exists(
    select 1 from public.blocks b
    where (b.blocker_id=auth.uid() and b.blocked_id=profile_photos.user_id)
       or (b.blocker_id=profile_photos.user_id and b.blocked_id=auth.uid())
  )
);

drop policy if exists "photos insert own" on public.profile_photos;
create policy "photos insert own" on public.profile_photos
for insert to authenticated with check(user_id=auth.uid());

drop policy if exists "photos update own" on public.profile_photos;
create policy "photos update own" on public.profile_photos
for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());

drop policy if exists "photos delete own" on public.profile_photos;
create policy "photos delete own" on public.profile_photos
for delete to authenticated using(user_id=auth.uid());

drop policy if exists "comments readable" on public.profile_comments;
create policy "comments readable" on public.profile_comments
for select to authenticated using(
  not exists(
    select 1 from public.blocks b
    where (b.blocker_id=auth.uid() and b.blocked_id=profile_comments.profile_id)
       or (b.blocker_id=profile_comments.profile_id and b.blocked_id=auth.uid())
  )
);

drop policy if exists "comments insert own" on public.profile_comments;
create policy "comments insert own" on public.profile_comments
for insert to authenticated with check(author_id=auth.uid());

drop policy if exists "comments delete own or profile owner" on public.profile_comments;
create policy "comments delete own or profile owner" on public.profile_comments
for delete to authenticated using(author_id=auth.uid() or profile_id=auth.uid());

drop policy if exists "prefs own read" on public.profile_preferences;
create policy "prefs own read" on public.profile_preferences for select to authenticated using(user_id=auth.uid());
drop policy if exists "prefs own insert" on public.profile_preferences;
create policy "prefs own insert" on public.profile_preferences for insert to authenticated with check(user_id=auth.uid());
drop policy if exists "prefs own update" on public.profile_preferences;
create policy "prefs own update" on public.profile_preferences for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());

drop policy if exists "notifications own read" on public.notifications;
create policy "notifications own read" on public.notifications for select to authenticated using(user_id=auth.uid());
drop policy if exists "notifications own update" on public.notifications;
create policy "notifications own update" on public.notifications for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());

alter table public.profile_comments replica identity full;
alter publication supabase_realtime add table public.profile_comments;

-- Keep profile last_seen fresh when a member loads the app.
create or replace function public.touch_profile()
returns void language sql security definer set search_path=public
as $$ update public.profiles set last_seen=now() where id=auth.uid(); $$;
grant execute on function public.touch_profile() to authenticated;

-- Helpful indexes for faster reads.
create index if not exists profiles_city_idx on public.profiles(city);
create index if not exists profiles_last_seen_idx on public.profiles(last_seen desc);
create index if not exists profile_photos_user_idx on public.profile_photos(user_id, created_at);
create index if not exists profile_comments_profile_idx on public.profile_comments(profile_id, created_at desc);
create index if not exists notifications_user_idx on public.notifications(user_id, created_at desc);
