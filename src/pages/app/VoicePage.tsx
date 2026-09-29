import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import type { CallOutcome, VoiceAgent, VoiceCall, VoiceProvider } from '../../types/database';
import { CALL_OUTCOME_LABELS, HANDOFF_RULE_OPTIONS } from '../../types/database';
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, Modal, Select, Spinner, StatCard, Textarea } from '../../components/ui';
import PageHeader from '../../components/layout/PageHeader';
import { connectProvider, disconnectProvider, getVoiceAgent, listCalls, saveVoiceSettings, type VoiceSettingsPatch } from '../../services/voice';

const outcomeBadge: Record<CallOutcome, string> = {
  lead_created: 'bg-brand-50 text-brand-700 border-brand-200',
  appointment_booked: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  customer_support: 'bg-sky-50 text-sky-700 border-sky-200',
  human_transfer: 'bg-amber-50 text-amber-700 border-amber-200',
  spam: 'bg-slate-100 text-slate-500 border-slate-200',
  other: 'bg-slate-50 text-slate-600 border-slate-200',
};

function ConnectModal({ open, onClose, onConnected, initialProvider }: {
  open: boolean; onClose: () => void; onConnected: (r: { webhookUrl: string; complianceReminder: string }) => void; initialProvider?: VoiceProvider | null;
}) {
  const { activeBusiness } = useAuth();
  const [provider, setProvider] = useState<VoiceProvider>(initialProvider ?? 'retell');
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function connect() {
    if (!activeBusiness || !apiKey.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await connectProvider(activeBusiness.id, provider, apiKey.trim());
      onConnected(r);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Connection failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Connect a voice provider">
      <div className="space-y-4">
        <Field label="Provider">
          <Select value={provider} onChange={(e) => setProvider(e.target.value as VoiceProvider)}>
            <option value="retell">Retell AI</option>
            <option value="vapi">Vapi</option>
          </Select>
        </Field>
        <Field label="API key">
          <Input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="Paste your provider API key" />
        </Field>
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
          Your key is sent once over HTTPS and stored where only server-side functions can read it — it is never returned to the browser. Revora then creates the agent at the provider and gives you the webhook to paste into their console.
        </p>
        {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button disabled={!apiKey.trim() || busy} onClick={connect}>{busy ? 'Connecting…' : 'Connect'}</Button>
        </div>
      </div>
    </Modal>
  );
}

export default function VoicePage() {
  const { activeBusiness, activeRole } = useAuth();
  const isAdmin = activeRole === 'owner' || activeRole === 'admin';
  const [agent, setAgent] = useState<VoiceAgent | null>(null);
  const [calls, setCalls] = useState<VoiceCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [webhookInfo, setWebhookInfo] = useState<string | null>(null);
  const [form, setForm] = useState<VoiceSettingsPatch>({});
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!activeBusiness) return;
    setLoading(true);
    setError(null);
    try {
      const [a, c] = await Promise.all([getVoiceAgent(activeBusiness.id), listCalls(activeBusiness.id)]);
      setAgent(a);
      setCalls(c);
      if (a) setForm(pickForm(a));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load voice agent');
    } finally {
      setLoading(false);
    }
  }, [activeBusiness]);

  useEffect(() => { load(); }, [load]);

  function pickForm(a: VoiceAgent): VoiceSettingsPatch {
    return {
      agent_name: a.agent_name, greeting: a.greeting, business_description: a.business_description,
      services: a.services ?? [], faqs: a.faqs ?? [], business_hours: a.business_hours,
      transfer_number: a.transfer_number, appointment_rules: a.appointment_rules ?? {},
      voice_settings: a.voice_settings ?? {}, behaviour_instructions: a.behaviour_instructions,
      handoff_rules: a.handoff_rules ?? [], compliance: a.compliance ?? {},
    };
  }

  async function handleSave() {
    if (!activeBusiness) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      await saveVoiceSettings(activeBusiness.id, form);
      setSaveMsg('Settings saved.');
      await load();
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : 'Could not save settings');
    } finally {
      setSaving(false);
    }
  }

  const stats = {
    total: calls.length,
    answered: calls.filter((c) => c.answered_at != null).length,
    missed: calls.filter((c) => c.answered_at == null && c.ended_at != null).length,
    leads: calls.filter((c) => c.lead_id != null).length,
    appointments: calls.filter((c) => c.outcome === 'appointment_booked').length,
    transfers: calls.filter((c) => c.outcome === 'human_transfer').length,
  };

  return (
    <div>
      <PageHeader
        title="AI Voice Agent"
        subtitle="Answer calls, qualify leads and book appointments through a real voice provider. No simulator — a live provider connection."
        action={isAdmin && (
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setSettingsOpen(true)}>Agent settings</Button>
            {agent?.status === 'connected' ? (
              <Button variant="secondary" onClick={async () => { if (activeBusiness) { await disconnectProvider(activeBusiness.id); await load(); } }}>Disconnect</Button>
            ) : (
              <Button onClick={() => setConnectOpen(true)}>Connect provider</Button>
            )}
          </div>
        )}
      />

      {webhookInfo && (
        <Card className="mb-6 border-emerald-200 bg-emerald-50/50">
          <div className="p-5">
            <p className="text-sm font-semibold text-emerald-800">Provider connected. One step left:</p>
            <p className="mt-1 text-sm text-emerald-700">Paste this webhook URL into your provider's console so calls flow back to Revora:</p>
            <code className="mt-2 block break-all rounded-lg bg-white px-3 py-2 text-xs text-slate-700">{webhookInfo}</code>
          </div>
        </Card>
      )}

      {/* connection status */}
      {agent && (
        <Card className="mb-6">
          <div className="flex flex-wrap items-center justify-between gap-3 p-5">
            <div>
              <div className="flex items-center gap-2">
                <p className="font-semibold text-slate-900">{agent.agent_name}</p>
                <Badge className={
                  agent.status === 'connected' ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : agent.status === 'error' ? 'bg-red-50 text-red-700 border-red-200'
                  : 'bg-slate-100 text-slate-600 border-slate-200'
                }>{agent.status}</Badge>
                {agent.provider && <Badge className="border-slate-200 bg-slate-50 text-slate-600">{agent.provider === 'retell' ? 'Retell AI' : 'Vapi'}</Badge>}
              </div>
              <p className="mt-1 text-sm text-slate-500">
                {agent.status === 'connected'
                  ? `Live since ${new Date(agent.last_connected_at ?? '').toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}`
                  : agent.status === 'error'
                  ? agent.status_message ?? 'Connection error — check your API key'
                  : 'Not connected — no calls are handled until a provider is connected'}
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* dashboard */}
      {loading ? <Card><Spinner label="Loading voice data…" /></Card>
        : error ? <ErrorState message={error} onRetry={load} />
        : (
          <>
            <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-6">
              <StatCard label="Calls" value={stats.total} hint="All time" />
              <StatCard label="Answered" value={stats.answered} />
              <StatCard label="Missed" value={stats.missed} />
              <StatCard label="Leads generated" value={stats.leads} />
              <StatCard label="Appointments" value={stats.appointments} hint="Booked by the agent" />
              <StatCard label="Transfers" value={stats.transfers} hint="To a human" />
            </div>

            <Card>
              <div className="border-b border-slate-100 px-5 py-4">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-900">Call log</h2>
                <p className="mt-0.5 text-xs text-slate-500">Real calls arrive here once your provider webhook is live.</p>
              </div>
              {calls.length === 0 ? (
                <div className="p-5">
                  <EmptyState
                    title="No calls yet"
                    description={agent?.status === 'connected'
                      ? 'Calls appear as soon as the provider starts sending events to your webhook.'
                      : 'Connect a voice provider and calls will be recorded here with outcomes, summaries and any leads or appointments created.'}
                    action={isAdmin && agent?.status !== 'connected' ? <Button onClick={() => setConnectOpen(true)}>Connect provider</Button> : undefined}
                  />
                </div>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {calls.map((c) => (
                    <li key={c.id} className="px-5 py-4">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-900">{c.phone_number ?? 'Unknown number'}</p>
                          <p className="text-xs text-slate-500">
                            {c.started_at ? new Date(c.started_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—'}
                            {c.duration_seconds != null && ` · ${Math.floor(c.duration_seconds / 60)}m ${c.duration_seconds % 60}s`}
                            {c.intent && ` · Intent: ${c.intent}`}
                          </p>
                          {c.ai_summary && <p className="mt-1 text-sm text-slate-600">{c.ai_summary}</p>}
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          {c.outcome && <Badge className={outcomeBadge[c.outcome]}>{CALL_OUTCOME_LABELS[c.outcome]}</Badge>}
                          {!c.processed && <span className="text-[10px] uppercase tracking-wide text-slate-400">Processing…</span>}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </>
        )}

      <ConnectModal open={connectOpen} onClose={() => setConnectOpen(false)} initialProvider={agent?.provider} onConnected={(r) => { setWebhookInfo(r.webhookUrl); load(); }} />

      {/* ---- settings drawer ---- */}
      <Modal open={settingsOpen} onClose={() => { setSettingsOpen(false); setSaveMsg(null); }} title="Voice agent settings">
        <div className="max-h-[70vh] space-y-4 overflow-y-auto">
          <Field label="Agent name"><Input value={form.agent_name ?? ''} onChange={(e) => setForm((f) => ({ ...f, agent_name: e.target.value }))} /></Field>
          <Field label="Greeting"><Textarea value={form.greeting ?? ''} onChange={(e) => setForm((f) => ({ ...f, greeting: e.target.value }))} placeholder="Thank you for calling! How can I help today?" /></Field>
          <Field label="Business description"><Textarea value={form.business_description ?? ''} onChange={(e) => setForm((f) => ({ ...f, business_description: e.target.value }))} placeholder="What the business does, tone, anything the agent must know." /></Field>
          <Field label="Services (one per line)">
            <Textarea value={(form.services ?? []).join('\n')} onChange={(e) => setForm((f) => ({ ...f, services: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) }))} />
          </Field>
          <Field label="Approved FAQs — question|answer per line">
            <Textarea
              value={(form.faqs ?? []).map((f) => `${f.question}|${f.answer}`).join('\n')}
              onChange={(e) => setForm((f) => ({ ...f, faqs: e.target.value.split('\n').map((l) => l.split('|')).filter((p) => p.length >= 2).map((p) => ({ question: p[0].trim(), answer: p.slice(1).join('|').trim() })) }))}
              placeholder="Do you do home visits?|Yes, within 10 miles."
            />
          </Field>
          <Field label="Business hours (shown to the agent)"><Input value={form.business_hours ?? ''} onChange={(e) => setForm((f) => ({ ...f, business_hours: e.target.value }))} placeholder="Mon–Fri 9–5, Sat 10–2" /></Field>
          <Field label="Transfer number"><Input value={form.transfer_number ?? ''} onChange={(e) => setForm((f) => ({ ...f, transfer_number: e.target.value }))} placeholder="+44…" /></Field>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Transfer calls to a human when</p>
            {HANDOFF_RULE_OPTIONS.map((o) => (
              <label key={o.value} className="flex items-center gap-2 py-1 text-sm text-slate-700">
                <input type="checkbox" className="h-4 w-4 rounded border-slate-300"
                  checked={(form.handoff_rules ?? []).includes(o.value)}
                  onChange={(e) => setForm((f) => ({ ...f, handoff_rules: e.target.checked ? [...(f.handoff_rules ?? []), o.value] : (f.handoff_rules ?? []).filter((x) => x !== o.value) }))}
                />
                {o.label}
              </label>
            ))}
          </div>

          <Field label="Voice settings — language"><Input value={form.voice_settings?.language ?? 'en-GB'} onChange={(e) => setForm((f) => ({ ...f, voice_settings: { ...f.voice_settings, language: e.target.value } }))} /></Field>

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" className="h-4 w-4 rounded border-slate-300"
              checked={form.appointment_rules?.auto_confirm ?? false}
              onChange={(e) => setForm((f) => ({ ...f, appointment_rules: { ...f.appointment_rules, auto_confirm: e.target.checked } }))}
            />
            Auto-confirm appointments booked by the voice agent (otherwise they land as Requested)
          </label>

          <Field label="AI behaviour instructions"><Textarea value={form.behaviour_instructions ?? ''} onChange={(e) => setForm((f) => ({ ...f, behaviour_instructions: e.target.value }))} placeholder="Be concise. Always confirm spellings. Never quote prices." /></Field>

          {/* compliance */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Compliance notices</p>
            <label className="mt-2 flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" className="h-4 w-4 rounded border-slate-300"
                checked={form.compliance?.recording_enabled ?? false}
                onChange={(e) => setForm((f) => ({ ...f, compliance: { ...f.compliance, recording_enabled: e.target.checked } }))}
              />
              Call recording enabled (also configure recording at your provider)
            </label>
            <Field label="Recording / consent notice">
              <Input value={form.compliance?.recording_consent_notice ?? ''} onChange={(e) => setForm((f) => ({ ...f, compliance: { ...f.compliance, recording_consent_notice: e.target.value } }))} placeholder="This call may be recorded for quality." />
            </Field>
            <Field label="AI disclosure notice">
              <Input value={form.compliance?.ai_disclosure_notice ?? ''} onChange={(e) => setForm((f) => ({ ...f, compliance: { ...f.compliance, ai_disclosure_notice: e.target.value } }))} placeholder="You are speaking with an AI assistant." />
            </Field>
            <Field label="Consent mode">
              <Select value={form.compliance?.consent_mode ?? 'notice_only'} onChange={(e) => setForm((f) => ({ ...f, compliance: { ...f.compliance, consent_mode: e.target.value as 'notice_only' | 'verbal_consent_required' } }))}>
                <option value="notice_only">Notice only</option>
                <option value="verbal_consent_required">Require verbal consent before recording</option>
              </Select>
            </Field>
            <p className="mt-2 text-xs text-slate-500">
              Storing these notices is your choice and does not make the business compliant. Recording and AI-disclosure requirements vary by region — review yours, and match the provider-side recording settings accordingly.
            </p>
          </div>

          {saveMsg && <p className={`rounded-lg px-3 py-2 text-sm ${saveMsg === 'Settings saved.' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{saveMsg}</p>}
          <div className="flex justify-end">
            <Button disabled={saving} onClick={handleSave}>{saving ? 'Saving…' : 'Save settings'}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
