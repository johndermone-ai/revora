import { supabase } from '../lib/supabase';
import type { Appointment, Customer, FollowUp, Lead, RevenueOpportunity } from '../types/database';

// ============================================================
// Revenue Analytics — computed from REAL database rows only.
// RULES (honest analytics, no manufactured statistics):
//   - A metric is null when the data to compute it does not exist.
//   - The UI renders null as "—" with an explanatory hint, never 0
//     pretending to be a measured zero.
//   - Actual revenue requires a payments/invoicing source, which is
//     not implemented — shown as unavailable, not estimated.
//   - Estimated value / recovered revenue only sum values the LEAD
//     provided (budget field); "Value unknown" otherwise.
// ============================================================

export type PeriodPreset = 'today' | '7d' | '30d' | '90d' | 'custom';

export interface Period {
  start: Date;
  end: Date;
  preset: PeriodPreset;
}

function startOfDayUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function makePeriod(preset: PeriodPreset, customFrom?: string, customTo?: string): Period {
  const today = startOfDayUTC(new Date());
  const tomorrow = new Date(today.getTime() + 86_400_000);
  switch (preset) {
    case 'today': return { start: today, end: tomorrow, preset };
    case '7d': return { start: new Date(today.getTime() - 6 * 86_400_000), end: tomorrow, preset };
    case '30d': return { start: new Date(today.getTime() - 29 * 86_400_000), end: tomorrow, preset };
    case '90d': return { start: new Date(today.getTime() - 89 * 86_400_000), end: tomorrow, preset };
    case 'custom': {
      const start = customFrom ? new Date(`${customFrom}T00:00:00Z`) : today;
      const end = customTo ? new Date(`${customTo}T00:00:00Z`) : tomorrow;
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
        return { start: today, end: tomorrow, preset };
      }
      return { start, end: new Date(end.getTime() + 86_400_000), preset };
    }
  }
}

export interface LeadMetrics {
  totalAllTime: number;
  newLeads: number;            // created in period
  qualified: number;           // created in period, reached qualified+ stage (current status)
  won: number;                 // converted in period
  lost: number;                // lost with last update in period
  conversionRate: number | null; // won / (won + lost), null when no closed outcomes
  buckets: { label: string; count: number }[]; // created over time, for the chart
}

export interface VoiceMetrics {
  // agentConnected=false means no voice provider is connected yet — the
  // UI shows "—" with a hint instead of implying a measured zero.
  agentConnected: boolean;
  totalCalls: number | null;
  answeredCalls: number | null;
  missedCalls: number | null;
  transfers: number | null;
  // Real once calls flow: leads linked from voice calls, and appointments
  // booked with created_source 'ai_voice' (voice flow or post-call pipeline).
  leadsGenerated: number;
  appointmentsGenerated: number;
}

export interface SalesMetrics {
  proposalsSent: number;           // leads that reached proposal stage (created in period)
  proposalsAccepted: number;      // leads converted in period
  avgConversionDays: number | null; // mean(converted_at - created_at) for conversions in period
  followUpsCreated: number;
  followUpsSent: number;          // only counts real sends (sent_at set)
  followUpSendRate: number | null;
  overdueFollowUps: number;
}

export interface RecoveryMetrics {
  detected: number;
  recovered: number;
  recoveredRevenueKnown: boolean;
  recoveredRevenue: number;       // sums LEAD-provided values only
  openEstimatedValue: number;     // open opportunities, LEAD-provided values only
  openValueKnown: boolean;
}

export interface CustomerMetrics {
  newCustomers: number;
  returningCustomers: number;     // 2+ appointments ever
  inactiveCustomers: number;      // no activity or appointment for 90+ days
}

export interface AnalyticsData {
  leads: LeadMetrics;
  voice: VoiceMetrics;
  sales: SalesMetrics;
  recovery: RecoveryMetrics;
  customers: CustomerMetrics;
  // Chart is only meaningful with real points; page checks these.
  hasChartData: boolean;
}

const QUALIFIED_PLUS = ['qualified', 'proposal_sent', 'negotiation', 'won'];

