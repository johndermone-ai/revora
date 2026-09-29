import { useAuth } from '../../context/AuthContext';
import { useBusinessData } from '../../hooks/useBusinessData';
import type { Activity } from '../../types/database';
import { Card, EmptyState, ErrorState, Spinner, Badge } from '../../components/ui';
import PageHeader from '../../components/layout/PageHeader';
import { formatDateTime } from '../../lib/format';

const typeColors: Record<string, string> = {
  lead: 'bg-brand-50 text-brand-700 border-brand-200',
  customer: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  task: 'bg-slate-50 text-slate-600 border-slate-200',
  follow_up: 'bg-amber-50 text-amber-700 border-amber-200',
  automation: 'bg-violet-50 text-violet-700 border-violet-200',
  ai: 'bg-sky-50 text-sky-700 border-sky-200',
};

export default function Activities() {
  const { activeBusiness } = useAuth();
  const { data, loading, error, refetch } = useBusinessData<Activity>('activities', activeBusiness?.id ?? null, { order: 'created_at' });

  return (
    <div>
      <PageHeader title="Activities" subtitle="A complete audit trail of everything that happens in your business." />
      <Card>
        {loading ? <Spinner /> : error ? <ErrorState message={error} onRetry={refetch} /> : data.length === 0 ? (
          <EmptyState title="No activity yet" description="Create your first lead and actions will start appearing here." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.map((a) => (
              <li key={a.id} className="flex items-start gap-4 px-5 py-4">
                <Badge className={typeColors[a.entity_type] ?? typeColors.task}>{a.entity_type}</Badge>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-900">{a.title}</p>
                  {a.description && <p className="mt-0.5 text-sm text-slate-500">{a.description}</p>}
                </div>
                <span className="whitespace-nowrap text-xs text-slate-400">{formatDateTime(a.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
