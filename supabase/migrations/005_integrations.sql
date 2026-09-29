-- ============================================================
-- Revora migration 005: Integrations Hub
-- Tables: integrations (connections registry), integration_credentials
-- (encrypted secrets, service-role-only), integration_logs (audit).
--
-- SECURITY MODEL:
--   - integration_credentials holds pgp-ENCRYPTED secrets. Master key
--     lives in a database setting, set once by the owner:
--       alter database postgres set app.integration_key = '<64-char-random-hex>';
--     It is never in code, never in an API response, never in the frontend.
--   - Decryption is only possible via get_integration_secret(), a SECURITY
--     DEFINER function executable ONLY by the service role (edge functions).
--     Clients have no policies on this table at all.
--   - Every connect / disconnect / test / sync / webhook event writes an
--     audit row to integration_logs.
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- integrations (connection registry, one row per connected key) ----------
create table integrations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  integration_key text not null,             -- registry key: 'openai', 'stripe', 'sendgrid'...
  status text not null default 'disconnected' check (status in ('disconnected', 'connected', 'error')),
  config jsonb not null default '{}'::jsonb, -- NON-secret configuration only
  permissions text[] not null default '{}',   -- what this integration can do, shown in UI
  error_message text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, integration_key)
);

-- ---------- integration_credentials (server-side encrypted secrets) ----------
create table integration_credentials (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  integration_key text not null,
  -- pgp_sym_encrypt output; decryptable only by the service role via
  -- get_integration_secret()
  secret_encrypted bytea not null,
  -- sha256 of the secret, for API-key lookups without decrypting
  secret_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, integration_key)
);
create index integration_credentials_hash_idx on integration_credentials (secret_hash);

-- ---------- integration_logs (audit trail for every integration event) ----------
create table integration_logs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  integration_key text not null,
  event text not null check (event in ('connect', 'disconnect', 'config_saved', 'test', 'sync', 'error', 'webhook')),
  status text not null check (status in ('ok', 'failed')),
  message text,
  created_at timestamptz not null default now()
);
create index integration_logs_business_idx on integration_logs (business_id, created_at desc);

-- ============================================================
-- Encrypted secret helpers (service-role only)
-- ============================================================

-- Store a secret: callable only by service role
create or replace function store_integration_secret(
  p_business uuid, p_key text, p_secret text
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_master text := current_setting('app.integration_key', true);
begin
  if v_master is null or v_master = '' then
    raise exception 'app.integration_key is not configured; run: alter database postgres set app.integration_key = ''<random>''';
  end if;
  insert into integration_credentials (business_id, integration_key, secret_encrypted, secret_hash)
  values (p_business, p_key, pgp_sym_encrypt(p_secret, v_master), encode(digest(p_secret, 'sha256'), 'hex'))
  on conflict (business_id, integration_key) do update
    set secret_encrypted = excluded.secret_encrypted,
        secret_hash = excluded.secret_hash,
        updated_at = now();
end;
$$;

-- Read a secret: service role ONLY
create or replace function get_integration_secret(
  p_business uuid, p_key text
) returns text language sql stable security definer set search_path = public as $$
  select pgp_sym_decrypt(secret_encrypted, current_setting('app.integration_key', true))
  from integration_credentials
  where business_id = p_business and integration_key = p_key;
$$;

-- Find a business by API key hash WITHOUT decrypting (for inbound webhooks)
create or replace function find_business_by_secret_hash(p_hash text)
returns uuid language sql stable security definer set search_path = public as $$
  select business_id from integration_credentials
  where secret_hash = p_hash and integration_key = 'api_webhooks'
  limit 1;
$$;

revoke all on function store_integration_secret(uuid, text, text) from public, anon, authenticated;
revoke all on function get_integration_secret(uuid, text) from public, anon, authenticated;
revoke all on function find_business_by_secret_hash(text) from public, anon, authenticated;
grant execute on function store_integration_secret(uuid, text, text) to service_role;
grant execute on function get_integration_secret(uuid, text) to service_role;
grant execute on function find_business_by_secret_hash(text) to service_role;

-- ============================================================
-- RLS
-- ============================================================
alter table integrations enable row level security;
alter table integration_credentials enable row level security; -- NO client policies: service role only
alter table integration_logs enable row level security;

-- integrations: members read; owner/admin update non-secret config
create policy integrations_select on integrations for select using (is_business_member(business_id));
create policy integrations_update on integrations for update
  using (has_role_in_business(business_id, array['owner','admin']::user_role[]))
  with check (has_role_in_business(business_id, array['owner','admin']::user_role[]));

-- logs: members read (audit visibility); writes service-role only
create policy integration_logs_select on integration_logs for select using (is_business_member(business_id));
