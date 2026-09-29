// ============================================================
// Revora shared booking engine — SINGLE SOURCE OF TRUTH.
// Imported by the frontend (staff UI) AND edge functions
// (AI voice / website booking) so every channel uses the
// same slot logic. Pure functions only - no I/O.
// ============================================================

export interface AvailabilityRule {
  day_of_week: number; // 0 = Sunday
  start_time: string;  // "HH:MM:SS"
  end_time: string;
  staff_user_id?: string | null;
}

export interface BookedSlot {
  start_at: string; // ISO
  end_at: string; // ISO
}

export interface BookingConfig {
  slot_duration_minutes: number;
  buffer_minutes: number;
  min_notice_minutes: number;
  max_booking_days: number;
  holidays: string[]; // "YYYY-MM-DD"
}

export const DEFAULT_BOOKING_CONFIG: BookingConfig = {
  slot_duration_minutes: 60,
  buffer_minutes: 15,
  min_notice_minutes: 120,
  max_booking_days: 60,
  holidays: [],
};

const ACTIVE_STATUSES = ['requested', 'confirmed', 'rescheduled'];

/** Convert "HH:MM[:SS]" to minutes since midnight. */
export function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
}

/** Is the given moment inside an active (blocking) appointment? Buffer applies. */
export function slotConflicts(
  start: Date, end: Date, booked: BookedSlot[], bufferMinutes: number
): boolean {
  const s = start.getTime(), e = end.getTime();
  const buf = bufferMinutes * 60_000;
  // `booked` must contain only ACTIVE (blocking) statuses - the caller filters.
  return booked.some((b) => {
    const bs = new Date(b.start_at).getTime() - buf;
    const be = new Date(b.end_at).getTime() + buf;
    return s < be && e > bs;
  });
}

export function isHoliday(d: Date, holidays: string[]): boolean {
  const iso = d.toISOString().slice(0, 10);
  return holidays.includes(iso);
}

/**
 * Compute all available slots for one calendar day.
 * rules = business-wide rules for that weekday; booked = active
 * appointments that day; now = reference time for notice checks.
 */
export function slotsForDay(
  date: Date,
  rules: AvailabilityRule[],
  booked: BookedSlot[],
  config: BookingConfig,
  now: Date = new Date()
): Date[] {
  const day = date.getUTCDay();
  const slots: Date[] = [];

  if (isHoliday(date, config.holidays)) return slots;

  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const dayNum = date.getUTCDate();

  for (const rule of rules) {
    if (rule.day_of_week !== day) continue;
    const startMin = timeToMinutes(rule.start_time);
    const endMin = timeToMinutes(rule.end_time);
    for (let m = startMin; m + config.slot_duration_minutes <= endMin; m += config.slot_duration_minutes) {
      const slotStart = new Date(Date.UTC(year, month, dayNum, Math.floor(m / 60), m % 60, 0));
      const slotEnd = new Date(slotStart.getTime() + config.slot_duration_minutes * 60_000);
      // minimum notice
      if (slotStart.getTime() < now.getTime() + config.min_notice_minutes * 60_000) continue;
      if (slotConflicts(slotStart, slotEnd, booked, config.buffer_minutes)) continue;
      slots.push(slotStart);
    }
  }
  return slots;
}

/**
 * Find the next N available slots starting from a date, scanning up to
 * the maximum booking window. Used by AI voice and website flows.
 */
export function nextAvailableSlots(
  from: Date,
  rules: AvailabilityRule[],
  booked: BookedSlot[],
  config: BookingConfig,
  count: number = 5,
  daysToScan?: number
): Date[] {
  const scanDays = daysToScan ?? config.max_booking_days;
  const out: Date[] = [];
  const startDay = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const windowEnd = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + config.max_booking_days));

  for (let d = 0; d < scanDays && out.length < count; d++) {
    const day = new Date(startDay.getTime() + d * 86_400_000);
    if (day > windowEnd) break;
    const slots = slotsForDay(day, rules, booked, config, from);
    for (const s of slots) {
      if (out.length >= count) break;
      out.push(s);
    }
  }
  return out;
}

/**
 * Validate that a requested start time is a legitimate bookable slot
 * according to availability rules, buffers, notice and window.
 * Returns { ok: true } or { ok: false, reason }.
 */
export function validateSlot(
  start: Date,
  rules: AvailabilityRule[],
  booked: BookedSlot[],
  config: BookingConfig,
  now: Date = new Date(),
  existingAppointmentId?: string
): { ok: true } | { ok: false; reason: string } {
  const end = new Date(start.getTime() + config.slot_duration_minutes * 60_000);

  if (start < new Date(now.getTime() + config.min_notice_minutes * 60_000)) {
    return { ok: false, reason: `Bookings need at least ${config.min_notice_minutes} minutes notice.` };
  }
  const windowEnd = new Date(now.getTime() + config.max_booking_days * 86_400_000);
  if (start > windowEnd) {
    return { ok: false, reason: `Bookings can only be made up to ${config.max_booking_days} days ahead.` };
  }
  if (isHoliday(start, config.holidays)) {
    return { ok: false, reason: 'The business is closed on that date.' };
  }

  const day = start.getUTCDay();
  const dayRules = rules.filter((r) => r.day_of_week === day);
  if (dayRules.length === 0) return { ok: false, reason: 'No availability on that weekday.' };

  const startMin = start.getUTCHours() * 60 + start.getUTCMinutes();
  const fitsHours = dayRules.some(
    (r) =>
      startMin >= timeToMinutes(r.start_time) &&
      startMin + config.slot_duration_minutes <= timeToMinutes(r.end_time)
  );
  if (!fitsHours) return { ok: false, reason: 'Time is outside working hours.' };

  // Conflict check (optionally excluding the appointment being rescheduled)
  // Callers filter out the appointment being rescheduled before calling.
  if (slotConflicts(start, end, booked, config.buffer_minutes)) {
    return { ok: false, reason: 'That slot overlaps another appointment.' };
  }
  return { ok: true };
}

export const APPOINTMENT_ACTIVE_STATUSES = ACTIVE_STATUSES;
