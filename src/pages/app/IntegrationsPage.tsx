import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { Badge, Button, Card, ErrorState, Field, Input, Modal, Spinner } from '../../components/ui';
import PageHeader from '../../components/layout/PageHeader';
import type { IntegrationDef } from '../../services/integrations';
import {
  INTEGRATIONS, connectIntegration, disconnectIntegration,
  getVoiceStatus, listIntegrationLogs, listIntegrations, saveIntegrationConfig,
  type IntegrationLog, type IntegrationRow,
} from '../../services/integrations';

const CATEGORIES: { key: IntegrationDef['category']; label: string; description: string }[] = [
  { key: 'communication', label: 'Communication', description: 'Voice, email, SMS and WhatsApp channels' },
  { key: 'calendar', label: 'Calendar', description: 'Two-way calendar sync' },
  { key: 'crm_data', label: 'CRM / Data', description: 'Import, forms and developer APIs' },
  { key: 'payments', label: 'Payments', description: 'Real revenue tracking' },
  { key: 'ai', label: 'AI', description: 'Intelligence providers' },
];

function StatusBadge({ def, row, voiceStatus }: { def: IntegrationDef; row?: IntegrationRow; voiceStatus?: string }) {
  const map: Record<string, [string, string]> = {
    connected: ['bg-emerald-50 text-emerald-700 border-emerald-200', 'Connected'],
    error: ['bg-red-50 text-red-700 border-red-200', 'Error'],
    disconnected: ['bg-slate-100 text-slate-600 border-slate-200', 'Not connected'],
    oauth_pending: ['bg-amber-50 text-amber-700 border-amber-200', 'Requires OAuth'],
    builtin: ['bg-brand-50 text-brand-700 border-brand-200', 'Built-in'],
  };
  let key: string = row?.status ?? 'disconnected';
  if (def.kind === 'builtin') key = 'builtin';
  else if (def.kind === 'oauth') key = row?.status === 'connected' ? 'connected' : 'oauth_pending';
  else if (def.kind === 'link' && voiceStatus) key = voiceStatus === 'connected' ? 'connected' : voiceStatus === 'error' ? 'error' : 'disconnected';
  const [cls, label] = map[key] ?? map.disconnected;
  return <Badge className={cls}>{label}</Badge>;
}

