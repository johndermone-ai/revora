-- ============================================================
-- REVORA FOUNDATION SCHEMA
-- Multi-tenant: every tenant row carries business_id.
-- RLS on every table; access requires membership in the business.
-- ============================================================

create type user_role as enum ('owner', 'admin', 'staff');
create type lead_source as enum ('website', 'phone', 'whatsapp', 'email', 'manual', 'referral', 'google', 'social', 'other');
create type lead_status as enum ('new', 'contacted', 'qualified', 'proposal_sent', 'negotiation', 'won', 'lost');
create type task_status as enum ('open', 'in_progress', 'done', 'cancelled');
create type follow_up_channel as enum ('email', 'whatsapp', 'sms');
create type follow_up_status as enum ('draft', 'pending_approval', 'approved', 'scheduled', 'sent', 'failed', 'cancelled');

-- ---------- profiles ----------
create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now()
);

-- ---------- businesses ----------
create table businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  industry text,
  website text,
  phone text,
  email text,
  address text,
  timezone text not null default 'Europe/London',
  currency text not null default 'GBP',
  logo_url text,
  description text,
  main_goal text,
  employee_count int,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- business_members ----------
create table business_members (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role user_role not null default 'staff',
  created_at timestamptz not null default now(),
  unique (business_id, user_id)
);

-- ---------- customers ----------
create table customers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  lead_id uuid, -- set on conversion; FK added after leads exists
  name text not null,
  email text,
  phone text,
  company text,
  status text not null default 'active',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- leads ----------
