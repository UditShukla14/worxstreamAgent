import { useMemo } from 'react';
import { Range, Row, compact, downloadCsv, go, int, pct, usd, useApi, useRoute } from '../lib';
import { AppScope, Card, ChartCard, DataTable, ErrorBox, Kpi } from '../components/ui';

const GROUPS = ['date', 'company', 'user', 'app', 'agent', 'model'] as const;
const LABEL: Record<string, string> = { date: 'Day', company: 'Company', user: 'Employee', app: 'AI app', agent: 'Agent', model: 'Model' };

/** Filter + group usage explorer. Filters live in the URL hash so a view can be shared/bookmarked. */
export default function Explorer({ range, app = '' }: { range: Range; app?: AppScope }) {
  const route = useRoute();
  const q = route.query;
  const company = q.company || '', user = q.user || '', agent = q.agent || '', model = q.model || '';
  const group = (q.group || 'date').split(',').filter(Boolean);

  const set = (patch: Record<string, string>) => go('explorer', { company, user, agent, model, group: group.join(','), ...patch });
  const toggleGroup = (g: string) => {
    const next = group.includes(g) ? group.filter((x) => x !== g) : [...group, g];
    set({ group: (next.length ? next : ['date']).join(',') });
  };

  const dir = useApi<Row>('/analytics/directory', { ...range, app });
  const sum = useApi<Row>('/analytics/summary', { ...range, app });
  const detail = useApi<Row>(company ? `/analytics/companies/${encodeURIComponent(company)}/detail` : null, range);
  const { data, error, loading } = useApi<Row>('/analytics/usage', { ...range, app, company_id: company, user_id: user, agent_key: agent, model, group_by: group.join(',') });

  const companies: Row[] = dir.data?.companies || [];
  const users: Row[] = detail.data?.users || [];
  const agents: string[] = (sum.data?.agents || []).map((a: Row) => a.agent_key);
  const models: string[] = (sum.data?.models || []).map((m: Row) => m.model);

  const rows: Row[] = data?.rows || [];
  const hasDate = group.includes('date');
  const t = data?.totals;

  const cols = useMemo(() => {
    const dims = group.map((g) => {
      const key = g === 'date' ? 'date' : g === 'company' ? 'company_id' : g === 'user' ? 'user_id' : g === 'app' ? 'app' : g === 'agent' ? 'agent_key' : 'model';
      return { key, label: LABEL[g], className: key.endsWith('_id') ? 'id' : '' };
    });
    return [
      ...dims,
      { key: 'call_count', label: 'Calls', align: 'r' as const, render: (r: Row) => compact(r.call_count) },
      { key: 'total_tokens', label: 'Tokens', align: 'r' as const, render: (r: Row) => compact(r.total_tokens) },
      { key: 'billable_usd', label: 'Revenue', align: 'r' as const, render: (r: Row) => usd(r.billable_usd) },
      { key: 'cost_usd', label: 'Cost', align: 'r' as const, render: (r: Row) => usd(r.cost_usd) },
      { key: 'cache_hit_rate', label: 'Cache hit', align: 'r' as const, render: (r: Row) => pct(r.cache_hit_rate, 0) },
    ];
  }, [group.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={`stack ${loading ? 'loading' : ''}`}>
      <div className="filters">
        <label className="field">Company
          <select className="select" value={company} onChange={(e) => set({ company: e.target.value, user: '' })}>
            <option value="">All companies</option>
            {companies.map((c) => (<option key={c.company_id} value={c.company_id}>{c.display_name ? `${c.display_name} (${c.company_id})` : c.company_id}</option>))}
          </select>
        </label>
        <label className="field">Employee
          {company ? (
            <select className="select" value={user} onChange={(e) => set({ user: e.target.value })}>
              <option value="">All employees</option>
              {users.map((u) => (<option key={u.user_id} value={u.user_id}>{u.user_id}</option>))}
            </select>
          ) : (<input className="input" placeholder="pick a company first" disabled />)}
        </label>
        <label className="field">Agent
          <select className="select" value={agent} onChange={(e) => set({ agent: e.target.value })}>
            <option value="">All agents</option>
            {agents.map((a) => (<option key={a} value={a}>{a}</option>))}
          </select>
        </label>
        <label className="field">Model
          <select className="select" value={model} onChange={(e) => set({ model: e.target.value })}>
            <option value="">All models</option>
            {models.map((m) => (<option key={m} value={m}>{m}</option>))}
          </select>
        </label>
        <div className="field">Group by
          <div className="chips">{GROUPS.map((g) => (<button key={g} className={`chip ${group.includes(g) ? 'on' : ''}`} onClick={() => toggleGroup(g)}>{LABEL[g]}</button>))}</div>
        </div>
        <button className="btn" onClick={() => go('explorer')}>Reset</button>
      </div>

      <ErrorBox error={error} />

      {t && (
        <div className="grid k4">
          <Kpi label="Revenue (billable)" value={usd(t.billable_usd)} />
          <Kpi label="Anthropic cost" value={usd(t.cost_usd)} hint={`${t.margin_pct}% margin`} />
          <Kpi label="Model calls" value={compact(t.call_count)} />
          <Kpi label="Tokens" value={compact(t.total_tokens)} hint={`${pct(t.cache_hit_rate, 0)} cache hit`} />
        </div>
      )}

      {hasDate && rows.length > 0 && group.filter((g) => g !== 'date').length === 0 && (
        <ChartCard
          title="Daily revenue vs cost"
          data={rows}
          yFmt={(n) => usd(n, { compact: true })}
          series={[
            { key: 'billable_usd', label: 'Revenue (billable)', color: 'var(--series-1)', fmt: usd },
            { key: 'cost_usd', label: 'Anthropic cost', color: 'var(--series-2)', fmt: usd },
          ]}
        />
      )}

      <Card
        title={`${rows.length} rows`}
        sub={hasDate && group.length > 1 ? 'Grouped by day plus other dimensions' : undefined}
        right={<button className="btn sm" onClick={() => downloadCsv(`usage_${range.from}_${range.to}.csv`, rows, [...cols.map((c) => ({ key: c.key, label: c.label })), { key: 'input_tokens', label: 'input_tokens' }, { key: 'output_tokens', label: 'output_tokens' }, { key: 'cache_read_input_tokens', label: 'cache_read_tokens' }, { key: 'margin_usd', label: 'margin_usd' }])}>Export CSV</button>}
      >
        <DataTable
          rows={rows}
          cols={cols}
          initialSort={hasDate ? { key: 'date', desc: true } : { key: 'billable_usd', desc: true }}
          onRow={group.includes('company') && !group.includes('user') ? (r) => go(`company/${encodeURIComponent(r.company_id)}`) : undefined}
          empty="No usage for these filters"
        />
      </Card>
      <div className="note">Daily buckets are UTC days. Rows grouped by Employee are listed per company, since user ids are only unique within a company.</div>
    </div>
  );
}
