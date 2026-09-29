// Public lead capture endpoint for website embedding.
// Deploy: supabase functions deploy capture-lead --no-verify-jwt
//
// This is the ONLY intentionally public write path in Revora. It inserts a
// lead for a given business WITHOUT a user JWT (website visitors are not
// logged in). Security: strict input validation, a honeypot field for bots,
// a simple per-IP rate limit, and no secrets are exposed. The lead is always
// created with source = 'website' and status = 'new' - nothing else.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

interface CaptureBody {
  businessId?: string;
  name?: string;
  email?: string;
  phone?: string;
  service_interest?: string;
  notes?: string;
  website?: string; // honeypot - real users never fill this
}

const rateLimit = new Map<string, { count: number; reset: number }>();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 5;

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimit.get(ip);
  if (!entry || entry.reset < now) {
    rateLimit.set(ip, { count: 1, reset: now + WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_PER_WINDOW;
}

function clean(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (t.length === 0 || t.length > max) return null;
  return t;
}

Deno.serve(async (req) => {
  if (req.method === 'POST') {
    try {
      const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
      if (rateLimited(ip)) {
        return new Response(JSON.stringify({ error: 'Too many requests' }), {
          status: 429,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }

      const body = (await req.json()) as CaptureBody;

      // Honeypot: bots fill hidden fields; silently accept and discard.
      if (body.website) {
        return new Response(JSON.stringify({ ok: true }), {
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }

      const businessId = clean(body.businessId, 64);
      const name = clean(body.name, 200);
      const email = clean(body.email, 200);
      const phone = clean(body.phone, 50);
      const service = clean(body.service_interest, 200);
      const notes = clean(body.notes, 2000);

      if (!businessId || !name || (!email && !phone)) {
        return new Response(JSON.stringify({ error: 'Name plus email or phone is required' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return new Response(JSON.stringify({ error: 'Invalid email' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }

      const serviceClient = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
      );

      // Verify the business actually exists before inserting.
      const { data: biz } = await serviceClient
        .from('businesses')
        .select('id, name')
        .eq('id', businessId)
        .single();
      if (!biz) {
        return new Response(JSON.stringify({ error: 'Business not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }

      // Insert the lead. Website leads are always status 'new', source 'website'.
      const { error } = await serviceClient.from('leads').insert({
        business_id: businessId,
        name,
        email,
        phone,
        service_interest: service,
        notes,
        source: 'website',
        status: 'new',
        lead_score: 10, // transparent base score
      });
      if (error) throw error;

      // Activity record (service role: visitor has no JWT)
      await serviceClient.from('activities').insert({
        business_id: businessId,
        entity_type: 'lead',
        type: 'website_capture',
        title: `Website lead captured: ${name}`,
        description: service ? `Interested in: ${service}` : 'Via website capture form',
      });

      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    } catch {
      return new Response(JSON.stringify({ error: 'Could not capture lead' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }
  }

  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
});
