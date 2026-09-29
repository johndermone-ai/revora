# Revora — AI Customer-to-Revenue Platform

**Capture. Qualify. Convert. Retain.**

Production-ready foundation for a multi-tenant SaaS built on **React + TypeScript + Tailwind CSS + Supabase**.

## What's implemented

### Foundation
- **Multi-tenant architecture** — every table carries `business_id`; Row Level Security on all 15 tables; `SECURITY DEFINER` membership helpers so one business can never read another's data.
- **Roles** — Owner, Admin, Staff (owner/admin manage businesses, automations, templates, and deletions; staff work leads).
- **Auth** — Sign up, login, logout, forgot password, password reset, protected routes (`RequireAuth`), onboarding gate (`RequireBusiness`).
- **Onboarding wizard** — 8 steps: name, industry, website, phone, email, main goal, employees, confirm. Creates business + owner membership + settings + subscription atomically via a secure RPC (`create_business_for_user`).
- **Pages** — Landing, Pricing, Login, Signup (public); Dashboard, Leads, Customers, Activities, Tasks, Automations, Settings (live); Calendar, AI Assistant, Analytics, Integrations, Billing (professional Coming Soon states).
- **Dashboard** — real DB-backed metrics: total leads, new leads, qualified, customers, conversion rate, overdue follow-ups, upcoming appointments, revenue placeholder, recent activity.

### Lead Management
- Full lead schema: contact info, company, source (9 options), service interest, status (7 stages), score, intent, urgency, budget, notes, assignee, follow-up dates, conversion timestamp, customer link.
- **Transparent rules-based scoring (0–100)** — 7 visible factors (contact info, service identified, urgency, budget, engagement, pipeline progression, follow-up) + base 10. Not AI, and it says so.
- **Pipeline** — drag-and-drop across New → Contacted → Qualified → Proposal → Negotiation → Won/Lost.
- **Lead detail** — details, transparent score breakdown, activity timeline, notes, tasks, follow-up date, communication-history placeholder, convert button.
- **Conversion** — Won leads create/update the customer record, stamp `converted_at`, link the lead, and preserve full history.
- **Filters & search** — status, source, score band, follow-up due, created date, plus global lead search.

### AI Lead Qualification
- **Server-side edge function** (`supabase/functions/ai-qualify-lead`) — OpenAI key stays in Supabase secrets; never in frontend code. Requires caller JWT + verifies business membership.
- Strict JSON validation of the AI response (score bounds, typed arrays, length caps).
- **AI Qualification panel** on the lead page: score, intent, urgency, summary, missing information, recommended action, suggested questions + "Re-analyse Lead".
- Every qualification writes an activity record. **AI output never modifies the lead automatically** — suggestions only.

### AI Follow-Up Engine
- Follow-up **drafts** generated server-side (edge function `generate-follow-up`) from lead + business + previous messages + desired action.
- Full lifecycle: **Generate → Edit → Approve → Schedule → Cancel**, each step activity-logged.
- **Never auto-sends.** Email is the prepared channel; with no provider connected the UI says delivery is pending integration rather than pretending a message was sent. WhatsApp/SMS/voice are architecturally ready.
- **Automation builder** — TRIGGER → CONDITION → ACTION rules (e.g. Proposal Sent + no response 3 days → create follow-up), with per-rule status, last run and error fields, and an execution-history table (`automation_runs`).

### Lead generation (website capture)
- Public capture page: `/capture/<businessId>` — animated, mobile-friendly, no login needed.
- Embeddable endpoint: `supabase/functions/capture-lead` (deploy with `--no-verify-jwt` — it is the only intentionally public write path; strict validation, honeypot + rate limiting, always creates source=website / status=new leads).
- Settings → Lead capture shows your link and the embed instructions.

## Setup

1. `npm install`
2. Create a project at https://supabase.com and copy `.env.example` to `.env`:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
3. Apply the schema: run `supabase/migrations/0001_foundation.sql` in the Supabase SQL editor (or `supabase db push` with the CLI).
4. Deploy the edge functions:
   ```
   supabase functions deploy ai-qualify-lead
   supabase functions deploy generate-follow-up
   supabase secrets set OPENAI_API_KEY=sk-...
   ```
