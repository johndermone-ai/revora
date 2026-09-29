import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import type { Appointment, Lead } from '../../types/database';
import { Badge, Button, Card, ErrorState, Field, Input, Modal, Select, Spinner, EmptyState } from '../../components/ui';
import PageHeader from '../../components/layout/PageHeader';
import {
  availableSlotsForDay, confirmAppointment, createAppointment, nextSlots,
  rescheduleAppointment, setAppointmentStatus,
} from '../../services/appointments';
import { formatDateTime } from '../../lib/format';

type ViewMode = 'day' | 'week' | 'month';

const statusColors: Record<Appointment['status'], string> = {
  requested: 'bg-amber-50 text-amber-700 border-amber-200',
  confirmed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  rescheduled: 'bg-sky-50 text-sky-700 border-sky-200',
  cancelled: 'bg-slate-50 text-slate-400 border-slate-200 line-through',
  completed: 'bg-brand-50 text-brand-700 border-brand-200',
  no_show: 'bg-red-50 text-red-700 border-red-200',
};

function startOfDayUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86_400_000);
}
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default function CalendarPage() {
  const { activeBusiness } = useAuth();
  const [view, setView] = useState<ViewMode>('week');
  const [anchor, setAnchor] = useState(() => startOfDayUTC(new Date()));
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [detail, setDetail] = useState<Appointment | null>(null);

  const range = useMemo(() => {
    if (view === 'day') return { from: anchor, to: addDays(anchor, 1) };
    if (view === 'week') {
      const dow = anchor.getUTCDay();
      const monday = addDays(anchor, dow === 0 ? -6 : 1 - dow);
      return { from: monday, to: addDays(monday, 7) };
    }
    return { from: new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1)), to: new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 1)) };
  }, [view, anchor]);

  const load = useCallback(async () => {
    if (!activeBusiness) return;
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase
      .from('appointments')
      .select('*')
      .eq('business_id', activeBusiness.id)
      .gte('start_at', range.from.toISOString())
      .lt('start_at', range.to.toISOString())
      .order('start_at');
    if (err) setError(err.message);
    else setAppointments((data as Appointment[]) ?? []);
    setLoading(false);
  }, [activeBusiness, range.from, range.to]);

  useEffect(() => { load(); }, [load]);

  const refresh = async () => { await load(); };

  return (
    <div>
      <PageHeader
        title="Calendar"
        subtitle="Appointments from every channel: manual, lead flow, website and AI voice — one booking engine."
        action={<Button onClick={() => setCreateOpen(true)}>New appointment</Button>}
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => setAnchor((a) => view === 'month'
            ? new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth() - 1, 1))
            : addDays(a, view === 'day' ? -1 : -7))}>←</Button>
          <Button variant="secondary" onClick={() => setAnchor(startOfDayUTC(new Date()))}>Today</Button>
          <Button variant="secondary" onClick={() => setAnchor((a) => view === 'month'
            ? new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth() + 1, 1))
            : addDays(a, view === 'day' ? 1 : 7))}>→</Button>
          <span className="ml-2 text-sm font-semibold text-slate-900">
            {view === 'month'
              ? anchor.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
              : `${isoDate(range.from)} → ${isoDate(addDays(range.to, -1))}`}
          </span>
        </div>
        <div className="flex rounded-lg border border-slate-200 bg-white p-0.5">
          {(['day', 'week', 'month'] as ViewMode[]).map((v) => (
            <button key={v} onClick={() => setView(v)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium capitalize ${view === v ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
              {v}
            </button>
          ))}
        </div>
      </div>

      {loading ? <Card><Spinner label="Loading calendar…" /></Card>
        : error ? <ErrorState message={error} onRetry={load} />
        : view === 'day' ? <DayView appointments={appointments} day={anchor} onSelect={setDetail} onCreateAt={() => setCreateOpen(true)} />
        : view === 'week' ? <WeekView appointments={appointments} from={range.from} onSelect={setDetail} />
        : <MonthView appointments={appointments} from={range.from} onSelect={setDetail} onJump={(d) => { setAnchor(d); setView('day'); }} />}

      <CreateModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={refresh} />
      {detail && <DetailModal appt={detail} onClose={() => setDetail(null)} onChanged={async () => { setDetail(null); await refresh(); }} />}
    </div>
  );
}

