// Revenue Recovery scan — requires the caller's JWT and verifies business
// membership server-side. Finds potentially lost revenue across leads,
// appointments and customers, and upserts Revenue Opportunities (deduped).
//
// Detection rules (all deterministic, audited via recovery_actions):
//   unanswered_lead        status 'new', no contact for 2+ days
//   missed_call            phone-sourced lead still 'new' after 1+ day
//   no_follow_up           active lead with no follow-up scheduled, 3+ days old
//   proposal_no_response   proposal_sent/negotiation with no contact 3+ days
//   abandoned_enquiry       active lead untouched for 14+ days
//   overdue_follow_up      follow-up date passed and lead still active
//   cancelled_appointment  appointment cancelled
//   no_show                appointment marked no-show
//   inactive_customer      converted customer with no activity 90+ days
//
// estimated_value is ONLY set when the lead's own budget field contains a
// real figure. It is never invented; null renders as "Value unknown".
// Recommendations are channel-aware: call/WhatsApp need a phone, email needs
// an email, rebooking for appointment losses, human for inactive customers.

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

type Row = Record<string, unknown>;

function daysAgo(d: string | null): number {
  if (!d) return Infinity;
  return (Date.now() - new Date(d).getTime()) / 86_400_000;
}

function parseBudget(budget: string | null): number | null {
  if (!budget) return null;
  // Accept plain numbers or currency amounts the LEAD provided (e.g. "£5000", "around 300")
  const m = budget.match(/(\d[\d,]*\.?\d*)/);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

interface Candidate {
  dedupeKey: string;
  type: string;
  title: string;
  reason: string;
  leadId?: string | null;
  customerId?: string | null;
  appointmentId?: string | null;
  estimatedValue: number | null;
  recommended: string;
}

async function scan(businessId: string, db: SupabaseClient): Promise<Candidate[]> {
  const out: Candidate[] = [];

  const { data: leads } = await db
    .from('leads')
    .select('id, name, email, phone, company, status, source, budget, last_contacted_at, next_follow_up_at, customer_id, created_at')
    .eq('business_id', businessId)
    .not('status', 'in', '("won","lost")');
  const activeLeads = (leads as Row[]) ?? [];

  const { data: appts } = await db
    .from('appointments')
    .select('id, title, status, start_at, lead_id, customer_id, google_event_id')
    .eq('business_id', businessId)
    .in('status', ['cancelled', 'no_show']);
  const lostAppts = (appts as Row[]) ?? [];

  const { data: customers } = await db
    .from('customers')
    .select('id, name, created_at');
  const allCustomers = (customers as Row[]) ?? [];

  // Last activity per customer (for inactive-customer detection)
  const { data: recentActivities } = await db
    .from('activities')
    .select('customer_id, created_at')
    .eq('business_id', businessId)
    .not('customer_id', 'is', null);
  const lastActivityByCustomer = new Map<string, number>();
  for (const a of (recentActivities as { customer_id: string; created_at: string }[]) ?? []) {
    const t = new Date(a.created_at).getTime();
    lastActivityByCustomer.set(a.customer_id, Math.max(lastActivityByCustomer.get(a.customer_id) ?? 0, t));
  }

  for (const l of activeLeads) {
    const id = l.id as string;
    const name = l.name as string;
    const hasPhone = Boolean(l.phone);
    const hasEmail = Boolean(l.email);
    const value = parseBudget(l.budget as string | null);
    const ageDays = daysAgo(l.created_at as string);
    const idleDays = daysAgo(l.last_contacted_at as string | null);
    const status = l.status as string;
    const pick = (phone: string, email: string) => (hasPhone ? phone : email);

    // 1. unanswered lead
    if (status === 'new' && idleDays >= 2) {
      out.push({
        dedupeKey: `unanswered_lead:${id}`,
        type: 'unanswered_lead',
        title: `Unanswered lead: ${name}`,
        reason: `New lead with no contact for ${Math.floor(idleDays) === Infinity ? Math.floor(ageDays) : Math.floor(idleDays)} days.`,
        leadId: id, customerId: (l.customer_id as string) ?? null,
        estimatedValue: value, recommended: pick('call', 'email'),
      });
    }

    // 2. missed call (phone-sourced, still unanswered — closest honest signal
    //    until a telephony integration exists; no fake call logs)
    if (status === 'new' && l.source === 'phone' && ageDays >= 1) {
      out.push({
        dedupeKey: `missed_call:${id}`,
        type: 'missed_call',
        title: `Possible missed call: ${name}`,
        reason: 'Phone enquiry never answered — until telephony integration this flags phone-sourced leads left unanswered.',
        leadId: id, estimatedValue: value, recommended: 'call',
      });
    }

    // 3. lead without follow-up
    if (!l.next_follow_up_at && ageDays >= 3 && ['new', 'contacted', 'qualified'].includes(status)) {
      out.push({
        dedupeKey: `no_follow_up:${id}`,
        type: 'no_follow_up',
        title: `No follow-up planned: ${name}`,
        reason: `Active lead for ${Math.floor(ageDays)} days with no follow-up scheduled.`,
        leadId: id, estimatedValue: value, recommended: 'follow_up',
      });
    }

    // 4. proposal without response
    if (['proposal_sent', 'negotiation'].includes(status) && idleDays >= 3) {
      out.push({
        dedupeKey: `proposal_no_response:${id}`,
        type: 'proposal_no_response',
        title: `Proposal unanswered: ${name}`,
        reason: `In ${status.replace('_', ' ')} with no response for ${Math.floor(idleDays)} days.`,
        leadId: id, estimatedValue: value, recommended: pick('email', 'follow_up'),
      });
    }

    // 5. abandoned enquiry
    if (['new', 'contacted', 'qualified'].includes(status) && idleDays >= 14) {
      out.push({
        dedupeKey: `abandoned_enquiry:${id}`,
        type: 'abandoned_enquiry',
        title: `Abandoned enquiry: ${name}`,
        reason: `No contact for ${Math.floor(idleDays)} days.`,
        leadId: id, estimatedValue: value, recommended: pick('whatsapp', 'email'),
      });
    }

    // 6. overdue follow-up
    if (l.next_follow_up_at && new Date(l.next_follow_up_at as string).getTime() < Date.now()) {
      out.push({
        dedupeKey: `overdue_follow_up:${id}`,
        type: 'overdue_follow_up',
        title: `Follow-up overdue: ${name}`,
        reason: `Follow-up was due ${new Date(l.next_follow_up_at as string).toISOString().slice(0, 10)}.`,
        leadId: id, estimatedValue: value, recommended: 'follow_up',
      });
    }
  }

  // 7 & 8. cancelled appointments + no-shows → rebooking
  for (const a of lostAppts) {
    const cancelled = a.status === 'cancelled';
    out.push({
      dedupeKey: `${cancelled ? 'cancelled_appointment' : 'no_show'}:${a.id}`,
      type: cancelled ? 'cancelled_appointment' : 'no_show',
      title: `${cancelled ? 'Cancelled' : 'Missed'} appointment: ${a.title}`,
      reason: cancelled
        ? `Appointment on ${new Date(a.start_at as string).toISOString().slice(0, 10)} was cancelled and never rebooked.`
        : `No-show on ${new Date(a.start_at as string).toISOString().slice(0, 10)} — offer a new slot.`,
      leadId: (a.lead_id as string) ?? null,
      customerId: (a.customer_id as string) ?? null,
      appointmentId: a.id as string,
      estimatedValue: null,
      recommended: 'rebooking',
    });
  }

  // 9. inactive customers
  for (const c of allCustomers) {
    const last = lastActivityByCustomer.get(c.id as string) ?? new Date(c.created_at as string).getTime();
    if ((Date.now() - last) / 86_400_000 >= 90) {
      out.push({
        dedupeKey: `inactive_customer:${c.id}`,
        type: 'inactive_customer',
        title: `Inactive customer: ${c.name}`,
        reason: 'No activity or appointments for 90+ days.',
        customerId: c.id as string,
        estimatedValue: null,
        recommended: 'human',
      });
    }
  }

  return out;
}

Deno.serve(async (req) => {
  const auth = req.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  try {
    const anon = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
      global: { headers: { Authorization: auth } },
    });
    const { data: { user } } = await anon.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

    const { businessId } = await req.json();

    const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    const { data: member } = await db
      .from('business_members')
      .select('user_id')
      .eq('business_id', businessId)
      .eq('user_id', user.id)
      .maybeSingle();
    if (!member) return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });

    const candidates = await scan(businessId, db);
    const now = new Date().toISOString();
    let created = 0;
    let updated = 0;

    // Existing rows by dedupe key
    const { data: existing } = await db
      .from('revenue_opportunities')
      .select('id, dedupe_key, status, detected_at')
      .eq('business_id', businessId);
    const byKey = new Map(((existing as { id: string; dedupe_key: string; status: string; detected_at: string }[]) ?? []).map((r) => [r.dedupe_key, r]));

    for (const c of candidates) {
      const prev = byKey.get(c.dedupeKey);
      if (!prev) {
        const { error } = await db.from('revenue_opportunities').insert({
          business_id: businessId,
          dedupe_key: c.dedupeKey,
          opportunity_type: c.type,
          status: 'detected',
          lead_id: c.leadId ?? null,
          customer_id: c.customerId ?? null,
          appointment_id: c.appointmentId ?? null,
          title: c.title,
          reason: c.reason,
          estimated_value: c.estimatedValue,
          recommended_action: c.recommended,
        });
        if (!error) {
          created += 1;
          // Audit trail: one row per detection, attached to the new opportunity
          const { data: created2 } = await db
            .from('revenue_opportunities')
            .select('id')
            .eq('business_id', businessId)
            .eq('dedupe_key', c.dedupeKey)
            .maybeSingle();
          if (created2) {
            await db.from('recovery_actions').insert({
              business_id: businessId,
              opportunity_id: (created2 as { id: string }).id,
              actor: 'automation',
              action: 'detected',
              details: { type: c.type, title: c.title },
            });
          }
        }
      } else if (['detected', 'action_required', 'in_progress'].includes(prev.status)) {
        // Promote stale unhandled detections (older than 24h) to action_required
        const ageH = (Date.now() - new Date(prev.detected_at).getTime()) / 3_600_000;
        if (prev.status === 'detected' && ageH >= 24) {
          await db.from('revenue_opportunities')
            .update({ status: 'action_required', updated_at: now })
            .eq('id', prev.id);
          await db.from('recovery_actions').insert({
            business_id: businessId, opportunity_id: prev.id,
            actor: 'automation', action: 'promoted_to_action_required',
            details: { after_hours: Math.round(ageH) },
          });
          updated += 1;
        }
        // keep reason/value fresh
        await db.from('revenue_opportunities')
          .update({ reason: c.reason, estimated_value: c.estimatedValue, updated_at: now })
          .eq('id', prev.id);
      }
      // recovered/dismissed opportunities are NEVER reopened by the scanner
    }

    return new Response(JSON.stringify({ ok: true, created, updated, scanned: candidates.length }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    return new Response(JSON.stringify({ error: 'Scan failed' }), { status: 500 });
  }
});
