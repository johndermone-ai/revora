import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useBusinessData } from '../../hooks/useBusinessData';
import type { Lead, Customer, Activity, Task } from '../../types/database';
import { Card, CardHeader, EmptyState, ErrorState, Spinner, StatCard, Badge } from '../../components/ui';
import PageHeader from '../../components/layout/PageHeader';
import { relativeTime } from '../../lib/format';
import { scoreBand } from '../../lib/leadScoring';

export default function Dashboard() {
  const { activeBusiness } = useAuth();
  const bizId = activeBusiness?.id ?? null;
  const leads = useBusinessData<Lead>('leads', bizId, { order: 'created_at' });
  const customers = useBusinessData<Customer>('customers', bizId, { order: 'created_at' });
  const activities = useBusinessData<Activity>('activities', bizId, { order: 'created_at' });
  const tasks = useBusinessData<Task>('tasks', bizId, { order: 'created_at' });

  const loading = leads.loading || customers.loading || activities.loading;
  const error = leads.error ?? customers.error ?? activities.error;

  const m = useMemo(() => {
    const all = leads.data;
    const now = Date.now();
    const total = all.length;
    const won = all.filter((l) => l.status === 'won').length;
    const monthLeads = all.filter((l) => new Date(l.created_at).getTime() > now - 30 * 24 * 3600 * 1000);
    return {
      total,
      newLeads: monthLeads.filter((l) => l.status === 'new').length,
      qualified: all.filter((l) => ['qualified', 'proposal_sent', 'negotiation', 'won'].includes(l.status)).length,
      customers: customers.data.length,
      won,
      conversionRate: total === 0 ? 0 : Math.round((won / total) * 100),
      followUpsDue: all.filter((l) => l.next_follow_up_at && new Date(l.next_follow_up_at).getTime() < now && !['won', 'lost'].includes(l.status)).length,
      upcoming: all
        .filter((l) => l.next_follow_up_at && new Date(l.next_follow_up_at).getTime() >= now)
        .sort((a, b) => a.next_follow_up_at!.localeCompare(b.next_follow_up_at!))
        .slice(0, 5),
    };
  }, [leads.data, customers.data]);

  if (loading) return <Spinner label="Loading dashboard…" />;
  if (error) return <ErrorState message={error} onRetry={leads.refetch} />;

  return (
    <div>
      <PageHeader title={`Welcome back${activeBusiness ? ` to ${activeBusiness.name}` : ''}`} subtitle="Here is what is happening with your pipeline." />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total leads" value={m.total} hint={`${m.newLeads} new in the last 30 days`} />
        <StatCard label="Qualified leads" value={m.qualified} />
        <StatCard label="Customers" value={m.customers} />
        <StatCard label="Conversion rate" value={`${m.conversionRate}%`} hint={`${m.won} won of ${m.total} leads`} />
        <StatCard label="Follow-ups overdue" value={m.followUpsDue} accent={m.followUpsDue > 0} hint={m.followUpsDue > 0 ? 'Needs attention' : 'All caught up'} />
        <StatCard label="Upcoming appointments" value={m.upcoming.length} hint="From follow-up schedule" />
        <StatCard label="Revenue" value={<span className="text-slate-400">Soon</span>} hint="Revenue tracking coming soon" />
        <StatCard label="Open tasks" value={tasks.data.filter((t) => t.status === 'open' || t.status === 'in_progress').length} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Recent activity" action={<Link className="text-xs font-medium text-brand-600 hover:text-brand-700" to="/app/activities">View all</Link>} />
          {activities.data.length === 0 ? (
            <EmptyState title="No activity yet" description="As you and your team work on leads, everything gets recorded here." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {activities.data.slice(0, 8).map((a) => (
                <li key={a.id} className="px-5 py-3">
                  <p className="text-sm font-medium text-slate-900">{a.title}</p>
                  <p className="mt-0.5 text-xs text-slate-500">{a.type.replace(/_/g, ' ')} · {relativeTime(a.created_at)}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Upcoming follow-ups" action={<Link className="text-xs font-medium text-brand-600 hover:text-brand-700" to="/app/leads">Open pipeline</Link>} />
          {m.upcoming.length === 0 ? (
            <EmptyState title="Nothing scheduled" description="Set a follow-up date on a lead and it will appear here." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {m.upcoming.map((l) => {
                const band = scoreBand(l.lead_score);
                return (
                  <li key={l.id} className="flex items-center justify-between px-5 py-3">
                    <div>
                      <Link to={`/app/leads/${l.id}`} className="text-sm font-medium text-slate-900 hover:text-brand-700">{l.name}</Link>
                      <p className="text-xs text-slate-500">{new Date(l.next_follow_up_at!).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</p>
                    </div>
                    <Badge className={band.className}>{l.lead_score}</Badge>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
