// Generic inbound webhook for the API/webhooks integration.
// Deploy with --no-verify-jwt. Authentication: the caller sends their Revora
// API key in the x-revora-api-key header; it is looked up by SHA-256 hash
// (find_business_by_secret_hash) — the key itself is never stored in
// plaintext-comparable form and never logged.
//
// Payload: { name, email?, phone?, service_interest?, notes?, source_label? }
// Creates a lead (deduplicated against existing leads by email/phone) and an
// activity, and logs a webhook audit row.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const KEY_HEADER = 'x-revora-api-key';

async function sha256Hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function clean(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length === 0 || t.length > max ? null : t;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, x-revora-api-key' } });
  }
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });

  try {
    const apiKey = req.headers.get(KEY_HEADER);
    if (!apiKey) return new Response(JSON.stringify({ error: 'Missing API key' }), { status: 401 });

    const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    const hash = await sha256Hex(apiKey);
    const { data: businessId } = await db.rpc('find_business_by_secret_hash', { p_hash: hash });
    if (!businessId) return new Response(JSON.stringify({ error: 'Invalid API key' }), { status: 401 });

    const p = await req.json();
    const name = clean(p.name, 200);
    const email = clean(p.email, 200);
    const phone = clean(p.phone, 50);
    const service = clean(p.service_interest, 200);
    const notes = clean(p.notes, 2000);
    const sourceLabel = clean(p.source_label, 100);

    if (!name || (!email && !phone)) {
      await db.from('integration_logs').insert({ business_id: businessId, integration_key: 'api_webhooks', event: 'webhook', status: 'failed', message: 'Rejected: name plus email or phone required.' });
      return new Response(JSON.stringify({ error: 'Name plus email or phone is required' }), { status: 400 });
    }

    // dedupe against existing leads
    let q = db.from('leads').select('id').eq('business_id', businessId);
    q = email && phone ? q.or(`email.eq.${email},phone.eq.${phone}`) : email ? q.eq('email', email) : q.eq('phone', phone);
    const { data: existing } = await q.limit(1).maybeSingle();

    if (existing) {
      await db.from('integration_logs').insert({ business_id: businessId, integration_key: 'api_webhooks', event: 'webhook', status: 'ok', message: `Updated lead from webhook: ${name}${sourceLabel ? ` (${sourceLabel})` : ''}` });
      await db.from('leads').update({ last_contacted_at: new Date().toISOString() }).eq('id', (existing as { id: string }).id);
      return new Response(JSON.stringify({ ok: true, deduplicated: true }), { headers: { 'Content-Type': 'application/json' } });
    }

    const { data: lead, error } = await db.from('leads').insert({
      business_id: businessId,
      name, email, phone,
      service_interest: service,
      notes,
      source: 'other',
      status: 'new',
      lead_score: 10,
    }).select('id').single();
    if (error) throw error;

    await db.from('activities').insert({
      business_id: businessId, entity_type: 'lead', entity_id: (lead as { id: string }).id,
      type: 'webhook_lead', title: `Lead from API webhook: ${name}`,
      description: sourceLabel ? `Source: ${sourceLabel}` : 'Received via API/webhooks integration',
    });
    await db.from('integration_logs').insert({ business_id: businessId, integration_key: 'api_webhooks', event: 'webhook', status: 'ok', message: `Lead created from webhook: ${name}${sourceLabel ? ` (${sourceLabel})` : ''}` });

    return new Response(JSON.stringify({ ok: true, leadId: (lead as { id: string }).id }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
  } catch {
    return new Response(JSON.stringify({ error: 'Webhook failed' }), { status: 500 });
  }
});
