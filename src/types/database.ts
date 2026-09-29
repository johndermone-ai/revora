export type UserRole = 'owner' | 'admin' | 'staff';
export type LeadSource = 'website' | 'phone' | 'whatsapp' | 'email' | 'manual' | 'referral' | 'google' | 'social' | 'other';
export type LeadStatus = 'new' | 'contacted' | 'qualified' | 'proposal_sent' | 'negotiation' | 'won' | 'lost';
export type TaskStatus = 'open' | 'in_progress' | 'done' | 'cancelled';
export type FollowUpChannel = 'email' | 'whatsapp' | 'sms';
export type FollowUpStatus = 'draft' | 'pending_approval' | 'approved' | 'scheduled' | 'sent' | 'failed' | 'cancelled';

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
}

export interface Business {
  id: string;
  name: string;
  industry: string | null;
  website: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  timezone: string;
  currency: string;
  logo_url: string | null;
  description: string | null;
  main_goal: string | null;
  employee_count: number | null;
  created_at: string;
}

export interface BusinessMember {
  id: string;
  business_id: string;
  user_id: string;
  role: UserRole;
  created_at: string;
}

export interface Lead {
  id: string;
  business_id: string;
  customer_id: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  source: LeadSource;
  service_interest: string | null;
  status: LeadStatus;
  lead_score: number;
  intent: string | null;
  urgency: string | null;
  budget: string | null;
  notes: string | null;
  assigned_to: string | null;
  last_contacted_at: string | null;
  next_follow_up_at: string | null;
  converted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Customer {
  id: string;
  business_id: string;
  lead_id: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  status: string;
  notes: string | null;
  created_at: string;
}

export interface Activity {
  id: string;
  business_id: string;
  entity_type: 'lead' | 'customer' | 'task' | 'follow_up' | 'automation' | 'ai';
  entity_id: string | null;
  type: string;
  title: string;
  description: string | null;
  user_id: string | null;
  created_at: string;
}

export interface Task {
  id: string;
  business_id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: 'low' | 'medium' | 'high';
  assigned_to: string | null;
  related_lead_id: string | null;
  related_customer_id: string | null;
  due_date: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface FollowUp {
  id: string;
  business_id: string;
  lead_id: string;
  channel: FollowUpChannel;
  status: FollowUpStatus;
  subject: string | null;
  body: string | null;
  ai_generated: boolean;
  scheduled_for: string | null;
  sent_at: string | null;
  error: string | null;
  created_by: string | null;
  approved_by: string | null;
  created_at: string;
}

export interface FollowUpTemplate {
  id: string;
  business_id: string;
  name: string;
  channel: FollowUpChannel;
  subject: string | null;
  body: string;
}

export interface AutomationRule {
  id: string;
  business_id: string;
  name: string;
  enabled: boolean;
  trigger: { type: string; value?: string | number };
  conditions: { type: string; value?: string | number }[];
  action: { type: string; channel?: string; delay_days?: number };
  last_run: string | null;
  next_run: string | null;
  last_error: string | null;
  created_at: string;
}

export interface AiQualification {
  id: string;
  lead_id: string;
  score: number;
  intent: string;
  urgency: string;
  qualification: string;
  summary: string;
  missing_information: string[];
  recommended_action: string;
  suggested_questions: string[];
  model: string | null;
  created_at: string;
}

export interface Notification {
  id: string;
  business_id: string;
  user_id: string;
  title: string;
  body: string | null;
  type: string | null;
  read: boolean;
  created_at: string;
}

export interface Subscription {
  id: string;
  business_id: string;
  plan: string;
  status: string;
  current_period_end: string | null;
}

export const LEAD_STATUSES: { value: LeadStatus; label: string }[] = [
  { value: 'new', label: 'New' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'qualified', label: 'Qualified' },
  { value: 'proposal_sent', label: 'Proposal Sent' },
  { value: 'negotiation', label: 'Negotiation' },
  { value: 'won', label: 'Won' },
  { value: 'lost', label: 'Lost' },
];

export const PIPELINE_STATUSES: LeadStatus[] = ['new', 'contacted', 'qualified', 'proposal_sent', 'negotiation', 'won', 'lost'];

export const LEAD_SOURCES: { value: LeadSource; label: string }[] = [
  { value: 'website', label: 'Website' },
  { value: 'phone', label: 'Phone' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'email', label: 'Email' },
  { value: 'manual', label: 'Manual' },
  { value: 'referral', label: 'Referral' },
  { value: 'google', label: 'Google' },
  { value: 'social', label: 'Social' },
  { value: 'other', label: 'Other' },
];
