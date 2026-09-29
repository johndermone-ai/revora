import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { Button, Field, Input, Select, Textarea } from '../../components/ui';

const INDUSTRIES = [
  'Home Services', 'Trades & Construction', 'Professional Services', 'Beauty & Wellness',
  'Healthcare', 'Hospitality', 'Retail & E-commerce', 'Education', 'Other',
];

const GOALS = [
  'Get more leads', 'Convert more leads into customers', 'Follow up consistently',
  'Reduce manual admin', 'Understand my revenue', 'Retain more customers',
];

const STEPS = ['Business name', 'Industry', 'Website', 'Phone', 'Email', 'Main goal', 'Employees', 'Confirm'];

export default function OnboardingWizard() {
  const { refreshBusinesses, businesses } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: '', industry: '', website: '', phone: '', email: '', main_goal: '', employee_count: '',
  });

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const canContinue = () => {
    switch (step) {
      case 0: return form.name.trim().length > 0;
      case 1: return form.industry !== '';
      case 4: return /.+@.+\..+/.test(form.email);
      default: return true;
    }
  };

  async function handleSave() {
    setSaving(true);
    setError(null);
    // Secure server-side creation: inserts business + owner membership + settings + subscription atomically.
    const { data, error: rpcError } = await supabase.rpc('create_business_for_user', {
      p_name: form.name,
      p_industry: form.industry || null,
      p_website: form.website || null,
      p_phone: form.phone || null,
      p_email: form.email || null,
      p_main_goal: form.main_goal || null,
      p_employee_count: form.employee_count ? parseInt(form.employee_count, 10) : null,
    });
    if (rpcError || !data) {
      setSaving(false);
      setError(rpcError?.message ?? 'Could not save your business profile. Please try again.');
      return;
    }
    await refreshBusinesses();
    setSaving(false);
    navigate('/app');
  }

  if (businesses && businesses.length > 0) {
    return (
      <main className="mx-auto flex max-w-md flex-col items-center px-4 py-24 text-center">
        <h1 className="text-2xl font-bold text-slate-900">You are all set</h1>
        <p className="mt-2 text-sm text-slate-500">Your business profile is ready. Head to your dashboard.</p>
        <Button className="mt-6" onClick={() => navigate('/app')}>Go to dashboard</Button>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-xl px-4 py-16">
      <p className="text-sm font-medium text-brand-600">Step {step + 1} of {STEPS.length}</p>
      <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-900">Set up your business</h1>
      <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
      </div>

      <div className="mt-10 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        {step === 0 && <Field label="What is your business called?"><Input autoFocus value={form.name} onChange={set('name')} placeholder="Dermone & Co" /></Field>}
        {step === 1 && (
          <Field label="What industry are you in?">
            <Select value={form.industry} onChange={set('industry')}>
              <option value="">Select an industry…</option>
              {INDUSTRIES.map((i) => <option key={i} value={i}>{i}</option>)}
            </Select>
          </Field>
        )}
        {step === 2 && <Field label="Do you have a website? (optional)"><Input type="url" value={form.website} onChange={set('website')} placeholder="https://" /></Field>}
        {step === 3 && <Field label="What is your phone number? (optional)"><Input type="tel" value={form.phone} onChange={set('phone')} placeholder="+44 …" /></Field>}
        {step === 4 && <Field label="What email should leads use?"><Input type="email" value={form.email} onChange={set('email')} placeholder="hello@yourbusiness.co.uk" /></Field>}
        {step === 5 && (
          <Field label="What is your main business goal?">
            <Select value={form.main_goal} onChange={set('main_goal')}>
              <option value="">Select a goal…</option>
              {GOALS.map((g) => <option key={g} value={g}>{g}</option>)}
            </Select>
          </Field>
        )}
        {step === 6 && (
          <Field label="How many employees do you have? (optional)">
            <Input type="number" min="1" value={form.employee_count} onChange={set('employee_count')} placeholder="e.g. 5" />
          </Field>
        )}
        {step === 7 && (
          <div>
            <h2 className="font-semibold text-slate-900">Confirm your business profile</h2>
            <dl className="mt-4 space-y-2 text-sm">
              {[
                ['Business name', form.name], ['Industry', form.industry], ['Website', form.website],
                ['Phone', form.phone], ['Email', form.email], ['Main goal', form.main_goal],
                ['Employees', form.employee_count],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between gap-4 border-b border-slate-100 pb-2">
                  <dt className="text-slate-500">{label}</dt>
                  <dd className="font-medium text-slate-900">{value || '—'}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        {error && <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <div className="mt-6 flex items-center justify-between">
          <Button variant="ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0 || saving}>
            Back
          </Button>
          {step < STEPS.length - 1 ? (
            <Button onClick={() => setStep((s) => s + 1)} disabled={!canContinue()}>Continue</Button>
          ) : (
            <Button onClick={handleSave} disabled={saving || !form.name.trim()}>{saving ? 'Saving…' : 'Save and finish'}</Button>
          )}
        </div>
      </div>
    </main>
  );
}
