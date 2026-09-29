import { supabase } from '../lib/supabase';
import type {
  Appointment, AppointmentStatus, AvailabilityRule, BookingSettings,
  CalendarEntity, Lead,
} from '../types/database';
import {
  DEFAULT_BOOKING_CONFIG, nextAvailableSlots, slotsForDay, validateSlot,
  type AvailabilityRule as EngineRule, type BookedSlot, type BookingConfig,
} from '../../supabase/functions/_shared/bookingEngine';
import { logActivity } from './leads';

// ============================================================
// Appointment service — staff UI path. The AI voice / website
// path runs through the book-appointment edge function, which
// imports the SAME bookingEngine module. One engine, all channels.
// ============================================================

async function getBookingConfig(businessId: string): Promise<{ config: BookingConfig; rules: EngineRule[]; calendar: CalendarEntity | null }> {
  const [{ data: settings }, { data: rules }, { data: calendars }] = await Promise.all([
    supabase.from('booking_settings').select('*').eq('business_id', businessId).maybeSingle(),
    supabase.from('availability_rules').select('day_of_week, start_time, end_time, staff_user_id').eq('business_id', businessId),
    supabase.from('calendars').select('*').eq('business_id', businessId).eq('is_default', true).maybeSingle(),
  ]);
  const s = settings as BookingSettings | null;
  const config: BookingConfig = s
    ? {
        slot_duration_minutes: s.slot_duration_minutes,
        buffer_minutes: s.buffer_minutes,
        min_notice_minutes: s.min_notice_minutes,
        max_booking_days: s.max_booking_days,
        holidays: s.holidays ?? [],
      }
    : { ...DEFAULT_BOOKING_CONFIG };
  return {
    config,
    rules: ((rules as AvailabilityRule[]) ?? []).map((r) => ({
      day_of_week: r.day_of_week,
      start_time: r.start_time,
      end_time: r.end_time,
      staff_user_id: r.staff_user_id,
    })),
    calendar: (calendars as CalendarEntity) ?? null,
  };
}

async function getBookedSlots(businessId: string, from: Date, to: Date, excludeId?: string): Promise<BookedSlot[]> {
  let q = supabase
    .from('appointments')
    .select('start_at, end_at')
    .eq('business_id', businessId)
    .in('status', ['requested', 'confirmed', 'rescheduled'])
    .gte('start_at', from.toISOString())
    .lt('start_at', to.toISOString());
  if (excludeId) q = q.neq('id', excludeId);
  const { data } = await q;
  return ((data as { start_at: string; end_at: string }[]) ?? []).map((r) => ({ start_at: r.start_at, end_at: r.end_at }));
}

/** Available slots for a single day, computed with the shared engine. */
export async function availableSlotsForDay(businessId: string, date: Date): Promise<Date[]> {
  const { config, rules } = await getBookingConfig(businessId);
  const from = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const to = new Date(from.getTime() + 86_400_000);
  const booked = await getBookedSlots(businessId, from, to);
  return slotsForDay(date, rules, booked, config);
}

/** Next available slots for AI-assisted / quick booking pickers. */
export async function nextSlots(businessId: string, count = 5): Promise<Date[]> {
  const { config, rules } = await getBookingConfig(businessId);
  const booked = await getBookedSlots(
    businessId,
    new Date(),
    new Date(Date.now() + config.max_booking_days * 86_400_000)
  );
  return nextAvailableSlots(new Date(), rules, booked, config, count);
}

export interface CreateAppointmentInput {
  title: string;
  startAt: Date;
  leadId?: string | null;
  customerId?: string | null;
  location?: string | null;
  notes?: string | null;
  source?: Appointment['created_source'];
  /** Skip availability validation (e.g. manual override by admin) */
  force?: boolean;
}

export async function createAppointment(businessId: string, input: CreateAppointmentInput): Promise<Appointment> {
  const { config, rules, calendar } = await getBookingConfig(businessId);
  const now = new Date();
  const booked = await getBookedSlots(businessId, input.startAt, new Date(input.startAt.getTime() + 86_400_000));

  if (!input.force) {
    const check = validateSlot(input.startAt, rules, booked, config, now);
    if (!check.ok) throw new Error(check.reason);
  }

  const endAt = new Date(input.startAt.getTime() + config.slot_duration_minutes * 60_000);
  const settings = await getBookingSettings(businessId);
  const status: AppointmentStatus = settings?.auto_confirm ? 'confirmed' : 'requested';

  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('appointments')
    .insert({
      business_id: businessId,
      calendar_id: calendar?.id ?? null,
      lead_id: input.leadId ?? null,
      customer_id: input.customerId ?? null,
      title: input.title,
      status,
      start_at: input.startAt.toISOString(),
      end_at: endAt.toISOString(),
      duration_minutes: config.slot_duration_minutes,
      location: input.location ?? null,
      notes: input.notes ?? null,
      created_source: input.source ?? 'manual',
      created_by: user?.id ?? null,
    })
    .select()
    .single();
  if (error || !data) throw new Error(error?.message ?? 'Could not create appointment');

  const appt = data as Appointment;
  await logActivity(businessId, 'lead', appt.lead_id ?? null, 'appointment_created',
    `Appointment booked: ${appt.title}`, `${appt.start_at} (${status})`);
  return appt;
}

