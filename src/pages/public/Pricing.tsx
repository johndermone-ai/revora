const plans = [
  {
    name: 'Starter',
    price: '£19',
    features: ['1 business', 'Up to 500 leads', 'Lead pipeline & scoring', 'Email follow-up drafts'],
  },
  {
    name: 'Growth',
    price: '£49',
    features: ['Everything in Starter', 'AI lead qualification', 'Automations', 'Unlimited leads'],
    featured: true,
  },
  {
    name: 'Scale',
    price: '£99',
    features: ['Everything in Growth', 'Priority support', 'Advanced analytics', 'API access'],
  },
];

export default function Pricing() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
      <div className="text-center">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">Simple pricing</h1>
        <p className="mt-3 text-slate-600">Start on a free trial. Upgrade when you are ready.</p>
      </div>
      <div className="mt-12 grid gap-6 lg:grid-cols-3">
        {plans.map((plan) => (
          <div
            key={plan.name}
            className={`rounded-2xl border bg-white p-8 shadow-sm ${plan.featured ? 'border-brand-300 ring-2 ring-brand-100' : 'border-slate-200'}`}
          >
            <h2 className="text-sm font-semibold uppercase tracking-wide text-brand-600">{plan.name}</h2>
            <p className="mt-3 text-4xl font-extrabold text-slate-900">
              {plan.price}<span className="text-base font-medium text-slate-500">/mo</span>
            </p>
            <ul className="mt-6 space-y-3 text-sm text-slate-600">
              {plan.features.map((f) => (
                <li key={f} className="flex items-start gap-2">
                  <svg className="mt-0.5 h-4 w-4 text-brand-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  {f}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <p className="mt-10 text-center text-sm text-slate-500">Billing is handled in-app. Payment provider coming soon.</p>
    </main>
  );
}
