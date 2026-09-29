import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { Button, Field, Input } from '../../components/ui';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setSubmitting(false);
    if (error) {
      setError(error.message === 'Invalid login credentials' ? 'Incorrect email or password.' : error.message);
      return;
    }
    navigate('/app');
  }

  return (
    <main className="mx-auto flex max-w-md flex-col px-4 py-20">
      <h1 className="text-2xl font-bold tracking-tight text-slate-900">Log in</h1>
      <p className="mt-2 text-sm text-slate-500">Welcome back to Revora.</p>
      <form className="mt-8 space-y-4" onSubmit={handleSubmit}>
        <Field label="Email">
          <Input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password">
          <Input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? 'Logging in…' : 'Log in'}
        </Button>
      </form>
      <div className="mt-4 flex justify-between text-sm text-slate-500">
        <Link to="/forgot-password" className="hover:text-slate-900">Forgot password?</Link>
        <Link to="/signup" className="hover:text-slate-900">Create account</Link>
      </div>
    </main>
  );
}
