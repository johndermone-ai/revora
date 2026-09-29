import { FormEvent, useEffect, useRef, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { Button, Card, Spinner } from '../../components/ui';
import PageHeader from '../../components/layout/PageHeader';

interface Msg { role: 'user' | 'assistant'; content: string }

const STARTERS = [
  'Which leads should I follow up with first?',
  'Summarise my pipeline right now.',
  'What appointments do I have coming up?',
  'Where might I be losing revenue?',
];

export default function AIAssistantPage() {
  const { activeBusiness } = useAuth();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, busy]);

  async function send(text: string) {
    if (!activeBusiness || busy || !text.trim()) return;
    const next = [...messages, { role: 'user' as const, content: text.trim() }];
    setMessages(next);
    setInput('');
    setBusy(true);
    setErr(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-assistant-chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ businessId: activeBusiness.id, messages: next }),
      });
      const body = await res.json().catch(() => ({}));
      if (body.reply) setMessages((m) => [...m, { role: 'assistant', content: body.reply }]);
      else throw new Error(body.error ?? 'The assistant could not answer');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'The assistant could not answer');
    } finally {
      setBusy(false);
    }
  }

  function submit(e: FormEvent) { e.preventDefault(); send(input); }

  return (
    <div>
      <PageHeader
        title="AI Assistant"
        subtitle="Ask about your leads, pipeline, appointments and recovery opportunities. Answers come from your live business data — if it can't see something, it says so."
      />

      <Card className="flex h-[62vh] flex-col overflow-hidden">
        <div className="flex-1 space-y-3 overflow-y-auto p-5">
          {messages.length === 0 && (
            <div className="space-y-3 py-8 text-center">
              <p className="text-sm text-slate-500">Try asking:</p>
              <div className="flex flex-wrap justify-center gap-2">
                {STARTERS.map((s) => (
                  <button key={s} onClick={() => send(s)}
                    className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 hover:border-brand-400 hover:text-brand-700">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm ${
                m.role === 'user'
                  ? 'rounded-br-sm bg-brand-600 text-white'
                  : 'rounded-bl-sm bg-slate-100 text-slate-800'
              }`}>{m.content}</div>
            </div>
          ))}
          {busy && <div className="flex justify-start"><Spinner label="Thinking…" /></div>}
          {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
          <div ref={endRef} />
        </div>
        <form onSubmit={submit} className="flex gap-2 border-t border-slate-100 p-3">
          <input
            value={input} onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about your leads, appointments, revenue…"
            className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
          />
          <Button type="submit" disabled={busy || !input.trim()}>Send</Button>
        </form>
      </Card>
      <p className="mt-3 text-center text-xs text-slate-400">
        Powered by OpenAI server-side. Conversation stays in your browser; the assistant reads a live snapshot of your business data with each question.
      </p>
    </div>
  );
}
