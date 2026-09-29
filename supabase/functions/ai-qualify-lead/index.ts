// Server-side AI Lead Qualification.
// Deploy: supabase functions deploy ai-qualify-lead
// Secrets: supabase secrets set OPENAI_API_KEY=sk-...  (never exposed to the frontend)
// Auth: requires the caller's Supabase JWT; verifies lead belongs to a business
// the caller is a member of. Output is strictly validated and treated as
// SUGGESTIONS ONLY - it never writes to the lead automatically.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const MODEL = 'gpt-4o-mini';

interface Qualification {
  score: number;
  intent: string;
  urgency: string;
  qualification: string;
  summary: string;
  missing_information: string[];
  recommended_action: string;
  suggested_questions: string[];
}

function validate(raw: unknown): Qualification | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const score = Number(r.score);
  if (!Number.isFinite(score) || score < 0 || score > 100) return null;
  const str = (v: unknown, max = 2000) => typeof v === 'string' && v.length > 0 && v.length <= max ? v : null;
  const strArr = (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === 'string') ? (v as string[]).slice(0, 10) : null;
  return {
    score: Math.round(score),
    intent: str(r.intent, 100) ?? 'unknown',
    urgency: str(r.urgency, 100) ?? 'unknown',
    qualification: str(r.qualification, 2000) ?? '',
    summary: str(r.summary, 2000) ?? '',
    missing_information: strArr(r.missing_information) ?? [],
    recommended_action: str(r.recommended_action, 1000) ?? '',
    suggested_questions: strArr(r.suggested_questions) ?? [],
  };
}

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

  // 1) Caller must be authenticated
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  let leadId: string;
  try {
    ({ leadId } = await req.json());
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400 });
  }
  if (!leadId) return new Response(JSON.stringify({ error: 'leadId required' }), { status: 400 });

  // 2) Business-level authorization: lead must belong to a business the user is a member of
  const { data: lead, error: leadError } = await supabase
    .from('leads')
    .select('id, business_id, name, email, phone, company, source, service_interest, status, notes, urgency, budget, intent, created_at')
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

  // 3) Gather context: business profile, notes/interactions
  const [{ data: business }, { data: activities }] = await Promise.all([
    supabase.from('businesses').select('name, industry, description, website').eq('id', lead.business_id).single(),
    supabase.from('activities').select('title, description, created_at').eq('entity_id', leadId).order('created_at', { ascending: false }).limit(20),
  ]);

  const context = {
    lead,
    business: business ?? {},
    recent_activities: (activities ?? []).map((a) => ({ title: a.title, description: a.description, at: a.created_at })),
  };

  const systemPrompt = `You are a lead qualification analyst for a B2C/B2B small business. Analyse the lead against the business profile and history.
Return ONLY valid JSON (no markdown) with exactly these keys:
score (integer 0-100 likelihood to convert), intent (e.g. "ready to buy", "researching", "price shopping"), urgency ("high"|"medium"|"low"), qualification (short verdict: "highly qualified" | "qualified" | "needs more info" | "poor fit"), summary (2-3 sentences), missing_information (array of strings - what we still need to know), recommended_action (one concrete next step), suggested_questions (array of up to 5 questions to ask the lead).
Be conservative: if information is missing, lower the score and list it in missing_information.`;

  let result: Qualification;
  try {
    const key = Deno.env.get('OPENAI_API_KEY');
    if (!key) throw new Error('OPENAI_API_KEY not configured');

    const aiRes = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: JSON.stringify(context) },
        ],
      }),
    });
    if (!aiRes.ok) throw new Error(`OpenAI error ${aiRes.status}`);
    const aiJson = await aiRes.json();
    const parsed = validate(JSON.parse(aiJson.choices[0].message.content));
    if (!parsed) throw new Error('AI response failed validation');
    result = parsed;
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'AI qualification failed', detail: String(err instanceof Error ? err.message : err) }),
      { status: 502 }
    );
  }

  return new Response(JSON.stringify(result), {
    headers: { 'Content-Type': 'application/json' },
  });
});
