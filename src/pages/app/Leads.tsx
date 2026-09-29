import { FormEvent, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { useBusinessData } from '../../hooks/useBusinessData';
import { changeStatus, createLead } from '../../services/leads';
import type { Lead, LeadSource, LeadStatus } from '../../types/database';
import { LEAD_SOURCES, LEAD_STATUSES } from '../../types/database';
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, Modal, Select, Spinner, Textarea } from '../../components/ui';
import PageHeader from '../../components/layout/PageHeader';
import { formatDate, relativeTime } from '../../lib/format';
import { scoreBand } from '../../lib/leadScoring';
import { normalizeLeadRows, parseCsv } from '../../lib/csv';

type ViewMode = 'list' | 'pipeline';

export default function Leads() {
  const { activeBusiness } = useAuth();
  const { data, loading, error, refetch } = useBusinessData<Lead>('leads', activeBusiness?.id ?? null, { order: 'created_at' });

  const [view, setView] = useState<ViewMode>('list');
  const [search, setSearch] = useState('');
  const [fStatus, setFStatus] = useState<string>('');
  const [fSource, setFSource] = useState<string>('');
  const [fAssignee, setFAssignee] = useState<string>('');
  const [fDue, setFDue] = useState<string>('');
  const [minScore, setMinScore] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const [testErr, setTestErr] = useState<string | null>(null);
  const captureUrl = `${window.location.origin}/capture/${activeBusiness?.id ?? ''}`;

  async function sendTestEnquiry() {
    if (!activeBusiness) return;
    setTesting(true);
    setTestMsg(null);
    setTestErr(null);
    try {
      const stamp = Date.now().toString().slice(-6);
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/capture-lead`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessId: activeBusiness.id,
          name: `Test Enquiry ${stamp}`,
          email: `test-${stamp}@example.com`,
          service_interest: 'Automated web form test',
          notes: 'Created by the "Send a test enquiry" button — delete this lead whenever you like.',
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Test failed');
      setTestMsg('Lead arrived automatically — check the top of the list.');
      refetch();
    } catch (e) {
      setTestErr(e instanceof Error ? e.message : 'Test failed');
    } finally {
      setTesting(false);
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return data.filter((l) => {
      if (q) {
        const hay = `${l.name} ${l.email ?? ''} ${l.phone ?? ''} ${l.company ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (fStatus && l.status !== fStatus) return false;
      if (fSource && l.source !== fSource) return false;
      if (fAssignee) {
        if (fAssignee === 'unassigned' && l.assigned_to) return false;
        if (fAssignee !== 'unassigned' && l.assigned_to !== fAssignee) return false;
      }
      if (minScore && l.lead_score < parseInt(minScore, 10)) return false;
      if (fromDate && new Date(l.created_at) < new Date(fromDate)) return false;
      if (fDue === 'overdue' && !(l.next_follow_up_at && new Date(l.next_follow_up_at).getTime() < Date.now() && !['won', 'lost'].includes(l.status))) return false;
      if (fDue === 'upcoming' && !(l.next_follow_up_at && new Date(l.next_follow_up_at).getTime() >= Date.now())) return false;
      return true;
    });
  }, [data, search, fStatus, fSource, fAssignee, minScore, fromDate, fDue]);

  const clearFilters = () => { setSearch(''); setFStatus(''); setFSource(''); setFAssignee(''); setMinScore(''); setFromDate(''); setFDue(''); };

  return (
    <div>
      <PageHeader
        title="Leads"
        subtitle="Every potential customer, captured and organised in one pipeline."
        action={<div className="flex gap-2"><Button variant="secondary" onClick={() => setImportOpen(true)}>Import CSV</Button><Button onClick={() => setCreateOpen(true)}>New lead</Button></div>}
      />
      {/* ----------------------------------------------------------
        Automatic lead capture — the channels that create leads FOR
        you. Manual entry is only a fallback; every block here is a
        live automation path. "Send test enquiry" pushes a real lead
        through the real public endpoint (no auth) to prove it works.
        ---------------------------------------------------------- */}
      <Card className="mb-6 border-brand-200 bg-brand-50/40">
        <div className="grid gap-4 p-5 md:grid-cols-3">
          <div>
            <p className="text-sm font-semibold text-slate-900">Web form (live)</p>
            <p className="mt-1 text-xs text-slate-500">Share this link or embed it — every submission becomes a lead automatically.</p>
            <div className="mt-2 flex items-center gap-2">
              <code className="flex-1 truncate rounded-lg bg-white px-2 py-1.5 text-xs text-slate-700">{captureUrl}</code>
              <Button variant="secondary" onClick={() => { navigator.clipboard.writeText(captureUrl); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? 'Copied' : 'Copy'}</Button>
            </div>
            <button onClick={sendTestEnquiry} className="mt-2 text-xs font-medium text-brand-700 hover:underline disabled:text-slate-400" disabled={testing}>
              {testing ? 'Sending…' : 'Send a test enquiry →'}
            </button>
            {testMsg && <p className="mt-1 text-xs text-emerald-700">{testMsg}</p>}
            {testErr && <p className="mt-1 text-xs text-red-600">{testErr}</p>}
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-900">Phone (AI voice agent)</p>
            <p className="mt-1 text-xs text-slate-500">Connect Retell AI or Vapi and every answered call creates or updates a lead, books appointments and logs itself.</p>
            <Link to="/app/voice" className="mt-2 inline-block text-xs font-medium text-brand-700 hover:underline">Set up the voice agent →</Link>
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-900">API / webhooks (external systems)</p>
            <p className="mt-1 text-xs text-slate-500">Push leads from any other tool with your Revora API key — deduplicated automatically.</p>
            <Link to="/app/integrations" className="mt-2 inline-block text-xs font-medium text-brand-700 hover:underline">Get your API key →</Link>
          </div>
        </div>
      </Card>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg border border-slate-200 bg-white p-0.5">
          {(['list', 'pipeline'] as ViewMode[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium capitalize ${view === v ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
            >
              {v}
            </button>
          ))}
        </div>
        <Input
          className="max-w-xs"
          placeholder="Search leads…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search leads"
        />
      </div>

      {view === 'list' ? (
        <>
          <div className="mb-4 flex flex-wrap gap-2">
            <Select className="w-auto" value={fStatus} onChange={(e) => setFStatus(e.target.value)} aria-label="Filter by status">
              <option value="">All statuses</option>
              {LEAD_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </Select>
            <Select className="w-auto" value={fSource} onChange={(e) => setFSource(e.target.value)} aria-label="Filter by source">
              <option value="">All sources</option>
              {LEAD_SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </Select>
            <Select className="w-auto" value={minScore} onChange={(e) => setMinScore(e.target.value)} aria-label="Minimum score">
              <option value="">Any score</option>
              <option value="50">Score 50+</option>
              <option value="75">Score 75+</option>
            </Select>
            <Select className="w-auto" value={fDue} onChange={(e) => setFDue(e.target.value)} aria-label="Follow-up filter">
              <option value="">Any follow-up</option>
              <option value="overdue">Overdue follow-ups</option>
              <option value="upcoming">Upcoming follow-ups</option>
            </Select>
            <Input className="w-auto" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} aria-label="Created from" />
            <Button variant="ghost" onClick={clearFilters}>Clear</Button>
          </div>
          <Card>
            {loading ? <Spinner /> : error ? <ErrorState message={error} onRetry={refetch} /> : filtered.length === 0 ? (
              <EmptyState
                title={data.length === 0 ? 'No leads yet' : 'No leads match your filters'}
                description={data.length === 0 ? 'Add your first lead manually, or capture one from your website once the chat widget is live.' : 'Try clearing the filters to see all leads.'}
                action={data.length === 0 ? <Button onClick={() => setCreateOpen(true)}>Create your first lead</Button> : undefined}
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-5 py-3 font-medium">Name</th>
                      <th className="px-5 py-3 font-medium">Source</th>
                      <th className="px-5 py-3 font-medium">Status</th>
                      <th className="px-5 py-3 font-medium">Score</th>
                      <th className="px-5 py-3 font-medium">Follow-up</th>
                      <th className="px-5 py-3 font-medium">Created</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filtered.map((l) => {
                      const band = scoreBand(l.lead_score);
                      return (
                        <tr key={l.id} className="hover:bg-slate-50">
                          <td className="px-5 py-3">
                            <Link to={`/app/leads/${l.id}`} className="font-medium text-slate-900 hover:text-brand-700">{l.name}</Link>
                            <p className="text-xs text-slate-500">{l.email ?? l.phone ?? l.company ?? '—'}</p>
                          </td>
                          <td className="px-5 py-3 capitalize text-slate-600">{l.source.replace('_', ' ')}</td>
                          <td className="px-5 py-3 text-slate-600">{LEAD_STATUSES.find((s) => s.value === l.status)?.label}</td>
                          <td className="px-5 py-3"><Badge className={band.className}>{l.lead_score} · {band.label}</Badge></td>
                          <td className="px-5 py-3 text-slate-600">{l.next_follow_up_at ? formatDate(l.next_follow_up_at) : '—'}</td>
                          <td className="px-5 py-3 text-slate-500">{relativeTime(l.created_at)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      ) : (
        <PipelineView leads={filtered} loading={loading} onMoved={refetch} />
      )}

      <NewLeadModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={refetch} />
      <CsvImportModal open={importOpen} onClose={() => setImportOpen(false)} onDone={(msg) => { setImportOpen(false); refetch(); }} />
    </div>
  );
}

function PipelineView({ leads, loading, onMoved }: { leads: Lead[]; loading: boolean; onMoved: () => void }) {
  const { activeBusiness } = useAuth();
  const [dragging, setDragging] = useState<Lead | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (loading) return <Card><Spinner /></Card>;

  async function handleDrop(status: LeadStatus) {
    setDropTarget(null);
    if (!dragging || !activeBusiness || dragging.status === status) { setDragging(null); return; }
    setError(null);
    try {
      await changeStatus(activeBusiness.id, dragging, status);
      onMoved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not move the lead.');
    }
    setDragging(null);
  }

  const columns: { status: LeadStatus; label: string }[] = [
    { status: 'new', label: 'New' },
    { status: 'contacted', label: 'Contacted' },
    { status: 'qualified', label: 'Qualified' },
    { status: 'proposal_sent', label: 'Proposal' },
    { status: 'negotiation', label: 'Negotiation' },
    { status: 'won', label: 'Won' },
    { status: 'lost', label: 'Lost' },
  ];

  return (
    <div>
      {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <p className="mb-3 hidden text-xs text-slate-500 sm:block">Tip: drag a lead card to another column to change its status.</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        {columns.map((col) => {
          const items = leads.filter((l) => l.status === col.status);
          return (
            <div
              key={col.status}
              onDragOver={(e) => { e.preventDefault(); setDropTarget(col.status); }}
              onDragLeave={() => setDropTarget(null)}
              onDrop={() => handleDrop(col.status)}
              className={`rounded-xl border p-2 transition-colors ${
                dropTarget === col.status ? 'border-brand-400 bg-brand-50' : 'border-slate-200 bg-slate-100/60'
              }`}
            >
              <div className="flex items-center justify-between px-2 py-1.5">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">{col.label}</span>
                <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-slate-500">{items.length}</span>
              </div>
              <div className="mt-1 space-y-2">
                {items.length === 0 && <p className="px-2 py-4 text-center text-xs text-slate-400">Empty</p>}
                {items.map((l) => {
                  const band = scoreBand(l.lead_score);
                  return (
                    <div
                      key={l.id}
                      draggable
                      onDragStart={() => setDragging(l)}
                      onDragEnd={() => { setDragging(null); setDropTarget(null); }}
                      className={`cursor-grab rounded-lg border border-slate-200 bg-white p-3 shadow-sm hover:shadow ${dragging?.id === l.id ? 'opacity-40' : ''}`}
                    >
                      <Link to={`/app/leads/${l.id}`} className="block text-sm font-medium text-slate-900 hover:text-brand-700">{l.name}</Link>
                      {l.service_interest && <p className="mt-0.5 truncate text-xs text-slate-500">{l.service_interest}</p>}
                      <div className="mt-2 flex items-center justify-between">
                        <Badge className={band.className}>{l.lead_score}</Badge>
                        <span className="text-[10px] uppercase text-slate-400">{l.source.replace('_', ' ')}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function NewLeadModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const { activeBusiness } = useAuth();
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '', email: '', phone: '', company: '', source: 'manual' as LeadSource,
    service_interest: '', notes: '', urgency: '', budget: '', next_follow_up_at: '',
  });
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!activeBusiness) return;
    setSaving(true);
    setFormError(null);
    try {
      await createLead(activeBusiness.id, {
        name: form.name,
        email: form.email || null,
        phone: form.phone || null,
        company: form.company || null,
        source: form.source,
        service_interest: form.service_interest || null,
        notes: form.notes || null,
        urgency: form.urgency || null,
        budget: form.budget || null,
        next_follow_up_at: form.next_follow_up_at ? new Date(form.next_follow_up_at).toISOString() : null,
      });
      onCreated();
      setForm({ name: '', email: '', phone: '', company: '', source: 'manual', service_interest: '', notes: '', urgency: '', budget: '', next_follow_up_at: '' });
      onClose();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not create lead');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="New lead">
      <form className="space-y-4" onSubmit={handleSubmit}>
        <Field label="Name"><Input required value={form.name} onChange={set('name')} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Email"><Input type="email" value={form.email} onChange={set('email')} /></Field>
          <Field label="Phone"><Input value={form.phone} onChange={set('phone')} /></Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Company"><Input value={form.company} onChange={set('company')} /></Field>
          <Field label="Source">
            <Select value={form.source} onChange={set('source')}>
              {LEAD_SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Service interest"><Input value={form.service_interest} onChange={set('service_interest')} placeholder="e.g. Kitchen renovation" /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Urgency">
            <Select value={form.urgency} onChange={set('urgency')}>
              <option value="">Unknown</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
            </Select>
          </Field>
          <Field label="Budget"><Input value={form.budget} onChange={set('budget')} placeholder="e.g. £5k–10k" /></Field>
        </div>
        <Field label="Notes"><Textarea value={form.notes} onChange={set('notes')} /></Field>
        <Field label="Next follow-up (optional)"><Input type="datetime-local" value={form.next_follow_up_at} onChange={set('next_follow_up_at')} /></Field>
        {formError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{formError}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Create lead'}</Button>
        </div>
      </form>
    </Modal>
  );
}


function CsvImportModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (message: string) => void }) {
  const { activeBusiness } = useAuth();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    if (!activeBusiness) return;
    setBusy(true);
    setErr(null);
    try {
      const rows = parseCsv(text);
      const { unique: toInsert, skipped, duplicates } = normalizeLeadRows(rows);
      if (toInsert.length === 0) throw new Error('No importable rows found. The CSV needs a name column and at least one data row.');

      const payload = toInsert.map((r) => ({
        business_id: activeBusiness.id,
        name: r.name,
        email: r.email || null,
        phone: r.phone || null,
        company: r.company || null,
        service_interest: r.service_interest || null,
        budget: r.budget || null,
        notes: r.notes || null,
        source: 'other',
        status: 'new',
        lead_score: 10,
      }));

      const { error } = await supabase.from('leads').insert(payload);
      if (error) throw error;

      await supabase.from('activities').insert({
        business_id: activeBusiness.id,
        entity_type: 'automation',
        entity_id: activeBusiness.id,
        type: 'csv_import',
        title: `CSV import: ${payload.length} leads added`,
        description: `${payload.length} imported${skipped ? `, ${skipped} skipped (missing name)` : ''}${duplicates ? `, ${duplicates} duplicate${duplicates === 1 ? '' : 's'} removed` : ''}.`,
      });

      onDone(`Imported ${payload.length} lead${payload.length === 1 ? '' : 's'}${skipped ? `, skipped ${skipped} invalid row${skipped === 1 ? '' : 's'}` : ''}${duplicates ? `, removed ${duplicates} duplicate${duplicates === 1 ? '' : 's'}` : ''}.`);
      setText('');
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Import leads from CSV">
      <div className="space-y-4">
        <p className="text-sm text-slate-500">
          Load a CSV file or paste its contents. Expected columns:
          <code className="mx-1 rounded bg-slate-100 px-1 py-0.5 text-xs">name,email,phone,company,service_interest,budget,notes</code>
          — name required, everything else optional. Parsed in your browser; only the resulting records are saved.
        </p>
        <input
          type="file" accept=".csv,text/csv" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (file) setText(await file.text());
          }}
        />
        <Textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder={'name,email,phone,service_interest\nJane Doe,jane@example.com,07…,Haircut'} />
        {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button disabled={busy || text.trim().length === 0} onClick={run}>{busy ? 'Importing…' : 'Import'}</Button>
        </div>
      </div>
    </Modal>
  );
}
