import { Range, Row, compact, go, int, pct100, usd, useApi } from '../lib';
import { BarList } from '../components/charts';
import ByApp from '../components/ByApp';
import { AppScope, Badge, Card, ChartCard, DataTable, ErrorBox, Kpi, Section } from '../components/ui';

const sliceCols = (key: string, label: string) => [
  { key, label },
  { key: 'call_count', label: 'Calls', align: 'r' as const, render: (r: Row) => compact(r.call_count) },
  { key: 'billable_usd', label: 'Revenue', align: 'r' as const, render: (r: Row) => usd(r.billable_usd) },
  { key: 'cost_usd', label: 'Cost', align: 'r' as const, render: (r: Row) => usd(r.cost_usd) },
  { key: 'margin_usd', label: 'Margin', align: 'r' as const, render: (r: Row) => usd(r.margin_usd) },
  { key: 'margin_pct', label: 'Margin %', align: 'r' as const, render: (r: Row) => pct100(r.margin_pct) },
  { key: 'revenue_per_call', label: 'Revenue / call', align: 'r' as const, render: (r: Row) => usd(r.revenue_per_call) },
  { key: 'cost_per_call', label: 'Cost / call', align: 'r' as const, render: (r: Row) => usd(r.cost_per_call) },
  { key: 'share_pct', label: 'Share', align: 'r' as const, render: (r: Row) => pct100(r.share_pct, 0) },
];

export default function Economics({ range, app = '' }: { range: Range; app?: AppScope }) {
  const { data, error, loading } = useApi<Row>('/analytics/economics', { ...range, app });
  if (error) return <ErrorBox error={error} />;
  if (!data) return <div className="empty">Loading…</div>;
  const r = data.runrate, u = data.unit, c = data.concentration, k = data.cache;

  return (
    <div className={loading ? 'loading' : ''}>
      <Section title="By AI app" desc="Nova and Raven side by side for the selected range, and their sum.">
        <ByApp rows={data.by_app} title="Revenue and cost by app" sub="Cumulative across both apps." />
      </Section>

      <Section title="Revenue run-rate" desc="Always the latest 30 days and the current month — not affected by the date range.">
        <div className="grid k4">
          <Kpi label="Last 30 days revenue" value={usd(r.trailing_30d_billable)} hint={r.growth_pct == null ? 'no prior 30 days to compare' : `${r.growth_pct > 0 ? '▲' : r.growth_pct < 0 ? '▼' : ''} ${Math.abs(r.growth_pct)}% vs prior 30 days`} />
          <Kpi label="Month to date" value={usd(r.mtd_billable)} hint={`day ${r.days_elapsed} of ${r.days_in_month}`} />
          <Kpi label="Projected month-end" value={usd(r.projected_month_billable)} hint="current daily pace × days in month" />
          <Kpi label="Last 30 days Anthropic cost" value={usd(r.trailing_30d_cost)} hint={r.trailing_30d_billable ? `${pct100(((r.trailing_30d_billable - r.trailing_30d_cost) / r.trailing_30d_billable) * 100)} margin` : ''} />
        </div>
      </Section>

      <Section title="Unit economics" desc="What one turn and one employee earn and cost, for the selected range.">
        <div className="grid k4">
          <Kpi label="Revenue per turn" value={usd(u.revenue_per_turn)} hint={`${int(u.turns)} turns`} />
          <Kpi label="Cost per turn" value={usd(u.cost_per_turn)} hint={`${u.calls_per_turn} model calls per turn`} />
          <Kpi label="Revenue per active employee" value={usd(u.revenue_per_employee)} hint={`${int(u.active_employees)} employees`} />
          <Kpi label="Cost per active employee" value={usd(u.cost_per_employee)} />
        </div>
        <div className="grid c2">
          <ChartCard
            title="Daily margin %"
            sub="Gross margin as a share of revenue"
            data={data.margin_trend}
            yFmt={(n) => `${Math.round(n)}%`}
            height={190}
            series={[{ key: 'margin_pct', label: 'Margin %', color: 'var(--series-3)', fmt: (n) => `${n.toFixed(1)}%` }]}
          />
          <ChartCard
            title="Daily gross margin ($)"
            data={data.margin_trend}
            yFmt={(n) => usd(n, { compact: true })}
            height={190}
            series={[{ key: 'margin_usd', label: 'Margin', color: 'var(--series-7)', fmt: usd }]}
          />
        </div>
      </Section>

      <Section
        title="Revenue concentration"
        desc="How dependent revenue is on a few companies."
        right={c.top1_pct >= 40 ? <Badge tone="warn">top company is {pct100(c.top1_pct, 0)} of revenue</Badge> : undefined}
      >
        <div className="grid c3">
          <Card title="Top 5 companies">
            <BarList rows={c.top.map((t: Row) => ({ ...t, label: t.company_id }))} labelKey="company_id" valueKey="share_pct" max={100} fmt={(n) => pct100(n, 1)} onClick={(t) => go(`company/${encodeURIComponent(t.company_id)}`)} secondary={(t) => usd(t.billable_usd)} />
          </Card>
          <div className="stack">
            <Kpi label="Top 1 company" value={pct100(c.top1_pct, 1)} />
            <Kpi label="Top 3 companies" value={pct100(c.top3_pct, 1)} />
            <Kpi label="Top 5 companies" value={pct100(c.top5_pct, 1)} hint={`${int(c.companies)} paying companies`} />
          </div>
        </div>
      </Section>

      <Section title="Margin by agent and model" desc="Where the money is made. Revenue/call vs cost/call shows which workloads are cheap or expensive to serve.">
        <div className="stack">
          <Card title="By agent"><DataTable rows={data.agents} cols={sliceCols('agent_key', 'Agent')} initialSort={{ key: 'billable_usd', desc: true }} /></Card>
          <Card title="By model"><DataTable rows={data.models} cols={sliceCols('model', 'Model')} initialSort={{ key: 'billable_usd', desc: true }} /></Card>
        </div>
      </Section>

      <Section title="Prompt-cache savings" desc="What prompt caching saved versus sending the same tokens uncached, priced per model from the catalog.">
        <div className="grid k4">
          <Kpi label="Net saved" value={usd(k.net_saved_usd)} hint={`${pct100(k.saved_pct)} of what it would have cost`} />
          <Kpi label="Cost without caching" value={usd(k.cost_without_cache_usd)} hint={`actual ${usd(data.totals.cost_usd)}`} />
          <Kpi label="Cache hit rate" value={pct100(k.hit_rate * 100)} hint={`${compact(k.read_tokens)} tokens read from cache`} />
          <Kpi label="Cache write premium" value={usd(k.write_premium_usd)} hint={`${compact(k.write_tokens)} tokens written`} />
        </div>
        <Card title="By model">
          <DataTable
            rows={k.by_model}
            cols={[
              { key: 'model', label: 'Model' },
              { key: 'cache_read_tokens', label: 'Read tokens', align: 'r', render: (x) => compact(x.cache_read_tokens) },
              { key: 'cache_write_tokens', label: 'Written tokens', align: 'r', render: (x) => compact(x.cache_write_tokens) },
              { key: 'saved_usd', label: 'Saved by reads', align: 'r', render: (x) => usd(x.saved_usd) },
              { key: 'write_premium_usd', label: 'Write premium', align: 'r', render: (x) => usd(x.write_premium_usd) },
              { key: 'net_saved_usd', label: 'Net saved', align: 'r', render: (x) => usd(x.net_saved_usd) },
            ]}
          />
        </Card>
      </Section>
    </div>
  );
}
