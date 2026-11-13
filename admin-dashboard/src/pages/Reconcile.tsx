import { Range, Row, compact, shortDate, usd, useApi } from '../lib';
import { Badge, Card, ChartCard, DataTable, ErrorBox, Kpi } from '../components/ui';

const statusBadge = (s: string) => {
  if (s === 'ok') return <Badge tone="good">matches</Badge>;
  if (s === 'pending') return <Badge>today (may lag)</Badge>;
  if (s === 'under_recorded') return <Badge tone="bad">under-recorded</Badge>;
  return <Badge tone="warn">over-recorded</Badge>;
};

export default function Reconcile({ range }: { range: Range }) {
  // Anthropic's report allows ≤31 daily buckets per page; the server pages through, but keep the view readable.
  const { data, error, loading, reload } = useApi<Row>('/analytics/reconcile/anthropic', range);
  if (error) return <div className="stack"><ErrorBox error={error} /><button className="btn" onClick={reload}>Retry</button></div>;
  if (!data) return <div className="empty">Loading…</div>;

  if (!data.configured) {
    return (
      <Card title="Anthropic reconciliation is not set up">
        <p className="secondary">{data.message}</p>
        <p className="note">Our ledger total for this range is <b>{usd(data.ours_total_usd)}</b>. Set <code>ANTHROPIC_ADMIN_API_KEY</code> (and optionally <code>ANTHROPIC_RECONCILE_WORKSPACE_ID</code> to restrict it to this agent's workspace) on the agent server, then reload.</p>
      </Card>
    );
  }

  return (
    <div className={`stack ${loading ? 'loading' : ''}`}>
      <div className="grid k4">
        <Kpi label="Our ledger (provider cost)" value={usd(data.totals.ours_usd)} />
        <Kpi label="Anthropic cost report" value={usd(data.totals.anthropic_usd)} />
        <Kpi label="Difference" value={usd(data.totals.diff_usd)} hint={`${data.totals.diff_pct}% of Anthropic`} />
        <Kpi label="Days needing a look" value={String(data.flagged_days)} hint={data.scope} />
      </div>

      <ChartCard
        title="Ledger vs Anthropic, per day"
        data={data.rows}
        yFmt={(n) => usd(n, { compact: true })}
        series={[
          { key: 'ours_usd', label: 'Our ledger', color: 'var(--series-1)', fmt: usd },
          { key: 'anthropic_usd', label: 'Anthropic', color: 'var(--series-2)', fmt: usd },
        ]}
      />

      <Card title="Daily comparison" sub="Under-recorded = Anthropic charged more than we metered (aborted calls, other apps on the org, tool fees, wrong catalog price).">
        <DataTable
          rows={data.rows}
          initialSort={{ key: 'date', desc: true }}
          cols={[
            { key: 'date', label: 'Day (UTC)', render: (r: Row) => `${shortDate(r.date)} ${r.date.slice(0, 4)}` },
            { key: 'ours_usd', label: 'Ours', align: 'r', render: (r) => usd(r.ours_usd) },
            { key: 'anthropic_usd', label: 'Anthropic', align: 'r', render: (r) => usd(r.anthropic_usd) },
            { key: 'diff_usd', label: 'Diff', align: 'r', render: (r) => usd(r.diff_usd) },
            { key: 'diff_pct', label: 'Diff %', align: 'r', render: (r) => `${r.diff_pct}%` },
            { key: 'ours_tokens', label: 'Our tokens', align: 'r', render: (r) => compact(r.ours_tokens) },
            { key: 'anthropic_tokens', label: 'Anthropic tokens', align: 'r', render: (r) => compact(r.anthropic_tokens) },
            { key: 'status', label: 'Status', render: (r) => statusBadge(r.status) },
          ]}
        />
      </Card>

      <div className="grid c2">
        <Card title="Anthropic cost by type">
          <dl className="kv">{Object.entries(data.anthropic_cost_by_type_usd as Record<string, number>).map(([k, v]) => (<><dt key={`k${k}`}>{k}</dt><dd key={`v${k}`} className="num">{usd(v)}</dd></>))}</dl>
        </Card>
        <Card title="Notes"><ul className="note" style={{ margin: 0, paddingLeft: 18 }}>{(data.notes as string[]).map((n) => (<li key={n}>{n}</li>))}</ul></Card>
      </div>
    </div>
  );
}
