import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import type { OpportunityStatus, RecoveryAuditEntry, RevenueOpportunity } from '../../types/database';
import { OPPORTUNITY_STATUSES, OPPORTUNITY_TYPE_LABELS } from '../../types/database';
import { Badge, Button, Card, ErrorState, EmptyState, Modal, Select, Spinner, StatCard } from '../../components/ui';
import PageHeader from '../../components/layout/PageHeader';

import { computeStats, dismiss, listAudit, listOpportunities, markRecovered, runScan, takeAction } from '../../services/recovery';

const statusBadge: Record<OpportunityStatus, string> = {
  detected: 'bg-slate-100 text-slate-700 border-slate-200',
  action_required: 'bg-amber-50 text-amber-700 border-amber-200',
  in_progress: 'bg-sky-50 text-sky-700 border-sky-200',
  recovered: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  dismissed: 'bg-slate-50 text-slate-400 border-slate-200',
};

function ageOf(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return '1 day';
  if (days < 30) return `${days} days`;
  const months = Math.floor(days / 30);
  return `${months} month${months > 1 ? 's' : ''}`;
}

function formatValue(opp: RevenueOpportunity): string {
  // Never invented: null shows "Value unknown"
  return opp.estimated_value != null ? `£${Number(opp.estimated_value).toLocaleString('en-GB')}` : 'Value unknown';
}

export default function RecoveryPage() {
  const { activeBusiness } = useAuth();
  const [opps, setOpps] = useState<RevenueOpportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanMsg, setScanMsg] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('open');
  const [detail, setDetail] = useState<RevenueOpportunity | null>(null);

  const load = useCallback(async () => {
    if (!activeBusiness) return;
    setLoading(true);
    setError(null);
    try {
      setOpps(await listOpportunities(activeBusiness.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load opportunities');
    } finally {
      setLoading(false);
    }
  }, [activeBusiness]);

  useEffect(() => { load(); }, [load]);

  const stats = useMemo(() => computeStats(opps), [opps]);

  const filtered = useMemo(() => {
    if (statusFilter === 'open') return opps.filter((o) => !['recovered', 'dismissed'].includes(o.status));
    if (statusFilter === 'all') return opps;
    return opps.filter((o) => o.status === statusFilter);
  }, [opps, statusFilter]);

  async function handleScan() {
    if (!activeBusiness) return;
    setScanning(true);
    setScanMsg(null);
    try {
      const r = await runScan(activeBusiness.id);
      setScanMsg(`Scan complete: ${r.scanned} checked, ${r.created} new, ${r.updated} promoted to Action Required.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Scan failed');
    } finally {
      setScanning(false);
    }
  }

  async function act(fn: () => Promise<unknown>) {
    try { await fn(); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Action failed'); }
  }

  return (
    <div>
      <PageHeader
        title="Revenue Recovery"
        subtitle="Automatically surfaced opportunities to win back revenue — unanswered leads, missed calls, no-shows, abandoned enquiries and more."
        action={<Button onClick={handleScan} disabled={scanning}>{scanning ? 'Scanning…' : 'Run scan'}</Button>}
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Opportunities detected" value={stats.detected} hint="Open + resolved, all time" />
        <StatCard label="Acted upon" value={stats.actedUpon} hint="Actions started" />
        <StatCard label="Recovered revenue" value={stats.recoveredRevenue != null ? `£${stats.recoveredRevenue.toLocaleString('en-GB')}` : '—'} hint={stats.recoveredRevenue != null ? `${stats.recoveredCount} recovered` : 'No known values yet'} />
        <StatCard label="Action rate" value={stats.conversionRate != null ? `${Math.round(stats.conversionRate * 100)}%` : '—'} hint="Acted on / detected" />
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-auto">
          <option value="open">Open opportunities</option>
          {OPPORTUNITY_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          <option value="all">All</option>
        </Select>
        {scanMsg && <p className="text-sm text-emerald-700">{scanMsg}</p>}
      </div>

      {loading ? <Card><Spinner label="Loading opportunities…" /></Card>
        : error ? <ErrorState message={error} onRetry={load} />
        : filtered.length === 0 ? (
          <Card><EmptyState title="No open opportunities" description="Nothing looks lost right now. Run a scan to check for unanswered leads, missed calls, no-shows and dormant customers." action={<Button onClick={handleScan} disabled={scanning}>{scanning ? 'Scanning…' : 'Run scan'}</Button>} /></Card>
        ) : (
          <div className="space-y-3">
            {filtered.map((o) => (
              <Card key={o.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-slate-900">{o.title}</p>
                      <Badge className={statusBadge[o.status]}>{OPPORTUNITY_STATUSES.find((s) => s.value === o.status)?.label}</Badge>
                      <Badge className="border-slate-200 bg-slate-50 text-slate-600">{OPPORTUNITY_TYPE_LABELS[o.opportunity_type]}</Badge>
                    </div>
                    <p className="mt-1 text-sm text-slate-500">{o.reason}</p>
                    <p className="mt-1 text-xs text-slate-400">
                      {formatValue(o)} · Age {ageOf(o.detected_at)} · Recommended: {(o.ai_recommendation ?? o.recommended_action).replace('_', ' ')}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {!['recovered', 'dismissed'].includes(o.status) && (
                      <>
                        <Button disabled={o.status === 'in_progress'} onClick={() => act(() => takeAction(activeBusiness!.id, o))}>
                          {o.status === 'in_progress' ? 'In progress' : 'Take action'}
                        </Button>
                        <Button variant="secondary" onClick={() => act(() => markRecovered(activeBusiness!.id, o))}>Mark recovered</Button>
                        <Button variant="ghost" onClick={() => act(() => dismiss(activeBusiness!.id, o))}>Dismiss</Button>
                      </>
                    )}
                    <Button variant="ghost" onClick={() => setDetail(o)}>Audit trail</Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}

      {detail && <AuditModal opportunity={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

function AuditModal({ opportunity, onClose }: { opportunity: RevenueOpportunity; onClose: () => void }) {
  const { activeBusiness } = useAuth();
  const [entries, setEntries] = useState<RecoveryAuditEntry[] | null>(null);

  useEffect(() => {
    if (!activeBusiness) return;
    listAudit(activeBusiness.id, opportunity.id).then(setEntries);
  }, [activeBusiness, opportunity.id]);

  return (
    <Modal open onClose={onClose} title={`Audit trail — ${opportunity.title}`}>
      <div className="max-h-96 space-y-3 overflow-y-auto">
        {entries === null ? <Spinner /> : entries.length === 0 ? (
          <p className="text-sm text-slate-500">No actions recorded yet.</p>
        ) : entries.map((e) => (
          <div key={e.id} className="flex items-start gap-3 rounded-lg border border-slate-100 p-3">
            <span className={`mt-0.5 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${e.actor === 'automation' ? 'bg-brand-50 text-brand-700' : e.actor === 'ai' ? 'bg-purple-50 text-purple-700' : 'bg-slate-100 text-slate-600'}`}>
              {e.actor}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-800">{e.action.replace(/_/g, ' ')}</p>
              <p className="text-xs text-slate-400">{new Date(e.created_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</p>
              {Object.keys(e.details ?? {}).length > 0 && (
                <p className="mt-1 break-words text-xs text-slate-500">{JSON.stringify(e.details)}</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}
