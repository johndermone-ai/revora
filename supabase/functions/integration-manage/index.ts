// Integrations Hub management — authenticated; owner/admin only; membership
// and role verified server-side on every call.
//
// Secrets: arrive ONCE in the request body over HTTPS, are stored pgp-ENCRYPTED
// via store_integration_secret (master key lives in a database setting, never
// in code), and are never returned in any response. The frontend only ever
// receives status, config (non-secret), last sync and error message.
//
// "Connected" is only set after a REAL verification call to the provider
// succeeds. If verification cannot be performed or fails, status is 'error'
// with a message — never a fake connected state.
//
// Supported keys with real verification:
//   openai          GET /v1/models (Bearer key)
//   stripe          GET /v1/balance (Bearer key)
//   sendgrid        GET /v3/scopes (Bearer key)
//   postmark        POST /server (X-Postmark-Server-Token)
//   twilio (sms)    GET /2010-04-01/Accounts.json (basic auth)
//   twilio_whatsapp same Twilio credentials, WhatsApp usage
//   api_webhooks    generates a Revora API key (verified by construction,
//                   used to authenticate inbound webhooks)
//   google_calendar / outlook_calendar — OAuth-based: stored as 'disconnected'
//                   until an OAuth token flow is configured; secrets accepted
//                   but connection requires the OAuth callback (not faked).
//   voice, csv_import, web_forms — built-in/link cards, no secrets here.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

interface VerifyResult { ok: boolean; message: string; permissions: string[] }

async function verifySecret(key: string, secret: string, config: Record<string, unknown>): Promise<VerifyResult> {
  switch (key) {
    case 'openai': {
      const r = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${secret}` } });
      return { ok: r.ok, message: r.ok ? 'Key verified with OpenAI.' : `OpenAI rejected the key (${r.status}).`, permissions: ['Generate AI summaries and follow-up drafts'] };
    }
    case 'stripe': {
      const r = await fetch('https://api.stripe.com/v1/balance', { headers: { Authorization: `Bearer ${secret}` } });
      return { ok: r.ok, message: r.ok ? 'Key verified with Stripe.' : `Stripe rejected the key (${r.status}).`, permissions: ['Read balance and create payment links'] };
    }
    case 'sendgrid': {
      const r = await fetch('https://api.sendgrid.com/v3/scopes', { headers: { Authorization: `Bearer ${secret}` } });
      return { ok: r.ok, message: r.ok ? 'Key verified with SendGrid.' : `SendGrid rejected the key (${r.status}).`, permissions: ['Send email follow-ups from your address'] };
    }
    case 'postmark': {
      const r = await fetch('https://api.postmarkapp.com/server', { headers: { 'X-Postmark-Server-Token': secret, Accept: 'application/json' } });
      return { ok: r.ok, message: r.ok ? 'Token verified with Postmark.' : `Postmark rejected the token (${r.status}).`, permissions: ['Send email follow-ups from your address'] };
    }
    case 'twilio':
    case 'twilio_whatsapp': {
      const sid = String(config.account_sid ?? '');
      if (!sid) return { ok: false, message: 'Twilio Account SID is required.', permissions: [] };
      const basic = btoa(`${sid}:${secret}`);
      const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}.json`, { headers: { Authorization: `Basic ${basic}` } });
      const what = key === 'twilio' ? 'SMS' : 'WhatsApp';
      return { ok: r.ok, message: r.ok ? `Credentials verified with Twilio (${what}).` : `Twilio rejected the credentials (${r.status}).`, permissions: [`Send ${what} messages from your Twilio number`] };
    }
    case 'api_webhooks':
      return { ok: true, message: 'API key generated. Use it to authenticate inbound webhooks.', permissions: ['Push leads into Revora from external systems'] };
    case 'google_calendar':
    case 'outlook_calendar':
      return { ok: false, message: 'Calendar sync needs an OAuth connection flow — stored as pending until the OAuth callback is configured. Status stays disconnected; nothing is faked.', permissions: ['Read and write calendar events'] };
    default:
      return { ok: false, message: `No server-side verification available for '${key}'.`, permissions: [] };
  }
}

