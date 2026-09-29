import { FormEvent, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { Button, Card, CardHeader, Field, Input, Select, Textarea } from '../../components/ui';
import PageHeader from '../../components/layout/PageHeader';
import type { Business } from '../../types/database';

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
