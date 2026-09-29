import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { Button, Field, Input } from '../../components/ui';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/reset-password` });
    if (error) { setError(error.message); return; }
    setSent(true);
  }

  return (
    <main className="mx-auto flex max-w-md flex-col px-4 py-20">
      <h1 className="text-2xl font-bold tracking-tight text-slate-900">Reset your password</h1>
      {sent ? (
        <>
          <p className="mt-4 text-sm text-slate-600">
            If an account exists for {email}, a reset link is on its way. Check your inbox.
          </p>
          <Link to="/login" className="mt-6 text-sm font-medium text-brand-600 hover:text-brand-700">Back to login</Link>
        </>
      ) : (
        <>
          <p className="mt-2 text-sm text-slate-500">Enter your email and we will send you a reset link.</p>
          <form className="mt-8 space-y-4" onSubmit={handleSubmit}>
            <Field label="Email">
              <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            <Button type="submit" className="w-full">Send reset link</Button>
          </form>
        </>
      )}
    </main>
  );
}