create table leads (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  customer_id uuid references customers (id) on delete set null,
  name text not null,
  email text,
  phone text,
  company text,
  source lead_source not null default 'manual',
  service_interest text,
  status lead_status not null default 'new',
  lead_score int not null default 0 check (lead_score between 0 and 100),
  intent text,
  urgency text,
  budget text,
  notes text,
  assigned_to uuid references auth.users (id) on delete set null,
  last_contacted_at timestamptz,
  next_follow_up_at timestamptz,
  converted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- activities ----------
create table activities (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  entity_type text not null check (entity_type in ('lead', 'customer', 'task', 'follow_up', 'automation', 'ai')),
  entity_id uuid,
  type text not null,
  title text not null,
  description text,
  user_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---------- tasks ----------
create table tasks (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  title text not null,
  description text,
  status task_status not null default 'open',
  priority text not null default 'medium',
  assigned_to uuid references auth.users (id) on delete set null,
  related_lead_id uuid references leads (id) on delete cascade,
  related_customer_id uuid references customers (id) on delete cascade,
  due_date timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- notifications ----------
create table notifications (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  body text,
  type text,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------- subscriptions ----------
create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade unique,
  plan text not null default 'trial',
  status text not null default 'trialing',
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- settings ----------
create table settings (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade unique,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- ---------- follow_ups ----------
create table follow_ups (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  lead_id uuid not null references leads (id) on delete cascade,
  channel follow_up_channel not null default 'email',
  status follow_up_status not null default 'draft',
  subject text,
  body text,
  ai_generated boolean not null default false,
  scheduled_for timestamptz,
  sent_at timestamptz,
  error text,
  created_by uuid references auth.users (id) on delete set null,
  approved_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- follow_up_templates ----------
create table follow_up_templates (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  name text not null,
  channel follow_up_channel not null default 'email',
  subject text,
  body text not null,
  created_at timestamptz not null default now()
);

-- ---------- automation_rules (TRIGGER -> CONDITION -> ACTION) ----------
create table automation_rules (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  name text not null,
  enabled boolean not null default true,
  trigger jsonb not null,   -- e.g. {"type":"lead_status_changed","value":"proposal_sent"}
  conditions jsonb not null default '[]'::jsonb, -- e.g. [{"type":"no_response_for_days","value":3}]
  action jsonb not null,    -- e.g. {"type":"create_follow_up","channel":"email","delay_days":0}
  last_run timestamptz,
  next_run timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- automation_runs ----------
create table automation_runs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  rule_id uuid not null references automation_rules (id) on delete cascade,
  lead_id uuid references leads (id) on delete set null,
  status text not null default 'ok', -- ok | error | skipped
  output jsonb,
  created_at timestamptz not null default now()
);

-- ---------- ai_qualifications (persisted AI output; suggestions only) ----------
create table ai_qualifications (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  lead_id uuid not null references leads (id) on delete cascade,
  score int,
  intent text,
  urgency text,
  qualification text,
  summary text,
  missing_information text[],
  recommended_action text,
  suggested_questions text[],
  model text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table customers add constraint customers_lead_fk foreign key (lead_id) references leads (id) on delete set null;

create index leads_business_idx on leads (business_id);
create index customers_business_idx on customers (business_id);
create index activities_business_idx on activities (business_id);
create index tasks_business_idx on tasks (business_id);
create index follow_ups_lead_idx on follow_ups (lead_id);
create index automation_rules_business_idx on automation_rules (business_id);

-- ============================================================
-- RLS
-- ============================================================

alter table profiles enable row level security;
alter table businesses enable row level security;
alter table business_members enable row level security;
alter table customers enable row level security;
alter table leads enable row level security;
alter table activities enable row level security;
alter table tasks enable row level security;
alter table notifications enable row level security;
alter table subscriptions enable row level security;
alter table settings enable row level security;
alter table follow_ups enable row level security;
alter table follow_up_templates enable row level security;
alter table automation_rules enable row level security;
alter table automation_runs enable row level security;
alter table ai_qualifications enable row level security;

-- Membership helpers (SECURITY DEFINER to avoid recursive policy evaluation)
create or replace function is_business_member(target_business uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from business_members
    where business_id = target_business and user_id = auth.uid()
  );
$$;

create or replace function has_role_in_business(target_business uuid, roles user_role[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from business_members
    where business_id = target_business and user_id = auth.uid() and role = any(roles)
  );
$$;

-- profiles: own row only
create policy profiles_select_own on profiles for select using (id = auth.uid());
create policy profiles_insert_own on profiles for insert with check (id = auth.uid());
create policy profiles_update_own on profiles for update using (id = auth.uid());

-- businesses: members read; owner/admin update; insert via rpc only (create_business_for_user)
create policy businesses_select on businesses for select using (is_business_member(id));
create policy businesses_update on businesses for update using (has_role_in_business(id, array['owner','admin']::user_role[]));

-- business_members
create policy members_select on business_members for select using (user_id = auth.uid() or is_business_member(business_id));
create policy members_manage on business_members for all
  using (has_role_in_business(business_id, array['owner','admin']::user_role[]))
  with check (has_role_in_business(business_id, array['owner','admin']::user_role[]));

-- Tenant tables: members see all rows of their business; owner/admin manage; staff insert/update allowed but not delete
create policy customers_select on customers for select using (is_business_member(business_id));
create policy customers_insert on customers for insert with check (is_business_member(business_id));
create policy customers_update on customers for update using (is_business_member(business_id));
create policy customers_delete on customers for delete using (has_role_in_business(business_id, array['owner','admin']::user_role[]));

create policy leads_select on leads for select using (is_business_member(business_id));
create policy leads_insert on leads for insert with check (is_business_member(business_id));
create policy leads_update on leads for update using (is_business_member(business_id));
create policy leads_delete on leads for delete using (has_role_in_business(business_id, array['owner','admin']::user_role[]));

create policy activities_select on activities for select using (is_business_member(business_id));
create policy activities_insert on activities for insert with check (is_business_member(business_id));

create policy tasks_select on tasks for select using (is_business_member(business_id));
create policy tasks_insert on tasks for insert with check (is_business_member(business_id));
create policy tasks_update on tasks for update using (is_business_member(business_id));
create policy tasks_delete on tasks for delete using (has_role_in_business(business_id, array['owner','admin']::user_role[]));

create policy notifications_select on notifications for select using (user_id = auth.uid() or is_business_member(business_id));
create policy notifications_update on notifications for update using (user_id = auth.uid());
create policy notifications_insert on notifications for insert with check (is_business_member(business_id));

create policy subscriptions_select on subscriptions for select using (is_business_member(business_id));

create policy settings_select on settings for select using (is_business_member(business_id));
create policy settings_update on settings for update using (has_role_in_business(business_id, array['owner','admin']::user_role[]));

create policy follow_ups_select on follow_ups for select using (is_business_member(business_id));
create policy follow_ups_insert on follow_ups for insert with check (is_business_member(business_id));
create policy follow_ups_update on follow_ups for update using (is_business_member(business_id));

create policy follow_up_templates_select on follow_up_templates for select using (is_business_member(business_id));
create policy follow_up_templates_insert on follow_up_templates for insert with check (has_role_in_business(business_id, array['owner','admin']::user_role[]));
create policy follow_up_templates_update on follow_up_templates for update using (has_role_in_business(business_id, array['owner','admin']::user_role[]));

create policy automation_rules_select on automation_rules for select using (is_business_member(business_id));
create policy automation_rules_insert on automation_rules for insert with check (has_role_in_business(business_id, array['owner','admin']::user_role[]));
create policy automation_rules_update on automation_rules for update using (has_role_in_business(business_id, array['owner','admin']::user_role[]));
create policy automation_rules_delete on automation_rules for delete using (has_role_in_business(business_id, array['owner','admin']::user_role[]));

create policy automation_runs_select on automation_runs for select using (is_business_member(business_id));
create policy automation_runs_insert on automation_runs for insert with check (is_business_member(business_id));

create policy ai_qualifications_select on ai_qualifications for select using (is_business_member(business_id));
create policy ai_qualifications_insert on ai_qualifications for insert with check (is_business_member(business_id));

-- ============================================================
-- Business creation (atomic: business + owner membership + settings + subscription)
-- Only secure way to create a business. Callable by any authenticated user for THEMSELVES.
-- ============================================================
create or replace function create_business_for_user(
  p_name text,
  p_industry text default null,
  p_website text default null,
  p_phone text default null,
  p_email text default null,
  p_address text default null,
  p_timezone text default 'Europe/London',
  p_currency text default 'GBP',
  p_main_goal text default null,
  p_employee_count int default null,
  p_description text default null
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  new_id uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if p_name is null or length(trim(p_name)) = 0 then raise exception 'Business name required'; end if;

  insert into businesses (name, industry, website, phone, email, address, timezone, currency, main_goal, employee_count, description, created_by)
  values (trim(p_name), p_industry, p_website, p_phone, p_email, p_address, coalesce(p_timezone,'Europe/London'), coalesce(p_currency,'GBP'), p_main_goal, p_employee_count, p_description, auth.uid())
  returning id into new_id;

  insert into business_members (business_id, user_id, role) values (new_id, auth.uid(), 'owner');
  insert into settings (business_id, data) values (new_id, '{}'::jsonb);
  insert into subscriptions (business_id, plan, status) values (new_id, 'trial', 'trialing');

  return new_id;
end;
$$;

grant execute on function create_business_for_user to authenticated;

-- Auto-create profile on signup
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', null))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
for each row execute function handle_new_user();
