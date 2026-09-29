import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { Badge, Card, ErrorState, Spinner } from '../../components/ui';
import PageHeader from '../../components/layout/PageHeader';

interface Subscription {
  id: string;
  plan: string;
  status: string;
  current_period_end: string | null;
  created_at: string;
}

const PLAN_FEATURES: Record<string, string[]> = {
  trial: ['All core features', '1 business', 'AI qualification & follow-ups', 'Voice agent architecture ready'],
  starter: ['Unlimited leads & customers', 'Booking system', 'Revenue recovery engine', 'Email support'],
  pro: ['Everything in Starter', 'AI voice agent (Retell/Vapi)', 'Analytics dashboard', 'Priority support'],
};

export default function BillingPage() {
  const { activeBusiness } = useAuth();
  const [sub, setSub] = useState<Subscription | null>(null);
  const [usage, setUsage] = useState<{ leads: number; appointments: number; customers: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeBusiness) return;
    setLoading(true);
    Promise.all([
      supabase.from('subscriptions').select('*').eq('business_id', activeBusiness.id).maybeSingle(),
      supabase.from('leads').select('id', { count: 'exact', head: true }).eq('business_id', activeBusiness.id),
      supabase.from('appointments').select('id', { count: 'exact', head: true }).eq('business_id', activeBusiness.id),
      supabase.from('customers').select('id', { count: 'exact', head: true }).eq('business_id', activeBusiness.id),
    ]).then(([s, l, a, c]) => {
      if (s.error) setError(s.error.message);
      else {
        setSub((s.data as Subscription) ?? null);
        setUsage({ leads: l.count ?? 0, appointments: a.count ?? 0, customers: c.count ?? 0 });
      }
    }).catch(() => setError('Could not load billing information'))
      .finally(() => setLoading(false));
  }, [activeBusiness]);

  return (
    <div>
      <PageHeader
        title="Billing"
        subtitle="Your current plan and usage. Payment collection activates when Stripe billing is wired — this page reads your real subscription record, nothing simulated."
      />

      {loading ? <Card><Spinner label="Loading billing…" /></Card>
        : error ? <ErrorState message={error} />
        : (
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <div className="border-b border-slate-100 px-5 py-4">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-900">Current plan</h2>
              </div>
              <div className="p-5">
                {sub ? (
                  <>
                    <div className="flex items-center gap-2">
                      <p className="text-2xl font-bold capitalize text-slate-900">{sub.plan}</p>
                      <Badge className={
                        sub.status === 'active' ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : sub.status === 'trialing' ? 'bg-sky-50 text-sky-700 border-sky-200'
                        : 'bg-slate-100 text-slate-600 border-slate-200'
                      }>{sub.status}</Badge>
                    </div>
                    {sub.current_period_end && (
                      <p className="mt-1 text-sm text-slate-500">
                        Current period ends {new Date(sub.current_period_end).toLocaleDateString('en-GB', { dateStyle: 'long' })}
                      </p>
                    )}
                    <ul className="mt-4 space-y-1">
                      {(PLAN_FEATURES[sub.plan] ?? PLAN_FEATURES.trial).map((f) => (
                        <li key={f} className="text-sm text-slate-600">✓ {f}</li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="text-sm text-slate-500">No subscription record found for this business yet.</p>
                )}
                <p className="mt-5 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
                  Card payments and plan upgrades are handled by your account's billing settings once Stripe is connected — Revora displays the real subscription record and never simulates charges.
                </p>
              </div>
            </Card>

            <Card>
              <div className="border-b border-slate-100 px-5 py-4">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-900">Usage</h2>
              </div>
              <div className="p-5">
                {usage ? (
                  <div className="grid grid-cols-3 gap-3">
                    <div className="rounded-xl border border-slate-200 p-4 text-center">
                      <p className="text-2xl font-bold text-slate-900">{usage.leads}</p>
                      <p className="text-xs text-slate-500">Leads</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 p-4 text-center">
                      <p className="text-2xl font-bold text-slate-900">{usage.appointments}</p>
                      <p className="text-xs text-slate-500">Appointments</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 p-4 text-center">
                      <p className="text-2xl font-bold text-slate-900">{usage.customers}</p>
                      <p className="text-xs text-slate-500">Customers</p>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">Usage data unavailable.</p>
                )}
              </div>
            </Card>
          </div>
        )}
    </div>
  );
}