5. `npm run dev`

## Environment variables

| Variable | Where | Purpose |
|---|---|---|
| `VITE_SUPABASE_URL` | frontend `.env` | Supabase project URL (public) |
| `VITE_SUPABASE_ANON_KEY` | frontend `.env` | Supabase anon key (public, RLS-protected) |
| `OPENAI_API_KEY` | Supabase secrets **only** | Server-side AI calls — never in frontend code |

## Roles & permissions (RLS-enforced)

| | Owner | Admin | Staff |
|---|---|---|---|
| View all business data | ✅ | ✅ | ✅ |
| Create/edit leads, customers, tasks, notes | ✅ | ✅ | ✅ |
| Convert leads, approve follow-ups | ✅ | ✅ | ✅ |
| Delete records | ✅ | ✅ | ❌ |
| Manage automations, templates, business profile | ✅ | ✅ | ❌ |

### Appointment & booking system
- **One booking engine for every channel.** `supabase/functions/_shared/bookingEngine.ts` is the single source of truth for slot logic (working hours, buffer, duration, minimum notice, booking window, holidays, conflict detection). The staff UI, the website flow and the AI voice agent all use it — there is no separate voice booking system.
- **Tables** (migration `002_booking.sql`): `calendars` (internal/google providers prepared), `availability_rules` (per-weekday working hours; staff-specific rules supported), `booking_settings` (duration, buffer, min notice, max window, auto-confirm, holidays), `appointments` (6 states: requested → confirmed → rescheduled / cancelled / completed / no-show; `created_source` distinguishes manual / lead / website / ai_voice), `appointment_participants`.
- **Booking flow:** lead → available slot → confirmation (manual or auto-confirm) → appointment → completed/no-show. Reminders are prepared via the notifications table; delivery activates with channel integrations.
- **Calendar page** (`/app/calendar`): Day / Week / Month views; staff can create, confirm, reschedule, cancel, mark completed or no-show. Slots offered in the UI come from the same engine.
- **Public endpoint** `supabase/functions/book-appointment` (deploy with `--no-verify-jwt`): for AI voice and website flows. Finds-or-creates the lead (reusing an existing lead matching email/phone), validates the requested slot, and on conflict returns the next 3 alternatives from the same engine. Rate-limited, CORS-enabled, strict validation.
- **Google Calendar:** architecture ready (`provider`, `google_calendar_id`, `google_event_id`, `sync_enabled`, `last_synced_at`) but sync is NOT implemented — nothing pretends to be synced.
- Deploy: `supabase functions deploy book-appointment --no-verify-jwt` and apply `002_booking.sql`.

### Revenue Recovery Engine
- **Tables** (migration `003_revenue_recovery.sql`): `revenue_opportunities` (9 detection types, 5 statuses: Detected → Action Required → In Progress → Recovered/Dismissed, dedupe key so the scanner never duplicates an opportunity and never reopens a dismissed/recovered one) and `recovery_actions` (audit trail — every automated or manual action recorded with actor: system/automation/user/ai).
- **Detection** (`supabase/functions/recovery-scan`, JWT-verified membership): unanswered leads, possible missed calls (phone-sourced leads left unanswered — honest proxy until telephony integration; no fake call logs), leads without follow-up, proposals without response, abandoned enquiries, cancelled appointments, no-shows, inactive customers (90+ days), overdue follow-ups. Stale detections (24h+) are automatically promoted to Action Required.
- **Estimated value is NEVER invented.** It is set only when the lead's own budget field contains a figure; otherwise the UI shows "Value unknown." Recovered revenue sums real lead-provided values only.
- **Recommended actions** are channel-aware (call/WhatsApp need a phone, email needs an address, rebooking for appointment losses, human intervention for inactive customers) with `ai_recommendation` columns prepared for the AI layer.
- **Dashboard** (`/app/recovery`): stat cards (detected, acted upon, recovered revenue, action rate), status filters, per-opportunity Take action (creates a task + activity, moves to In Progress), Mark recovered, Dismiss, and a full audit-trail modal.
- Deploy: `supabase functions deploy recovery-scan`.

