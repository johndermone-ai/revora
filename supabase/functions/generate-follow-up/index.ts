// Server-side AI follow-up message generation.
// Deploy: supabase functions deploy generate-follow-up
// Secrets: supabase secrets set OPENAI_API_KEY=sk-...
// Returns a DRAFT only. The app will NEVER send without explicit user approval
// or an approved automation rule. Sending is a separate future integration.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const MODEL = 'gpt-4o-mini';

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  let body: { leadId?: string; desiredAction?: string; tone?: string; channel?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400 });
  }
  const { leadId, desiredAction = 'move the conversation forward', tone = 'friendly and professional', channel = 'email' } = body;
  if (!leadId) return new Response(JSON.stringify({ error: 'leadId required' }), { status: 400 });

  const { data: lead, error: leadError } = await supabase
    .from('leads')
    .select('id, business_id, name, email, status, service_interest, notes, last_contacted_at')
    .eq('id', leadId)
    .single();
  if (leadError || !lead) {
    return new Response(JSON.stringify({ error: 'Lead not found' }), { status: 404 });
  }

  const { data: membership } = await supabase
    .from('business_members')
    .select('id')
    .eq('business_id', lead.business_id)
    .eq('user_id', userData.user.id)
    .maybeSingle();
  if (!membership) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
  }

  const [{ data: business }, { data: history }] = await Promise.all([
    supabase.from('businesses').select('name, industry, description, phone').eq('id', lead.business_id).single(),
    supabase.from('follow_ups').select('subject, body, status, sent_at').eq('lead_id', leadId).order('created_at', { ascending: false }).limit(5),
  ]);

  const systemPrompt = `You write concise, personalised follow-up messages for a small business to send to a warm lead.
Return ONLY valid JSON with keys: subject (string, empty for whatsapp/sms), body (string, under 160 words, plain text, no placeholders like [Name], use the actual details given).
Desired action: ${desiredAction}. Tone: ${tone}. Channel: ${channel}.
Reference previous messages only if provided. Never invent facts about the lead or the business.`;

  try {
    const key = Deno.env.get('OPENAI_API_KEY');
    if (!key) throw new Error('OPENAI_API_KEY not configured');

    const aiRes = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.4,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: JSON.stringify({ lead, business: business ?? {}, previous_follow_ups: history ?? [] }) },
        ],
      }),
    });
    if (!aiRes.ok) throw new Error(`OpenAI error ${aiRes.status}`);
    const aiJson = await aiRes.json();
    const content = JSON.parse(aiJson.choices[0].message.content);
    if (typeof content.body !== 'string' || content.body.length === 0) throw new Error('Invalid AI output');
    return new Response(JSON.stringify({ subject: typeof content.subject === 'string' ? content.subject : '', body: content.body }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'Generation failed', detail: String(err instanceof Error ? err.message : err) }),
      { status: 502 }
    );
  }
});
