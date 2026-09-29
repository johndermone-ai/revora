-- ============================================================
-- Revora migration 003: Revenue Recovery Engine
-- Tables: revenue_opportunities, recovery_actions (audit trail)
-- Estimated revenue is NEVER invented: estimated_value is
-- null unless the lead supplied a real figure, and the UI
-- shows "Value unknown" in that case.
-- ============================================================

create type opportunity_type as enum (
  'unanswered_lead', 'missed_call', 'no_follow_up', 'proposal_no_response',
  'abandoned_enquiry', 'cancelled_appointment', 'no_show',
  'inactive_customer', 'overdue_follow_up'
);

create type opportunity_status as enum (
  'detected', 'action_required', 'in_progress', 'recovered', 'dismissed'
);

create type recovery_action_kind as enum (
  'call', 'email', 'whatsapp', 'follow_up', 'rebooking', 'human'
);

create table revenue_opportunities (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  -- dedupe key: one open opportunity per (business, type, subject)
  dedupe_key text not null,
  opportunity_type opportunity_type not null,
  status opportunity_status not null default 'detected',
  lead_id uuid references leads(id) on delete set null,
  customer_id uuid references customers(id) on delete set null,
  appointment_id uuid references appointments(id) on delete set null,
  title text not null,
  reason text not null,
  -- NULL = value unknown (never invented)
  estimated_value numeric(12, 2),
  currency text not null default 'GBP',
  recommended_action recovery_action_kind not null,
  ai_recommendation recovery_action_kind,
  ai_rationale text,
  detected_at timestamptz not null default now(),
  last_action_at timestamptz,
  recovered_at timestamptz,
  dismissed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, dedupe_key)
);
create index revenue_opportunities_business_idx on revenue_opportunities (business_id, status);
create index revenue_opportunities_type_idx on revenue_opportunities (business_id, opportunity_type);

-- Audit trail: EVERY automated or manual action on an opportunity
create table recovery_actions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  opportunity_id uuid not null references revenue_opportunities(id) on delete cascade,
  actor text not null check (actor in ('system', 'automation', 'user', 'ai')),
  user_id uuid references auth.users(id) on delete set null,
  action text not null,           -- e.g. detected, promoted, status_change, ai_recommendation, follow_up_created
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index recovery_actions_opportunity_idx on recovery_actions (opportunity_id, created_at);

-- ============================================================
-- RLS
-- ============================================================
alter table revenue_opportunities enable row level security;
alter table recovery_actions enable row level security;

create policy revenue_opportunities_select on revenue_opportunities for select using (is_business_member(business_id));
create policy revenue_opportunities_insert on revenue_opportunities for insert with check (is_business_member(business_id));
create policy revenue_opportunities_update on revenue_opportunities for update
  using (is_business_member(business_id)) with check (is_business_member(business_id));
create policy revenue_opportunities_delete on revenue_opportunities for delete
  using (has_role_in_business(business_id, array['owner','admin']::user_role[]));

create policy recovery_actions_select on recovery_actions for select using (is_business_member(business_id));
create policy recovery_actions_insert on recovery_actions for insert with check (is_business_member(business_id));
