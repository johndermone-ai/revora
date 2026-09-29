// In-app AI assistant — authenticated (JWT + business membership).
// Answers using REAL business data only: loads a live snapshot (lead counts
// by status, recent leads, upcoming appointments, open recovery
// opportunities) and instructs the model to say when something isn't in the
// snapshot. No business data is stored; conversation history is held
// client-side and sent per request.

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

    const { businessId, messages } = await req.json();
    if (!businessId || !Array.isArray(messages)) return new Response(JSON.stringify({ error: 'Missing parameters' }), { status: 400 });

    const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    const { data: member } = await db.from('business_members')
      .select('user_id').eq('business_id', businessId).eq('user_id', user.id).maybeSingle();
    if (!member) return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });

    const key = Deno.env.get('OPENAI_API_KEY');
    if (!key) return new Response(JSON.stringify({ error: 'The OpenAI integration is not configured yet — connect it in the Integrations hub.' }), { status: 503, headers: { 'Content-Type': 'application/json' } });

    // ---- real business snapshot ----
    const { data: biz } = await db.from('businesses').select('name, industry').eq('id', businessId).maybeSingle();
    const [{ data: leads }, { data: appts }, { data: opps }] = await Promise.all([
      db.from('leads').select('name, status, lead_score, service_interest, next_follow_up_at').eq('business_id', businessId).order('created_at', { ascending: false }).limit(15),
      db.from('appointments').select('title, start_at, status').eq('business_id', businessId).in('status', ['requested', 'confirmed', 'rescheduled']).gte('start_at', new Date().toISOString()).order('start_at').limit(5),
      db.from('revenue_opportunities').select('title, status, opportunity_type').eq('business_id', businessId).in('status', ['detected', 'action_required', 'in_progress']).limit(5),
    ]);
    const leadRows = (leads as Record<string, unknown>[]) ?? [];
    const apptRows = (appts as { title: string; start_at: string; status: string }[]) ?? [];
    const oppRows = (opps as { title: string; status: string; opportunity_type: string }[]) ?? [];

    const byStatus: Record<string, number> = {};
    for (const l of leadRows) byStatus[String(l.status)] = (byStatus[String(l.status)] ?? 0) + 1;

    const snapshot = `BUSINESS SNAPSHOT (live)
Business: ${(biz as { name: string } | null)?.name ?? 'unknown'} — ${(biz as { industry?: string } | null)?.industry ?? 'industry not set'}
Lead statuses (of 15 most recent): ${JSON.stringify(byStatus)}
Recent leads: ${leadRows.map((l) => `${l.name} [${l.status}, score ${l.lead_score}${l.next_follow_up_at ? `, follow-up ${l.next_follow_up_at}` : ''}]`).join('; ') || 'none'}
Upcoming appointments: ${apptRows.map((a) => `${a.title} at ${a.start_at} (${a.status})`).join('; ') || 'none'}
Open recovery opportunities: ${oppRows.map((o) => `${o.title} (${o.status})`).join('; ') || 'none'}`;

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are Revora's in-app assistant for a small business's team. Answer questions about their leads, pipeline, appointments and revenue recovery. Use ONLY the live business snapshot provided — if something isn't in it, say plainly that you can't see that information rather than guessing. Be concise and practical. ${snapshot}`,
          },
          ...messages.slice(-10).map((m: { role: string; content: string }) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })),
        ],
      }),
    });
    if (!res.ok) return new Response(JSON.stringify({ error: `AI request failed (${res.status})` }), { status: 502, headers: { 'Content-Type': 'application/json' } });
    const data = await res.json();
    return new Response(JSON.stringify({ reply: data.choices[0].message.content }), { headers: { 'Content-Type': 'application/json' } });
  } catch {
    return new Response(JSON.stringify({ error: 'Assistant request failed' }), { status: 500 });
  }
});
