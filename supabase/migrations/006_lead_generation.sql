-- ============================================================
-- 006 · Subscription-based AI lead generation
-- Paying businesses receive a daily allowance of fresh leads
-- according to their plan. The generator runs daily (cron) or on
-- demand, creates clearly-labelled prospect leads, and never
-- contacts anyone automatically — generated leads land as 'new'
-- and wait for the owner.
-- ============================================================

-- Two new lead sources:
--  ai_generated : prospect created by the AI generator (labelled)
--  marketplace  : real enquiry delivered from a lead provider/pool
alter type lead_source add value if not exists 'ai_generated';
alter type lead_source add value if not exists 'marketplace';

-- Per-business lead-generation configuration
create table if not exists lead_gen_settings (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade unique,
  enabled boolean not null default false,
  service_keywords text not null default '',      -- e.g. 'landscape gardening, patio, fencing'
  target_area text not null default '',          -- e.g. 'Manchester & Stockport'
  target_customer text not null default '',      -- e.g. 'homeowners'
  daily_quota_override int,                      -- null = use plan quota
  last_run_at timestamptz,
  last_run_status text,                          -- ok | partial | error
  last_run_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table lead_gen_settings enable row level security;

create policy "members read lead gen settings"
  on lead_gen_settings for select
  using (business_id in (
    select business_id from business_members where user_id = auth.uid()
  ));

create policy "admins manage lead gen settings"
  on lead_gen_settings for all
  using (
    exists (
      select 1 from business_members bm
      where bm.business_id = lead_gen_settings.business_id
        and bm.user_id = auth.uid()
        and bm.role in ('owner', 'admin')
    )
  )
  with check (
    exists (
      select 1 from business_members bm
      where bm.business_id = lead_gen_settings.business_id
        and bm.user_id = auth.uid()
        and bm.role in ('owner', 'admin')
    )
  );

-- Index for the daily usage count (leads delivered today)
create index if not exists leads_business_created_idx
  on leads (business_id, created_at desc);