function randomApiKey(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return `rv_live_${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

async function log(db: ReturnType<typeof createClient>, businessId: string, key: string, event: string, status: 'ok' | 'failed', message: string) {
  await db.from('integration_logs').insert({ business_id: businessId, integration_key: key, event, status, message: message.slice(0, 500) });
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

    const body = await req.json();
    const { businessId, action, integrationKey } = body;
    if (!businessId || !integrationKey) return new Response(JSON.stringify({ error: 'Missing parameters' }), { status: 400 });

    const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');

    const { data: member } = await db.from('business_members')
      .select('role').eq('business_id', businessId).eq('user_id', user.id).maybeSingle();
    const role = (member as { role: string } | null)?.role;
    if (!role || !['owner', 'admin'].includes(role)) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
    }

    // ---- disconnect ----
    if (action === 'disconnect') {
      await db.from('integrations').upsert({
        business_id: businessId, integration_key: integrationKey,
        status: 'disconnected', error_message: null, config: {},
        updated_at: new Date().toISOString(),
      }, { onConflict: 'business_id,integration_key' });
      // remove the stored secret entirely
      await db.from('integration_credentials').delete().eq('business_id', businessId).eq('integration_key', integrationKey);
      await log(db, businessId, integrationKey, 'disconnect', 'ok', 'Disconnected and credentials deleted.');
      return new Response(JSON.stringify({ ok: true, status: 'disconnected' }), { headers: { 'Content-Type': 'application/json' } });
    }

    // ---- save non-secret config ----
    if (action === 'save_config') {
      await db.from('integrations').upsert({
        business_id: businessId, integration_key: integrationKey,
        config: body.config ?? {}, updated_at: new Date().toISOString(),
      }, { onConflict: 'business_id,integration_key' });
      await log(db, businessId, integrationKey, 'config_saved', 'ok', 'Configuration saved.');
      return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
    }

    if (action !== 'connect') return new Response(JSON.stringify({ error: 'Unknown action' }), { status: 400 });

    // ---- connect: verify the secret against the REAL provider ----
    const secret: string = typeof body.secret === 'string' && body.secret.trim() ? body.secret.trim() : '';
    const config: Record<string, unknown> = body.config ?? {};

    let effectiveSecret = secret;
    if (integrationKey === 'api_webhooks') {
      if (!secret) effectiveSecret = randomApiKey();
    }
    if (!effectiveSecret) return new Response(JSON.stringify({ error: 'A secret/API key is required' }), { status: 400 });

    const result = await verifySecret(integrationKey, effectiveSecret, config);

    if (!result.ok) {
      await db.from('integrations').upsert({
        business_id: businessId, integration_key: integrationKey,
        status: 'error', error_message: result.message, config,
        permissions: result.permissions, updated_at: new Date().toISOString(),
      }, { onConflict: 'business_id,integration_key' });
      await log(db, businessId, integrationKey, 'connect', 'failed', result.message);
      return new Response(JSON.stringify({ error: result.message, status: 'error' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    // Store the secret pgp-encrypted; delete any previous error state.
    const { error: storeError } = await db.rpc('store_integration_secret', {
      p_business: businessId, p_key: integrationKey, p_secret: effectiveSecret,
    });
    if (storeError) throw storeError;

    const now = new Date().toISOString();
    await db.from('integrations').upsert({
      business_id: businessId, integration_key: integrationKey,
      status: 'connected', error_message: null, config, permissions: result.permissions,
      last_synced_at: now, updated_at: now,
    }, { onConflict: 'business_id,integration_key' });
    await log(db, businessId, integrationKey, 'connect', 'ok', result.message);

    // The ONLY time a secret is surfaced: a newly generated API key the owner
    // must copy. API keys for providers are never echoed back.
    const response: Record<string, unknown> = { ok: true, status: 'connected', message: result.message };
    if (integrationKey === 'api_webhooks') response.apiKey = effectiveSecret;
    return new Response(JSON.stringify(response), { headers: { 'Content-Type': 'application/json' } });
  } catch {
    return new Response(JSON.stringify({ error: 'Integration action failed' }), { status: 500 });
  }
});
