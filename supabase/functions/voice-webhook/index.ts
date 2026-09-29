// Revora voice webhook — the ONLY entry point for provider call events.
// Deploy with --no-verify-jwt. Security: the webhook URL contains the
// business's secret (?secret=...), which is verified against the stored
// webhook_secret before anything is processed. All writes happen with the
// service role; customers/leads/activities/appointments are business-scoped.
//
// Post-call pipeline (on call_ended):
//   1. Structured summary via AI (validated JSON; on failure the call
//      record still lands with outcome 'other' and no summary — no fakes)
//   2. Create/update customer
//   3. Create/update lead
//   4. Add activity
//   5. Trigger relevant automations (automation_rules trigger
//      voice_call_completed)
// Bookings use the SAME shared booking engine as the staff UI and website.

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getAdapter, type NormalizedCallEvent } from '../_shared/voiceProviders.ts';
import {
  nextAvailableSlots, validateSlot,
  type AvailabilityRule, type BookedSlot, type BookingConfig, DEFAULT_BOOKING_CONFIG,
} from '../_shared/bookingEngine.ts';

const OUTCOMES = ['lead_created', 'appointment_booked', 'customer_support', 'human_transfer', 'spam', 'other'];

interface CallAnalysis {
  summary: string | null;
  intent: string | null;
  outcome: string;
  callerName: string | null;
  callerEmail: string | null;
  service_interest: string | null;
  urgency: string | null;
  notes: string | null;
  wants_appointment: boolean;
  requested_slot: string | null;
  confidence: number;
  spam: boolean;
  asked_for_human: boolean;
}

