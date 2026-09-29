// Pure-function regression tests for Revora's core logic.
// Run: npx tsx tests/pure.test.ts
import { DEFAULT_BOOKING_CONFIG, isHoliday, nextAvailableSlots, slotConflicts, timeToMinutes, validateSlot, type AvailabilityRule, type BookedSlot } from '../supabase/functions/_shared/bookingEngine.ts';
import { scoreLead, scoreBand } from '../src/lib/leadScoring.ts';
import { normalizeLeadRows, parseCsv } from '../src/lib/csv.ts';

let passed = 0; let failed = 0;
function t(name: string, cond: boolean, detail = '') {
  if (cond) { passed++; console.log(`  + ${name}`); }
  else { failed++; console.error(`  x ${name}${detail ? ' — ' + detail : ''}`); }
}

console.log('Booking engine:');
t('timeToMinutes parses HH:MM', timeToMinutes('09:30') === 570);
const rules: AvailabilityRule[] = [
  { day_of_week: 1, start_time: '09:00', end_time: '17:00' },
  { day_of_week: 2, start_time: '09:00', end_time: '17:00' },
];
const now = new Date();
const daysUntilMon = ((8 - now.getUTCDay()) % 7) || 7;
const mon = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysUntilMon, 9));
const config = { ...DEFAULT_BOOKING_CONFIG, min_notice_minutes: 0, max_booking_days: 30, buffer_minutes: 15 };
const slots = nextAvailableSlots(new Date(mon.getTime() - 3 * 86400000), rules, [], config, 5);
t('generates slots from availability rules', slots.length === 5, `got ${slots.length}`);
t('first slot is Mon 09:00 UTC', slots[0]?.toISOString() === mon.toISOString(), `got ${slots[0]?.toISOString()}`);
t('slot spacing respects duration (60m)', slots[1] && slots[1].getTime() - slots[0].getTime() === 3600000, `got ${slots[1]?.toISOString()}`);
t('no slot past end_time (17:00)', slots.every((s) => s.getUTCHours() < 17), JSON.stringify(slots.map((s) => s.toISOString())));

const conflictBooked: BookedSlot[] = [{ start_at: new Date(Date.UTC(mon.getUTCFullYear(), mon.getUTCMonth(), mon.getUTCDate(), 10)).toISOString(), end_at: new Date(Date.UTC(mon.getUTCFullYear(), mon.getUTCMonth(), mon.getUTCDate(), 11)).toISOString() }];
t('rejects 09:00-10:00 booking (overlaps existing 10:00 + buffer)', slotConflicts(mon, new Date(mon.getTime() + 3600000), conflictBooked, config.buffer_minutes) === true);
t('accepts non-overlapping booking (14:00)', slotConflicts(new Date(Date.UTC(mon.getUTCFullYear(), mon.getUTCMonth(), mon.getUTCDate(), 14)), new Date(Date.UTC(mon.getUTCFullYear(), mon.getUTCMonth(), mon.getUTCDate(), 15)), conflictBooked, config.buffer_minutes) === false);

const clearSlot = new Date(Date.UTC(mon.getUTCFullYear(), mon.getUTCMonth(), mon.getUTCDate(), 14));
t('validateSlot accepts valid slot', validateSlot(clearSlot, rules, conflictBooked, config, new Date(mon.getTime() - 86400000)).ok === true);
const outOfHours = new Date(Date.UTC(mon.getUTCFullYear(), mon.getUTCMonth(), mon.getUTCDate(), 18));
t('validateSlot rejects outside hours', validateSlot(outOfHours, rules, conflictBooked, config, new Date(mon.getTime() - 86400000)).ok === false);
const sunday = new Date(Date.UTC(mon.getUTCFullYear(), mon.getUTCMonth(), mon.getUTCDate() + 6));
t('validateSlot rejects unavailable day', validateSlot(sunday, rules, [], config, new Date(mon.getTime() - 86400000)).ok === false);
t('isHoliday flags holidays', isHoliday(mon, [mon.toISOString().slice(0, 10)]) === true);
const holidayCfg = { ...config, holidays: [mon.toISOString().slice(0, 10)] };
t('validateSlot rejects holiday', validateSlot(mon, rules, [], holidayCfg, new Date(mon.getTime() - 86400000)).ok === false);

