import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!url || !anonKey) {
  console.warn(
    'Revora: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are not set. Copy .env.example to .env and fill in your Supabase project credentials.'
  );
}

export const supabase = createClient(url ?? 'https://placeholder.supabase.co', anonKey ?? 'placeholder', {
  auth: { persistSession: true, autoRefreshToken: true },
});
