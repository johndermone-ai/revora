// Appointment reminders — authenticated (JWT + business membership).
// Scans confirmed/rescheduled appointments starting in the next 24 hours
// and creates notification rows for every business member, deduplicated so
// running it repeatedly never spams (same appointment + same user = no new
// notification). Intended to run on a schedule (e.g. cron via Supabase
// scheduled functions, pg_cron, or an external scheduler) or manually from
// the Calendar page. Reminders are prepared infrastructure — actual SMS/
// email delivery to CUSTOMERS activates with those channel integrations;
// here they are in-app notifications for the team.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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

    const { data: member } = await db.from('business_members')
      .select('user_id').eq('business_id', businessId).eq('user_id', user.id).maybeSingle();
    if (!member) return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });

    const now = new Date();
    const in24h = new Date(now.getTime() + 24 * 3_600_000);

    const { data: upcoming } = await db.from('appointments')
      .select('id, title, start_at, status')
      .eq('business_id', businessId)
      .in('status', ['confirmed', 'rescheduled'])
      .gte('start_at', now.toISOString())
      .lt('start_at', in24h.toISOString());
    const appts = (upcoming as { id: string; title: string; start_at: string }[]) ?? [];

    const { data: members } = await db.from('business_members')
      .select('user_id').eq('business_id', businessId);
    const memberIds = ((members as { user_id: string }[]) ?? []).map((m) => m.user_id);

    // dedupe: existing reminder notifications for these members
    const { data: existing } = await db.from('notifications')
      .select('user_id, title')
      .eq('business_id', businessId)
      .eq('type', 'appointment_reminder')
      .gte('created_at', new Date(now.getTime() - 3 * 86_400_000).toISOString());
    const seen = new Set(((existing as { user_id: string; title: string }[]) ?? []).map((n) => `${n.user_id}|${n.title}`));

    let created = 0;
    for (const a of appts) {
      const when = new Date(a.start_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
      const title = `Reminder: ${a.title} — ${when}`;
      for (const uid of memberIds) {
        if (seen.has(`${uid}|${title}`)) continue;
        await db.from('notifications').insert({
          business_id: businessId, user_id: uid, title,
          body: `Starts soon (${when}). Tap through to the calendar for details.`,
          type: 'appointment_reminder', read: false,
        });
        created += 1;
        seen.add(`${uid}|${title}`);
      }
    }

    return new Response(JSON.stringify({ ok: true, scanned: appts.length, created }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    return new Response(JSON.stringify({ error: 'Reminder run failed' }), { status: 500 });
  }
});
