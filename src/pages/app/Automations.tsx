import { FormEvent, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useBusinessData } from '../../hooks/useBusinessData';
import { supabase } from '../../lib/supabase';
import type { AutomationRule } from '../../types/database';
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, Field, Input, Modal, Select, Spinner, Textarea } from '../../components/ui';
import PageHeader from '../../components/layout/PageHeader';
import { formatDateTime } from '../../lib/format';

// Automation builder: TRIGGER -> CONDITION -> ACTION
const TRIGGERS = [
  { value: 'lead_created', label: 'Lead is created' },
  { value: 'lead_status_changed', label: 'Lead enters a status' },
  { value: 'no_response', label: 'No response for X days' },
  { value: 'appointment_reminder', label: 'Appointment reminder' },
  { value: 'lead_lost_reactivation', label: 'Lost lead reactivation' },
  { value: 'voice_call_completed', label: 'Voice call completed' },
];

const ACTIONS = [
  { value: 'create_follow_up', label: 'Create a follow-up draft' },
  { value: 'create_task', label: 'Create a task' },
  { value: 'send_notification', label: 'Notify the owner' },
];

export default function Automations() {
  const { activeBusiness, activeRole } = useAuth();
  const isAdmin = activeRole === 'owner' || activeRole === 'admin';
  const { data, loading, error, refetch } = useBusinessData<AutomationRule>('automation_rules', activeBusiness?.id ?? null, { order: 'created_at' });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: '',
    trigger: 'lead_status_changed',
    triggerValue: 'proposal_sent',
    conditionType: 'no_response_days',
    conditionValue: '3',
    action: 'create_follow_up',
    actionChannel: 'email',
  });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!activeBusiness) return;
    setSaving(true);
    setFormError(null);
    const { error } = await supabase.from('automation_rules').insert({
      business_id: activeBusiness.id,
      name: form.name,
      enabled: true,
      trigger: { type: form.trigger, value: form.triggerValue },
      conditions: [{ type: form.conditionType, value: parseInt(form.conditionValue, 10) }],
      action: { type: form.action, channel: form.actionChannel, delay_days: 0 },
    });
    setSaving(false);
    if (error) { setFormError(error.message); return; }
    setOpen(false);
    refetch();
  }

  async function toggleRule(rule: AutomationRule) {
    await supabase.from('automation_rules').update({ enabled: !rule.enabled }).eq('id', rule.id);
    refetch();
  }

  return (
    <div>
      <PageHeader
        title="Automations"
        subtitle="TRIGGER → CONDITION → ACTION. Keep the owner in control: automations create drafts and reminders - they never send without approval."
        action={isAdmin ? <Button onClick={() => setOpen(true)}>New automation</Button> : undefined}
      />
      <Card>
        {loading ? <Spinner /> : error ? <ErrorState message={error} onRetry={refetch} /> : data.length === 0 ? (
          <EmptyState
            title="No automations yet"
            description="Create rules like: when a lead enters 'Proposal Sent' and there is no response for 3 days, create a follow-up draft."
            action={isAdmin ? <Button onClick={() => setOpen(true)}>Create automation</Button> : undefined}
          />
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.map((rule) => (
              <li key={rule.id} className="px-5 py-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{rule.name}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Trigger: <span className="font-medium text-slate-700">{rule.trigger.type.replace(/_/g, ' ')}</span>
                      {' · '}Condition: <span className="font-medium text-slate-700">{(rule.conditions[0]?.type ?? '').replace(/_/g, ' ')} {String(rule.conditions[0]?.value ?? '')}</span>
                      {' · '}Action: <span className="font-medium text-slate-700">{rule.action.type.replace(/_/g, ' ')} ({rule.action.channel ?? 'n/a'})</span>
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {rule.last_error ? (
                      <Badge className="border-red-200 bg-red-50 text-red-700">Error: {rule.last_error}</Badge>
                    ) : rule.last_run ? (
                      <span className="text-xs text-slate-400">Last run {formatDateTime(rule.last_run)}</span>
                    ) : (
                      <span className="text-xs text-slate-400">Never run</span>
                    )}
                    <Badge className={rule.enabled ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-500'}>
                      {rule.enabled ? 'Active' : 'Paused'}
                    </Badge>
                    {isAdmin && (
                      <Button variant="ghost" onClick={() => toggleRule(rule)}>{rule.enabled ? 'Pause' : 'Activate'}</Button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title="New automation">
        <form className="space-y-4" onSubmit={handleCreate}>
          <Field label="Name"><Input required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Proposal follow-up" /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Trigger">
              <Select value={form.trigger} onChange={(e) => setForm((f) => ({ ...f, trigger: e.target.value }))}>
                {TRIGGERS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </Select>
            </Field>
            <Field label="Trigger value (status / days)">
              <Input value={form.triggerValue} onChange={(e) => setForm((f) => ({ ...f, triggerValue: e.target.value }))} />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Condition">
              <Select value={form.conditionType} onChange={(e) => setForm((f) => ({ ...f, conditionType: e.target.value }))}>
                <option value="no_response_days">No response for N days</option>
                <option value="score_below">Lead score below N</option>
                <option value="none">No condition</option>
              </Select>
            </Field>
            <Field label="Condition value">
              <Input type="number" value={form.conditionValue} onChange={(e) => setForm((f) => ({ ...f, conditionValue: e.target.value }))} />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Action">
              <Select value={form.action} onChange={(e) => setForm((f) => ({ ...f, action: e.target.value }))}>
                {ACTIONS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
              </Select>
            </Field>
            <Field label="Channel">
              <Select value={form.actionChannel} onChange={(e) => setForm((f) => ({ ...f, actionChannel: e.target.value }))}>
                <option value="email">Email</option>
                <option value="whatsapp">WhatsApp</option>
                <option value="sms">SMS</option>
              </Select>
            </Field>
          </div>
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
            Automations generate follow-up drafts and notifications for approval. No message is ever sent automatically without an explicit approved rule.
          </p>
          {formError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{formError}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" type="button" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Create automation'}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