export async function loadAnalytics(businessId: string, period: Period): Promise<AnalyticsData> {
  const startIso = period.start.toISOString();
  const endIso = period.end.toISOString();

  // ---- leads (in period + all-time total) ----
  const [{ data: periodLeads }, { count: totalAllTime }] = await Promise.all([
    supabase.from('leads').select('id, created_at, status, converted_at')
      .eq('business_id', businessId).gte('created_at', startIso).lt('created_at', endIso),
    supabase.from('leads').select('id', { count: 'exact', head: true }).eq('business_id', businessId),
  ]);
  const leads = (periodLeads as Lead[]) ?? [];

  const newLeads = leads.length;
  const qualified = leads.filter((l) => QUALIFIED_PLUS.includes(l.status)).length;

  // Won: conversions with converted_at in period (fetch regardless of created date)
  const { data: wonLeads } = await supabase.from('leads')
    .select('id, created_at, converted_at, status')
    .eq('business_id', businessId)
    .gte('converted_at', startIso)
    .lt('converted_at', endIso);
  const won = (wonLeads as Lead[]) ?? [];

  const { count: lostCount } = await supabase.from('leads')
    .select('id', { count: 'exact', head: true })
    .eq('business_id', businessId).eq('status', 'lost')
    .gte('updated_at', startIso).lt('updated_at', endIso);
  const lost = lostCount ?? 0;

  const closed = won.length + lost;
  const conversionRate = closed > 0 ? Math.round((won.length / closed) * 100) : null;

  // buckets for the chart
  const ms = period.end.getTime() - period.start.getTime();
  const dayCount = Math.max(1, Math.round(ms / 86_400_000));
  const bucketCount = dayCount <= 1 ? 1 : dayCount <= 31 ? dayCount : Math.min(12, Math.ceil(dayCount / 7));
  const bucketMs = ms / bucketCount;
  const buckets = Array.from({ length: bucketCount }, (_, i) => ({
    from: period.start.getTime() + i * bucketMs,
    to: period.start.getTime() + (i + 1) * bucketMs,
    count: 0,
  }));
  for (const l of leads) {
    const t = new Date(l.created_at).getTime();
    const b = buckets.find((x) => t >= x.from && t < x.to);
    if (b) b.count += 1;
  }

  // ---- sales ----
  const proposalsSent = newLeads > 0
    ? leads.filter((l) => ['proposal_sent', 'negotiation', 'won'].includes(l.status)).length
    : 0;
  const avgConversionDays = won.length > 0
    ? won.reduce((sum, l) => sum + (new Date(l.converted_at!).getTime() - new Date(l.created_at).getTime()), 0) / won.length / 86_400_000
    : null;

  const [{ data: followUps }, { count: overdueCount }] = await Promise.all([
    supabase.from('follow_ups').select('id, status, sent_at, created_at')
      .eq('business_id', businessId).gte('created_at', startIso).lt('created_at', endIso),
    supabase.from('leads').select('id', { count: 'exact', head: true })
      .eq('business_id', businessId).not('next_follow_up_at', 'is', null)
      .lt('next_follow_up_at', new Date().toISOString())
      .not('status', 'in', '("won","lost")'),
  ]);
  const fus = (followUps as FollowUp[]) ?? [];
  const followUpsCreated = fus.length;
  const followUpsSent = fus.filter((f) => f.sent_at != null).length;
  const followUpSendRate = followUpsCreated > 0 ? Math.round((followUpsSent / followUpsCreated) * 100) : null;

  // ---- appointments (for voice + customer metrics) ----
  const { data: allAppts } = await supabase.from('appointments')
    .select('id, status, customer_id, lead_id, created_source, start_at')
    .eq('business_id', businessId);
  const appts = (allAppts as Appointment[]) ?? [];
  const apptsInPeriod = appts.filter((a) => a.start_at >= startIso && a.start_at < endIso);
  const voiceAppts = apptsInPeriod.filter((a) => a.created_source === 'ai_voice');
  const voiceLeadIds = new Set(voiceAppts.map((a) => a.lead_id).filter(Boolean) as string[]);

  // ---- voice calls (real records once the voice provider is connected) ----
  const [{ data: voiceAgentRow }, { data: voiceCallsRows }] = await Promise.all([
    supabase.from('voice_agents').select('id, status').eq('business_id', businessId).maybeSingle(),
    supabase.from('voice_calls').select('id, started_at, answered_at, ended_at, lead_id, outcome')
      .eq('business_id', businessId).gte('started_at', startIso).lt('started_at', endIso),
  ]);
  const voiceAgent = voiceAgentRow as { status: string } | null;
  const agentConnected = voiceAgent?.status === 'connected';
  const voiceCalls = (voiceCallsRows as { id: string; answered_at: string | null; ended_at: string | null; lead_id: string | null; outcome: string | null }[]) ?? [];
  const voiceCallLeadIds = new Set(voiceCalls.map((c) => c.lead_id).filter(Boolean) as string[]);

  // ---- recovery ----
  const { data: opps } = await supabase.from('revenue_opportunities')
    .select('id, status, estimated_value, detected_at, recovered_at')
    .eq('business_id', businessId);
  const opportunities = (opps as RevenueOpportunity[]) ?? [];
  const detectedInPeriod = opportunities.filter((o) => o.detected_at >= startIso && o.detected_at < endIso);
  const recoveredInPeriod = opportunities.filter((o) => o.recovered_at != null && o.recovered_at >= startIso && o.recovered_at < endIso);
  const openOpps = opportunities.filter((o) => !['recovered', 'dismissed'].includes(o.status));

  const recoveredValues = recoveredInPeriod.map((o) => o.estimated_value);
  const openValues = openOpps.map((o) => o.estimated_value);
  const sumKnown = (vals: (number | null)[]) =>
    vals.reduce<number>((s, v) => s + (v ?? 0), 0);

  // ---- customers ----
  const [{ data: customers }, { data: customerActivities }] = await Promise.all([
    supabase.from('customers').select('id, created_at').eq('business_id', businessId),
    supabase.from('activities').select('customer_id, created_at')
      .eq('business_id', businessId).not('customer_id', 'is', null),
  ]);
  const allCustomers = (customers as Customer[]) ?? [];
  const newCustomers = allCustomers.filter((c) => c.created_at >= startIso && c.created_at < endIso).length;

  const apptCountByCustomer = new Map<string, number>();
  for (const a of appts) if (a.customer_id) apptCountByCustomer.set(a.customer_id, (apptCountByCustomer.get(a.customer_id) ?? 0) + 1);
  const returningCustomers = [...apptCountByCustomer.values()].filter((n) => n >= 2).length;

  const lastActivityByCustomer = new Map<string, number>();
  for (const act of (customerActivities as { customer_id: string; created_at: string }[]) ?? []) {
    const t = new Date(act.created_at).getTime();
    lastActivityByCustomer.set(act.customer_id, Math.max(lastActivityByCustomer.get(act.customer_id) ?? 0, t));
  }
  const ninetyDaysAgo = Date.now() - 90 * 86_400_000;
  const inactiveCustomers = allCustomers.filter((c) => {
    const lastAppt = Math.max(0, ...appts.filter((a) => a.customer_id === c.id).map((a) => new Date(a.start_at).getTime()));
    const lastAct = lastActivityByCustomer.get(c.id) ?? 0;
    return Math.max(lastAppt, lastAct, new Date(c.created_at).getTime()) < ninetyDaysAgo;
  }).length;

  return {
    leads: { totalAllTime: totalAllTime ?? 0, newLeads, qualified, won: won.length, lost, conversionRate, buckets: buckets.map((b, i) => ({ label: bucketLabel(b.from, dayCount, bucketCount, i), count: b.count })) },
    voice: {
      agentConnected,
      totalCalls: agentConnected ? voiceCalls.length : null,
      answeredCalls: agentConnected ? voiceCalls.filter((c) => c.answered_at != null).length : null,
      missedCalls: agentConnected ? voiceCalls.filter((c) => c.answered_at == null && c.ended_at != null).length : null,
      transfers: agentConnected ? voiceCalls.filter((c) => c.outcome === 'human_transfer').length : null,
      leadsGenerated: new Set([...voiceCallLeadIds, ...voiceLeadIds]).size,
      appointmentsGenerated: voiceAppts.length,
    },
    sales: {
      proposalsSent,
      proposalsAccepted: won.length,
      avgConversionDays: avgConversionDays != null ? Math.round(avgConversionDays * 10) / 10 : null,
      followUpsCreated, followUpsSent, followUpSendRate,
      overdueFollowUps: overdueCount ?? 0,
    },
    recovery: {
      detected: detectedInPeriod.length,
      recovered: recoveredInPeriod.length,
      recoveredRevenueKnown: recoveredValues.length > 0 && recoveredValues.some((v) => v != null),
      recoveredRevenue: sumKnown(recoveredValues),
      openEstimatedValue: sumKnown(openValues),
      openValueKnown: openValues.some((v) => v != null),
    },
    customers: { newCustomers, returningCustomers, inactiveCustomers },
    hasChartData: newLeads > 0 && bucketCount > 1,
  };
}

function bucketLabel(fromMs: number, dayCount: number, bucketCount: number, _i: number): string {
  const d = new Date(fromMs);
  if (dayCount <= 31) return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}
