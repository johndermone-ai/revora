import { supabase } from '../lib/supabase';
import type { VoiceAgent, VoiceCall, VoiceProvider } from '../types/database';

// ============================================================
// Voice agent service. Settings are read via RLS-protected reads;
// connect/save/disconnect go through the authenticated edge
// function. The provider API key is only ever sent, never
// received back.
// ============================================================

export async function getVoiceAgent(businessId: string): Promise<VoiceAgent | null> {
  const { data } = await supabase.from('voice_agents').select('*').eq('business_id', businessId).maybeSingle();
  return (data as VoiceAgent) ?? null;
}

export async function listCalls(businessId: string, limit = 100): Promise<VoiceCall[]> {
  const { data } = await supabase.from('voice_calls')
    .select('*').eq('business_id', businessId)
    .order('started_at', { ascending: false }).limit(limit);
  return (data as VoiceCall[]) ?? [];
}

export type VoiceSettingsPatch = Partial<Pick<VoiceAgent,
  'agent_name' | 'greeting' | 'business_description' | 'services' | 'faqs' |
  'business_hours' | 'transfer_number' | 'appointment_rules' | 'voice_settings' |
  'behaviour_instructions' | 'handoff_rules' | 'compliance'>>;

export async function saveVoiceSettings(businessId: string, settings: VoiceSettingsPatch): Promise<{ status: string }> {
  return callVoiceConfig(businessId, 'save', { settings });
}

export async function connectProvider(
  businessId: string, provider: VoiceProvider, apiKey: string, settings?: VoiceSettingsPatch
): Promise<{ status: string; provider: string; providerAgentId: string; webhookUrl: string; complianceReminder: string }> {
  return callVoiceConfig(businessId, 'connect', { provider, apiKey, settings });
}

export async function disconnectProvider(businessId: string): Promise<{ status: string }> {
  return callVoiceConfig(businessId, 'disconnect', {});
}

async function callVoiceConfig(businessId: string, action: string, body: Record<string, unknown>) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not signed in');
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/voice-agent-config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ businessId, action, ...body }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(data.error ?? 'Voice configuration failed');
  return data;
}
