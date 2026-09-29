import { FormEvent, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useBusinessData } from '../../hooks/useBusinessData';
import { supabase } from '../../lib/supabase';
import type { Task } from '../../types/database';
import { Button, Card, EmptyState, ErrorState, Field, Input, Modal, Spinner, Select } from '../../components/ui';
import PageHeader from '../../components/layout/PageHeader';
import { formatDate } from '../../lib/format';

export default function Tasks() {
  const { activeBusiness } = useAuth();
  const { data, loading, error, refetch } = useBusinessData<Task>('tasks', activeBusiness?.id ?? null, { order: 'created_at' });
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!activeBusiness) return;
    setSaving(true);
    setFormError(null);
    const { error } = await supabase.from('tasks').insert({
      business_id: activeBusiness.id,
      title,
      due_date: due ? new Date(due).toISOString() : null,
    });
    setSaving(false);
    if (error) { setFormError(error.message); return; }
    setOpen(false);
    setTitle('');
    setDue('');
    refetch();
  }

  async function toggleDone(task: Task) {
    await supabase
      .from('tasks')
      .update({ status: task.status === 'done' ? 'open' : 'done', completed_at: task.status === 'done' ? null : new Date().toISOString() })
      .eq('id', task.id);
    refetch();
  }

  const openTasks = data.filter((t) => t.status === 'open' || t.status === 'in_progress');
  const doneTasks = data.filter((t) => t.status === 'done');

  return (
    <div>
      <PageHeader
        title="Tasks"
        subtitle="Simple to-dos for you and your team."
        action={<Button onClick={() => setOpen(true)}>New task</Button>}
      />
      <Card>
        {loading ? <Spinner /> : error ? <ErrorState message={error} onRetry={refetch} /> : data.length === 0 ? (
          <EmptyState title="No tasks yet" description="Create a task to remind yourself or a team member to follow up." action={<Button onClick={() => setOpen(true)}>Create task</Button>} />
        ) : (
          <div>
            <ul className="divide-y divide-slate-100">
              {openTasks.map((t) => (
                <li key={t.id} className="flex items-center gap-3 px-5 py-3">
                  <input type="checkbox" checked={false} onChange={() => toggleDone(t)} className="h-4 w-4 rounded border-slate-300 text-brand-600" aria-label={`Complete ${t.title}`} />
                  <span className="flex-1 text-sm text-slate-900">{t.title}</span>
                  {t.due_date && <span className="text-xs text-slate-500">Due {formatDate(t.due_date)}</span>}
                </li>
              ))}
              {doneTasks.map((t) => (
                <li key={t.id} className="flex items-center gap-3 px-5 py-3 opacity-50">
                  <input type="checkbox" checked readOnly className="h-4 w-4 rounded border-slate-300" aria-label={`Completed ${t.title}`} />
                  <span className="flex-1 text-sm line-through text-slate-500">{t.title}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title="New task">
        <form className="space-y-4" onSubmit={handleCreate}>
          <Field label="Title"><Input required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Call Sarah about the quote" /></Field>
          <Field label="Due date (optional)"><Input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
          {formError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{formError}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" type="button" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Create'}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
