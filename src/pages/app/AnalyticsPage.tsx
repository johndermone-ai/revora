import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { makePeriod, loadAnalytics, type AnalyticsData, type PeriodPreset } from '../../services/analytics';
import { Badge, Button, Card, CardHeader, ErrorState, Input, Select, Spinner } from '../../components/ui';
import PageHeader from '../../components/layout/PageHeader';

const periodLabels: { value: PeriodPreset; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: 'custom', label: 'Custom range' },
];

function Metric({ label, value, hint, na = false }: { label: string; value: string | number; hint?: string; na?: boolean }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${na ? 'text-slate-300' : 'text-slate-900'}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <Card>
      <div className="border-b border-slate-100 px-5 py-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-900">{title}</h2>
        <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>
      </div>
      <div className="p-5">{children}</div>
    </Card>
  );
}

function LeadsChart({ buckets }: { buckets: { label: string; count: number }[] }) {
  const max = Math.max(...buckets.map((b) => b.count), 1);
  return (
    <div className="mt-5 rounded-xl border border-slate-100 bg-slate-50/50 p-4">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Leads created over time</p>
      <div className="flex h-32 items-end gap-1 overflow-x-auto">
        {buckets.map((b, i) => (
          <div key={i} className="flex min-w-[24px] flex-1 flex-col items-center justify-end gap-1">
            <span className="text-[10px] font-medium text-slate-500">{b.count > 0 ? b.count : ''}</span>
            <div
              className="w-full rounded-t bg-brand-500/80"
              style={{ height: `${Math.max((b.count / max) * 100, b.count > 0 ? 6 : 2)}%`, minHeight: b.count > 0 ? 6 : 2 }}
              title={`${b.label}: ${b.count}`}
            />
            <span className="whitespace-nowrap text-[9px] text-slate-400">{b.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AnalyticsPage() {
  const { activeBusiness } = useAuth();
  const [preset, setPreset] = useState<PeriodPreset>('30d');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!activeBusiness) return;
    setLoading(true);
    setError(null);
    try {
      setData(await loadAnalytics(activeBusiness.id, makePeriod(preset, from, to)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load analytics');
    } finally {
      setLoading(false);
    }
  }, [activeBusiness, preset, from, to]);

  useEffect(() => { load(); }, [load]);

  const money = (n: number) => `£${n.toLocaleString('en-GB')}`;

  return (
    <div>
      <PageHeader
        title="Revenue Analytics"
        subtitle="Every number here comes from real records. Where data doesn't exist yet, it says so — nothing is estimated or invented."
        action={
          <div className="flex flex-wrap items-center gap-2">
            {preset === 'custom' && (
              <>
                <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-auto" />
                <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-auto" />
              </>
            )}
            <Select value={preset} onChange={(e) => setPreset(e.target.value as PeriodPreset)} className="w-auto">
              {periodLabels.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </Select>
          </div>
        }
      />

      {loading ? <Card><Spinner label="Computing metrics…" /></Card>
        : error ? <ErrorState message={error} onRetry={load} />
        : !data ? null : (
          <div className="space-y-6">

            {/* ---- Revenue: three clearly separated kinds ---- */}
            <Card>
              <div className="border-b border-slate-100 px-5 py-4">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-900">Revenue</h2>
                <p className="mt-0.5 text-xs text-slate-500">Actual vs estimated vs recovered — never mixed.</p>
              </div>
              <div className="grid gap-4 p-5 sm:grid-cols-3">
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Actual revenue</p>
                    <Badge className="border-slate-200 bg-slate-100 text-slate-600">Payments</Badge>
                  </div>
                  <p className="mt-1 text-2xl font-bold text-slate-300">—</p>
                  <p className="mt-1 text-xs text-slate-400">No payments or invoicing source is connected yet, so no actual revenue figure is shown. When invoicing lands, this uses real paid amounts only.</p>
                </div>
                <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4">
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-medium uppercase tracking-wide text-amber-700">Estimated opportunity value</p>
                    <Badge className="border-amber-200 bg-amber-100 text-amber-700">Estimated</Badge>
                  </div>
                  <p className="mt-1 text-2xl font-bold text-amber-800">{data.recovery.openValueKnown ? money(data.recovery.openEstimatedValue) : '—'}</p>
                  <p className="mt-1 text-xs text-amber-700/80">Open recovery opportunities, valued only from figures leads gave you. {data.recovery.openValueKnown ? '' : 'No known values yet.'}</p>
                </div>
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4">
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-medium uppercase tracking-wide text-emerald-700">Recovered revenue</p>
                    <Badge className="border-emerald-200 bg-emerald-100 text-emerald-700">Recovered</Badge>
                  </div>
                  <p className="mt-1 text-2xl font-bold text-emerald-800">{data.recovery.recoveredRevenueKnown ? money(data.recovery.recoveredRevenue) : '—'}</p>
                  <p className="mt-1 text-xs text-emerald-700/80">{data.recovery.recovered} opportunit{data.recovery.recovered === 1 ? 'y' : 'ies'} recovered this period{data.recovery.recoveredRevenueKnown ? `, ${money(data.recovery.recoveredRevenue)} from lead-provided values` : ' — value unknown where leads gave none'}.</p>
                </div>
              </div>
            </Card>

            {/* ---- Leads ---- */}
            <Section title="Lead metrics" subtitle="Across the selected period">
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
                <Metric label="Total leads" value={data.leads.totalAllTime} hint="All time" />
                <Metric label="New leads" value={data.leads.newLeads} />
                <Metric label="Qualified" value={data.leads.qualified} />
                <Metric label="Won" value={data.leads.won} />
                <Metric label="Lost" value={data.leads.lost} />
                <Metric label="Conversion rate" value={data.leads.conversionRate != null ? `${data.leads.conversionRate}%` : '—'} hint={data.leads.conversionRate != null ? 'Won ÷ (won + lost)' : 'No closed outcomes yet'} na={data.leads.conversionRate == null} />
              </div>
              {data.hasChartData
                ? <LeadsChart buckets={data.leads.buckets} />
                : <p className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">The leads-over-time chart appears once there are enough lead records to make it meaningful.</p>}
            </Section>

            {/* ---- Voice ---- */}
            <Section title="Voice metrics" subtitle="AI voice agent">
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
                <Metric label="Total calls" value={data.voice.totalCalls ?? '—'} na={data.voice.totalCalls == null} hint={data.voice.agentConnected ? 'From call records' : 'Connect the voice agent'} />
                <Metric label="Answered" value={data.voice.answeredCalls ?? '—'} na={data.voice.answeredCalls == null} hint={data.voice.agentConnected ? 'From call records' : 'Connect the voice agent'} />
                <Metric label="Missed" value={data.voice.missedCalls ?? '—'} na={data.voice.missedCalls == null} hint={data.voice.agentConnected ? 'From call records' : 'Connect the voice agent'} />
                <Metric label="Transfers" value={data.voice.transfers ?? '—'} na={data.voice.transfers == null} hint={data.voice.agentConnected ? 'To a human' : 'Connect the voice agent'} />
                <Metric label="Leads generated" value={data.voice.leadsGenerated} hint="From voice calls & bookings" />
                <Metric label="Appointments generated" value={data.voice.appointmentsGenerated} hint="Booked via the voice flow" />
              </div>
              <p className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
                {data.voice.agentConnected
                  ? 'Call counts come from real call records delivered by your voice provider.'
                  : 'Call counts stay blank until a voice provider is connected — they are never invented. Leads and appointments generated through the AI voice booking flow are real and shown above.'}
              </p>
            </Section>

            {/* ---- Sales ---- */}
            <Section title="Sales metrics" subtitle="Proposals and follow-up performance">
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
                <Metric label="Proposals sent" value={data.sales.proposalsSent} hint="Leads reaching proposal stage" />
                <Metric label="Proposals accepted" value={data.sales.proposalsAccepted} hint="Conversions this period" />
                <Metric label="Avg conversion time" value={data.sales.avgConversionDays != null ? `${data.sales.avgConversionDays}d` : '—'} hint="Created → won" na={data.sales.avgConversionDays == null} />
                <Metric label="Follow-ups sent" value={`${data.sales.followUpsSent}/${data.sales.followUpsCreated}`} hint={data.sales.followUpSendRate != null ? `${data.sales.followUpSendRate}% of drafts` : 'Delivery needs email integration'} />
                <Metric label="Overdue follow-ups" value={data.sales.overdueFollowUps} hint="Past due, still active" />
              </div>
            </Section>

            {/* ---- Revenue recovery ---- */}
            <Section title="Revenue recovery" subtitle="From the recovery engine, this period">
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
                <Metric label="Opportunities detected" value={data.recovery.detected} />
                <Metric label="Opportunities recovered" value={data.recovery.recovered} />
                <Metric label="Recovered revenue" value={data.recovery.recoveredRevenueKnown ? money(data.recovery.recoveredRevenue) : '—'} hint={data.recovery.recoveredRevenueKnown ? 'Lead-provided values' : 'Value unknown'} na={!data.recovery.recoveredRevenueKnown} />
              </div>
            </Section>

            {/* ---- Customers ---- */}
            <Section title="Customer metrics" subtitle="Conversion and retention">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Metric label="New customers" value={data.customers.newCustomers} hint="Created this period" />
                <Metric label="Returning customers" value={data.customers.returningCustomers} hint="2+ appointments ever" />
                <Metric label="Inactive customers" value={data.customers.inactiveCustomers} hint="90+ days without activity" />
              </div>
            </Section>

          </div>
        )}
    </div>
  );
}
