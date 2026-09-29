import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { approveFollowUp, cancelFollowUp, changeStatus, convertLeadToCustomer, generateFollowUpDraft, rescoreLead, runAiQualification, scheduleFollowUp, saveFollowUp, updateLead } from '../../services/leads';
import type { Activity, AiQualification, FollowUp, Lead, Task } from '../../types/database';
import { LEAD_STATUSES } from '../../types/database';
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, Field, Modal, Select, Spinner, Textarea } from '../../components/ui';
import PageHeader from '../../components/layout/PageHeader';
import { formatDateTime, relativeTime } from '../../lib/format';
import { scoreBand, scoreLead } from '../../lib/leadScoring';

export default function LeadDetail() {
  const { leadId } = useParams<{ leadId: string }>();
  const { activeBusiness } = useAuth();
  const navigate = useNavigate();

  const [lead, setLead] = useState<Lead | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [ai, setAi] = useState<AiQualification | null>(null);
  const [aiRunning, setAiRunning] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const [genOpen, setGenOpen] = useState(false);
  const [genAction, setGenAction] = useState('move the conversation forward');
  const [genChannel, setGenChannel] = useState<FollowUp['channel']>('email');
  const [genBusy, setGenBusy] = useState(false);

  const [convertOpen, setConvertOpen] = useState(false);
  const [convertBusy, setConvertBusy] = useState(false);
  const [convertError, setConvertError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!leadId || !activeBusiness) return;
    setLoading(true);
    setError(null);
    const [leadRes, actRes, taskRes, fuRes, aiRes] = await Promise.all([
      supabase.from('leads').select('*').eq('id', leadId).eq('business_id', activeBusiness.id).single(),
      supabase.from('activities').select('*').eq('entity_id', leadId).order('created_at', { ascending: false }),
      supabase.from('tasks').select('*').eq('related_lead_id', leadId).order('created_at', { ascending: false }),
      supabase.from('follow_ups').select('*').eq('lead_id', leadId).order('created_at', { ascending: false }),
      supabase.from('ai_qualifications').select('*').eq('lead_id', leadId).order('created_at', { ascending: false }).limit(1),
    ]);
    if (leadRes.error || !leadRes.data) setError('Lead not found.');
    else setLead(leadRes.data as Lead);
    setActivities((actRes.data as Activity[]) ?? []);
    setTasks((taskRes.data as Task[]) ?? []);
    setFollowUps((fuRes.data as FollowUp[]) ?? []);
    setAi((aiRes.data as AiQualification[])[0] ?? null);
    setLoading(false);
  }, [leadId, activeBusiness]);

  useEffect(() => { load(); }, [load]);

  const refreshLead = useCallback(async () => {
    if (!leadId) return;
    const { data } = await supabase.from('leads').select('*').eq('id', leadId).single();
    if (data) setLead(data as Lead);
  }, [leadId]);

  if (loading) return <Spinner label="Loading lead…" />;
  if (error || !lead || !activeBusiness) return <ErrorState message={error ?? 'Lead not found'} onRetry={load} />;

  const band = scoreBand(lead.lead_score);
  const { factors } = scoreLead(lead);

  async function handleAiRun() {
    setAiRunning(true);
    setAiError(null);
    try {
      const result = await runAiQualification(activeBusiness!.id, lead!);
      setAi(result);
      await load();
    } catch (e) {
      setAiError(e instanceof Error ? e.message : 'AI qualification failed.');
    } finally {
      setAiRunning(false);
    }
  }

  const [genError, setGenError] = useState<string | null>(null);

  async function handleGenerate() {
    setGenBusy(true);
    setGenError(null);
    try {
      await generateFollowUpDraft(activeBusiness!.id, lead!, genAction, genChannel);
      setGenOpen(false);
      await load();
    } catch (e) {
      setGenError(e instanceof Error ? e.message : 'Could not generate the draft.');
    } finally {
      setGenBusy(false);
    }
  }

  async function handleConvert() {
    setConvertBusy(true);
    setConvertError(null);
    try {
      await convertLeadToCustomer(activeBusiness!.id, lead!);
      setConvertOpen(false);
      navigate('/app/customers');
    } catch (e) {
      setConvertError(e instanceof Error ? e.message : 'Conversion failed.');
    } finally {
      setConvertBusy(false);
    }
  }

  return (
    <div>
      <Link to="/app/leads" className="text-sm text-slate-500 hover:text-slate-900">← Back to leads</Link>
      <PageHeader
        title={lead.name}
        subtitle={`${lead.email ?? 'no email'} · ${lead.phone ?? 'no phone'}${lead.company ? ` · ${lead.company}` : ''}`}
        action={
          <div className="flex gap-2">
            <Select
              className="w-auto"
              value={lead.status}
              onChange={async (e) => { await changeStatus(activeBusiness.id, lead, e.target.value as Lead['status']); await load(); }}
              aria-label="Lead status"
            >
              {LEAD_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </Select>
            {lead.status !== 'won' && lead.status !== 'lost' && (
              <Button onClick={() => setConvertOpen(true)}>Mark as Won</Button>
            )}
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* AI Qualification panel */}
          <Card>
            <CardHeader
              title="AI Qualification"
              action={<Button variant="secondary" onClick={handleAiRun} disabled={aiRunning}>{aiRunning ? 'Analysing…' : ai ? 'Re-analyse Lead' : 'Analyse Lead'}</Button>}
            />
            <div className="p-5">
              {aiError && (
                <div className="mb-4 rounded-lg bg-red-50 px-3 py-2">
                  <p className="text-sm text-red-700">{aiError}</p>
                  <p className="mt-1 text-xs text-red-500">The lead is safe - nothing was changed. You can retry above.</p>
                </div>
              )}
              {!ai && !aiRunning && !aiError && (
                <p className="text-sm text-slate-500">
                  Run an AI analysis for a qualification summary, intent, urgency, recommended next action and suggested questions.
                  Results are suggestions only - nothing is applied to the lead automatically.
                </p>
              )}
              {ai && (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className={scoreBand(ai.score).className}>AI score: {ai.score}/100</Badge>
                    <Badge className="border-slate-200 bg-slate-50 text-slate-700">Intent: {ai.intent}</Badge>
                    <Badge className="border-slate-200 bg-slate-50 text-slate-700">Urgency: {ai.urgency}</Badge>
                    <Badge className="border-slate-200 bg-slate-50 text-slate-700">{ai.qualification}</Badge>
                  </div>
                  <p className="text-sm leading-6 text-slate-700">{ai.summary}</p>
                  {ai.missing_information.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Missing information</p>
                      <ul className="mt-1 list-inside list-disc text-sm text-slate-600">
                        {ai.missing_information.map((m) => <li key={m}>{m}</li>)}
                      </ul>
                    </div>
                  )}
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Recommended next action</p>
                    <p className="mt-1 text-sm font-medium text-slate-900">{ai.recommended_action}</p>
                  </div>
                  {ai.suggested_questions.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Suggested questions</p>
                      <ul className="mt-1 space-y-1 text-sm text-slate-600">
                        {ai.suggested_questions.map((q) => <li key={q} className="flex gap-2"><span className="text-brand-500">›</span>{q}</li>)}
                      </ul>
                    </div>
                  )}
                  <p className="text-xs text-slate-400">Generated {relativeTime(ai.created_at)} · Suggestions only - review before acting.</p>
                </div>
              )}
            </div>
          </Card>

          {/* Follow-ups */}
          <Card>
            <CardHeader
              title="Follow-ups"
              action={<Button variant="secondary" onClick={() => setGenOpen(true)}>Draft with AI</Button>}
            />
            {followUps.length === 0 ? (
              <EmptyState title="No follow-ups yet" description="Generate an AI draft, edit it, then approve or schedule it. Nothing is ever sent without your approval." />
            ) : (
              <ul className="divide-y divide-slate-100">
                {followUps.map((f) => <FollowUpRow key={f.id} followUp={f} onChanged={load} />)}
              </ul>
            )}
          </Card>

          {/* Activity timeline */}
          <Card>
            <CardHeader title="Activity timeline" />
            {activities.length === 0 ? (
              <EmptyState title="No activity yet" description="Status changes, notes, AI analyses and conversions will appear here." />
            ) : (
              <ul className="divide-y divide-slate-100">
                {activities.map((a) => (
                  <li key={a.id} className="px-5 py-3">
                    <p className="text-sm font-medium text-slate-900">{a.title}</p>
                    {a.description && <p className="mt-0.5 text-sm text-slate-500">{a.description}</p>}
                    <p className="mt-0.5 text-xs text-slate-400">{formatDateTime(a.created_at)}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <Card className="p-5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">Lead score</h3>
              <Badge className={band.className}>{lead.lead_score} · {band.label}</Badge>
            </div>
            <ul className="mt-4 space-y-1.5">
              {factors.map((f) => (
                <li key={f.label} className="flex items-center justify-between gap-2 text-sm">
                  <span className={f.hit ? 'text-slate-600' : 'text-slate-400'}>{f.label}</span>
                  <span className={f.hit ? 'font-medium text-emerald-600' : 'text-slate-300'}>+{f.points}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-slate-400">Rules-based score - fully transparent, not AI. Base of 10 points applies to every lead.</p>
            <Button variant="secondary" className="mt-3 w-full" onClick={async () => { await rescoreLead(activeBusiness.id, lead); await load(); }}>
              Recalculate score
            </Button>
          </Card>

          <Card className="p-5">
            <h3 className="text-sm font-semibold text-slate-900">Details</h3>
            <dl className="mt-3 space-y-2 text-sm">
              <Detail label="Source" value={lead.source.replace('_', ' ')} />
              <Detail label="Service interest" value={lead.service_interest ?? '—'} />
              <Detail label="Urgency" value={lead.urgency ?? 'Unknown'} />
              <Detail label="Budget" value={lead.budget ?? 'Unknown'} />
              <Detail label="Last contacted" value={lead.last_contacted_at ? formatDateTime(lead.last_contacted_at) : 'Never'} />
            </dl>
          </Card>

          <Card className="p-5">
            <h3 className="text-sm font-semibold text-slate-900">Notes</h3>
            <EditableNotes lead={lead} onSaved={refreshLead} />
          </Card>

          <Card className="p-5">
            <h3 className="text-sm font-semibold text-slate-900">Follow-up date</h3>
            <FollowUpDateEditor lead={lead} onSaved={load} />
          </Card>

          <Card className="p-5">
            <h3 className="text-sm font-semibold text-slate-900">Tasks</h3>
            {tasks.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">No tasks for this lead.</p>
            ) : (
              <ul className="mt-2 space-y-1.5 text-sm text-slate-600">
                {tasks.map((t) => <li key={t.id} className="flex justify-between"><span>{t.title}</span><span className="text-xs text-slate-400">{t.status}</span></li>)}
              </ul>
            )}
          </Card>

          <Card className="p-5">
            <h3 className="text-sm font-semibold text-slate-900">Communication history</h3>
            <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
              Email, WhatsApp and SMS threads will appear here once channel integrations are configured.
            </p>
          </Card>

          {lead.converted_at && (
            <Card className="border-emerald-200 bg-emerald-50/50 p-5">
              <h3 className="text-sm font-semibold text-emerald-800">Converted {formatDateTime(lead.converted_at)}</h3>
              {lead.customer_id && (
                <p className="mt-1 text-xs text-emerald-700">
                  Customer record created - <Link className="underline" to="/app/customers">view customers</Link>
                </p>
              )}
            </Card>
          )}
        </div>
      </div>

      {/* AI follow-up generation modal */}
      <Modal open={genOpen} onClose={() => setGenOpen(false)} title="Draft follow-up with AI">
        <div className="space-y-4">
          <Field label="What should the message achieve?">
            <Textarea value={genAction} onChange={(e) => setGenAction(e.target.value)} placeholder="e.g. ask if they are ready to proceed" />
          </Field>
          <Field label="Channel">
            <Select value={genChannel} onChange={(e) => setGenChannel(e.target.value as FollowUp['channel'])}>
              <option value="email">Email</option>
              <option value="whatsapp">WhatsApp (integration coming soon)</option>
              <option value="sms">SMS (integration coming soon)</option>
            </Select>
          </Field>
          {genError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{genError}</p>}
          <p className="text-xs text-slate-500">A draft is saved for your review. Nothing is sent without your approval.</p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setGenOpen(false)}>Cancel</Button>
            <Button onClick={handleGenerate} disabled={genBusy}>{genBusy ? 'Generating…' : 'Generate draft'}</Button>
          </div>
        </div>
      </Modal>

      {/* Convert modal */}
      <Modal open={convertOpen} onClose={() => setConvertOpen(false)} title={`Convert ${lead.name} to customer`}>
        <p className="text-sm text-slate-600">
          This will mark the lead as Won, create a customer record, and record the conversion time.
          The lead and its full history are preserved - never deleted.
        </p>
        {convertError && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{convertError}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConvertOpen(false)}>Cancel</Button>
          <Button onClick={handleConvert} disabled={convertBusy}>{convertBusy ? 'Converting…' : 'Convert to customer'}</Button>
        </div>
      </Modal>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-slate-500 capitalize">{label}</dt>
      <dd className="text-right font-medium text-slate-900 capitalize">{value}</dd>
    </div>
  );
}

function EditableNotes({ lead, onSaved }: { lead: Lead; onSaved: () => void }) {
  const { activeBusiness } = useAuth();
  const [value, setValue] = useState(lead.notes ?? '');
  const [saving, setSaving] = useState(false);
  useEffect(() => setValue(lead.notes ?? ''), [lead.notes]);
  return (
    <div className="mt-2 space-y-2">
      <Textarea value={value} onChange={(e) => setValue(e.target.value)} placeholder="Add context about this lead…" />
      <Button variant="secondary" className="w-full" disabled={saving} onClick={async () => {
        setSaving(true);
        await updateLead(activeBusiness!.id, lead.id, { notes: value });
        setSaving(false);
        onSaved();
      }}>{saving ? 'Saving…' : 'Save notes'}</Button>
    </div>
  );
}

function FollowUpDateEditor({ lead, onSaved }: { lead: Lead; onSaved: () => void }) {
  const { activeBusiness } = useAuth();
  const [value, setValue] = useState(lead.next_follow_up_at ? lead.next_follow_up_at.slice(0, 16) : '');
  const [saving, setSaving] = useState(false);
  return (
    <div className="mt-2 space-y-2">
      <input
        type="datetime-local"
        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <Button variant="secondary" className="w-full" disabled={saving} onClick={async () => {
        setSaving(true);
        await updateLead(activeBusiness!.id, lead.id, { next_follow_up_at: value ? new Date(value).toISOString() : null });
        setSaving(false);
        onSaved();
      }}>{saving ? 'Saving…' : 'Set follow-up'}</Button>
    </div>
  );
}

function FollowUpRow({ followUp, onChanged }: { followUp: FollowUp; onChanged: () => void }) {
  const { activeBusiness } = useAuth();
  const [editing, setEditing] = useState(false);
  const [subject, setSubject] = useState(followUp.subject ?? '');
  const [body, setBody] = useState(followUp.body ?? '');
  const [busy, setBusy] = useState(false);
  const [scheduleValue, setScheduleValue] = useState('');

  const statusBadge: Record<FollowUp['status'], string> = {
    draft: 'bg-slate-50 text-slate-600 border-slate-200',
    pending_approval: 'bg-amber-50 text-amber-700 border-amber-200',
    approved: 'bg-sky-50 text-sky-700 border-sky-200',
    scheduled: 'bg-brand-50 text-brand-700 border-brand-200',
    sent: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    failed: 'bg-red-50 text-red-700 border-red-200',
    cancelled: 'bg-slate-50 text-slate-400 border-slate-200',
  };

  if (editing) {
    return (
      <li className="space-y-2 px-5 py-4">
        {followUp.channel === 'email' && (
          <Field label="Subject"><input className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>
        )}
        <Field label="Message"><Textarea value={body} onChange={(e) => setBody(e.target.value)} /></Field>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setEditing(false)}>Cancel</Button>
          <Button disabled={busy} onClick={async () => {
            setBusy(true);
            await saveFollowUp(followUp.id, { subject: subject || null, body });
            setBusy(false);
            setEditing(false);
            onChanged();
          }}>Save</Button>
        </div>
      </li>
    );
  }

  return (
    <li className="px-5 py-4">
      <div className="flex items-center justify-between gap-2">
        <Badge className={statusBadge[followUp.status]}>{followUp.status.replace('_', ' ')}</Badge>
        <span className="text-xs text-slate-400">{followUp.channel}{followUp.ai_generated ? ' · AI draft' : ''}</span>
      </div>
      {followUp.subject && <p className="mt-2 text-sm font-medium text-slate-900">{followUp.subject}</p>}
      <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{followUp.body}</p>
      {followUp.scheduled_for && <p className="mt-2 text-xs text-slate-500">Scheduled for {formatDateTime(followUp.scheduled_for)}</p>}
      {followUp.status !== 'sent' && followUp.status !== 'cancelled' && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button variant="ghost" onClick={() => setEditing(true)}>Edit</Button>
          {['draft'].includes(followUp.status) && (
            <Button variant="secondary" disabled={busy} onClick={async () => { setBusy(true); await approveFollowUp(activeBusiness!.id, followUp); setBusy(false); onChanged(); }}>Approve</Button>
          )}
          {['draft', 'approved'].includes(followUp.status) && (
            <span className="flex items-center gap-1">
              <input type="datetime-local" className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs" value={scheduleValue} onChange={(e) => setScheduleValue(e.target.value)} aria-label="Schedule date" />
              <Button variant="secondary" disabled={busy || !scheduleValue} onClick={async () => {
                setBusy(true);
                await scheduleFollowUp(activeBusiness!.id, followUp, new Date(scheduleValue).toISOString());
                setBusy(false);
                onChanged();
              }}>Schedule</Button>
            </span>
          )}
          <Button variant="ghost" disabled={busy} onClick={async () => { setBusy(true); await cancelFollowUp(activeBusiness!.id, followUp); setBusy(false); onChanged(); }}>Cancel</Button>
        </div>
      )}
      <p className="mt-2 text-[10px] text-slate-400">Delivery requires a configured email provider - Revora will never mark a message as sent until one is connected.</p>
    </li>
  );
}
