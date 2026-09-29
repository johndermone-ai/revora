import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { Button, Field, Input } from '../../components/ui';

export default function ResetPassword() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    const { error } = await supabase.auth.updateUser({ password });
    if (error) { setError(error.message); return; }
    navigate('/app');
  }

  return (
    <main className="mx-auto flex max-w-md flex-col px-4 py-20">
      <h1 className="text-2xl font-bold tracking-tight text-slate-900">Choose a new password</h1>
      <form className="mt-8 space-y-4" onSubmit={handleSubmit}>
        <Field label="New password">
          <Input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <Button type="submit" className="w-full">Save password</Button>
      </form>
    </main>
  );
}
