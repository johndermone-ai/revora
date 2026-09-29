// Public appointment booking endpoint — used by the AI voice agent and the
// website booking flow. Deploy with --no-verify-jwt.
//
// CRITICAL DESIGN RULE: this endpoint uses the SAME booking engine as the
// staff UI (supabase/functions/_shared/bookingEngine.ts). There is no
// separate AI voice booking system — every channel validates and books
// through identical slot logic.
//
// Input:
//   { businessId, name, email?, phone?, service_interest?, notes?,
//     startISO?: string,      // exact slot request (validated)
//     preferNext?: boolean }  // or "give me the next available slot"
// Behaviour:
//   - Finds-or-creates the lead (source website/ai_voice, status new) and
//     reuses an existing lead matching email or phone.
//   - Validates the slot with the shared engine (availability, buffer,
//     notice, window, holidays, conflicts).
//   - Creates the appointment (requested, or confirmed if auto_confirm).
//   - Logs activities for the lead and appointment.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  nextAvailableSlots, validateSlot,
  type AvailabilityRule, type BookedSlot, type BookingConfig, DEFAULT_BOOKING_CONFIG,
} from '../_shared/bookingEngine.ts';

const rateLimit = new Map<string, { count: number; reset: number }>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const e = rateLimit.get(ip);
  if (!e || e.reset < now) { rateLimit.set(ip, { count: 1, reset: now + 60_000 }); return false; }
  e.count += 1;
  return e.count > 10;
}

function clean(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length === 0 || t.length > max ? null : t;
}

const cors = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' },
    });
  }
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: cors });

  try {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
    if (rateLimited(ip)) return new Response(JSON.stringify({ error: 'Too many requests' }), { status: 429, headers: cors });

    const body = await req.json();
    const businessId = clean(body.businessId, 64);
    const name = clean(body.name, 200);
    const email = clean(body.email, 200);
    const phone = clean(body.phone, 50);
    const service = clean(body.service_interest, 200);
    const notes = clean(body.notes, 2000);
    const source = body.source === 'ai_voice' ? 'ai_voice' : 'website';

    if (!businessId || !name || (!email && !phone)) {
      return new Response(JSON.stringify({ error: 'Name plus email or phone is required' }), { status: 400, headers: cors });
    }

    const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');

    const { data: biz } = await db.from('businesses').select('id, name').eq('id', businessId).single();
    if (!biz) return new Response(JSON.stringify({ error: 'Business not found' }), { status: 404, headers: cors });

    // ---- load booking config + availability (same tables the staff UI uses) ----
    const [{ data: settingsRow }, { data: ruleRows }, { data: calendarRow }] = await Promise.all([
      db.from('booking_settings').select('*').eq('business_id', businessId).maybeSingle(),
      db.from('availability_rules').select('day_of_week, start_time, end_time').eq('business_id', businessId),
      db.from('calendars').select('id').eq('business_id', businessId).eq('is_default', true).maybeSingle(),
    ]);

    const s: { slot_duration_minutes: number; buffer_minutes: number; min_notice_minutes: number; max_booking_days: number; holidays: string[]; auto_confirm: boolean } | null = settingsRow as never;
    const config: BookingConfig = s
      ? {
          slot_duration_minutes: s.slot_duration_minutes ?? 60,
          buffer_minutes: s.buffer_minutes ?? 15,
          min_notice_minutes: s.min_notice_minutes ?? 120,
          max_booking_days: s.max_booking_days ?? 60,
          holidays: s.holidays ?? [],
        }
      : { ...DEFAULT_BOOKING_CONFIG };
    const rules: AvailabilityRule[] = (ruleRows as AvailabilityRule[]) ?? [];
    const calendarId = (calendarRow as { id: string } | null)?.id ?? null;

    // ---- find the slot ----
    const now = new Date();
    const windowStart = now;
    const windowEnd = new Date(now.getTime() + config.max_booking_days * 86_400_000);
    const { data: bookedRows } = await db
      .from('appointments')
      .select('start_at, end_at')
      .eq('business_id', businessId)
      .in('status', ['requested', 'confirmed', 'rescheduled'])
      .gte('start_at', windowStart.toISOString())
      .lt('start_at', windowEnd.toISOString());
    const booked: BookedSlot[] = (bookedRows as BookedSlot[]) ?? [];

    let start: Date | null = null;
    if (body.startISO) {
      const requested = new Date(String(body.startISO));
      if (Number.isNaN(requested.getTime())) {
        return new Response(JSON.stringify({ error: 'Invalid start time' }), { status: 400, headers: cors });
      }
      const check = validateSlot(requested, rules, booked, config, now);
      if (!check.ok) {
        // offer the next available alternatives from the same engine
        const alternatives = nextAvailableSlots(now, rules, booked, config, 3);
        return new Response(JSON.stringify({ error: check.reason, alternatives }), { status: 409, headers: cors });
      }
      start = requested;
    } else {
      const [next] = nextAvailableSlots(now, rules, booked, config, 1);
      if (!next) return new Response(JSON.stringify({ error: 'No available slots in the booking window' }), { status: 409, headers: cors });
      start = next;
    }

    const end = new Date(start.getTime() + config.slot_duration_minutes * 60_000);

    // ---- find or create the lead (reuse across channels) ----
    let leadId: string;
    const { data: existing } = await db
      .from('leads')
      .select('id, name, customer_id')
      .eq('business_id', businessId)
      .or(email ? `email.eq.${email}` : `phone.eq.${phone}`)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const existingLead = existing as { id: string; name: string; customer_id: string | null } | null;

    if (existingLead) {
      leadId = existingLead.id;
    } else {
      const { data: newLead, error: leadErr } = await db.from('leads').insert({
        business_id: businessId,
        name,
        email,
        phone,
        service_interest: service,
        notes,
        source: source === 'ai_voice' ? 'phone' : 'website',
        status: 'new',
        lead_score: 10,
      }).select('id').single();
      if (leadErr || !newLead) throw leadErr ?? new Error('lead insert failed');
      leadId = (newLead as { id: string }).id;
    }

    // ---- create the appointment via the shared rules ----
    const status = s?.auto_confirm ? 'confirmed' : 'requested';
    const { data: appt, error: apptErr } = await db.from('appointments').insert({
      business_id: businessId,
      calendar_id: calendarId,
      lead_id: leadId,
      customer_id: existingLead?.customer_id ?? null,
      title: `${name}${service ? ` — ${service}` : ' — appointment'}`,
      status,
      start_at: start.toISOString(),
      end_at: end.toISOString(),
      duration_minutes: config.slot_duration_minutes,
      notes,
      created_source: source,
    }).select().single();
    if (apptErr || !appt) throw apptErr ?? new Error('appointment insert failed');

    await db.from('activities').insert([
      {
        business_id: businessId, entity_type: 'lead', entity_id: leadId,
        type: 'appointment_requested',
        title: `Appointment booked via ${source.replace('_', ' ')}: ${name}`,
        description: `${start.toISOString()} (${status})`,
      },
    ]);

    return new Response(JSON.stringify({
      ok: true,
      appointmentId: (appt as { id: string }).id,
      start: start.toISOString(),
      end: end.toISOString(),
      status,
    }), { headers: cors });
  } catch {
    return new Response(JSON.stringify({ error: 'Could not book the appointment' }), { status: 500, headers: cors });
  }
});
