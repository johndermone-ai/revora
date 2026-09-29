import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';

// Generic tenant-scoped data hook. Always filters by the active business id,
// so no query can ever cross tenant boundaries.
export function useBusinessData<T extends { business_id: string }>(
  table: string,
  businessId: string | null,
  options: { order?: string; ascending?: boolean } = {}
) {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!businessId) { setData([]); setLoading(false); return; }
    setLoading(true);
    setError(null);
    const query = supabase
      .from(table)
      .select('*')
      .eq('business_id', businessId);
    if (options.order) query.order(options.order, { ascending: options.ascending ?? false });
    const { data: rows, error: err } = await query;
    if (err) setError(err.message);
    else setData((rows as T[]) ?? []);
    setLoading(false);
  }, [table, businessId, options.order, options.ascending]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { data, loading, error, refetch };
}
