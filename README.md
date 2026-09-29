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

## Notes for future phases

- Voice AI, website chat capture, booking, quotes, revenue recovery, retention and analytics were deliberately NOT built — the schema and automation engine are structured so they slot in.
