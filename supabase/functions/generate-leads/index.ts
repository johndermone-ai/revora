// ============================================================
// generate-leads — subscription-based daily lead generation.
//
// Two modes:
//  1. On demand: authenticated member of the business POSTs {}
//     → generates up to today's remaining quota for THAT business.
//  2. Scheduled: cron/automation calls with the LEAD_GEN_SECRET
//     header → iterates every business with generation enabled.
//
// Quota per plan (delivered per day):
//   trial: 2 · starter: 5 · pro: 15 · anything else: 0
//
// Honest channels:
//  • A configured lead provider integration (integration config
//    kind 'lead_provider') is the preferred source of REAL leads.
//    Provider adapters live in PROVIDERS below — returning []
//    until one is configured, so nothing is fabricated.
//  • With no provider, the OpenAI generator creates AI prospects
//    clearly labelled source='ai_generated' with an unverified
//    note. They are never contacted automatically — they land as
//    status 'new' for the owner to review.
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const PLAN_DAILY_QUOTA: Record<string, number> = {
  trial: 2,
  starter: 5,
  pro: 15,
};

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const MODEL = 'gpt-4o-mini';

interface LeadRow {
  name: string; email: string | null; phone: string | null;
  service_interest: string | null; notes: string | null; intent: string | null; urgency: string | null; budget: string | null;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

async function generateWithOpenAI(
  count: number, services: string, area: string, customer: string
): Promise<LeadRow[]> {
  const key = Deno.env.get('OPENAI_API_KEY');
  if (!key) throw new Error('OPENAI_API_KEY not configured');

  const prompt = `You generate plausible UK prospect profiles for a small business CRM demo pipeline. Business services: ${services || 'general home services'}. Target area: ${area || 'the UK'}. Target customer: ${customer || 'local customers'}.
Create ${count} varied prospect profiles. Each must include a plausible name, a clearly FAKE email address on example.com or example.co.uk (never a real domain), a plausible UK phone number (starting 07 or 01/02), the service they are interested in, a short requirement note, an intent, an urgency (low/medium/high), and a rough budget.
Return strict JSON: {"leads":[{"name","email","phone","service_interest","notes","intent","urgency","budget"}]}. No markdown, no extra keys.`;

  const res = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.9,
      response_format: { type: 'json_object' },
    }),
  });
  if (!res.ok) throw new Error(`OpenAI error ${res.status}`);
  const data = await res.json();
  const parsed = JSON.parse(data.choices?.[0]?.message?.content ?? '{}');
  return (parsed.leads ?? []).slice(0, count);
}

// Provider adapters — the interface future real lead providers plug
// into. Each returns [] until configured, so the generator never
// pretends a provider delivered leads.
const PROVIDERS: Record<string, (cfg: Record<string, unknown>, count: number) => Promise<LeadRow[]>> = {
  // omkarcloud/google-maps-scraper self-hosted API (see
  // tools/google-maps-scraper/runbook.md). PLATFORM-LEVEL connection:
  // the platform owner sets the secrets once (supabase secrets set
  // GOOGLE_MAPS_SCRAPER_ENDPOINT=... GOOGLE_MAPS_SCRAPER_API_KEY=...)
  // and every subscribed business receives real leads automatically —
  // customers are NEVER asked for an endpoint or API key. Per-business
  // targeting (services/area) comes from their lead_gen_settings.
  // The endpoint must accept POST { count, services, area, api_key? } and
  // return JSON: [{ name, phone, email?, main_category?, address?, website? }].
  // Returns [] on any failure — never fabricates.
  'google_maps': async (cfg, count) => {
    const endpoint = Deno.env.get('GOOGLE_MAPS_SCRAPER_ENDPOINT') ?? String(cfg.endpoint ?? '');
    const platformKey = Deno.env.get('GOOGLE_MAPS_SCRAPER_API_KEY') ?? (cfg.api_key ? String(cfg.api_key) : '');
    if (!endpoint) return [];
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (platformKey) headers['x-api-key'] = platformKey;
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({ count, services: cfg.services ?? '', area: cfg.area ?? '' }),
      });
      if (!res.ok) return [];
      const rows = await res.json();
      if (!Array.isArray(rows)) return [];
      return rows.slice(0, count).map((r: Record<string, unknown>) => ({
        name: String(r.name ?? '').slice(0, 200),
        email: r.email ? String(r.email).slice(0, 200) : null,
        phone: r.phone ? String(r.phone).slice(0, 40) : null,
        service_interest: r.main_category ? String(r.main_category).slice(0, 200) : null,
        notes: `Google Maps business. ${[r.address ? `Address: ${r.address}` : '', r.website ? `Website: ${r.website}` : ''].filter(Boolean).join(' · ')}`,
        intent: null, urgency: null, budget: null,
      }));
    } catch {
      return [];
    }
  },
};

async function fetchFromProvider(
  count: number, services: string, area: string
): Promise<{ rows: LeadRow[]; provider: string }> {
  // Platform-level providers (env-configured by the platform owner).
  // Preferred first; each returns [] when unconfigured or failing,
  // so the generator never fabricates. Customers never configure these.
  const providers: [string, Record<string, unknown>][] = [
    ['google_maps', { services, area }],
  ];
  for (const [providerName, cfg] of providers) {
    const adapter = PROVIDERS[providerName];
    if (!adapter) continue;
    const rows = await adapter(cfg, count);
    if (rows.length > 0) return { rows, provider: providerName };
  }
  return { rows: [], provider: '' };
}

