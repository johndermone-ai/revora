// Voice agent configuration — authenticated (user JWT + business membership
// verified server-side). Owner/admin only.
//
// API keys NEVER touch the frontend:
//   - The browser sends the key ONCE inside the request body over HTTPS.
//   - It is stored in voice_provider_credentials, which has RLS enabled with
//     NO client policies — only the service role (edge functions) can read it.
//   - The API key is never included in any response.
//
// Actions:
//   save    — persist agent settings (no provider call)
//   connect — save settings + store API key + create/update the agent at the
//             real provider API, then return the webhook URL + secret to paste
//             into the provider console
//   disconnect — mark disconnected (settings kept)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getAdapter, type AgentSettings } from '../_shared/voiceProviders.ts';

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
    const { businessId, action } = body;
    if (!businessId) return new Response(JSON.stringify({ error: 'Missing businessId' }), { status: 400 });

    const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');

    const { data: member } = await db.from('business_members')
      .select('role').eq('business_id', businessId).eq('user_id', user.id).maybeSingle();
    const role = (member as { role: string } | null)?.role;
    if (!role || !['owner', 'admin'].includes(role)) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
    }

    const { data: agentRow } = await db.from('voice_agents')
      .select('*').eq('business_id', businessId).maybeSingle();
    const agent = agentRow as Record<string, never> | null;

    const settingsPatch = body.settings ?? {};
    const allowed = [
      'agent_name', 'greeting', 'business_description', 'services', 'faqs',
      'business_hours', 'transfer_number', 'appointment_rules', 'voice_settings',
      'behaviour_instructions', 'handoff_rules', 'compliance',
    ];
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const k of allowed) if (k in settingsPatch) patch[k] = settingsPatch[k];

    if (action === 'save') {
      await db.from('voice_agents').update(patch).eq('business_id', businessId);
      return new Response(JSON.stringify({ ok: true, status: (agent as { status?: string } | null)?.status ?? 'disconnected' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (action === 'disconnect') {
      await db.from('voice_agents').update({
        status: 'disconnected', provider: null, provider_agent_id: null, status_message: null,
        updated_at: new Date().toISOString(),
      }).eq('business_id', businessId);
      await db.from('voice_provider_credentials').delete().eq('business_id', businessId);
      return new Response(JSON.stringify({ ok: true, status: 'disconnected' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (action !== 'connect') return new Response(JSON.stringify({ error: 'Unknown action' }), { status: 400 });

    // ---- connect ----
    const provider = body.provider === 'retell' || body.provider === 'vapi' ? body.provider : null;
    const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
    if (!provider) return new Response(JSON.stringify({ error: 'Choose a provider: retell or vapi' }), { status: 400 });
    if (!apiKey) return new Response(JSON.stringify({ error: 'API key is required to connect' }), { status: 400 });

    // Save settings first, then read the full merged settings for the provider
    if (Object.keys(patch).length > 0) await db.from('voice_agents').update(patch).eq('business_id', businessId);
    const { data: merged } = await db.from('voice_agents').select('*').eq('business_id', businessId).maybeSingle();
    const m = merged as Record<string, never>;

    const s: AgentSettings = {
      agentName: (m.agent_name as string) ?? 'Receptionist',
      greeting: (m.greeting as string) ?? '',
      businessDescription: (m.business_description as string) ?? '',
      services: (m.services as unknown as string[]) ?? [],
      faqs: (m.faqs as unknown as AgentSettings['faqs']) ?? [],
      businessHours: (m.business_hours as string) ?? '',
      transferNumber: (m.transfer_number as string | null) ?? null,
      appointmentRules: (m.appointment_rules as unknown as AgentSettings['appointmentRules']) ?? {},
      voiceSettings: (m.voice_settings as unknown as AgentSettings['voiceSettings']) ?? {},
      behaviourInstructions: (m.behaviour_instructions as string) ?? '',
      handoffRules: (m.handoff_rules as unknown as string[]) ?? [],
      compliance: (m.compliance as unknown as AgentSettings['compliance']) ?? {},
    };

    const webhookSecret = (m.webhook_secret as string) ?? '';
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const webhookUrl = `${supabaseUrl}/functions/v1/voice-webhook?secret=${webhookSecret}`;

    const adapter = getAdapter(provider);
    const payload = adapter.toAgentPayload(s, webhookUrl);

    const existingProviderAgentId = provider === (m.provider as string | null) ? (m.provider_agent_id as string | null) : null;

    let providerAgentId: string;
    try {
      if (existingProviderAgentId) {
        await adapter.updateAgent(apiKey, existingProviderAgentId, payload);
        providerAgentId = existingProviderAgentId;
      } else {
        providerAgentId = await adapter.createAgent(apiKey, payload);
      }
    } catch (e) {
      await db.from('voice_agents').update({
        status: 'error',
        status_message: e instanceof Error ? e.message : 'Provider connection failed',
        updated_at: new Date().toISOString(),
      }).eq('business_id', businessId);
      return new Response(JSON.stringify({
        error: e instanceof Error ? e.message : 'Provider connection failed',
      }), { status: 502, headers: { 'Content-Type': 'application/json' } });
    }

    // Store the API key where ONLY the service role can read it
    await db.from('voice_provider_credentials').upsert(
      { business_id: businessId, provider, api_key: apiKey, updated_at: new Date().toISOString() },
      { onConflict: 'business_id' }
    );

    await db.from('voice_agents').update({
      provider,
      provider_agent_id: providerAgentId,
      status: 'connected',
      status_message: null,
      last_connected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('business_id', businessId);

    // The response contains everything EXCEPT the API key.
    return new Response(JSON.stringify({
      ok: true,
      status: 'connected',
      provider,
      providerAgentId,
      webhookUrl,
      // Setting compliance notices is the owner's choice and does not by
      // itself make the business compliant — they must also configure the
      // provider-side recording settings accordingly.
      complianceReminder: 'Review recording and AI-disclosure requirements for your region — Revora stores your notices and passes them to the agent, but does not make the business compliant.',
    }), { headers: { 'Content-Type': 'application/json' } });
  } catch {
    return new Response(JSON.stringify({ error: 'Configuration failed' }), { status: 500 });
  }
});
