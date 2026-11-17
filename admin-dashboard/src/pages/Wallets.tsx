import { useState } from 'react';
import { Row, go, int, pct, shortDate, usd, useApi } from '../lib';
import { AppScope, Badge, Card, DataTable, ErrorBox, Kpi, Section, appBadge, walletBadge } from '../components/ui';

export default function Wallets({ app = '' }: { app?: AppScope }) {
  const { data, error, loading } = useApi<Row>('/analytics/wallets', { app });
  const [status, setStatus] = useState('');
  if (error) return <ErrorBox error={error} />;
  if (!data) return <div className="empty">Loading…</div>;
  const s = data.summary;
  const all: Row[] = data.wallets;
  const rows = all.filter((w) => !status || (status === 'runway' ? w.runway_days != null && w.runway_days < 7 : w.status === status));
  const count = (st: string) => all.filter((w) => w.status === st).length;

  return (
    <div className={loading ? 'loading' : ''}>
      <Section title="Credit health" desc="Prepaid balances are customer-facing (billable) dollars. Burn rate is the average daily spend over the last 14 days.">
        <div className="grid k5">
          <Kpi label="Outstanding credit" value={usd(s.outstanding_credit_usd)} hint="prepaid balance still to be served" />
          <Kpi label="Purchased to date" value={usd(s.purchased_total_usd)} hint={`${usd(s.free_allowance_total_usd)} given free`} />
          <Kpi label="Runway under 7 days" value={int(s.runway_under_7d)} hint="at current burn rate" />
          <Kpi label="Exhausted / low" value={`${int(s.exhausted)} / ${int(s.low)}`} hint="need a top-up now / soon" />
          <Kpi label="Free → paid conversion" value={`${s.conversion_pct}%`} hint={`${int(s.converted_to_paid)} of ${int(s.exhausted_free_allowance)} that used up their free allowance`} />
        </div>
      </Section>

      <Section title="By AI app" desc="Each app is paid for from its own wallet, so a company with both has two.">
        <div className="grid k4">
          {(s.by_app as Row[]).map((a) => (
            <Kpi key={a.app} label={`${a.app === 'raven' ? 'Raven' : 'Nova'} credit outstanding`} value={usd(a.outstanding_credit_usd)} hint={`${int(a.wallets)} wallets · ${usd(a.purchased_total_usd)} purchased · ${int(a.exhausted)} exhausted`} />
          ))}
        </div>
      </Section>

      <Section title="Company wallets">
        <div className="row">
          <div className="seg" role="group" aria-label="Wallet status">
            {[['', `All (${all.length})`], ['exhausted', `Exhausted (${count('exhausted')})`], ['low', `Low (${count('low')})`], ['runway', `Runway < 7d (${s.runway_under_7d})`], ['ok', `Funded (${count('ok')})`], ['unlimited', `Unlimited (${count('unlimited')})`]].map(([v, l]) => (
              <button key={v} className={status === v ? 'on' : ''} onClick={() => setStatus(v)}>{l}</button>
            ))}
          </div>
        </div>
        <Card sub="Low = under 20% of credits left. Runway = remaining balance ÷ the daily burn of that wallet's own app.">
          <DataTable
            rows={rows}
            initialSort={{ key: 'runway_days' }}
            onRow={(r) => go(`company/${encodeURIComponent(r.company_id)}`)}
            cols={[
              { key: 'company_id', label: 'Company', sortValue: (r) => r.display_name || r.company_id, render: (r) => (<div>{r.display_name ? <b>{r.display_name}</b> : null}<div className="id muted">{r.company_id}</div></div>) },
              { key: 'app', label: 'App', render: (r) => appBadge(r.app) },
              { key: 'status', label: 'Status', render: (r) => walletBadge(r.status) },
              { key: 'remaining_usd', label: 'Remaining', align: 'r', render: (r) => (r.enforced ? usd(r.remaining_usd) : '—') },
              { key: 'overdraft_usd', label: 'Overdraft', align: 'r', render: (r) => (r.overdraft_usd > 0 ? <span className="bad">{usd(r.overdraft_usd)}</span> : <span className="muted">—</span>) },
              { key: 'burn_per_day_usd', label: 'Burn / day', align: 'r', render: (r) => usd(r.burn_per_day_usd) },
              { key: 'runway_days', label: 'Runway', align: 'r', sortValue: (r) => r.runway_days ?? 1e9, render: (r) => (r.runway_days == null ? '—' : r.runway_days < 7 ? <Badge tone="bad">{r.runway_days} days</Badge> : r.runway_days < 21 ? <Badge tone="warn">{r.runway_days} days</Badge> : `${Math.round(r.runway_days)} days`) },
              { key: 'projected_exhaustion', label: 'Runs out', render: (r) => (r.projected_exhaustion ? shortDate(r.projected_exhaustion) : '—') },
              { key: 'pct_left', label: '% left', align: 'r', sortValue: (r) => r.pct_left ?? 2, render: (r) => (r.pct_left == null ? '—' : pct(Math.max(0, r.pct_left), 0)) },
              { key: 'free_allowance_usd', label: 'Free', align: 'r', render: (r) => usd(r.free_allowance_usd) },
              { key: 'purchased_credit_usd', label: 'Purchased', align: 'r', render: (r) => usd(r.purchased_credit_usd) },
              { key: 'spent_usd', label: 'Spent', align: 'r', render: (r) => usd(r.spent_usd) },
              { key: 'markup_rate', label: 'Markup', align: 'r', render: (r) => (r.markup_rate == null ? 'default' : `${Math.round(r.markup_rate * 100)}%`) },
            ]}
          />
        </Card>
      </Section>
    </div>
  );
}
