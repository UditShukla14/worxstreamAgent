import { useMemo, useState } from 'react';
import { Range, Row, compact, downloadCsv, go, int, usd, useApi } from '../lib';
import { Card, DataTable, ErrorBox, Section, appStatusBadge } from '../components/ui';

const credit = (w: Row | null) => (w && w.enforced && w.remaining_usd != null ? usd(w.remaining_usd) : <span className="muted">unlimited</span>);

/** The hub: every AI app (Nova, Raven), who has it, what it costs and what is left. Each app is subscribed and paid for separately. */
export default function AiApps({ range }: { range: Range }) {
  const { data, error, loading } = useApi<Row>('/analytics/apps', range);
  const [q, setQ] = useState('');
  const [app, setApp] = useState('');
  const [companyId, setCompanyId] = useState('');

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return ((data?.companies as Row[]) || []).filter((c) => {
      if (app && c[app].status === 'not_subscribed') return false;
      return !needle || `${c.company_id} ${c.display_name}`.toLowerCase().includes(needle);
    });
  }, [data, q, app]);

  if (error) return <ErrorBox error={error} />;
  if (!data) return <div className="empty">Loading…</div>;

  const exportCsv = () => downloadCsv('ai_apps.csv', rows.map((c) => ({
    company_id: c.company_id, company: c.display_name,
    nova_status: c.nova.status, nova_credit_usd: c.nova.wallet?.enforced ? c.nova.wallet.remaining_usd : '', nova_billed_usd: c.nova.usage.billable_usd,
    raven_status: c.raven.status, raven_credit_usd: c.raven.wallet?.enforced ? c.raven.wallet.remaining_usd : '', raven_billed_usd: c.raven.usage.billable_usd, raven_tokens: c.raven.usage.total_tokens,
  })), ['company_id', 'company', 'nova_status', 'nova_credit_usd', 'nova_billed_usd', 'raven_status', 'raven_credit_usd', 'raven_billed_usd', 'raven_tokens'].map((k) => ({ key: k, label: k })));

  return (
    <div className={loading ? 'loading' : ''}>
      <Section title="AI apps" desc="Companies choose Nova, Raven or both. Each app has its own subscription and its own wallet, so each is paid for separately.">
        <div className="grid c2">
          {(data.apps as Row[]).map((a) => (
            <Card key={a.key} title={a.name} sub={a.description}>
              <dl className="kv">
                <dt>Companies on it</dt><dd className="num"><b>{int(a.subscribers.total_active)}</b></dd>
                <dt>Paused / off</dt><dd className="num">{int(a.subscribers.paused)} / {int(a.subscribers.off)}</dd>
                <dt>Billed in range</dt><dd className="num"><b>{usd(a.usage.billable_usd)}</b></dd>
                <dt>Anthropic cost</dt><dd className="num">{usd(a.usage.cost_usd)}</dd>
                <dt>Tokens / model calls</dt><dd className="num">{compact(a.usage.total_tokens)} / {compact(a.usage.call_count)}</dd>
                <dt>Credit left (enforced wallets)</dt><dd className="num">{usd(a.wallets.remaining_usd)}</dd>
                <dt>Empty wallets</dt><dd className="num">{int(a.wallets.exhausted)}</dd>
              </dl>
            </Card>
          ))}
        </div>
      </Section>

      <Section title="Companies" desc="Click a company to subscribe, pause or switch off an app, and to manage its credit.">
        <div className="filters">
          <label className="field">Search<input className="input" placeholder="Company id or name" value={q} onChange={(e) => setQ(e.target.value)} /></label>
          <label className="field">App
            <select className="select" value={app} onChange={(e) => setApp(e.target.value)}>
              <option value="">Both</option>
              <option value="nova">Nova</option>
              <option value="raven">Raven</option>
            </select>
          </label>
          <form className="row" onSubmit={(e) => { e.preventDefault(); if (companyId.trim()) go(`company/${encodeURIComponent(companyId.trim())}`); }}>
            <label className="field">Open a company by id<input className="input" placeholder="e.g. 30000000037" value={companyId} onChange={(e) => setCompanyId(e.target.value)} /></label>
            <button className="btn" disabled={!companyId.trim()}>Open</button>
          </form>
        </div>
        <Card title={`Companies (${rows.length})`} right={<button className="btn sm" onClick={exportCsv}>Export CSV</button>}>
          <DataTable
            rows={rows}
            initialSort={{ key: 'billed', desc: true }}
            empty="No company has an AI app yet. Open a company to subscribe it."
            onRow={(r) => go(`company/${encodeURIComponent(r.company_id)}`)}
            cols={[
              { key: 'company', label: 'Company', sortValue: (r) => (r.display_name || r.company_id).toLowerCase(), render: (r) => (<div>{r.display_name ? <b>{r.display_name}</b> : null}<div className="id muted">{r.company_id}</div></div>) },
              { key: 'nova_status', label: 'Nova', sortValue: (r) => r.nova.status, render: (r) => appStatusBadge(r.nova.status) },
              { key: 'nova_credit', label: 'Nova credit', align: 'r', sortValue: (r) => (r.nova.wallet?.enforced ? r.nova.wallet.remaining_usd ?? 1e9 : 1e9), render: (r) => credit(r.nova.wallet) },
              { key: 'nova_billed', label: 'Nova billed', align: 'r', sortValue: (r) => r.nova.usage.billable_usd, render: (r) => usd(r.nova.usage.billable_usd) },
              { key: 'raven_status', label: 'Raven', sortValue: (r) => r.raven.status, render: (r) => appStatusBadge(r.raven.status) },
              { key: 'raven_credit', label: 'Raven credit', align: 'r', sortValue: (r) => (r.raven.wallet?.enforced ? r.raven.wallet.remaining_usd ?? 1e9 : 1e9), render: (r) => credit(r.raven.wallet) },
              { key: 'raven_billed', label: 'Raven billed', align: 'r', sortValue: (r) => r.raven.usage.billable_usd, render: (r) => usd(r.raven.usage.billable_usd) },
              { key: 'raven_tokens', label: 'Raven tokens', align: 'r', sortValue: (r) => r.raven.usage.total_tokens, render: (r) => compact(r.raven.usage.total_tokens) },
              { key: 'billed', label: 'Total billed', align: 'r', sortValue: (r) => r.nova.usage.billable_usd + r.raven.usage.billable_usd, render: (r) => <b>{usd(r.nova.usage.billable_usd + r.raven.usage.billable_usd)}</b> },
            ]}
          />
        </Card>
      </Section>
    </div>
  );
}