### Revenue Analytics dashboard (`/app/analytics`)
- **Periods:** Today / 7 / 30 / 90 days / custom range.
- **Honest analytics rules:** metrics render "—" with an explanatory hint wherever the data source doesn't exist — never a manufactured zero. Actual revenue is shown as unavailable until a payments/invoicing source is connected (never estimated). Estimated opportunity value and recovered revenue only sum figures leads themselves provided.
- **Sections:** Lead metrics (total/new/qualified/won/lost/conversion rate), Voice metrics (call counts honestly blank until the voice integration exists; leads & appointments generated via the existing AI voice booking flow are real), Sales metrics (proposals, avg conversion time, follow-up performance incl. real sends only), Revenue recovery (detected/recovered/recovered revenue), Customer metrics (new/returning 2+ appointments/inactive 90+ days).
- **Chart:** leads-over-time bar chart (no chart library, inline SVG-free CSS bars) rendered only when the underlying data is meaningful; otherwise an explanatory note.

### AI Voice Agent (provider-agnostic, no simulator)
- **Provider abstraction layer** (`supabase/functions/_shared/voiceProviders.ts`): implement `VoiceProviderAdapter` once and a new provider plugs in without touching settings, the webhook pipeline or the dashboard. Adapters included: **Retell AI** and **Vapi** (real HTTP APIs; field mappings follow their public agent/webhook APIs and may need minor tuning to their current docs).
- **Settings** (`voice_agents` table + `/app/voice` page): agent name, greeting, business description, services, approved FAQs, business hours, transfer number, appointment rules (auto-confirm), voice/language settings, AI behaviour instructions and handoff rules (asks for human / low confidence / sensitive issue / business-defined).
- **Call records** (`voice_calls`): provider call ID, business, customer, lead, phone, start/answered/end, duration, outcome (lead_created / appointment_booked / customer_support / human_transfer / spam / other), intent, transcript reference, recording reference (stored only when the owner enabled recording), AI summary. Unique on (provider, call id) so webhook retries are idempotent.
- **Post-call pipeline** (`voice-webhook`, deploy with `--no-verify-jwt`, secured by per-business webhook secret): structured AI summary from the transcript (validated JSON; no transcript → outcome 'other', no invented summary) → create/update customer + lead (found by phone/email) → activity log → appointment booking through the SAME shared booking engine → automation rules with trigger `voice_call_completed` (added to the automation builder).
- **Human handoff:** transfer number + handoff rules are compiled into the agent prompt and provider transfer config.
- **Compliance:** configurable recording preference, recording/consent notice, AI disclosure notice, consent mode. Revora stores and passes the owner's notices — it does NOT claim the business is compliant; recording references are only stored when the owner enabled recording.
- **Credentials:** provider API keys are sent once and stored in `voice_provider_credentials`, a table with RLS enabled and deliberately NO client policies — only edge functions (service role) can read them. Keys are never returned to the browser.
- **Dashboard** (`/app/voice`): calls, answered, missed, leads generated, appointments, transfers, per-call outcomes and AI summaries — all from real `voice_calls` rows. The Revenue Analytics voice section reads the same table once connected (blank, not zero, before connection).
- Deploy: `supabase functions deploy voice-webhook --no-verify-jwt` and `supabase functions deploy voice-agent-config`.

