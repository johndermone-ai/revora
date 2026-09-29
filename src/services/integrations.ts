import { supabase } from '../lib/supabase';

// ============================================================
// Integrations Hub — generic registry. Adding a provider means
// appending one entry here (plus, if it needs server-side
// verification, a case in integration-manage). Core pages never
// change. Status is NEVER fabricated: it comes from the
// `integrations` table, which is only marked connected after a
// real provider verification succeeded server-side.
// ============================================================

export type IntegrationCategory = 'communication' | 'calendar' | 'crm_data' | 'payments' | 'ai';

export interface IntegrationDef {
  key: string;
  name: string;
  category: IntegrationCategory;
  description: string;
  /** how the card behaves */
  kind: 'api_key' | 'oauth' | 'builtin' | 'link';
  /** non-secret config fields shown on connect */
  configFields?: { name: string; label: string; placeholder?: string; type?: string }[];
  /** secret field label, e.g. 'API key' */
  secretLabel?: string;
  /** what the integration can do — shown as permissions */
  defaultPermissions: string[];
}

export const INTEGRATIONS: IntegrationDef[] = [
  // ---- COMMUNICATION ----
  { key: 'voice', name: 'AI Voice Agent', category: 'communication', description: 'Retell AI / Vapi phone agent: answers calls, qualifies leads, books appointments.', kind: 'link', defaultPermissions: ['Handle inbound calls', 'Create and update leads', 'Book appointments', 'Transfer to a human'] },
  { key: 'sendgrid', name: 'Email — SendGrid', category: 'communication', description: 'Send approved follow-up emails through your SendGrid account.', kind: 'api_key', secretLabel: 'SendGrid API key', defaultPermissions: ['Send email follow-ups'] },
  { key: 'postmark', name: 'Email — Postmark', category: 'communication', description: 'Send approved follow-up emails through your Postmark server.', kind: 'api_key', secretLabel: 'Postmark server token', defaultPermissions: ['Send email follow-ups'] },
  { key: 'twilio', name: 'SMS — Twilio', category: 'communication', description: 'Send SMS follow-ups from your Twilio number.', kind: 'api_key', secretLabel: 'Twilio auth token', configFields: [{ name: 'account_sid', label: 'Account SID' }], defaultPermissions: ['Send SMS follow-ups'] },
  { key: 'twilio_whatsapp', name: 'WhatsApp — Twilio', category: 'communication', description: 'Send WhatsApp follow-ups via your Twilio WhatsApp sender.', kind: 'api_key', secretLabel: 'Twilio auth token', configFields: [{ name: 'account_sid', label: 'Account SID' }], defaultPermissions: ['Send WhatsApp follow-ups'] },

  // ---- CALENDAR ----
  { key: 'google_calendar', name: 'Google Calendar', category: 'calendar', description: 'Two-way appointment sync (OAuth flow activates on first connection).', kind: 'oauth', defaultPermissions: ['Read and write calendar events'] },
  { key: 'outlook_calendar', name: 'Microsoft Outlook Calendar', category: 'calendar', description: 'Two-way appointment sync (OAuth flow activates on first connection).', kind: 'oauth', defaultPermissions: ['Read and write calendar events'] },

  // ---- CRM / DATA ----
  { key: 'csv_import', name: 'CSV import', category: 'crm_data', description: 'Bulk-import leads and customers from CSV files.', kind: 'builtin', defaultPermissions: ['Import lead and customer records'] },
  { key: 'web_forms', name: 'Web forms', category: 'crm_data', description: 'Your hosted lead capture page and embeddable endpoint.', kind: 'builtin', defaultPermissions: ['Create leads from website enquiries'] },
  { key: 'api_webhooks', name: 'API / webhooks', category: 'crm_data', description: 'Push leads into Revora from any external system via signed API key.', kind: 'api_key', secretLabel: 'API key (leave blank to generate one)', defaultPermissions: ['Create leads from external systems'] },

  // ---- PAYMENTS ----
  { key: 'stripe', name: 'Stripe', category: 'payments', description: 'Charge customers and track real revenue from Stripe.', kind: 'api_key', secretLabel: 'Stripe secret key', defaultPermissions: ['Read balance and create payment links'] },

  // ---- AI ----
  { key: 'openai', name: 'OpenAI', category: 'ai', description: 'Lead qualification, follow-up drafting and call summaries.', kind: 'api_key', secretLabel: 'OpenAI API key', defaultPermissions: ['Generate AI summaries and follow-up drafts'] },
];

export interface IntegrationRow {
  id: string;
  business_id: string;
  integration_key: string;
  status: 'disconnected' | 'connected' | 'error';
  config: Record<string, unknown>;
  permissions: string[];
  error_message: string | null;
  last_synced_at: string | null;
}

export interface IntegrationLog {
  id: string;
  business_id: string;
  integration_key: string;
  event: 'connect' | 'disconnect' | 'config_saved' | 'test' | 'sync' | 'error' | 'webhook';
  status: 'ok' | 'failed';
  message: string | null;
  created_at: string;
}

export async function listIntegrations(businessId: string): Promise<IntegrationRow[]> {
  const { data } = await supabase.from('integrations').select('*').eq('business_id', businessId);
  return (data as IntegrationRow[]) ?? [];
}

export async function listIntegrationLogs(businessId: string, limit = 50): Promise<IntegrationLog[]> {
  const { data } = await supabase.from('integration_logs')
    .select('*').eq('business_id', businessId)
    .order('created_at', { ascending: false }).limit(limit);
  return (data as IntegrationLog[]) ?? [];
}

/** Voice status lives on the voice agent, not the integrations table. */
export async function getVoiceStatus(businessId: string): Promise<{ status: string; provider: string | null }> {
  const { data } = await supabase.from('voice_agents').select('status, provider').eq('business_id', businessId).maybeSingle();
  return (data as { status: string; provider: string | null }) ?? { status: 'disconnected', provider: null };
}

async function callManage(businessId: string, action: string, integrationKey: string, extra: Record<string, unknown> = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not signed in');
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/integration-manage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ businessId, action, integrationKey, ...extra }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) throw new Error(body.error ?? 'Integration action failed');
  return body as Record<string, unknown>;
}

export function connectIntegration(businessId: string, integrationKey: string, secret: string, config: Record<string, unknown>) {
  return callManage(businessId, 'connect', integrationKey, { secret, config });
}

export function disconnectIntegration(businessId: string, integrationKey: string) {
  return callManage(businessId, 'disconnect', integrationKey);
}

export function saveIntegrationConfig(businessId: string, integrationKey: string, config: Record<string, unknown>) {
  return callManage(businessId, 'save_config', integrationKey, { config });
}