function ApptChip({ appt, onClick }: { appt: Appointment; onClick: () => void }) {
  const time = new Date(appt.start_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
  return (
    <button onClick={onClick}
      className={`w-full truncate rounded-md border px-2 py-1 text-left text-xs font-medium transition-shadow hover:shadow ${statusColors[appt.status]}`}>
      {time} {appt.title}
    </button>
  );
}

function DayView({ appointments, day, onSelect, onCreateAt }: {
  appointments: Appointment[]; day: Date; onSelect: (a: Appointment) => void; onCreateAt: () => void;
}) {
  return (
    <Card className="overflow-hidden">
      {appointments.length === 0 ? (
        <EmptyState title="No appointments today" description="Create one manually, or let leads book themselves via the website flow." action={<Button onClick={onCreateAt}>New appointment</Button>} />
      ) : (
        <ul className="divide-y divide-slate-100">
          {appointments.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
              <button className="min-w-0 text-left" onClick={() => onSelect(a)}>
                <p className="truncate text-sm font-medium text-slate-900">{a.title}</p>
                <p className="text-xs text-slate-500">{formatDateTime(a.start_at)} · {a.duration_minutes} min</p>
              </button>
              <Badge className={statusColors[a.status]}>{a.status.replace('_', ' ')}</Badge>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function WeekView({ appointments, from, onSelect }: { appointments: Appointment[]; from: Date; onSelect: (a: Appointment) => void }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
      {days.map((d) => {
        const items = appointments.filter((a) => isoDate(new Date(a.start_at)) === isoDate(d));
        return (
          <div key={d.toISOString()} className="min-h-[180px] rounded-xl border border-slate-200 bg-white p-2">
            <p className="px-1 pb-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
              {d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', timeZone: 'UTC' })}
            </p>
            <div className="space-y-1.5">
              {items.length === 0 && <p className="px-1 py-2 text-xs text-slate-300">—</p>}
              {items.map((a) => <ApptChip key={a.id} appt={a} onClick={() => onSelect(a)} />)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MonthView({ appointments, from, onSelect, onJump }: {
  appointments: Appointment[]; from: Date; onSelect: (a: Appointment) => void; onJump: (d: Date) => void;
}) {
  const daysInMonth = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 0)).getUTCDate();
  const firstDow = from.getUTCDay();
  const cells: (Date | null)[] = [
    ...Array.from({ length: firstDow }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => addDays(from, i)),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div className="overflow-x-auto">
      <div className="grid min-w-[700px] grid-cols-7 gap-1">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
          <p key={d} className="px-2 py-1 text-center text-xs font-semibold uppercase tracking-wide text-slate-500">{d}</p>
        ))}
        {cells.map((d, i) => {
          if (!d) return <div key={`e${i}`} className="min-h-[80px] rounded-lg bg-slate-50/50" />;
          const items = appointments.filter((a) => isoDate(new Date(a.start_at)) === isoDate(d));
          return (
            <button key={d.toISOString()} onClick={() => onJump(d)}
              className="min-h-[80px] rounded-lg border border-slate-100 bg-white p-1.5 text-left hover:border-brand-300">
              <p className="text-xs font-medium text-slate-700">{d.getUTCDate()}</p>
              {items.slice(0, 3).map((a) => (
                <span key={a.id} className={`mt-1 block truncate rounded border px-1 py-0.5 text-[10px] ${statusColors[a.status]}`}>{a.title}</span>
              ))}
              {items.length > 3 && <span className="text-[10px] text-slate-400">+{items.length - 3} more</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function useLeadOptions() {
  const { activeBusiness } = useAuth();
  const [leads, setLeads] = useState<Lead[]>([]);
  useEffect(() => {
    if (!activeBusiness) return;
    supabase.from('leads').select('id, name, customer_id, service_interest')
      .eq('business_id', activeBusiness.id)
      .not('status', 'in', '("won","lost")')
      .order('created_at', { ascending: false }).limit(100)
      .then(({ data }) => setLeads((data as Lead[]) ?? []));
  }, [activeBusiness]);
  return leads;
}

function CreateModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const { activeBusiness } = useAuth();
  const leads = useLeadOptions();
  const [mode, setMode] = useState<'pick' | 'custom'>('pick');
  const [slots, setSlots] = useState<Date[]>([]);
  const [selected, setSelected] = useState<Date | null>(null);
  const [date, setDate] = useState(isoDate(new Date()));
  const [daySlots, setDaySlots] = useState<Date[]>([]);
  const [title, setTitle] = useState('');
  const [leadId, setLeadId] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !activeBusiness) return;
    setErr(null);
    nextSlots(activeBusiness.id, 6).then(setSlots).catch((e) => setErr(e instanceof Error ? e.message : 'Could not load slots'));
  }, [open, activeBusiness]);

  useEffect(() => {
    if (!open || mode !== 'custom' || !activeBusiness) return;
    availableSlotsForDay(activeBusiness.id, new Date(`${date}T00:00:00Z`)).then(setDaySlots).catch(() => setDaySlots([]));
  }, [open, mode, date, activeBusiness]);

  async function handleCreate() {
    if (!activeBusiness || !selected) return;
    setBusy(true);
    setErr(null);
    try {
      const lead = leads.find((l) => l.id === leadId);
      const finalTitle = title.trim() || (lead ? `${lead.name} — ${lead.service_interest ?? 'appointment'}` : 'Appointment');
      await createAppointment(activeBusiness.id, {
        title: finalTitle,
        startAt: selected,
        leadId: leadId || null,
        customerId: lead?.customer_id ?? null,
      });
      onCreated();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not create appointment');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="New appointment">
      <div className="space-y-4">
        <Field label="Link to lead (optional)">
          <Select value={leadId} onChange={(e) => setLeadId(e.target.value)}>
            <option value="">No lead</option>
            {leads.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </Select>
        </Field>
        <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Consultation call" /></Field>

        <div className="flex rounded-lg border border-slate-200 p-0.5">
          <button className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium ${mode === 'pick' ? 'bg-brand-600 text-white' : 'text-slate-600'}`} onClick={() => setMode('pick')}>Next available</button>
          <button className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium ${mode === 'custom' ? 'bg-brand-600 text-white' : 'text-slate-600'}`} onClick={() => setMode('custom')}>Pick a date</button>
        </div>

        {mode === 'pick' ? (
          slots.length === 0 ? <p className="text-sm text-slate-500">No available slots in the booking window.</p> : (
            <div className="grid grid-cols-2 gap-2">
              {slots.map((s) => (
                <button key={s.toISOString()} onClick={() => setSelected(s)}
                  className={`rounded-lg border px-3 py-2 text-sm ${selected?.toISOString() === s.toISOString() ? 'border-brand-500 bg-brand-50 text-brand-700 font-medium' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                  {s.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })}
                </button>
              ))}
            </div>
          )
        ) : (
          <div className="space-y-2">
            <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            <div className="grid max-h-40 grid-cols-3 gap-2 overflow-y-auto">
              {daySlots.length === 0 && <p className="col-span-3 text-sm text-slate-500">No free slots that day.</p>}
              {daySlots.map((s) => (
                <button key={s.toISOString()} onClick={() => setSelected(s)}
                  className={`rounded-lg border px-2 py-1.5 text-sm ${selected?.toISOString() === s.toISOString() ? 'border-brand-500 bg-brand-50 font-medium text-brand-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                  {s.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })}
                </button>
              ))}
            </div>
          </div>
        )}

        {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button disabled={!selected || busy} onClick={handleCreate}>{busy ? 'Booking…' : 'Book appointment'}</Button>
        </div>
      </div>
    </Modal>
  );
}

function DetailModal({ appt, onClose, onChanged }: { appt: Appointment; onClose: () => void; onChanged: () => void }) {
  const { activeBusiness } = useAuth();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [rescheduleSlots, setRescheduleSlots] = useState<Date[] | null>(null);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setErr(null);
    try { await fn(); onChanged(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Action failed'); setBusy(false); }
  }

  const biz = activeBusiness!;
  const isPast = new Date(appt.start_at) < new Date();

  return (
    <Modal open onClose={onClose} title={appt.title}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge className={statusColors[appt.status]}>{appt.status.replace('_', ' ')}</Badge>
          <span className="text-xs text-slate-500">{formatDateTime(appt.start_at)} · {appt.duration_minutes} min</span>
        </div>
        <p className="text-sm text-slate-600">Source: {appt.created_source.replace('_', ' ')}</p>
        {appt.notes && <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">{appt.notes}</p>}

        {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}

        {rescheduleSlots === null ? (
          <div className="flex flex-wrap gap-2">
            {appt.status === 'requested' && (
              <Button disabled={busy} onClick={() => act(() => confirmAppointment(biz.id, appt))}>Confirm</Button>
            )}
            {['requested', 'confirmed', 'rescheduled'].includes(appt.status) && (
              <>
                <Button variant="secondary" disabled={busy} onClick={async () => {
                  const { nextSlots } = await import('../../services/appointments');
                  setRescheduleSlots(await nextSlots(biz.id, 8));
                }}>Reschedule</Button>
                <Button variant="secondary" disabled={busy} onClick={() => act(() => setAppointmentStatus(biz.id, appt, 'cancelled'))}>Cancel</Button>
              </>
            )}
            {!isPast && ['confirmed', 'rescheduled'].includes(appt.status) && (
              <>
                <Button variant="secondary" disabled={busy} onClick={() => act(() => setAppointmentStatus(biz.id, appt, 'completed'))}>Mark completed</Button>
                <Button variant="secondary" disabled={busy} onClick={() => act(() => setAppointmentStatus(biz.id, appt, 'no_show'))}>Mark no-show</Button>
              </>
            )}
          </div>
        ) : (
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Pick a new slot</p>
            <div className="grid max-h-48 grid-cols-2 gap-2 overflow-y-auto">
              {rescheduleSlots.length === 0 && <p className="col-span-2 text-sm text-slate-500">No free slots available.</p>}
              {rescheduleSlots.map((s) => (
                <button key={s.toISOString()} disabled={busy}
                  onClick={() => act(() => rescheduleAppointment(biz.id, appt, s))}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-brand-50 hover:text-brand-700">
                  {s.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })}
                </button>
              ))}
            </div>
            <Button variant="ghost" className="mt-2" onClick={() => setRescheduleSlots(null)}>Back</Button>
          </div>
        )}
      </div>
    </Modal>
  );
}
