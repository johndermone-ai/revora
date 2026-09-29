import { FormEvent, useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { Button, Card, CardHeader, Field, Input, Select, Textarea } from '../../components/ui';
import PageHeader from '../../components/layout/PageHeader';
import type { Business } from '../../types/database';
import { DAYS_OF_WEEK } from '../../types/database';
import { getAvailabilityRules, getBookingSettings, replaceAvailabilityRules, updateBookingSettings } from '../../services/appointments';

function TimeInput({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <input type="time" disabled={disabled} value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm disabled:bg-slate-50" />
  );
}

function BookingCard({ isAdmin }: { isAdmin: boolean }) {
  const { activeBusiness } = useAuth();
  const [settings, setSettings] = useState<Awaited<ReturnType<typeof getBookingSettings>>>(null);
  const [hours, setHours] = useState<Record<number, { enabled: boolean; start: string; end: string }>>({});
  const [holidays, setHolidays] = useState<string[]>([]);
  const [newHoliday, setNewHoliday] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!activeBusiness) return;
    Promise.all([getBookingSettings(activeBusiness.id), getAvailabilityRules(activeBusiness.id)]).then(([s, rules]) => {
      setSettings(s);
      const map: Record<number, { enabled: boolean; start: string; end: string }> = {};
      for (const d of [0, 1, 2, 3, 4, 5, 6]) {
        const rule = rules.find((r) => r.day_of_week === d);
        map[d] = rule ? { enabled: true, start: rule.start_time.slice(0, 5), end: rule.end_time.slice(0, 5) } : { enabled: false, start: '09:00', end: '17:00' };
      }
      setHours(map);
      setHolidays(s?.holidays ?? []);
    });
  }, [activeBusiness]);

  if (!settings) return null;

  async function save() {
    const s = settings;
    if (!activeBusiness || !s) return;
    setSaving(true);
    setMsg(null);
    setErr(null);
    try {
      await updateBookingSettings(activeBusiness.id, {
        slot_duration_minutes: s.slot_duration_minutes,
        buffer_minutes: s.buffer_minutes,
        min_notice_minutes: s.min_notice_minutes,
        max_booking_days: s.max_booking_days,
        auto_confirm: s.auto_confirm,
        holidays,
      });
      await replaceAvailabilityRules(
        activeBusiness.id,
        Object.entries(hours)
          .filter(([, v]) => v.enabled)
          .map(([d, v]) => ({ day_of_week: Number(d), start_time: `${v.start}:00`, end_time: `${v.end}:00` }))
      );
      setMsg('Booking settings saved.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save booking settings.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader title="Booking settings" />
      <div className="space-y-5 p-5">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Working hours</p>
          <div className="space-y-2">
            {[1, 2, 3, 4, 5, 6, 0].map((d) => (
              <div key={d} className="flex items-center gap-3">
                <label className="flex w-28 items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" disabled={!isAdmin} checked={hours[d]?.enabled}
                    onChange={(e) => setHours((h) => ({ ...h, [d]: { ...h[d], enabled: e.target.checked } }))}
                    className="h-4 w-4 rounded border-slate-300" />
                  {DAYS_OF_WEEK[d]}
                </label>
                <TimeInput value={hours[d]?.start ?? '09:00'} disabled={!isAdmin || !hours[d]?.enabled}
                  onChange={(v) => setHours((h) => ({ ...h, [d]: { ...h[d], start: v } }))} />
                <span className="text-slate-400">→</span>
                <TimeInput value={hours[d]?.end ?? '17:00'} disabled={!isAdmin || !hours[d]?.enabled}
                  onChange={(v) => setHours((h) => ({ ...h, [d]: { ...h[d], end: v } }))} />
              </div>
            ))}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Appointment duration (min)">
            <Input type="number" min="5" disabled={!isAdmin} value={settings.slot_duration_minutes}
              onChange={(e) => setSettings((s) => s && { ...s, slot_duration_minutes: Number(e.target.value) })} />
          </Field>
          <Field label="Buffer between appointments (min)">
            <Input type="number" min="0" disabled={!isAdmin} value={settings.buffer_minutes}
              onChange={(e) => setSettings((s) => s && { ...s, buffer_minutes: Number(e.target.value) })} />
          </Field>
          <Field label="Minimum notice (min)">
            <Input type="number" min="0" disabled={!isAdmin} value={settings.min_notice_minutes}
              onChange={(e) => setSettings((s) => s && { ...s, min_notice_minutes: Number(e.target.value) })} />
          </Field>
          <Field label="Max booking window (days)">
            <Input type="number" min="1" max="365" disabled={!isAdmin} value={settings.max_booking_days}
              onChange={(e) => setSettings((s) => s && { ...s, max_booking_days: Number(e.target.value) })} />
          </Field>
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" disabled={!isAdmin} checked={settings.auto_confirm}
            onChange={(e) => setSettings((s) => s && { ...s, auto_confirm: e.target.checked })}
            className="h-4 w-4 rounded border-slate-300" />
          Automatically confirm requested appointments (AI voice / website bookings skip manual approval)
        </label>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Holidays (closed dates)</p>
          <div className="flex flex-wrap gap-2">
            {holidays.map((h) => (
              <span key={h} className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs text-slate-700">
                {h}
                {isAdmin && <button onClick={() => setHolidays((hs) => hs.filter((x) => x !== h))} className="text-slate-400 hover:text-red-600">✕</button>}
              </span>
            ))}
            {holidays.length === 0 && <p className="text-sm text-slate-500">No holidays set.</p>}
          </div>
          {isAdmin && (
            <div className="mt-2 flex gap-2">
              <Input type="date" value={newHoliday} onChange={(e) => setNewHoliday(e.target.value)} className="w-auto" />
              <Button variant="secondary" disabled={!newHoliday}
                onClick={() => { setHolidays((hs) => [...new Set([...hs, newHoliday])].sort()); setNewHoliday(''); }}>Add</Button>
            </div>
          )}
        </div>

        <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
          Staff-specific availability, Google Calendar sync and reminders are architecturally prepared (calendars, provider and sync columns exist) —
          sync itself will activate when the integration is connected. Nothing is faked.
        </p>

        {msg && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{msg}</p>}
        {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
        {isAdmin && <Button disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save booking settings'}</Button>}
      </div>
    </Card>
  );
}

export default function Settings() {
  const { activeBusiness, refreshBusinesses, activeRole } = useAuth();
  const isAdmin = activeRole === 'owner' || activeRole === 'admin';
  const [form, setForm] = useState<Partial<Business>>(activeBusiness ?? {});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!activeBusiness) return;
    setSaving(true);
    setMessage(null);
    setError(null);
    const { error } = await supabase
      .from('businesses')
      .update({
        name: form.name,
        industry: form.industry,
        website: form.website,
        phone: form.phone,
        email: form.email,
        address: form.address,
        timezone: form.timezone,
        currency: form.currency,
        description: form.description,
        updated_at: new Date().toISOString(),
      })
      .eq('id', activeBusiness.id);
    setSaving(false);
    if (error) setError(error.message);
    else { setMessage('Saved.'); await refreshBusinesses(); }
  }

  if (!activeBusiness) return null;
  const f = (key: keyof Business) => (e: { target: { value: string } }) => setForm((prev) => ({ ...prev, [key]: e.target.value }));

  return (
    <div>
      <PageHeader title="Settings" subtitle="Your business profile and workspace configuration." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Business profile" />
          <form className="space-y-4 p-5" onSubmit={handleSave}>
            <Field label="Business name"><Input required value={form.name ?? ''} onChange={f('name')} disabled={!isAdmin} /></Field>
            <Field label="Industry"><Input value={form.industry ?? ''} onChange={f('industry')} disabled={!isAdmin} /></Field>
            <Field label="Website"><Input type="url" value={form.website ?? ''} onChange={f('website')} disabled={!isAdmin} /></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Phone"><Input value={form.phone ?? ''} onChange={f('phone')} disabled={!isAdmin} /></Field>
              <Field label="Email"><Input type="email" value={form.email ?? ''} onChange={f('email')} disabled={!isAdmin} /></Field>
            </div>
            <Field label="Address"><Input value={form.address ?? ''} onChange={f('address')} disabled={!isAdmin} /></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Timezone"><Input value={form.timezone ?? ''} onChange={f('timezone')} disabled={!isAdmin} /></Field>
              <Field label="Currency"><Input value={form.currency ?? ''} onChange={f('currency')} disabled={!isAdmin} /></Field>
            </div>
            <Field label="Description"><Textarea value={form.description ?? ''} onChange={f('description')} disabled={!isAdmin} /></Field>
            {message && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</p>}
            {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            {isAdmin && <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</Button>}
          </form>
        </Card>

        <div className="space-y-6">
          <BookingCard isAdmin={isAdmin} />
          <Card>
            <CardHeader title="Team" />
            <div className="p-5 text-sm text-slate-600">
              <p>Roles: <strong>Owner</strong> (full access), <strong>Admin</strong> (manage all data), <strong>Staff</strong> (work leads, cannot delete or manage billing).</p>
              <p className="mt-2 text-slate-500">Team member invitations are coming soon.</p>
            </div>
          </Card>
          <Card>
            <CardHeader title="Data isolation" />
            <div className="p-5 text-sm text-slate-600">
              <p>Row Level Security is enabled on every table. Members of your business can only ever see your business's records - one business can never access another's data, enforced at the database level.</p>
            </div>
          </Card>
          <Card>
            <CardHeader title="Lead capture (website)" />
            <div className="p-5 text-sm text-slate-600">
              <p className="mb-2">Share this link or embed the form on your website. Every enquiry lands in your Leads pipeline automatically with source "Website".</p>
              <code className="block break-all rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700">
                {window.location.origin}/capture/{activeBusiness.id}
              </code>
              <p className="mt-3 text-xs text-slate-500">For external sites, POST enquiries to:<br />
                <span className="break-all">https://YOUR-PROJECT.supabase.co/functions/v1/capture-lead</span> with JSON: businessId, name, email or phone, service_interest, notes.</p>
            </div>
          </Card>
          <Card>
            <CardHeader title="Integrations" />
            <div className="p-5 text-sm text-slate-600">
              <p>Email, WhatsApp, SMS, voice and calendar integrations will be configured here. The follow-up engine is already channel-ready - delivery simply stays disabled until a provider is connected.</p>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
