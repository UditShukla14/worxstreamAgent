import { Range, Row, delta, go, int, pct100, shortDate, useApi } from '../lib';
import { Badge, Card, ChartCard, DataTable, ErrorBox, Kpi, Section, walletBadge } from '../components/ui';

const nameOf = (r: Row) => (
  <div>{r.display_name ? <b>{r.display_name}</b> : null}<div className="id muted">{r.company_id}</div></div>
);
const open = (r: Row) => go(`company/${encodeURIComponent(r.company_id)}`);

export default function Growth({ range }: { range: Range }) {
  const { data, error, loading } = useApi<Row>('/analytics/growth', range);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <div className="empty">Loading…</div>;
  const c = data.counts, s = data.stickiness;
  const mauDelta = delta(s.mau, s.previous_mau);

  return (
    <div className={loading ? 'loading' : ''}>
      <Section title="Onboarding & activation" desc="Who has started using the agent, and who signed up but never did.">
        <div className="grid k5">
          <Kpi label="Onboarded companies" value={int(c.onboarded_companies)} hint="has a wallet or any usage" />
          <Kpi label="Active in range" value={int(c.active_in_range)} hint={`${c.onboarded_companies ? pct100((c.active_in_range / c.onboarded_companies) * 100, 0) : '0%'} of onboarded`} />
          <Kpi label="New in range" value={int(c.new_in_range)} hint="first ever usage in this range" />
          <Kpi label={`Inactive ${data.inactive_days_threshold}d+`} value={int(c.inactive)} hint="churn risk" />
          <Kpi label="Activation rate" value={pct100(c.activation_rate_pct, 0)} hint={`${int(c.activated_wallets)} of ${int(c.wallets)} wallets used it`} />
        </div>
        <ChartCard
          title="Companies using the agent over time"
          sub="Cumulative companies with at least one model call"
          data={data.cumulative}
          yFmt={(n) => String(Math.round(n))}
          height={200}
          series={[{ key: 'companies', label: 'Companies', color: 'var(--series-1)', fmt: int }]}
        />
      </Section>

      <Section title="Engagement" desc="How often employees come back. DAU/MAU near 20–30% is healthy for a work tool.">
        <div className="grid k5">
          <Kpi label="Monthly active employees" value={int(s.mau)} hint={`${mauDelta.text} vs previous period`} />
          <Kpi label="Weekly active (last 7d)" value={int(s.wau)} />
          <Kpi label="Avg daily active" value={String(s.avg_dau)} />
          <Kpi label="Stickiness (DAU/MAU)" value={pct100(s.dau_mau_pct, 1)} />
          <Kpi label="Active days / employee" value={String(s.avg_active_days_per_employee)} hint="in this range" />
        </div>
        <ChartCard title="Daily active employees" data={s.series} yFmt={(n) => String(Math.round(n))} height={200} series={[{ key: 'active_employees', label: 'Active employees', color: 'var(--series-3)', fmt: int }]} />
      </Section>

      <Section
        title="Seat adoption"
        desc="Active employees against the seats on each company's plan. Set seats on a company's page."
        right={data.seats_configured ? <Badge>{pct100(data.adoption_overall_pct, 0)} overall</Badge> : undefined}
      >
        {data.seats_configured ? (
          <Card>
            <DataTable
              rows={data.adoption}
              onRow={open}
              initialSort={{ key: 'adoption_pct' }}
              cols={[
                { key: 'company_id', label: 'Company', sortValue: (r) => r.display_name || r.company_id, render: nameOf },
                { key: 'seats', label: 'Seats', align: 'r', render: (r) => int(r.seats) },
                { key: 'active_employees', label: 'Active employees', align: 'r', render: (r) => int(r.active_employees) },
                { key: 'adoption_pct', label: 'Adoption', align: 'r', render: (r) => pct100(r.adoption_pct, 0) },
                { key: 'bar', label: '', render: (r) => (<div className="bartrack" style={{ width: 120 }}><div className="barfill" style={{ width: `${Math.min(100, r.adoption_pct)}%` }} /></div>) },
              ]}
            />
          </Card>
        ) : (
          <div className="callout">No company has seats configured yet. Seats aren't stored in the agent database, so set them per company (Company page → Wallet → Seats) to see adoption.</div>
        )}
      </Section>

      <Section title="Companies to watch">
        <div className="grid c2">
          <Card title={`Churn risk · inactive ${data.inactive_days_threshold}+ days`} sub="Had usage before, then went quiet. Highest lifetime revenue first.">
            <DataTable
              rows={data.inactive}
              onRow={open}
              empty="No inactive companies"
              cols={[
                { key: 'company_id', label: 'Company', sortValue: (r) => r.display_name || r.company_id, render: nameOf },
                { key: 'days_inactive', label: 'Days quiet', align: 'r', render: (r) => int(r.days_inactive) },
                { key: 'last_seen', label: 'Last active', render: (r) => shortDate(r.last_seen) },
                { key: 'lifetime_billable_usd', label: 'Lifetime revenue', align: 'r', render: (r) => `$${r.lifetime_billable_usd.toFixed(2)}` },
              ]}
            />
          </Card>
          <Card title="Signed up, never used" sub="Wallet exists but no model call yet — the best people to nudge.">
            <DataTable
              rows={data.not_activated}
              onRow={open}
              empty="Every company with a wallet has used the agent"
              cols={[
                { key: 'company_id', label: 'Company', sortValue: (r) => r.display_name || r.company_id, render: nameOf },
                { key: 'wallet_status', label: 'Wallet', render: (r) => walletBadge(r.wallet_status) },
                { key: 'updated_at', label: 'Updated', render: (r) => (r.updated_at || '').slice(0, 10) },
              ]}
            />
          </Card>
        </div>
        <Card title={`New companies (${data.new_companies.length})`} sub="First ever usage fell inside this range.">
          <DataTable
            rows={data.new_companies}
            onRow={open}
            initialSort={{ key: 'first_seen', desc: true }}
            empty="No new companies in this range"
            cols={[
              { key: 'company_id', label: 'Company', sortValue: (r) => r.display_name || r.company_id, render: nameOf },
              { key: 'first_seen', label: 'First used', render: (r) => shortDate(r.first_seen) },
              { key: 'last_seen', label: 'Last active', render: (r) => shortDate(r.last_seen) },
              { key: 'lifetime_billable_usd', label: 'Revenue so far', align: 'r', render: (r) => `$${r.lifetime_billable_usd.toFixed(2)}` },
            ]}
          />
        </Card>
      </Section>
    </div>
  );
}