console.log('Lead scoring:');
const base = { id: 'x', business_id: 'b', name: 'Test', source: 'website', status: 'new', lead_score: 0, created_at: '', updated_at: '' } as never;
const s1 = scoreLead({ ...base, email: 'a@b.c', phone: '07', service_interest: 'Cut', budget: '150' } as never);
t('score increases with contact + budget info', s1.score > 10, `got ${s1.score}`);
const s2 = scoreLead({ ...base } as never);
t('bare lead scores base only', s2.score <= 10, `got ${s2.score}`);
const s3 = scoreLead({ ...base, source: 'referral', email: 'a@b.c', phone: '07', service_interest: 'Cut', budget: '150', urgency: 'high' } as never);
t('referral + urgency scores higher', s3.score > s1.score, `${s3.score} vs ${s1.score}`);
t('score capped at 100', scoreLead({ ...base, source: 'referral', email: 'a@b.c', phone: '07', service_interest: 'Cut', budget: '150', urgency: 'high', notes: 'x'.repeat(400) } as never).score <= 100);
t('bands cover ranges', scoreBand(0).label.length > 0 && scoreBand(50).label.length > 0 && scoreBand(90).label.length > 0);

console.log('CSV import:');
const csv1 = parseCsv('Name,Email,Phone\nJane Doe,jane@x.com,07111\n"Smith, John",,07222\n');
t('parses basic rows', csv1.length === 2);
t('handles quoted commas', csv1[1]?.name === 'Smith, John', `got "${csv1[1]?.name}"`);
t('normalises headers', 'email' in (csv1[0] ?? {}));
const norm = normalizeLeadRows(parseCsv('NAME,EMAIL\nA,a@a\nB,b@b\nA,a@a\n'));
t('rejects missing-name rows', normalizeLeadRows(parseCsv('email\nx@x\n')).unique.length === 0);
t('deduplicates identical contact keys', norm.unique.length === 2 && norm.duplicates === 1, JSON.stringify(norm));
t('empty input parses to no rows', parseCsv('').length === 0);
t('CRLF line endings handled', parseCsv('name,email\r\nJane,j@x\r\n').length === 1);

// ---------- Google Maps CSV mapping (src/lib/csv.ts) ----------
import { isGoogleMapsExport, mapGoogleMapsRows } from '../src/lib/csv';

console.log('Google Maps mapping:');
const gmRows = [
  { kgmid: '/g/1', name: 'Acme Plumbing', main_category: 'Plumber', phone: '0161 111 2222', phone_international: '+441611112222', address: '1 Main St, Manchester', website: 'https://acme.example', rating: '4.8', reviews: '21', email: '' },
  { kgmid: '/g/1', name: 'Acme Plumbing (duplicate)', main_category: 'Plumber' },
  { kgmid: '', name: '', main_category: 'Plumber' },
];
const gm = mapGoogleMapsRows(gmRows);
t('isGoogleMapsExport detects kgmid header', isGoogleMapsExport(gmRows) && !isGoogleMapsExport([{ name: 'A', email: 'b@c.d' }]));
t('mapGoogleMapsRows maps, dedupes and enriches',
  gm.mapped.length === 1 && gm.duplicates === 1 && gm.skipped === 1
  && gm.mapped[0].phone === '+441611112222'
  && gm.mapped[0].service_interest === 'Plumber'
  && gm.mapped[0].notes.includes('Rating: 4.8')
  && gm.mapped[0].notes.includes('Website: https://acme.example')
  && gm.mapped[0].company === 'Acme Plumbing');

console.log(`\n${passed} passed, ${failed} failed`);

process.exit(failed > 0 ? 1 : 0);
