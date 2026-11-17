import { useMemo, useState } from 'react';
import { Range, Row, compact, downloadCsv, go, int, pct, pct100, usd, useApi } from '../lib';
import { AppScope, Card, DataTable, ErrorBox, walletBadge } from '../components/ui';

export default function Companies({ range, app = '' }: { range: Range; app?: AppScope }) {
  const { data, error, loading } = useApi<Row>('/analytics/directory', { ...range, app });
  const [q, setQ] = useState('');
  const [wallet, setWallet] = useState('');
  const [activeOnly, setActiveOnly] = useState(true);

  const rows = useMemo(() => {
    const list: Row[] = data?.companies || [];
    const needle = q.trim().toLowerCase();
    return list.filter((c) => {
      if (activeOnly && !c.call_count) return false;
      if (wallet && ![c.wallet?.status || 'none', c.raven_wallet?.status || 'none'].includes(wallet)) return false;
      if (needle && !`${c.company_id} ${c.display_name}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [data, q, wallet, activeOnly]);

  if (error) return <ErrorBox error={error} />;
  const totals = rows.reduce((a, r) => ({ billable: a.billable + r.billable_usd, cost: a.cost + r.cost_usd, users: a.users + r.users }), { billable: 0, cost: 0, users: 0 });

  return (
    <div className={`stack ${loading ? 'loading' : ''}`}>
      <div className="filters">
        <label className="field">Search<input className="input" placeholder="Company id or name" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        <label className="field">Wallet
          <select className="select" value={wallet} onChange={(e) => setWallet(e.target.value)}>
            <option value="">All</option>
            <option value="ok">Funded</option>
            <option value="low">Low balance</option>
            <option value="exhausted">Exhausted</option>
            <option value="unlimited">Unlimited</option>
            <option value="none">No wallet</option>
          </select>
        </label>
        <label className="field">Show
          <div className="seg"><button className={activeOnly ? 'on' : ''} onClick={() => setActiveOnly(true)}>Active in range</button><button className={!activeOnly ? 'on' : ''} onClick={() => setActiveOnly(false)}>All companies</button></div>
        </label>
        <span className="grow" style={{ flex: 1 }} />
        <button className="btn" onClick={() => downloadCsv(`companies_${range.from}_${range.to}.csv`, rows.map((r) => ({ ...r, wallet_status: r.wallet?.status || '', wallet_remaining_usd: r.wallet?.remaining_usd ?? '', nova_revenue_usd: r.by_app?.[0]?.billable_usd ?? 0, raven_revenue_usd: r.by_app?.[1]?.billable_usd ?? 0 })), [
          { key: 'company_id', label: 'company_id' }, { key: 'display_name', label: 'name' }, { key: 'users', label: 'employees' }, { key: 'turns', label: 'turns' }, { key: 'call_count', label: 'calls' },
          { key: 'billable_usd', label: 'revenue_usd' }, { key: 'nova_revenue_usd', label: 'nova_revenue_usd' }, { key: 'raven_revenue_usd', label: 'raven_revenue_usd' }, { key: 'cost_usd', label: 'cost_usd' }, { key: 'margin_usd', label: 'margin_usd' }, { key: 'wallet_status', label: 'wallet_status' }, { key: 'wallet_remaining_usd', label: 'wallet_remaining_usd' }, { key: 'last_active', label: 'last_active' },
        ])}>Export CSV</button>
      </div>

      <Card title={`${rows.length} companies`} sub={`${int(totals.users)} active employees · ${usd(totals.billable)} revenue · ${usd(totals.cost)} cost`}>
        <DataTable
          rows={rows}
          onRow={(r) => go(`company/${encodeURIComponent(r.company_id)}`)}
          initialSort={{ key: 'billable_usd', desc: true }}
          empty="No companies match these filters"
          cols={[
            { key: 'company_id', label: 'Company', sortValue: (r) => r.display_name || r.company_id, render: (r) => (<div>{r.display_name ? <b>{r.display_name}</b> : null}<div className="id muted">{r.company_id}</div></div>) },
            { key: 'wallet', label: 'Nova wallet', sortValue: (r) => r.wallet?.remaining_usd ?? Infinity, render: (r) => (<div className="row" style={{ gap: 6 }}>{walletBadge(r.wallet?.status)}{r.wallet?.enforced ? <span className="muted num">{usd(r.wallet.remaining_usd)}</span> : null}</div>) },
            { key: 'raven_wallet', label: 'Raven wallet', sortValue: (r) => r.raven_wallet?.remaining_usd ?? Infinity, render: (r) => (r.raven_wallet ? <div className="row" style={{ gap: 6 }}>{walletBadge(r.raven_wallet.status)}{r.raven_wallet.enforced ? <span className="muted num">{usd(r.raven_wallet.remaining_usd)}</span> : null}</div> : <span className="muted">none</span>) },
            { key: 'users', label: 'Employees', align: 'r', render: (r) => int(r.users) },
            { key: 'turns', label: 'Turns', align: 'r', render: (r) => int(r.turns) },
            { key: 'call_count', label: 'Calls', align: 'r', render: (r) => compact(r.call_count) },
            { key: 'billable_usd', label: 'Revenue', align: 'r', render: (r) => usd(r.billable_usd) },
            { key: 'nova_revenue', label: 'Nova', align: 'r', sortValue: (r) => r.by_app?.[0]?.billable_usd ?? 0, render: (r) => usd(r.by_app?.[0]?.billable_usd) },
            { key: 'raven_revenue', label: 'Raven', align: 'r', sortValue: (r) => r.by_app?.[1]?.billable_usd ?? 0, render: (r) => usd(r.by_app?.[1]?.billable_usd) },
            { key: 'cost_usd', label: 'Cost', align: 'r', render: (r) => usd(r.cost_usd) },
            { key: 'margin_pct', label: 'Margin', align: 'r', render: (r) => (r.billable_usd ? pct100(r.margin_pct) : '–') },
            { key: 'cache_hit_rate', label: 'Cache hit', align: 'r', render: (r) => (r.call_count ? pct(r.cache_hit_rate, 0) : '–') },
            { key: 'active_days', label: 'Active days', align: 'r', render: (r) => int(r.active_days) },
            { key: 'last_active', label: 'Last active', render: (r) => r.last_active || '–' },
            { key: 'first_seen', label: 'First seen', render: (r) => r.first_seen || '–' },
          ]}
        />
      </Card>
    </div>
  );
}
