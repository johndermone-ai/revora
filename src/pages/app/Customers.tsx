import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useBusinessData } from '../../hooks/useBusinessData';
import type { Customer } from '../../types/database';
import { Card, EmptyState, ErrorState, Spinner } from '../../components/ui';
import PageHeader from '../../components/layout/PageHeader';
import { formatDate } from '../../lib/format';

export default function Customers() {
  const { activeBusiness } = useAuth();
  const { data, loading, error, refetch } = useBusinessData<Customer>('customers', activeBusiness?.id ?? null, { order: 'created_at' });

  return (
    <div>
      <PageHeader title="Customers" subtitle="Everyone who has said yes. Won leads convert into customer records here." />
      <Card>
        {loading ? <Spinner /> : error ? <ErrorState message={error} onRetry={refetch} /> : data.length === 0 ? (
          <EmptyState
            title="No customers yet"
            description="When you mark a lead as Won, Revora creates the customer record automatically, preserving the full lead history."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3 font-medium">Name</th>
                  <th className="px-5 py-3 font-medium">Email</th>
                  <th className="px-5 py-3 font-medium">Phone</th>
                  <th className="px-5 py-3 font-medium">Company</th>
                  <th className="px-5 py-3 font-medium">Since</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3 font-medium text-slate-900">
                      {c.lead_id ? <Link to={`/app/leads/${c.lead_id}`} className="hover:text-brand-700">{c.name}</Link> : c.name}
                    </td>
                    <td className="px-5 py-3 text-slate-600">{c.email ?? '—'}</td>
                    <td className="px-5 py-3 text-slate-600">{c.phone ?? '—'}</td>
                    <td className="px-5 py-3 text-slate-600">{c.company ?? '—'}</td>
                    <td className="px-5 py-3 text-slate-500">{formatDate(c.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
