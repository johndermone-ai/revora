import { supabase } from '../lib/supabase';
import type { Lead, LeadStatus, LeadSource, Activity, Customer, AiQualification, FollowUp } from '../types/database';
import { scoreLead } from '../lib/leadScoring';

export async function logActivity(
  businessId: string,
  entity_type: Activity['entity_type'],
  entity_id: string | null,
  type: string,
  title: string,
  description?: string
) {
  const { data: { user } } = await supabase.auth.getUser();
  await supabase.from('activities').insert({
    business_id: businessId, entity_type, entity_id, type, title,
    description: description ?? null, user_id: user?.id ?? null,
  });
}

export async function createLead(businessId: string, input: {
  name: string; email?: string | null; phone?: string | null; company?: string | null;
  source: LeadSource; service_interest?: string | null; notes?: string | null;
  urgency?: string | null; budget?: string | null; next_follow_up_at?: string | null;
}): Promise<Lead> {
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('leads')
    .insert({
      business_id: businessId,
      name: input.name,
      email: input.email ?? null,
      phone: input.phone ?? null,
      company: input.company ?? null,
      source: input.source,
      service_interest: input.service_interest ?? null,
      notes: input.notes ?? null,
      urgency: input.urgency ?? null,
      budget: input.budget ?? null,
      next_follow_up_at: input.next_follow_up_at ?? null,
      assigned_to: user?.id ?? null,
      status: 'new',
      lead_score: 0,
    })
    .select()
    .single();
  if (error || !data) throw new Error(error?.message ?? 'Could not create lead');
  const lead = data as Lead;
  const { score } = scoreLead(lead);
  const { data: scored } = await supabase.from('leads').update({ lead_score: score }).eq('id', lead.id).select().single();
  await logActivity(businessId, 'lead', lead.id, 'created', `New lead created: ${lead.name}`, `Source: ${lead.source}`);
  return (scored as Lead) ?? lead;
}

export async function updateLead(businessId: string, leadId: string, patch: Partial<Lead>): Promise<Lead> {
  const { data, error } = await supabase
    .from('leads')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', leadId)
    .select()
    .single();
  if (error || !data) throw new Error(error?.message ?? 'Could not update lead');
  return data as Lead;
}

export async function changeStatus(businessId: string, lead: Lead, status: LeadStatus) {
  const patch: Partial<Lead> = { status };
  if (status === 'contacted') patch.last_contacted_at = new Date().toISOString();
  const updated = await updateLead(businessId, lead.id, patch);
  await logActivity(businessId, 'lead', lead.id, 'status_changed', `${lead.name} moved to ${status.replace('_', ' ')}`);
  return updated;
}

// Rescore with the transparent rules-based model
export async function rescoreLead(businessId: string, lead: Lead) {
  const { score } = scoreLead(lead);
  const updated = await updateLead(businessId, lead.id, { lead_score: score });
  await logActivity(businessId, 'lead', lead.id, 'score_updated', `Lead score recalculated: ${score}/100`);
  return updated;
}

// Convert: create/update the customer record, preserve full lead history, record timestamp.
export async function convertLeadToCustomer(businessId: string, lead: Lead): Promise<Customer> {
  const now = new Date().toISOString();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: existing } = await supabase
    .from('customers')
    .select('*')
    .eq('business_id', businessId)
    .eq('lead_id', lead.id)
    .maybeSingle();

  if (existing) {
    const { data: updated, error } = await supabase
      .from('customers')
      .update({ name: lead.name, email: lead.email, phone: lead.phone, company: lead.company })
      .eq('id', existing.id)
      .select()
      .single();
    if (error || !updated) throw new Error(error?.message ?? 'Conversion failed');
    return updated as Customer;
  }

  const { data: customer, error } = await supabase
    .from('customers')
    .insert({
      business_id: businessId,
      lead_id: lead.id,
      name: lead.name,
      email: lead.email,
      phone: lead.phone,
      company: lead.company,
      notes: lead.notes,
      status: 'active',
    })
    .select()
    .single();
  if (error || !customer) throw new Error(error?.message ?? 'Conversion failed');

  // Link the lead to the customer and stamp the conversion time.
  // Lead row is never deleted - the full history is preserved.
  await supabase
    .from('leads')
    .update({ customer_id: customer.id, converted_at: now, status: 'won', updated_at: now })
    .eq('id', lead.id);

  await logActivity(businessId, 'lead', lead.id, 'converted', `${lead.name} converted to customer`, `Converted by ${user?.email ?? 'user'}`);
  await logActivity(businessId, 'customer', customer.id, 'created', `Customer created from lead ${lead.name}`);
  return customer as Customer;
}

