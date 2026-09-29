-- CONNECTLY V2 DATABASE
-- Run this entire script in Supabase SQL Editor.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 name text not null default '',
 age int not null check (age >= 18),
 city text default '',
 bio text default '',
 interests text[] not null default '{}',
 avatar_url text,
 is_blocked boolean not null default false,
 created_at timestamptz not null default now()
);

create table if not exists public.likes (
 from_user uuid references public.profiles(id) on delete cascade,
 to_user uuid references public.profiles(id) on delete cascade,
 created_at timestamptz not null default now(),
 primary key(from_user,to_user),
 check(from_user <> to_user)
);

create table if not exists public.messages (
 id bigint generated always as identity primary key,
 sender_id uuid references public.profiles(id) on delete cascade,
 receiver_id uuid references public.profiles(id) on delete cascade,
 body text not null check(length(body) between 1 and 4000),
 created_at timestamptz not null default now(),
 check(sender_id <> receiver_id)
);

create table if not exists public.blocks (
 blocker_id uuid references public.profiles(id) on delete cascade,
 blocked_id uuid references public.profiles(id) on delete cascade,
 created_at timestamptz not null default now(),
 primary key(blocker_id,blocked_id),
 check(blocker_id <> blocked_id)
);

create table if not exists public.reports (
 id bigint generated always as identity primary key,
 reporter_id uuid references public.profiles(id) on delete cascade,
 reported_id uuid references public.profiles(id) on delete cascade,
 reason text not null check(length(reason) between 3 and 2000),
 created_at timestamptz not null default now()
);

-- Helper view: each authenticated user can see the other profile in their matches.
create or replace view public.my_matches as
select l1.from_user as user_a, l1.to_user as user_b
from public.likes l1 join public.likes l2
on l2.from_user=l1.to_user and l2.to_user=l1.from_user;

create or replace view public.matches as
select
 md5(least(m.user_a::text,m.user_b::text)||greatest(m.user_a::text,m.user_b::text)) as id,
 case when m.user_a=auth.uid() then m.user_a else m.user_b end as user_a,
 case when m.user_a=auth.uid() then m.user_b else m.user_a end as user_b,
 case when m.user_a=auth.uid() then p2 else p1 end as other_profile
from public.my_matches m
join public.profiles p1 on p1.id=m.user_a
join public.profiles p2 on p2.id=m.user_b
where auth.uid() in (m.user_a,m.user_b);

alter table public.profiles enable row level security;
alter table public.likes enable row level security;
alter table public.messages enable row level security;
alter table public.blocks enable row level security;
alter table public.reports enable row level security;

create policy "profiles readable by authenticated users" on public.profiles for select to authenticated using (
 id=auth.uid() or not exists(select 1 from public.blocks b where (b.blocker_id=auth.uid() and b.blocked_id=profiles.id) or (b.blocker_id=profiles.id and b.blocked_id=auth.uid()))
);
create policy "users create own profile" on public.profiles for insert to authenticated with check(id=auth.uid());
create policy "users update own profile" on public.profiles for update to authenticated using(id=auth.uid()) with check(id=auth.uid());

create policy "users manage own likes" on public.likes for insert to authenticated with check(from_user=auth.uid());
create policy "users view likes involving self" on public.likes for select to authenticated using(from_user=auth.uid() or to_user=auth.uid());

create policy "participants read messages" on public.messages for select to authenticated using(sender_id=auth.uid() or receiver_id=auth.uid());
create policy "sender creates message" on public.messages for insert to authenticated with check(sender_id=auth.uid());

create policy "users create blocks" on public.blocks for insert to authenticated with check(blocker_id=auth.uid());
create policy "users view own blocks" on public.blocks for select to authenticated using(blocker_id=auth.uid());
create policy "users create reports" on public.reports for insert to authenticated with check(reporter_id=auth.uid());

-- Realtime
alter table public.messages replica identity full;
alter publication supabase_realtime add table public.messages;

-- Automatically create a profile after email signup.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path=public
as $$
begin
 insert into public.profiles(id,name,age) values(new.id,coalesce(new.raw_user_meta_data->>'name',''),18);
 return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute procedure public.handle_new_user();

-- IMPORTANT: The profiles view and matching logic are intentionally simple for MVP.
-- For production, add stronger moderation/admin controls, photo storage policies,
-- account deletion, email verification, anti-spam/rate limits and age/identity safeguards.
