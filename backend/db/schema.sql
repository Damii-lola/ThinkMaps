-- ThinkMaps MVP schema (Supabase / Postgres)
-- Run this once in the Supabase SQL editor before deploying the backend.

create extension if not exists "pgcrypto";

-- One row per auth.users entry, holding plan/billing state.
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique not null,
  plan text not null default 'free' check (plan in ('free', 'pro')),
  plan_expires_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists blueprints (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  title text not null default 'Untitled blueprint',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists node_groups (
  id uuid primary key default gen_random_uuid(),
  blueprint_id uuid not null references blueprints(id) on delete cascade,
  type text not null check (type in ('niche', 'sub_niche', 'audience', 'monetization')),
  label text not null,
  parent_option_id uuid, -- FK added below (node_options doesn't exist yet at this point)
  position_x float,
  position_y float,
  created_at timestamptz not null default now()
);

create table if not exists node_options (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references node_groups(id) on delete cascade,
  label text not null,
  is_custom boolean not null default false,
  frozen boolean not null default false,
  created_at timestamptz not null default now()
);

alter table node_groups
  add constraint node_groups_parent_option_fk
  foreign key (parent_option_id) references node_options(id) on delete cascade;

create table if not exists edges (
  id uuid primary key default gen_random_uuid(),
  blueprint_id uuid not null references blueprints(id) on delete cascade,
  from_option_id uuid not null references node_options(id) on delete cascade,
  to_group_id uuid not null references node_groups(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists ideas (
  id uuid primary key default gen_random_uuid(),
  blueprint_id uuid not null references blueprints(id) on delete cascade,
  name text not null,
  one_liner text,
  problem text,
  ten_x_upgrade text,
  monetization text,
  mvp_scope text,
  sources jsonb default '[]'::jsonb,
  -- { "Category name": [{ "question": "...", "score": 0-10 }, ...10 items] } x 10 categories
  scorecard jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  provider text not null default 'selar',
  external_event text,
  raw_payload jsonb,
  created_at timestamptz not null default now()
);

-- Row Level Security. The backend uses the service role key (bypasses RLS),
-- so these policies matter only if the frontend ever talks to Supabase
-- directly with the anon key. Enabling them now costs nothing and protects
-- you later.

alter table profiles enable row level security;
alter table blueprints enable row level security;
alter table node_groups enable row level security;
alter table node_options enable row level security;
alter table edges enable row level security;
alter table ideas enable row level security;
alter table subscriptions enable row level security;

create policy "Users see their own profile" on profiles
  for select using (auth.uid() = id);

create policy "Users manage their own blueprints" on blueprints
  for all using (auth.uid() = user_id);

create policy "Users manage groups on their own blueprints" on node_groups
  for all using (
    exists (select 1 from blueprints b where b.id = node_groups.blueprint_id and b.user_id = auth.uid())
  );

create policy "Users manage options on their own blueprints" on node_options
  for all using (
    exists (
      select 1 from node_groups g
      join blueprints b on b.id = g.blueprint_id
      where g.id = node_options.group_id and b.user_id = auth.uid()
    )
  );

create policy "Users manage edges on their own blueprints" on edges
  for all using (
    exists (select 1 from blueprints b where b.id = edges.blueprint_id and b.user_id = auth.uid())
  );

create policy "Users manage ideas on their own blueprints" on ideas
  for all using (
    exists (select 1 from blueprints b where b.id = ideas.blueprint_id and b.user_id = auth.uid())
  );

create policy "Users see their own subscriptions" on subscriptions
  for select using (auth.uid() = user_id);

-- Auto-create a profile row whenever someone signs up via Supabase Auth.
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