export default function IntegrationsPage() {
  const { activeBusiness, activeRole } = useAuth();
  const isAdmin = activeRole === 'owner' || activeRole === 'admin';
  const [rows, setRows] = useState<IntegrationRow[]>([]);
  const [logs, setLogs] = useState<IntegrationLog[]>([]);
  const [voiceStatus, setVoiceStatus] = useState<{ status: string; provider: string | null }>({ status: 'disconnected', provider: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connectDef, setConnectDef] = useState<IntegrationDef | null>(null);
  const [secret, setSecret] = useState('');
  const [config, setConfig] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [modalErr, setModalErr] = useState<string | null>(null);
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [logsFor, setLogsFor] = useState<IntegrationDef | null>(null);

  const load = useCallback(async () => {
    if (!activeBusiness) return;
    setLoading(true);
    setError(null);
    try {
      const [r, l, v] = await Promise.all([
        listIntegrations(activeBusiness.id),
        listIntegrationLogs(activeBusiness.id),
        getVoiceStatus(activeBusiness.id),
      ]);
      setRows(r); setLogs(l); setVoiceStatus(v);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load integrations');
    } finally {
      setLoading(false);
    }
  }, [activeBusiness]);

  useEffect(() => { load(); }, [load]);

  const rowFor = (key: string) => rows.find((r) => r.integration_key === key);
  const logsFor2 = (key: string) => logs.filter((l) => l.integration_key === key);

  const grouped = useMemo(() => {
    const g: Record<string, IntegrationDef[]> = {};
    for (const def of INTEGRATIONS) (g[def.category] ??= []).push(def);
    return g;
  }, []);

  async function handleConnect() {
    if (!activeBusiness || !connectDef) return;
    setBusy(true);
    setModalErr(null);
    try {
      const r = await connectIntegration(activeBusiness.id, connectDef.key, secret, config);
      if (typeof r.apiKey === 'string') setGeneratedKey(r.apiKey);
      await load();
      if (!r.apiKey) setConnectDef(null);
    } catch (e) {
      setModalErr(e instanceof Error ? e.message : 'Connection failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleDisconnect(def: IntegrationDef) {
    if (!activeBusiness) return;
    setBusy(true);
    try {
      await disconnectIntegration(activeBusiness.id, def.key);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Disconnect failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Integrations"
        subtitle="Connect the tools Revora works with. A connection only shows as Connected after the provider verifies your credentials server-side — nothing is simulated."
      />

      {loading ? <Card><Spinner label="Loading integrations…" /></Card>
        : error ? <ErrorState message={error} onRetry={load} />
        : (
          <div className="space-y-8">
            {CATEGORIES.map((cat) => (
              <section key={cat.key}>
                <div className="mb-3">
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-900">{cat.label}</h2>
                  <p className="text-xs text-slate-500">{cat.description}</p>
                </div>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {grouped[cat.key]?.map((def) => {
                    const row = rowFor(def.key);
                    const status = def.kind === 'link' ? (voiceStatus.status === 'connected' ? 'connected' : voiceStatus.status) : row?.status;
                    return (
                      <Card key={def.key} className="flex flex-col p-4">
                        <div className="flex items-start justify-between gap-2">
                          <p className="font-medium text-slate-900">{def.name}</p>
                          <StatusBadge def={def} row={row} voiceStatus={voiceStatus.status} />
                        </div>
                        <p className="mt-1 text-sm text-slate-500">{def.description}</p>

                        {/* permissions */}
                        <ul className="mt-3 space-y-0.5">
                          {(row?.permissions?.length ? row.permissions : def.defaultPermissions).slice(0, 3).map((p) => (
                            <li key={p} className="text-xs text-slate-400">• {p}</li>
                          ))}
                        </ul>

                        {(row?.last_synced_at || row?.error_message) && (
                          <p className={`mt-3 text-xs ${row.error_message ? 'text-red-600' : 'text-slate-400'}`}>
                            {row.error_message
                              ? `Error: ${row.error_message}`
                              : `Last verified: ${new Date(row.last_synced_at!).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}`}
                          </p>
                        )}

                        <div className="mt-4 flex flex-wrap gap-2 pt-2">
                          {def.kind === 'link' ? (
                            <Link to="/app/voice"><Button variant="secondary">Open Voice settings</Button></Link>
                          ) : def.kind === 'builtin' ? (
                            <Link to={def.key === 'csv_import' ? '/app/leads' : '/app/settings'}><Button variant="secondary">{def.key === 'csv_import' ? 'Import from Leads page' : 'View in Settings'}</Button></Link>
                          ) : def.kind === 'oauth' ? (
                            <p className="text-xs text-amber-600">Connects via OAuth once the provider client is configured — status stays Not connected until then.</p>
                          ) : (
                            <>
                              {status === 'connected' ? (
                                <Button variant="secondary" disabled={busy} onClick={() => handleDisconnect(def)}>Disconnect</Button>
                              ) : (
                                <Button disabled={!isAdmin} onClick={() => { setConnectDef(def); setSecret(''); setConfig({}); setModalErr(null); setGeneratedKey(null); }}>
                                  {status === 'error' ? 'Retry connection' : 'Connect'}
                                </Button>
                              )}
                            </>
                          )}
                          <Button variant="ghost" onClick={() => setLogsFor(def)}>Logs</Button>
                        </div>
                      </Card>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}

      {/* ---- connect modal ---- */}
      {connectDef && (
        <Modal open onClose={() => setConnectDef(null)} title={`Connect — ${connectDef.name}`}>
          <div className="space-y-4">
            <p className="text-sm text-slate-500">{connectDef.description}</p>
            {connectDef.configFields?.map((f) => (
              <Field key={f.name} label={f.label}>
                <Input value={config[f.name] ?? ''} onChange={(e) => setConfig((c) => ({ ...c, [f.name]: e.target.value }))} placeholder={f.placeholder} />
              </Field>
            ))}
            <Field label={connectDef.secretLabel ?? 'API key'}>
              <Input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={connectDef.key === 'api_webhooks' ? 'Leave blank to generate one' : 'Paste your secret key'} />
            </Field>
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
              Your secret is sent once over HTTPS, stored encrypted (pgp) server-side where only edge functions can read it, and never shown again — not even to this page. Revora verifies it with the provider before the integration is marked Connected.
            </p>
            {modalErr && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{modalErr}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setConnectDef(null)}>Cancel</Button>
              <Button disabled={busy || (!secret && connectDef.key !== 'api_webhooks')} onClick={handleConnect}>{busy ? 'Verifying…' : 'Connect'}</Button>
            </div>
          </div>
        </Modal>
      )}

      {/* ---- generated API key reveal ---- */}
      {generatedKey && (
        <Modal open onClose={() => { setGeneratedKey(null); setConnectDef(null); }} title="Your Revora API key">
          <p className="mb-2 text-sm text-slate-600">Copy it now — it is stored encrypted and this is the only time it is shown.</p>
          <code className="block break-all rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-800">{generatedKey}</code>
          <p className="mt-3 text-xs text-slate-500">Use it as the <code>x-revora-api-key</code> header on the integration webhook endpoint to push leads from any external system.</p>
        </Modal>
      )}

      {/* ---- logs modal ---- */}
      {logsFor && (
        <Modal open onClose={() => setLogsFor(null)} title={`Logs — ${logsFor.name}`}>
          <div className="max-h-96 space-y-2 overflow-y-auto">
            {logsFor2(logsFor.key).length === 0
              ? <p className="text-sm text-slate-500">No events recorded yet. Connect, disconnect, verification and webhook events all appear here.</p>
              : logsFor2(logsFor.key).map((l) => (
                <div key={l.id} className="flex items-start gap-3 rounded-lg border border-slate-100 p-3">
                  <span className={`mt-0.5 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${l.status === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{l.event.replace('_', ' ')}</span>
                  <div className="min-w-0">
                    <p className="text-sm text-slate-700">{l.message}</p>
                    <p className="text-xs text-slate-400">{new Date(l.created_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</p>
                  </div>
                </div>
              ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
