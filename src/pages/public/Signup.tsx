import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { Button, Field, Input } from '../../components/ui';

export default function Signup() {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    setSubmitting(true);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    });
    setSubmitting(false);
    if (error) { setError(error.message); return; }
    navigate('/onboarding');
  }

  return (
    <main className="mx-auto flex max-w-md flex-col px-4 py-20">
      <h1 className="text-2xl font-bold tracking-tight text-slate-900">Create your account</h1>
      <p className="mt-2 text-sm text-slate-500">Start your free trial. No card required.</p>
      <form className="mt-8 space-y-4" onSubmit={handleSubmit}>
        <Field label="Full name">
          <Input required autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </Field>
        <Field label="Email">
          <Input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password">
          <Input type="password" required minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? 'Creating account…' : 'Create account'}
        </Button>
      </form>
      <p className="mt-4 text-sm text-slate-500">
        Already have an account? <Link to="/login" className="font-medium text-brand-600 hover:text-brand-700">Log in</Link>
      </p>
    </main>
  );
}
