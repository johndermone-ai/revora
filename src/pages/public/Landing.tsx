import { Link } from 'react-router-dom';

const pillars = [
  { title: 'Capture', text: 'Website, phone, WhatsApp and email leads land in one pipeline.' },
  { title: 'Qualify', text: 'Transparent lead scoring and AI-assisted qualification summaries.' },
  { title: 'Convert', text: 'Follow-ups, proposals and reminders that keep deals moving.' },
  { title: 'Retain', text: 'Customer records and activity history from the moment a lead is won.' },
];

export default function Landing() {
  return (
    <main>
      <section className="mx-auto max-w-6xl px-4 pt-20 pb-24 sm:px-6">
        <div className="mx-auto max-w-3xl text-center">
          <span className="rv-fade-up inline-flex items-center rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700">
            AI Customer-to-Revenue Platform
          </span>
          <h1 className="rv-fade-up-1 mt-6 text-4xl font-extrabold tracking-tight text-slate-900 sm:text-5xl">
            Capture. Qualify. Convert. Retain.
          </h1>
          <p className="rv-fade-up-2 mt-6 text-lg leading-8 text-slate-600">
            Revora helps small businesses turn every enquiry into revenue — one organised pipeline,
            clear follow-ups, and your customer history in one place.
          </p>
          <div className="rv-fade-up-3 mt-10 flex items-center justify-center gap-3">
            <Link to="/signup" className="rounded-lg bg-brand-600 px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-brand-700">
              Start free
            </Link>
            <Link to="/pricing" className="rounded-lg border border-slate-200 px-6 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              See pricing
            </Link>
          </div>
        </div>

        <div className="mt-20 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {pillars.map((p, idx) => (
            <div key={p.title} className={`rv-fade-up-${idx + 1} rounded-xl border border-slate-200 bg-white p-6 shadow-sm transition-transform hover:-translate-y-1`}>
              <h3 className="font-semibold text-slate-900">{p.title}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">{p.text}</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
