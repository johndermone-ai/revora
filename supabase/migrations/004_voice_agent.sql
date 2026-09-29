-- ============================================================
-- Revora migration 004: AI Voice Agent architecture
-- Tables: voice_agents (settings), voice_calls (call records),
--         voice_provider_credentials (server-side only keys).
-- NO fake simulator: all provider work happens in edge functions
-- against real APIs (Retell AI / Vapi adapters). Credentials are
-- stored where ONLY the service role can read them — the client
-- can never SELECT them; the API key is never returned to any
-- frontend, page, or response body.
-- ============================================================

create type call_outcome as enum (
  'lead_created', 'appointment_booked', 'customer_support',
  'human_transfer', 'spam', 'other'
);

-- ---------- voice_agents ----------
create table voice_agents (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null unique references businesses(id) on delete cascade,
  agent_name text not null default 'Receptionist',
  greeting text not null default '',
  business_description text not null default '',
  services jsonb not null default '[]',          -- ["Haircuts", "Colouring"]
  faqs jsonb not null default '[]',              -- [{ question, answer }]
  business_hours text not null default '',       -- human-readable, shared with booking engine availability
  transfer_number text,                          -- where humans are reached
  appointment_rules jsonb not null default '{}'::jsonb, -- e.g. { auto_confirm: false, max_slots_to_offer: 3 }
  voice_settings jsonb not null default '{}'::jsonb,    -- { language: 'en-GB', voice: '', speed: 1.0 }
  behaviour_instructions text not null default '',
  handoff_rules jsonb not null default '["customer_requests_human","low_confidence","sensitive_issue"]'::jsonb,
  -- provider connection state
  provider text check (provider in ('retell', 'vapi')) or null,
  provider_agent_id text,
  webhook_secret text not null default encode(gen_random_bytes(24), 'hex'),
  status text not null default 'disconnected' check (status in ('disconnected', 'connected', 'error')),
  status_message text,
  last_connected_at timestamptz,
  -- Compliance: configurable notices. This stores the owner's chosen
  -- disclosure text and recording preference. It does NOT make the
  -- business compliant — that remains the owner's responsibility.
  compliance jsonb not null default '{}'::jsonb,
  -- { recording_enabled: false, recording_consent_notice: '', ai_disclosure_notice: '', consent_mode: 'notice_only' | 'verbal_consent_required' }
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- voice_calls ----------
create table voice_calls (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  voice_agent_id uuid references voice_agents(id) on delete set null,
  provider text not null check (provider in ('retell', 'vapi')),
  provider_call_id text not null,                -- the provider's call ID
  customer_id uuid references customers(id) on delete set null,
  lead_id uuid references leads(id) on delete set null,
  phone_number text,
  started_at timestamptz,
  answered_at timestamptz,
  ended_at timestamptz,
  duration_seconds int,
  outcome call_outcome,
  intent text,
  transcript_url text,                           -- transcript reference
  recording_url text,                           -- only when available AND permitted
  ai_summary text,
  processed boolean not null default false,
  created_at timestamptz not null default now(),
  unique (provider, provider_call_id)            -- idempotent webhook processing
);
create index voice_calls_business_idx on voice_calls (business_id, started_at desc);

-- ---------- voice_provider_credentials ----------
-- Server-side only: NO RLS policies for clients. Readable exclusively by
-- the service role (edge functions). The API key is never returned to the
-- frontend — set via the authenticated voice-agent-config edge function.
create table voice_provider_credentials (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null unique references businesses(id) on delete cascade,
  provider text not null check (provider in ('retell', 'vapi')),
  api_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table voice_provider_credentials enable row level security;
-- intentionally NO policies: clients can neither read nor write directly

-- ============================================================
-- RLS
-- ============================================================
alter table voice_agents enable row level security;
alter table voice_calls enable row level security;

create policy voice_agents_select on voice_agents for select using (is_business_member(business_id));
create policy voice_agents_update on voice_agents for update
  using (has_role_in_business(business_id, array['owner','admin']::user_role[]))
  with check (has_role_in_business(business_id, array['owner','admin']::user_role[]));

create policy voice_calls_select on voice_calls for select using (is_business_member(business_id));

-- Ensure every business has a voice agent settings row
insert into voice_agents (business_id)
select id from businesses
where not exists (select 1 from voice_agents where business_id = businesses.id);