### Integrations Hub (`/app/integrations`)
- **Generic registry architecture:** every integration is one entry in `src/services/integrations.ts` (INTEGRATIONS) plus, if it needs server-side verification, one case in the `integration-manage` edge function. Adding providers never changes core pages. Categories: Communication (Voice, SendGrid, Postmark, Twilio SMS, Twilio WhatsApp), Calendar (Google, Outlook — OAuth, honestly "Not connected" until the OAuth flow exists), CRM/Data (CSV import, web forms, API/webhooks), Payments (Stripe), AI (OpenAI).
- **Per-card:** connection status, connect/disconnect, configuration fields, permissions, error status, last successful verification/sync, per-integration logs.
- **Honest status:** an integration is only marked Connected after a REAL verification call to the provider succeeds server-side (OpenAI /v1/models, Stripe /v1/balance, SendGrid /v3/scopes, Postmark /server, Twilio Accounts). Failures show as Error with the reason. OAuth calendars stay "Not connected" until the OAuth flow is wired — never faked.
- **Secrets:** sent once over HTTPS, stored pgp-encrypted (`pgp_sym_encrypt`) in `integration_credentials` — a table with RLS enabled and NO client policies; decryption is a security-definer function executable only by the service role. Master key lives in the `app.integration_key` database setting (`alter database postgres set app.integration_key = '...'`), never in code. The only secret ever surfaced is a freshly generated API key, shown once.
- **API/webhooks integration:** generates a `rv_live_…` API key (SHA-256 hashed for lookup). The `integration-webhook` edge function authenticates inbound lead pushes by that hash — signature-style validation without ever storing or logging the plaintext key. Leads are deduplicated by email/phone.
- **Audit logs:** every connect / disconnect / config save / verification / webhook event writes an `integration_logs` row, visible per integration in the hub.
- **Tenant isolation:** all edge functions verify business membership and owner/admin role server-side; webhook lookups resolve the business from the key itself.
- Deploy: `supabase functions deploy integration-manage` and `supabase functions deploy integration-webhook --no-verify-jwt`; apply `005_integrations.sql` and set the `app.integration_key` setting.

### Final gap-fill (feature-complete pass)
- **CSV import** (Leads page): file upload or paste, browser-side parse, batch insert, invalid-row reporting, activity log. The file never leaves the browser.
- **Google Maps lead source** (migration `007_google_maps_source.sql`, `src/lib/csv.ts`, `tools/google-maps-scraper/runbook.md`): real leads from [omkarcloud/google-maps-scraper](https://github.com/omkarcloud/google-maps-scraper). Its CSV exports are auto-detected on import (by `kgmid`/`main_category` headers) and mapped into leads tagged source `google_maps` (dedupe by kgmid/phone; phone international preferred; address/website/rating into notes). A self-hosted scraper API can also be connected as the `google_maps` provider in `generate-leads` (config: endpoint/api_key) — the daily generator then delivers real Google Maps leads per plan quota; if the provider is unconfigured or fails it returns nothing, never fabricates, and falls back to the labelled AI generator.
- **Subscription-based lead generation** (migration `006_lead_generation.sql` + `generate-leads` edge function + "Daily leads" card on the Leads page): paying businesses receive a daily allowance of fresh leads according to plan — trial 2/day, Starter 5/day, Pro 15/day. Sources, in order of preference: (1) a connected lead provider integration (adapter interface in the function; registers under `lead_provider:` keys in the `integrations` table — returns nothing until configured, so nothing is fabricated), (2) the OpenAI generator, which creates prospects clearly labelled `ai_generated` / "AI-generated prospect — unverified", with fake-domain emails by design. Generated leads land as `new` and are never contacted automatically. On demand via the "Generate leads now" button, or daily for all enabled businesses via the scheduled mode (`x-lead-gen-secret` header + `LEAD_GEN_SECRET`; e.g. pg_cron or any external scheduler calling it once a day). Daily usage is counted from leads created since midnight, so the quota can never be exceeded.
- **Appointment reminders** (`appointment-reminders` edge function + "Send reminders" on the Calendar page): scans confirmed appointments in the next 24h and creates deduplicated in-app notifications for every team member. Runs on demand or on a schedule; customer-facing SMS/email delivery activates with those channel integrations.
- **AI Assistant** (`/app/ai-assistant` + `ai-assistant-chat` edge function): in-app chat answering from a LIVE business snapshot (lead counts, recent leads, upcoming appointments, open recovery opportunities). Instructed to say when something isn't visible rather than guessing. Conversation held client-side.
- **Billing** (`/app/billing`): real subscription record, plan features, usage counters (leads/appointments/customers). Payment collection is honestly marked as pending Stripe wiring — no simulated charges.
- No Coming Soon placeholders remain; every route is a working feature.

## Notes for future phases

- Voice AI, website chat capture, booking, quotes, revenue recovery, retention and analytics were deliberately NOT built — the schema and automation engine are structured so they slot in.
