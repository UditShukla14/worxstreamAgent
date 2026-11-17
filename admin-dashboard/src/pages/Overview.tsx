import { Range, Row, compact, go, int, pct, pct100, usd, useApi } from '../lib';
import { BarList } from '../components/charts';
import ByApp from '../components/ByApp';
import { AppScope, Badge, Card, ChartCard, DataTable, ErrorBox, Kpi } from '../components/ui';

export default function Overview({ range, app = '' }: { range: Range; app?: AppScope }) {
  const { data, error, loading } = useApi<Row>('/analytics/summary', { ...range, app });
  if (error) return <ErrorBox error={error} />;
  if (!data) return <div className="empty">Loading…</div>;
  const k = data.kpis, p = data.previous_kpis, a = data.alerts, w = data.wallets;
  const name = (r: Row) => r.display_name || r.company_id;

  return (
    <div className={`stack ${loading ? 'loading' : ''}`}>
      <div className="grid k4">
        <Kpi label="Revenue (billable)" value={usd(k.billable_usd)} cur={k.billable_usd} prev={p.billable_usd} />
        <Kpi label="Anthropic cost" value={usd(k.cost_usd)} cur={k.cost_usd} prev={p.cost_usd} />
        <Kpi label="Gross margin" value={usd(k.margin_usd)} hint={`${pct100(k.margin_pct)} of revenue`} />
        <Kpi label="Active companies" value={int(k.active_companies)} cur={k.active_companies} prev={p.active_companies} />
        <Kpi label="Active employees" value={int(k.active_users)} cur={k.active_users} prev={p.active_users} />
        <Kpi label="Nova chat turns" value={int(k.turns)} hint={app === 'raven' ? 'Raven works per mail (see model calls)' : k.turns ? `${usd(k.avg_cost_per_turn_usd)} avg revenue / turn` : ''} />
        <Kpi label="Model calls" value={compact(k.call_count)} cur={k.call_count} prev={p.call_count} />
        <Kpi label="Prompt-cache hit rate" value={pct(k.cache_hit_rate)} hint="share of input tokens read from cache" />
      </div>

      <ByApp rows={data.by_app} />

      <ChartCard
        title="Daily revenue vs Anthropic cost"
        sub="Billable amount customers are charged, and what Anthropic charges us"
        data={data.daily}
        yFmt={(n) => usd(n, { compact: true })}
        series={[
          { key: 'billable_usd', label: 'Revenue (billable)', color: 'var(--series-1)', fmt: usd },
          { key: 'cost_usd', label: 'Anthropic cost', color: 'var(--series-2)', fmt: usd },
        ]}
      />

      <div className="grid c2">
        <ChartCard title="Daily active employees" data={data.daily} yFmt={(n) => String(Math.round(n))} height={180} series={[{ key: 'active_users', label: 'Active employees', color: 'var(--series-3)' }]} />
        <ChartCard title="Daily Nova chat turns" data={data.daily} yFmt={(n) => compact(n)} height={180} series={[{ key: 'turns', label: 'Turns', color: 'var(--series-7)', fmt: int }]} />
      </div>

      <div className="grid c3">
        <Card title="Top companies by revenue" sub="Click a company to open it">
          <BarList rows={data.top_companies.map((c: Row) => ({ ...c, label: name(c) }))} labelKey="company_id" valueKey="billable_usd" fmt={(n) => usd(n)} onClick={(r) => go(`company/${encodeURIComponent(r.company_id)}`)} secondary={(r) => `${int(r.call_count)} calls`} />
        </Card>
        <div className="stack">
          <Card title="Wallet health" sub="Nova and Raven wallets. Click to review">
            <div className="row" style={{ gap: 8 }} onClick={() => go('wallets')}>
              <Badge tone="bad">{w.exhausted || 0} exhausted</Badge>
              <Badge tone="warn">{w.low || 0} low</Badge>
              <Badge tone="good">{w.ok || 0} funded</Badge>
              <Badge>{w.unlimited || 0} unlimited</Badge>
            </div>
          </Card>
          <Card title="Billing integrity" sub="Anything non-zero deserves a look">
            <dl className="kv">
              <dt>Costs priced by estimate</dt>
              <dd>{a.estimated_cost_events ? <Badge tone="warn">{int(a.estimated_cost_events)} events</Badge> : <Badge tone="good">none</Badge>}</dd>
              <dt>Wallet debits pending</dt>
              <dd>{a.events_pending_wallet_debit ? <Badge tone="bad">{int(a.events_pending_wallet_debit)} events</Badge> : <Badge tone="good">none</Badge>}</dd>
              <dt>Unattributed spend</dt>
              <dd>{a.unattributed_calls ? <Badge tone="warn">{usd(a.unattributed_cost_usd)} · {int(a.unattributed_calls)} calls</Badge> : <Badge tone="good">none</Badge>}</dd>
            </dl>
            <div className="note" style={{ marginTop: 10 }}>Compare against Anthropic in <a href="#/reconcile">Reconcile</a>.</div>
          </Card>
        </div>
      </div>

      <div className="grid c2">
        <Card title="By agent" sub="Which specialists customers use">
          <BarList rows={data.agents.slice(0, 10)} labelKey="agent_key" valueKey="billable_usd" fmt={(n) => usd(n)} />
        </Card>
        <Card title="By model">
          <DataTable
            rows={data.models}
            initialSort={{ key: 'billable_usd', desc: true }}
            cols={[
              { key: 'model', label: 'Model' },
              { key: 'call_count', label: 'Calls', align: 'r', render: (r) => int(r.call_count) },
              { key: 'total_tokens', label: 'Tokens', align: 'r', render: (r) => compact(r.total_tokens) },
              { key: 'billable_usd', label: 'Revenue', align: 'r', render: (r) => usd(r.billable_usd) },
              { key: 'cost_usd', label: 'Cost', align: 'r', render: (r) => usd(r.cost_usd) },
            ]}
          />
        </Card>
      </div>
    </div>
  );
}
