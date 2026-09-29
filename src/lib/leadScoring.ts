import type { Lead } from '../types/database';

// ============================================================
// Transparent, rules-based lead scoring (0-100).
// NOT AI. Each factor and its points are visible to the user.
// ============================================================

export interface ScoreFactor {
  label: string;
  points: number;
  hit: boolean;
}

export function scoreLead(lead: Lead): { score: number; factors: ScoreFactor[] } {
  const factors: ScoreFactor[] = [];

  // 1. Contact information available (up to 25)
  let contact = 0;
  if (lead.email) contact += 12;
  if (lead.phone) contact += 13;
  factors.push({ label: 'Contact information available', points: contact, hit: contact > 0 });

  // 2. Service clearly identified (15)
  const service = Boolean(lead.service_interest && lead.service_interest.trim().length > 0);
  factors.push({ label: 'Service clearly identified', points: service ? 15 : 0, hit: service });

  // 3. Urgency (15)
  let urgencyPoints = 0;
  if (lead.urgency === 'high') urgencyPoints = 15;
  else if (lead.urgency === 'medium') urgencyPoints = 10;
  else if (lead.urgency === 'low') urgencyPoints = 4;
  factors.push({ label: 'Urgency', points: urgencyPoints, hit: Boolean(lead.urgency) });

  // 4. Budget information (15)
  const budget = Boolean(lead.budget && lead.budget.trim().length > 0);
  factors.push({ label: 'Budget information provided', points: budget ? 15 : 0, hit: budget });

  // 5. Engagement: contacted at least once recently (10)
  const engaged =
    lead.last_contacted_at !== null &&
    Date.now() - new Date(lead.last_contacted_at).getTime() < 14 * 24 * 60 * 60 * 1000;
  factors.push({ label: 'Recent engagement (contacted in last 14 days)', points: engaged ? 10 : 0, hit: engaged });

  // 6. Pipeline progression (10)
  let stagePoints = 0;
  if (lead.status === 'qualified' || lead.status === 'proposal_sent') stagePoints = 6;
  else if (lead.status === 'negotiation') stagePoints = 10;
  else if (lead.status === 'won') stagePoints = 10;
  factors.push({ label: 'Pipeline progression', points: stagePoints, hit: stagePoints > 0 });

  // 7. Response behaviour: follow-up scheduled and kept (10)
  const hasFollowUp = Boolean(lead.next_follow_up_at);
  factors.push({ label: 'Follow-up scheduled', points: hasFollowUp ? 10 : 0, hit: hasFollowUp });

  // Base 10 points for being a real lead with a name (all leads start here)
  const score = Math.min(100, 10 + factors.reduce((sum, f) => sum + f.points, 0));
  return { score, factors };
}

export function scoreBand(score: number): { label: string; className: string } {
  if (score >= 75) return { label: 'Hot', className: 'bg-red-50 text-red-700 border-red-200' };
  if (score >= 50) return { label: 'Warm', className: 'bg-amber-50 text-amber-700 border-amber-200' };
  return { label: 'Cold', className: 'bg-sky-50 text-sky-700 border-sky-200' };
}