// ---------- AI qualification ----------
export async function runAiQualification(businessId: string, lead: Lead): Promise<AiQualification> {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-qualify-lead`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session?.access_token ?? ''}`,
    },
    body: JSON.stringify({ leadId: lead.id }),
  });
  if (!res.ok) {
    let detail = 'AI qualification is unavailable right now.';
    try {
      const body = await res.json();
      if (body?.detail) detail = `${detail} (${body.detail})`;
    } catch { /* keep default */ }
    throw new Error(detail);
  }
  const result = await res.json();
  // Persist + activity record. NOTE: the lead row itself is NOT modified automatically -
  // AI output is a suggestion the user must act on.
  const { data, error } = await supabase
    .from('ai_qualifications')
    .insert({
      business_id: businessId,
      lead_id: lead.id,
      score: result.score,
      intent: result.intent,
      urgency: result.urgency,
      qualification: result.qualification,
      summary: result.summary,
      missing_information: result.missing_information,
      recommended_action: result.recommended_action,
      suggested_questions: result.suggested_questions,
      model: 'gpt-4o-mini',
    })
    .select()
    .single();
  if (error) throw new Error('Could not save qualification result.');
  await logActivity(businessId, 'ai', lead.id, 'ai_qualification', `AI qualification generated for ${lead.name}`, `Score: ${result.score}/100 - ${result.qualification}`);
  return data as AiQualification;
}

// ---------- Follow-ups ----------
export async function generateFollowUpDraft(businessId: string, lead: Lead, desiredAction: string, channel: FollowUp['channel']) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-follow-up`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` },
    body: JSON.stringify({ leadId: lead.id, desiredAction, channel }),
  });
  if (!res.ok) {
    let detail = 'Message generation is unavailable right now.';
    try { const b = await res.json(); if (b?.detail) detail = `${detail} (${b.detail})`; } catch { /* ignore */ }
    throw new Error(detail);
  }
  const { subject, body } = await res.json();
  // Save as DRAFT only - sending requires explicit approval.
  const { data, error } = await supabase
    .from('follow_ups')
    .insert({
      business_id: businessId, lead_id: lead.id, channel, status: 'draft',
      subject: subject ?? null, body, ai_generated: true,
    })
    .select()
    .single();
  if (error || !data) throw new Error('Could not save the draft.');
  await logActivity(businessId, 'follow_up', lead.id, 'ai_generated', `AI follow-up drafted for ${lead.name}`);
  return data as FollowUp;
}

export async function saveFollowUp(followUpId: string, patch: Partial<FollowUp>) {
  const { data, error } = await supabase
    .from('follow_ups')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', followUpId)
    .select()
    .single();
  if (error || !data) throw new Error(error?.message ?? 'Could not update follow-up');
  return data as FollowUp;
}

// Approve: marks the follow-up as approved. Actual sending requires a configured
// channel integration - until one exists this records the approval honestly and
// never pretends a message was delivered.
export async function approveFollowUp(businessId: string, followUp: FollowUp) {
  const updated = await saveFollowUp(followUp.id, { status: 'approved', approved_by: (await supabase.auth.getUser()).data.user?.id ?? null });
  await logActivity(businessId, 'follow_up', followUp.lead_id, 'approved', 'Follow-up approved', 'Delivery pending email provider integration.');
  return updated;
}

export async function scheduleFollowUp(businessId: string, followUp: FollowUp, scheduledFor: string) {
  const updated = await saveFollowUp(followUp.id, { status: 'scheduled', scheduled_for: scheduledFor });
  await logActivity(businessId, 'follow_up', followUp.lead_id, 'scheduled', `Follow-up scheduled for ${new Date(scheduledFor).toLocaleString('en-GB')}`);
  return updated;
}

export async function cancelFollowUp(businessId: string, followUp: FollowUp) {
  const updated = await saveFollowUp(followUp.id, { status: 'cancelled' });
  await logActivity(businessId, 'follow_up', followUp.lead_id, 'cancelled', 'Follow-up cancelled');
  return updated;
}