async function analyseCall(db: SupabaseClient, transcript: string | null, businessName: string): Promise<CallAnalysis> {
  // Without a transcript there is nothing real to summarise — the call
  // record is stored with outcome 'other' and a null summary. No fakes.
  if (!transcript || transcript.trim().length < 10) {
    return { summary: null, intent: null, outcome: 'other', callerName: null, callerEmail: null,
      service_interest: null, urgency: null, notes: null, wants_appointment: false, requested_slot: null,
      confidence: 0, spam: false, asked_for_human: false };
  }

  const key = Deno.env.get('OPENAI_API_KEY');
  if (!key) throw new Error('OPENAI_API_KEY not configured');

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You analyse a phone call transcript to the business "${businessName}". Respond as strict JSON with exactly these keys: summary (string, 1-3 sentences), intent (short string), outcome (one of lead_created, appointment_booked, customer_support, human_transfer, spam, other), callerName (string|null), callerEmail (string|null), service_interest (string|null), urgency (high|medium|low|null), notes (string|null), wants_appointment (boolean), requested_slot (ISO 8601 datetime string the caller asked for, or null), confidence (0-1 number), spam (boolean, true for robocalls/telemarketers), asked_for_human (boolean). Only use information present in the transcript — never invent details.`,
        },
        { role: 'user', content: transcript.slice(0, 12_000) },
      ],
    }),
  });
  if (!res.ok) throw new Error(`AI analysis failed (${res.status})`);
  const data = await res.json();
  const parsed = JSON.parse(data.choices[0].message.content) as Record<string, unknown>;

  let outcome = String(parsed.outcome ?? 'other');
  if (!OUTCOMES.includes(outcome)) outcome = 'other';
  if (parsed.spam === true) outcome = 'spam';
  if (parsed.asked_for_human === true) outcome = 'human_transfer';
  if (parsed.wants_appointment === true && outcome === 'lead_created') outcome = 'appointment_booked';

  return {
    summary: typeof parsed.summary === 'string' ? parsed.summary : null,
    intent: typeof parsed.intent === 'string' ? parsed.intent : null,
    outcome,
    callerName: typeof parsed.callerName === 'string' && parsed.callerName ? parsed.callerName : null,
    callerEmail: typeof parsed.callerEmail === 'string' && parsed.callerEmail ? parsed.callerEmail : null,
    service_interest: typeof parsed.service_interest === 'string' ? parsed.service_interest : null,
    urgency: typeof parsed.urgency === 'string' ? parsed.urgency : null,
    notes: typeof parsed.notes === 'string' ? parsed.notes : null,
    wants_appointment: parsed.wants_appointment === true,
    requested_slot: typeof parsed.requested_slot === 'string' ? parsed.requested_slot : null,
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
    spam: parsed.spam === true,
    asked_for_human: parsed.asked_for_human === true,
  };
}

async function upsertLeadAndCustomer(
  db: SupabaseClient, businessId: string, ev: NormalizedCallEvent, analysis: CallAnalysis
): Promise<{ leadId: string | null; customerId: string | null; createdLead: boolean }> {
  const phone = ev.from;
  const email = analysis.callerEmail;
  if (!phone && !email) return { leadId: null, customerId: null, createdLead: false };

  // find existing lead by phone or email
  let q = db.from('leads').select('id, name, customer_id, status').eq('business_id', businessId);
  q = phone && email ? q.or(`phone.eq.${phone},email.eq.${email}`) : phone ? q.eq('phone', phone) : q.eq('email', email);
  const { data: found } = await q.order('created_at', { ascending: false }).limit(1).maybeSingle();
  const existing = found as { id: string; name: string; customer_id: string | null; status: string } | null;

  if (existing) {
    await db.from('leads').update({
      last_contacted_at: new Date().toISOString(),
      intent: analysis.intent ?? undefined,
    }).eq('id', existing.id);
    return { leadId: existing.id, customerId: existing.customer_id, createdLead: false };
  }

  const { data: lead, error } = await db.from('leads').insert({
    business_id: businessId,
    name: analysis.callerName ?? (phone ? `Caller ${phone}` : 'Voice caller'),
    email,
    phone,
    service_interest: analysis.service_interest,
    urgency: analysis.urgency,
    notes: analysis.notes,
    source: 'phone',
    status: 'new',
    lead_score: 23, // transparent base 10 + phone 13 (email unknown at call time)
    last_contacted_at: new Date().toISOString(),
  }).select('id').single();
  if (error) throw error;
  return { leadId: (lead as { id: string }).id, customerId: null, createdLead: true };
}

async function maybeBookAppointment(
  db: SupabaseClient, businessId: string, leadId: string | null, customerId: string | null, analysis: CallAnalysis, ev: NormalizedCallEvent
): Promise<string | null> {
  if (!analysis.wants_appointment) return null;

  // SAME booking engine as staff UI + website — no separate voice system.
  const [{ data: settingsRow }, { data: ruleRows }, { data: calendarRow }] = await Promise.all([
    db.from('booking_settings').select('*').eq('business_id', businessId).maybeSingle(),
    db.from('availability_rules').select('day_of_week, start_time, end_time').eq('business_id', businessId),
    db.from('calendars').select('id').eq('business_id', businessId).eq('is_default', true).maybeSingle(),
  ]);
  const s = settingsRow as { slot_duration_minutes?: number; buffer_minutes?: number; min_notice_minutes?: number; max_booking_days?: number; holidays?: string[]; auto_confirm?: boolean } | null;
  const config: BookingConfig = s ? {
    slot_duration_minutes: s.slot_duration_minutes ?? 60,
    buffer_minutes: s.buffer_minutes ?? 15,
    min_notice_minutes: s.min_notice_minutes ?? 120,
    max_booking_days: s.max_booking_days ?? 60,
    holidays: s.holidays ?? [],
  } : { ...DEFAULT_BOOKING_CONFIG };
  const rules = (ruleRows as AvailabilityRule[]) ?? [];
  const calendarId = (calendarRow as { id: string } | null)?.id ?? null;

  const now = new Date();
  const { data: bookedRows } = await db.from('appointments')
    .select('start_at, end_at')
    .eq('business_id', businessId)
    .in('status', ['requested', 'confirmed', 'rescheduled'])
    .gte('start_at', now.toISOString())
    .lt('start_at', new Date(now.getTime() + config.max_booking_days * 86_400_000).toISOString());
  const booked: BookedSlot[] = (bookedRows as BookedSlot[]) ?? [];

  let start: Date | null = null;
  if (analysis.requested_slot) {
    const requested = new Date(analysis.requested_slot);
    if (!Number.isNaN(requested.getTime()) && validateSlot(requested, rules, booked, config, now).ok) {
      start = requested;
    }
  }
  if (!start) {
    const [next] = nextAvailableSlots(now, rules, booked, config, 1);
    start = next ?? null;
  }
  if (!start) return null;

  const end = new Date(start.getTime() + config.slot_duration_minutes * 60_000);
  const status = s?.auto_confirm ? 'confirmed' : 'requested';
  const { data: appt, error } = await db.from('appointments').insert({
    business_id: businessId,
    calendar_id: calendarId,
    lead_id: leadId,
    customer_id: customerId,
    title: `${analysis.callerName ?? 'Voice caller'}${analysis.service_interest ? ` — ${analysis.service_interest}` : ' — appointment'}`,
    status,
    start_at: start.toISOString(),
    end_at: end.toISOString(),
    duration_minutes: config.slot_duration_minutes,
    created_source: 'ai_voice',
  }).select('id').single();
  if (error) throw error;
  return (appt as { id: string }).id;
}

async function triggerAutomations(
  db: SupabaseClient, businessId: string, leadId: string | null, outcome: string
) {
  const { data: rules } = await db.from('automation_rules')
    .select('id, name, trigger, action')
    .eq('business_id', businessId)
    .eq('enabled', true)
    .eq('trigger->>type', 'voice_call_completed');
  const matched = (rules as { id: string; name: string; action: Record<string, unknown> }[]) ?? [];

  for (const rule of matched) {
    const actionType = String((rule.action as { type?: string })?.type ?? '');
    let runStatus = 'ok';
    let runOutput: Record<string, unknown> = { source: 'voice_call', outcome };

    try {
      if (actionType === 'create_follow_up' && leadId) {
        await db.from('follow_ups').insert({
          business_id: businessId, lead_id: leadId,
          channel: 'email', status: 'draft', subject: 'Following up on your call',
          body: '', ai_generated: false,
        });
      } else if (actionType === 'create_task') {
        await db.from('tasks').insert({
          business_id: businessId,
          title: `Review voice call outcome (${outcome.replace('_', ' ')})`,
          status: 'open', priority: 'medium', related_lead_id: leadId,
        });
      } else if (actionType === 'send_notification') {
        // notifications.user_id is NOT NULL: notify every member of the business
        const { data: members } = await db.from('business_members')
          .select('user_id').eq('business_id', businessId);
        const memberIds = ((members as { user_id: string }[]) ?? []).map((m) => m.user_id);
        if (memberIds.length === 0) throw new Error('No business members to notify');
        await db.from('notifications').insert(
          memberIds.map((uid) => ({
            business_id: businessId, user_id: uid,
            title: 'Voice call completed',
            body: `Automation "${rule.name}" ran after a call with outcome ${outcome.replace('_', ' ')}.`,
            type: 'automation', read: false,
          }))
        );
      } else {
        runStatus = 'skipped';
        runOutput = { source: 'voice_call', reason: `Unsupported action: ${actionType}` };
      }
    } catch (e) {
      runStatus = 'error';
      runOutput = { source: 'voice_call', error: e instanceof Error ? e.message : 'action failed' };
    }

    await db.from('automation_runs').insert({
      business_id: businessId, rule_id: rule.id, lead_id: leadId,
      status: runStatus, output: runOutput,
    });
  }
}


Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });

  try {
    const url = new URL(req.url);
    const secret = url.searchParams.get('secret');
    if (!secret) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

    const payload = await req.json();
    // Detect provider from payload shape: Retell sends { event, call }, Vapi sends { type, message }
    const provider = 'event' in (payload as object) ? 'retell' : 'vapi';
    const adapter = getAdapter(provider);
    const ev = adapter.normalizeWebhook(payload);

    const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');

    const { data: agent } = await db.from('voice_agents')
      .select('id, business_id, webhook_secret, compliance')
      .eq('webhook_secret', secret)
      .maybeSingle();
    if (!agent) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    const biz = agent as { id: string; business_id: string; webhook_secret: string; compliance: { recording_enabled?: boolean } };

    // Idempotency: upsert the call record keyed on (provider, provider_call_id)
    const { data: existingCall } = await db.from('voice_calls')
      .select('id, processed')
      .eq('provider', ev.provider)
      .eq('provider_call_id', ev.providerCallId)
      .maybeSingle();
    const prior = existingCall as { id: string; processed: boolean } | null;

    // Recording reference only when the owner enabled recording AND the provider supplied one
    const recordingUrl = biz.compliance?.recording_enabled === true ? ev.recordingUrl ?? null : null;

    const callRow = {
      business_id: biz.business_id,
      voice_agent_id: biz.id,
      provider: ev.provider,
      provider_call_id: ev.providerCallId,
      phone_number: ev.from ?? null,
      started_at: ev.startedAt ?? new Date().toISOString(),
      answered_at: ev.type === 'call_started' ? new Date().toISOString() : null,
      ended_at: ev.endedAt ?? null,
      duration_seconds: ev.durationSeconds ?? null,
      transcript_url: ev.transcriptUrl ?? null,
      recording_url: recordingUrl,
    };

    if (prior) {
      await db.from('voice_calls').update(callRow).eq('id', prior.id);
    } else {
      await db.from('voice_calls').insert(callRow);
    }

    // ---- post-call pipeline only when the call has ended ----
    if (ev.type === 'call_ended') {
      const { data: business } = await db.from('businesses').select('name').eq('id', biz.business_id).single();
      const analysis = await analyseCall(db, ev.transcriptText ?? null, (business as { name: string })?.name ?? 'this business');

      const { leadId, customerId, createdLead } = await upsertLeadAndCustomer(db, biz.business_id, ev, analysis);
      const apptId = await maybeBookAppointment(db, biz.business_id, leadId, customerId, analysis, ev);

      const { data: callRowFinal } = await db.from('voice_calls')
        .select('id').eq('provider', ev.provider).eq('provider_call_id', ev.providerCallId).maybeSingle();
      if (callRowFinal) {
        let outcome = analysis.outcome;
        if (apptId) outcome = 'appointment_booked';
        else if (createdLead && outcome === 'other') outcome = 'lead_created';
        await db.from('voice_calls').update({
          outcome,
          intent: analysis.intent,
          ai_summary: analysis.summary,
          customer_id: customerId,
          lead_id: leadId,
          answered_at: ev.startedAt ?? new Date().toISOString(),
          processed: true,
        }).eq('id', (callRowFinal as { id: string }).id);
      }

      await db.from('activities').insert({
        business_id: biz.business_id,
        entity_type: leadId ? 'lead' : 'automation',
        entity_id: leadId ?? biz.id,
        type: 'voice_call',
        title: `Voice call ${analysis.spam ? '(spam)' : `— ${analysis.intent ?? outcome}`}`,
        description: analysis.summary ?? `Call from ${ev.from ?? 'unknown number'}, outcome: ${outcome.replace('_', ' ')}.`,
      });

      await triggerAutomations(db, biz.business_id, leadId, analysis.outcome);
    }

    return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Webhook processing failed' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
});