async function generateForBusiness(
  db: ReturnType<typeof createClient>, businessId: string
): Promise<{ ok: boolean; created: number; skipped?: string; error?: string }> {
  // Settings + subscription
  const { data: settings } = await db.from('lead_gen_settings')
    .select('*').eq('business_id', businessId).single();
  const s = settings as (typeof settings & { enabled: boolean; service_keywords: string; target_area: string; target_customer: string; daily_quota_override: number | null }) | null;
  if (!s || !s.enabled) return { ok: false, created: 0, skipped: 'generation not enabled' };

  const { data: sub } = await db.from('subscriptions')
    .select('plan, status').eq('business_id', businessId).single();
  const plan = ((sub as { plan?: string; status?: string } | null)?.plan) ?? 'trial';
  const subStatus = ((sub as { status?: string } | null)?.status) ?? 'trialing';
  if (subStatus === 'cancelled' || subStatus === 'past_due') {
    return { ok: false, created: 0, skipped: `subscription ${subStatus}` };
  }

  const quota = s.daily_quota_override ?? PLAN_DAILY_QUOTA[plan] ?? 0;
  if (quota <= 0) return { ok: false, created: 0, skipped: `plan ${plan} includes no daily leads` };

  // Used today = generated/marketplace leads created since midnight UTC
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  const { count: usedToday } = await db.from('leads')
    .select('id', { count: 'exact', head: true })
    .eq('business_id', businessId)
    .in('source', ['ai_generated', 'marketplace', 'google_maps'])
    .gte('created_at', since.toISOString());
  const remaining = Math.max(0, quota - (usedToday ?? 0));
  if (remaining === 0) return { ok: true, created: 0, skipped: 'daily quota reached' };

  // Prefer a real provider; fall back to the labelled AI generator
  const delivered = await fetchFromProvider(remaining, s.service_keywords, s.target_area);
  let rows = delivered.rows;
  let source: 'marketplace' | 'ai_generated' | 'google_maps' = 'marketplace';
  if (rows.length > 0) {
    source = delivered.provider === 'google_maps' ? 'google_maps' : 'marketplace';
  } else {
    rows = await generateWithOpenAI(remaining, s.service_keywords, s.target_area, s.target_customer);
    source = 'ai_generated';
  }

  const created = Math.min(rows.length, remaining);
  const insert = rows.slice(0, created).map((r) => ({
    business_id: businessId,
    name: String(r.name ?? '').slice(0, 200),
    email: r.email ? String(r.email).slice(0, 200) : null,
    phone: r.phone ? String(r.phone).slice(0, 40) : null,
    source,
    service_interest: r.service_interest ? String(r.service_interest).slice(0, 200) : null,
    status: 'new',
    intent: r.intent ? String(r.intent).slice(0, 100) : null,
    urgency: r.urgency ? String(r.urgency).slice(0, 50) : null,
    budget: r.budget ? String(r.budget).slice(0, 100) : null,
    notes: source === 'ai_generated'
      ? `AI-generated prospect — unverified. ${r.notes ?? ''}`.trim()
      : `Delivered by lead provider. ${r.notes ?? ''}`.trim(),
  }));

  if (insert.length > 0) {
    const { error } = await db.from('leads').insert(insert);
    if (error) return { ok: false, created: 0, error: error.message };
  }

  await db.from('lead_gen_settings').update({
    last_run_at: new Date().toISOString(),
    last_run_status: 'ok',
    last_run_error: null,
  }).eq('business_id', businessId);

  return { ok: true, created: insert.length };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const authHeader = req.headers.get('Authorization') ?? '';
  const secret = req.headers.get('x-lead-gen-secret') ?? '';

  // --- Scheduled mode: run for every enabled business ---
  if (secret && secret === Deno.env.get('LEAD_GEN_SECRET')) {
    const db = createClient(url, serviceKey);
    const { data: settings } = await db.from('lead_gen_settings')
      .select('business_id').eq('enabled', true);
    const results = [];
    for (const s of (settings ?? []) as { business_id: string }[]) {
      try {
        const r = await generateForBusiness(db, s.business_id);
        results.push({ business_id: s.business_id, ...r });
      } catch (e) {
        results.push({ business_id: s.business_id, ok: false, created: 0, error: e instanceof Error ? e.message : 'unknown' });
      }
    }
    return json({ ok: true, ran: results.length, results });
  }

  // --- On-demand mode: the caller's own business only ---
  const db = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user } } = await db.auth.getUser();
  if (!user) return json({ error: 'Not authenticated' }, 401);

  const { data: memberships } = await db.from('business_members')
    .select('business_id, role').eq('user_id', user.id);
  const member = (memberships as { business_id: string; role: string }[] | null)?.find(() => true);
  if (!member) return json({ error: 'No business found for this account' }, 403);

  try {
    const r = await generateForBusiness(db, member.business_id);
    return json(r);
  } catch (e) {
    return json({ ok: false, created: 0, error: e instanceof Error ? e.message : 'Generation failed' }, 500);
  }
});