export async function getBookingSettings(businessId: string): Promise<BookingSettings | null> {
  const { data } = await supabase.from('booking_settings').select('*').eq('business_id', businessId).maybeSingle();
  return (data as BookingSettings) ?? null;
}

export async function updateBookingSettings(businessId: string, patch: Partial<BookingSettings>) {
  const { error } = await supabase.from('booking_settings').update(patch).eq('business_id', businessId);
  if (error) throw new Error(error.message);
}

export async function getAvailabilityRules(businessId: string): Promise<AvailabilityRule[]> {
  const { data } = await supabase.from('availability_rules').select('*').eq('business_id', businessId).order('day_of_week');
  return (data as AvailabilityRule[]) ?? [];
}

export async function replaceAvailabilityRules(businessId: string, rules: { day_of_week: number; start_time: string; end_time: string }[]) {
  const { error: delError } = await supabase.from('availability_rules').delete().eq('business_id', businessId);
  if (delError) throw new Error(delError.message);
  if (rules.length > 0) {
    const { error } = await supabase.from('availability_rules').insert(
      rules.map((r) => ({ business_id: businessId, ...r }))
    );
    if (error) throw new Error(error.message);
  }
}

export async function confirmAppointment(businessId: string, appt: Appointment) {
  const { data, error } = await supabase
    .from('appointments').update({ status: 'confirmed', updated_at: new Date().toISOString() })
    .eq('id', appt.id).select().single();
  if (error) throw new Error(error.message);
  await logActivity(businessId, 'lead', appt.lead_id ?? appt.id, 'appointment_confirmed', `Appointment confirmed: ${appt.title}`);
  return data as Appointment;
}

export async function rescheduleAppointment(businessId: string, appt: Appointment, newStart: Date) {
  const { config, rules } = await getBookingConfig(businessId);
  const booked = await getBookedSlots(
    businessId, newStart, new Date(newStart.getTime() + 86_400_000), appt.id
  );
  const check = validateSlot(newStart, rules, booked, config, new Date());
  if (!check.ok) throw new Error(check.reason);
  const endAt = new Date(newStart.getTime() + config.slot_duration_minutes * 60_000);
  const { data, error } = await supabase
    .from('appointments')
    .update({
      status: 'rescheduled',
      start_at: newStart.toISOString(),
      end_at: endAt.toISOString(),
      rescheduled_from: appt.start_at,
      updated_at: new Date().toISOString(),
    })
    .eq('id', appt.id).select().single();
  if (error) throw new Error(error.message);
  await logActivity(businessId, 'lead', appt.lead_id ?? appt.id, 'appointment_rescheduled',
    `Appointment rescheduled: ${appt.title}`, `${appt.start_at} → ${newStart.toISOString()}`);
  return data as Appointment;
}

export async function setAppointmentStatus(
  businessId: string, appt: Appointment,
  status: Extract<AppointmentStatus, 'cancelled' | 'completed' | 'no_show'>
) {
  const patch: Partial<Appointment> = { status, updated_at: new Date().toISOString() };
  if (status === 'cancelled') patch.cancelled_at = new Date().toISOString();
  if (status === 'completed') patch.completed_at = new Date().toISOString();
  const { data, error } = await supabase
    .from('appointments').update(patch).eq('id', appt.id).select().single();
  if (error) throw new Error(error.message);
  await logActivity(businessId, 'lead', appt.lead_id ?? appt.id, `appointment_${status}`,
    `Appointment ${status === 'no_show' ? 'marked as no-show' : status}: ${appt.title}`);
  return data as Appointment;
}

export async function updateAppointment(businessId: string, apptId: string, patch: Partial<Appointment>) {
  const { data, error } = await supabase
    .from('appointments').update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', apptId).select().single();
  if (error) throw new Error(error.message);
  return data as Appointment;
}

/** Link an appointment to a lead (used when booking from the lead page). */
export async function bookForLead(businessId: string, lead: Lead, input: { title?: string; startAt: Date; location?: string; notes?: string }) {
  return createAppointment(businessId, {
    title: input.title ?? `${lead.name} — ${lead.service_interest ?? 'appointment'}`,
    startAt: input.startAt,
    leadId: lead.id,
    customerId: lead.customer_id,
    location: input.location,
    notes: input.notes,
    source: 'lead',
  });
}
