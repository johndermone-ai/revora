-- ============================================================
-- Revora migration 002: Appointment & Booking System
-- Tables: calendars, availability_rules, booking_settings,
--         appointments, appointment_participants
-- Every table is business-scoped with RLS. Google Calendar
-- sync is architecturally prepared (provider + google_event_id
-- + sync columns) but NOT implemented - no fake sync.
-- ============================================================

-- ---------- calendars ----------
create table calendars (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  provider text not null default 'internal' check (provider in ('internal', 'google')),
  is_default boolean not null default false,
  -- Google Calendar sync (prepared, not implemented)
  google_calendar_id text,
  sync_enabled boolean not null default false,
  last_synced_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------- availability_rules ----------
-- Working hours per weekday; staff_user_id null = business-wide rule.
create table availability_rules (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  calendar_id uuid references calendars(id) on delete cascade,
  staff_user_id uuid references auth.users(id) on delete cascade,
  day_of_week smallint not null check (day_of_week between 0 and 6), -- 0 = Sunday
  start_time time not null,
  end_time time not null,
  created_at timestamptz not null default now(),
  check (start_time < end_time)
);

-- ---------- booking_settings ----------
create table booking_settings (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null unique references businesses(id) on delete cascade,
  slot_duration_minutes int not null default 60,
  buffer_minutes int not null default 15,
  min_notice_minutes int not null default 120,
  max_booking_days int not null default 60,
  auto_confirm boolean not null default false,
  -- ISO dates (YYYY-MM-DD) the business is closed
  holidays date[] not null default '{}',
  created_at timestamptz not null default now(),
  check (slot_duration_minutes between 5 and 480),
  check (buffer_minutes >= 0),
  check (min_notice_minutes >= 0),
  check (max_booking_days between 1 and 365)
);

-- ---------- appointments ----------
create table appointments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  calendar_id uuid references calendars(id) on delete set null,
  lead_id uuid references leads(id) on delete set null,
  customer_id uuid references customers(id) on delete set null,
  title text not null,
  status text not null default 'requested' check (status in
    ('requested', 'confirmed', 'rescheduled', 'cancelled', 'completed', 'no_show')),
  start_at timestamptz not null,
  end_at timestamptz not null,
  duration_minutes int not null,
  location text,
  notes text,
  -- where the booking came from
  created_source text not null default 'manual' check (created_source in
    ('manual', 'ai_voice', 'website', 'lead')),
  created_by uuid references auth.users(id) on delete set null,
  -- Google Calendar sync (prepared, not implemented)
  google_event_id text,
  google_synced_at timestamptz,
  cancelled_at timestamptz,
  completed_at timestamptz,
  rescheduled_from timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_at > start_at)
);
create index appointments_business_start_idx on appointments (business_id, start_at);
create index appointments_lead_idx on appointments (lead_id);

-- ---------- appointment_participants ----------
create table appointment_participants (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  appointment_id uuid not null references appointments(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null, -- staff member
  name text,
  email text,
  phone text,
  role text not null default 'staff' check (role in ('staff', 'lead', 'customer')),
  created_at timestamptz not null default now()
);
create index appointment_participants_appt_idx on appointment_participants (appointment_id);

-- ============================================================
-- Row Level Security
-- ============================================================

alter table calendars enable row level security;
alter table availability_rules enable row level security;
alter table booking_settings enable row level security;
alter table appointments enable row level security;
alter table appointment_participants enable row level security;

-- calendars: members read; owner/admin manage
create policy calendars_select on calendars for select using (is_business_member(business_id));
create policy calendars_manage on calendars for insert
  with check (has_role_in_business(business_id, array['owner','admin']::user_role[]));
create policy calendars_update on calendars for update
  using (has_role_in_business(business_id, array['owner','admin']::user_role[]));
create policy calendars_delete on calendars for delete
  using (has_role_in_business(business_id, array['owner','admin']::user_role[]));

-- availability_rules: members read; owner/admin manage; staff can read (slot picking)
create policy availability_select on availability_rules for select using (is_business_member(business_id));
create policy availability_manage on availability_rules for insert
  with check (has_role_in_business(business_id, array['owner','admin']::user_role[]));
create policy availability_update on availability_rules for update
  using (has_role_in_business(business_id, array['owner','admin']::user_role[]));
create policy availability_delete on availability_rules for delete
  using (has_role_in_business(business_id, array['owner','admin']::user_role[]));

-- booking_settings: members read; owner/admin update
create policy booking_settings_select on booking_settings for select using (is_business_member(business_id));
create policy booking_settings_update on booking_settings for update
  using (has_role_in_business(business_id, array['owner','admin']::user_role[]));

-- appointments: members see all; staff can create/update; owner/admin delete
create policy appointments_select on appointments for select using (is_business_member(business_id));
create policy appointments_insert on appointments for insert with check (is_business_member(business_id));
create policy appointments_update on appointments for update
  using (is_business_member(business_id)) with check (is_business_member(business_id));
create policy appointments_delete on appointments for delete
  using (has_role_in_business(business_id, array['owner','admin']::user_role[]));

-- appointment_participants
create policy appt_participants_select on appointment_participants for select using (is_business_member(business_id));
create policy appt_participants_insert on appointment_participants for insert with check (is_business_member(business_id));
create policy appt_participants_delete on appointment_participants for delete
  using (has_role_in_business(business_id, array['owner','admin']::user_role[]));

-- ============================================================
-- Default calendar + default booking settings for new businesses
-- ============================================================
create or replace function create_default_calendar(p_business uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_calendar uuid;
begin
  insert into calendars (business_id, name, provider, is_default)
  values (p_business, 'Main calendar', 'internal', true)
  returning id into v_calendar;

  -- Default working hours: Mon-Fri 09:00-17:00
  insert into availability_rules (business_id, calendar_id, day_of_week, start_time, end_time)
  select p_business, v_calendar, d, '09:00', '17:00'
  from generate_series(1, 5) as d;

  insert into booking_settings (business_id)
  values (p_business)
  on conflict (business_id) do nothing;

  return v_calendar;
end;
$$;

-- Backfill defaults for existing businesses
do $$
declare
  b record;
begin
  for b in select id from businesses where not exists (select 1 from calendars where business_id = b.id)
  loop
    perform create_default_calendar(b.id);
  end loop;
end $$;

-- Auto-create defaults for every NEW business (covers onboarding RPC path)
create or replace function on_business_created_defaults()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform create_default_calendar(new.id);
  return new;
end;
$$;

create trigger business_defaults_trigger
after insert on businesses
for each row execute function on_business_created_defaults();
