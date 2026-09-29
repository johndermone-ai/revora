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

## Notes for future phases

- Voice AI, website chat capture, booking, quotes, revenue recovery, retention and analytics were deliberately NOT built — the schema and automation engine are structured so they slot in.
