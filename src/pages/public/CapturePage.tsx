import { FormEvent, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Button, Field, Input, Textarea } from '../../components/ui';

// Public lead capture page: /capture/:businessId
// Animated, brandable, no auth required. Submits to the capture-lead edge
// function, which validates, rate-limits, and inserts the lead server-side.
export default function CapturePage() {
  const { businessId } = useParams<{ businessId: string }>();
  const [form, setForm] = useState({ name: '', email: '', phone: '', service_interest: '', notes: '' });
  const [honeypot, setHoneypot] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setState('sending');
    setError(null);
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/capture-lead`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessId,
          name: form.name,
          email: form.email,
          phone: form.phone,
          service_interest: form.service_interest,
          notes: form.notes,
          website: honeypot, // honeypot: humans never fill this
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) throw new Error(body.error ?? 'Something went wrong. Please try again.');
      setState('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
      setState('error');
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-b from-brand-50 via-white to-slate-50 px-4 py-16">
      <div className="w-full max-w-md">
        <div className="rv-float mb-6 flex justify-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-600 text-xl font-bold text-white shadow-lg">R</span>
        </div>

        {state === 'done' ? (
          <div className="rv-pop-in rounded-2xl border border-emerald-200 bg-white p-10 text-center shadow-xl">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50">
              <svg className="h-7 w-7 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h1 className="text-xl font-bold text-slate-900">Thank you!</h1>
            <p className="mt-2 text-sm text-slate-600">Your enquiry has been received. We will be in touch shortly.</p>
          </div>
        ) : (
          <div className="rv-fade-up rounded-2xl border border-slate-200 bg-white p-8 shadow-xl">
            <h1 className="text-xl font-bold tracking-tight text-slate-900">Get in touch</h1>
            <p className="mt-1 text-sm text-slate-500">Tell us what you need and we will come back to you.</p>
            <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
              <Field label="Your name"><Input required value={form.name} onChange={set('name')} autoComplete="name" /></Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Email"><Input type="email" value={form.email} onChange={set('email')} autoComplete="email" /></Field>
                <Field label="Phone"><Input value={form.phone} onChange={set('phone')} autoComplete="tel" /></Field>
              </div>
              <Field label="What do you need?"><Input value={form.service_interest} onChange={set('service_interest')} placeholder="e.g. Kitchen renovation" /></Field>
              <Field label="Anything else? (optional)"><Textarea value={form.notes} onChange={set('notes')} /></Field>
              {/* Honeypot - hidden from humans */}
              <input
                type="text" tabIndex={-1} autoComplete="off" aria-hidden="true"
                value={honeypot} onChange={(e) => setHoneypot(e.target.value)}
                className="pointer-events-none absolute left-[-9999px] h-0 w-0 opacity-0"
              />
              {state === 'error' && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
              <Button type="submit" className="w-full" disabled={state === 'sending'}>
                {state === 'sending' ? 'Sending…' : 'Send enquiry'}
              </Button>
            </form>
          </div>
        )}
        <p className="mt-6 text-center text-xs text-slate-400">Powered by Revora</p>
      </div>
    </main>
  );
}
