import { supabase } from '../lib/supabase';
import type { RecoveryAuditEntry, RevenueOpportunity } from '../types/database';

// ============================================================
// Revenue Recovery service — frontend path. The scan itself runs
// in the recovery-scan edge function (JWT-verified membership);
// every automated step it takes is written to recovery_actions.
// ============================================================

export interface RecoveryStats {
  detected: number;
  actedUpon: number;
  recoveredRevenue: number | null; // null = no recoverable values known
  recoveredCount: number;
  conversionRate: number | null; // recovered / detected
}

export async function runScan(businessId: string): Promise<{ created: number; updated: number; scanned: number }> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not signed in');
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/recovery-scan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ businessId }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.ok) throw new Error(body.error ?? 'Scan failed');
  return { created: body.created ?? 0, updated: body.updated ?? 0, scanned: body.scanned ?? 0 };
}

export async function listOpportunities(businessId: string): Promise<RevenueOpportunity[]> {
  const { data } = await supabase
    .from('revenue_opportunities')
    .select('*')
    .eq('business_id', businessId)
    .order('created_at', { ascending: false });
  return (data as RevenueOpportunity[]) ?? [];
}

export async function listAudit(businessId: string, opportunityId?: string): Promise<RecoveryAuditEntry[]> {
  let q = supabase.from('recovery_actions').select('*').eq('business_id', businessId).order('created_at', { ascending: false }).limit(200);
  if (opportunityId) q = q.eq('opportunity_id', opportunityId);
  const { data } = await q;
  return (data as RecoveryAuditEntry[]) ?? [];
}

export function computeStats(opps: RevenueOpportunity[]): RecoveryStats {
  const detected = opps.filter((o) => o.status !== 'dismissed').length;
  const acted = opps.filter((o) => ['in_progress', 'recovered'].includes(o.status)).length;
  const recovered = opps.filter((o) => o.status === 'recovered');
  const recoveredRevenue = recovered.some((o) => o.estimated_value != null)
    ? recovered.reduce((sum, o) => sum + (o.estimated_value ?? 0), 0)
    : null;
  return {
    detected,
    actedUpon: acted,
    recoveredRevenue,
    recoveredCount: recovered.length,
    conversionRate: detected > 0 ? Math.round((acted / detected) * 100) / 100 : null,
  };
}

async function audit(businessId: string, opportunityId: string, action: string, details: Record<string, unknown>) {
  const { data: { user } } = await supabase.auth.getUser();
  await supabase.from('recovery_actions').insert({
    business_id: businessId,
    opportunity_id: opportunityId,
    actor: 'user',
    user_id: user?.id ?? null,
    action,
    details,
  });
}

export async function markInProgress(businessId: string, opp: RevenueOpportunity) {
  const { error } = await supabase
    .from('revenue_opportunities')
    .update({ status: 'in_progress', last_action_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', opp.id);
  if (error) throw new Error(error.message);
  await audit(businessId, opp.id, 'status_change', { from: opp.status, to: 'in_progress' });
}

export async function markRecovered(businessId: string, opp: RevenueOpportunity) {
  const { error } = await supabase
    .from('revenue_opportunities')
    .update({ status: 'recovered', recovered_at: new Date().toISOString(), last_action_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', opp.id);
  if (error) throw new Error(error.message);
  await audit(businessId, opp.id, 'status_change', { from: opp.status, to: 'recovered' });
  await supabase.from('activities').insert({
    business_id: businessId,
    entity_type: opp.customer_id ? 'customer' : 'lead',
    entity_id: opp.customer_id ?? opp.lead_id ?? opp.id,
    type: 'revenue_recovered',
    title: `Revenue recovered: ${opp.title}`,
    description: opp.estimated_value != null ? `Recovered value: £${opp.estimated_value}` : 'Recovered value unknown',
  });
}

export async function dismiss(businessId: string, opp: RevenueOpportunity) {
  const { error } = await supabase
    .from('revenue_opportunities')
    .update({ status: 'dismissed', dismissed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', opp.id);
  if (error) throw new Error(error.message);
  await audit(businessId, opp.id, 'status_change', { from: opp.status, to: 'dismissed' });
}

/** Take the recommended action: creates a task + follow-up so the recovery work is trackable. */
export async function takeAction(businessId: string, opp: RevenueOpportunity) {
  const actionLabels: Record<string, string> = {
    call: 'Call', email: 'Email', whatsapp: 'WhatsApp', follow_up: 'Follow up', rebooking: 'Rebook', human: 'Personal outreach',
  };
  const kind = opp.ai_recommendation ?? opp.recommended_action;
  const { data: { user } } = await supabase.auth.getUser();
  const { data: task, error } = await supabase
    .from('tasks')
    .insert({
      business_id: businessId,
      title: `${actionLabels[kind] ?? 'Follow up'}: ${opp.title}`,
      description: `${opp.reason} Recommended action: ${kind.replace('_', ' ')}.`,
      status: 'open',
      priority: opp.status === 'action_required' ? 'high' : 'medium',
      assigned_to: user?.id ?? null,
      related_lead_id: opp.lead_id,
      related_customer_id: opp.customer_id,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);

  await markInProgress(businessId, opp);
  await audit(businessId, opp.id, 'action_task_created', {
    action: kind,
    task_id: (task as { id: string })?.id,
  });
  await supabase.from('activities').insert({
    business_id: businessId,
    entity_type: opp.customer_id ? 'customer' : 'lead',
    entity_id: opp.customer_id ?? opp.lead_id ?? opp.id,
    type: 'recovery_action',
    title: `Recovery action taken: ${opp.title}`,
    description: `Recommended action: ${kind.replace('_', ' ')}`,
  });
  return task;
}
