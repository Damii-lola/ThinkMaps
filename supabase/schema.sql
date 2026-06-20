-- ThinkMaps MVP schema
-- Run this in the Supabase SQL editor on a fresh project.

create extension if not exists "pgcrypto";

-- =========================================================
-- PROFILES (1:1 with auth.users)
-- =========================================================
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  is_pro boolean not null default false,
  pro_expires_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id);

-- auto-create a profile row whenever a new auth user signs up
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- =========================================================
-- BLUEPRINTS
-- =========================================================
create table public.blueprints (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Untitled Blueprint',
  created_at timestamptz not null default now(),
  locks_at timestamptz not null default (now() + interval '7 days'),
  is_locked boolean not null default false
);

alter table public.blueprints enable row level security;

create policy "blueprints_select_own" on public.blueprints
  for select using (auth.uid() = user_id);

create policy "blueprints_insert_own" on public.blueprints
  for insert with check (auth.uid() = user_id);

create policy "blueprints_update_own" on public.blueprints
  for update using (auth.uid() = user_id);

create policy "blueprints_delete_own" on public.blueprints
  for delete using (auth.uid() = user_id);

-- =========================================================
-- NODE GROUPS  (a card on the canvas, e.g. "Niches", "Sub-Niches")
-- =========================================================
create table public.node_groups (
  id uuid primary key default gen_random_uuid(),
  blueprint_id uuid not null references public.blueprints(id) on delete cascade,
  label text not null,                         -- e.g. "Niches", "Sub-Niches", "Audience"
  parent_option_id uuid,                       -- the option that spawned this group (null for the root group)
  position_x numeric not null default 0,
  position_y numeric not null default 0,
  is_frozen boolean not null default false,    -- true once the user branches away from this path
  created_at timestamptz not null default now()
);

alter table public.node_groups enable row level security;

create policy "node_groups_owner" on public.node_groups
  for all using (
    exists (
      select 1 from public.blueprints b
      where b.id = node_groups.blueprint_id and b.user_id = auth.uid()
    )
  );

-- =========================================================
-- NODE OPTIONS  (a single row inside a group, e.g. "Fitness")
-- =========================================================
create table public.node_options (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.node_groups(id) on delete cascade,
  text text not null,
  is_custom boolean not null default false,    -- user-typed vs AI-generated
  is_selected boolean not null default false,  -- whether the user branched from this option
  created_at timestamptz not null default now()
);

alter table public.node_options enable row level security;

create policy "node_options_owner" on public.node_options
  for all using (
    exists (
      select 1 from public.node_groups g
      join public.blueprints b on b.id = g.blueprint_id
      where g.id = node_options.group_id and b.user_id = auth.uid()
    )
  );

-- add the FK from node_groups.parent_option_id now that node_options exists
alter table public.node_groups
  add constraint node_groups_parent_option_fk
  foreign key (parent_option_id) references public.node_options(id) on delete set null;

-- =========================================================
-- EDGES  (the drawn line from a chosen option to the group it spawned)
-- =========================================================
create table public.edges (
  id uuid primary key default gen_random_uuid(),
  blueprint_id uuid not null references public.blueprints(id) on delete cascade,
  from_option_id uuid not null references public.node_options(id) on delete cascade,
  to_group_id uuid not null references public.node_groups(id) on delete cascade,
  is_frozen boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.edges enable row level security;

create policy "edges_owner" on public.edges
  for all using (
    exists (
      select 1 from public.blueprints b
      where b.id = edges.blueprint_id and b.user_id = auth.uid()
    )
  );

-- =========================================================
-- IDEAS  (output of a generation run)
-- =========================================================
create table public.ideas (
  id uuid primary key default gen_random_uuid(),
  blueprint_id uuid not null references public.blueprints(id) on delete cascade,
  name text not null,
  one_liner text not null,
  problem_statement text not null,
  upgrade_text text not null,                  -- the 10x upgrade
  monetization_text text not null,
  mvp_scope text not null,
  scores jsonb not null,                       -- { "Problem Validation & Pain Severity": [{q, score, evidence}, ...10], ... 10 categories }
  sources jsonb not null,                      -- [{ source: "reddit", url, quote, confidence }, ...]
  created_at timestamptz not null default now()
);

alter table public.ideas enable row level security;

create policy "ideas_owner" on public.ideas
  for all using (
    exists (
      select 1 from public.blueprints b
      where b.id = ideas.blueprint_id and b.user_id = auth.uid()
    )
  );

-- =========================================================
-- VALIDATION ITEMS  (AI-generated text blocks per idea)
-- =========================================================
create table public.validation_items (
  id uuid primary key default gen_random_uuid(),
  idea_id uuid not null references public.ideas(id) on delete cascade,
  type text not null check (type in ('survey', 'interview_script', 'landing_copy', 'fake_door')),
  content text not null,
  created_at timestamptz not null default now()
);

alter table public.validation_items enable row level security;

create policy "validation_items_owner" on public.validation_items
  for all using (
    exists (
      select 1 from public.ideas i
      join public.blueprints b on b.id = i.blueprint_id
      where i.id = validation_items.idea_id and b.user_id = auth.uid()
    )
  );

-- =========================================================
-- SUBSCRIPTIONS  (mirrors Selar subscription state)
-- =========================================================
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  selar_subscription_id text not null unique,
  status text not null default 'active',       -- active | cancelled | past_due
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.subscriptions enable row level security;

-- users can read their own subscription row; only the backend (service role) writes to it
create policy "subscriptions_select_own" on public.subscriptions
  for select using (auth.uid() = user_id);

-- =========================================================
-- Indexes
-- =========================================================
create index idx_blueprints_user on public.blueprints(user_id);
create index idx_node_groups_blueprint on public.node_groups(blueprint_id);
create index idx_node_options_group on public.node_options(group_id);
create index idx_edges_blueprint on public.edges(blueprint_id);
create index idx_ideas_blueprint on public.ideas(blueprint_id);
create index idx_validation_items_idea on public.validation_items(idea_id);
create index idx_subscriptions_user on public.subscriptions(user_id);
