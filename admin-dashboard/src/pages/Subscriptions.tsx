import { useMemo, useState } from 'react';
import { Row, downloadCsv, go, usd, useApi } from '../lib';
import { Badge, Card, DataTable, ErrorBox } from '../components/ui';

/** One cell of the table: the model a company uses for a task, and whether the company chose it or it is the recommendation. */
function ModelCell({ task }: { task: Row }) {
  return (
    <span>
      {task.model_name}{' '}
      {task.source === 'company' ? <Badge tone="good">chosen</Badge> : <span className="muted">recommended</span>}
    </span>
  );
}

export default function Subscriptions() {
  const { data, error, loading } = useApi<Row>('/analytics/company-models');
  const [q, setQ] = useState('');
  const [onlyChosen, setOnlyChosen] = useState(false);

  const tasks: Row[] = data?.tasks || [];
  const rows = useMemo(() => {
    const list: Row[] = data?.companies || [];
    const needle = q.trim().toLowerCase();
    return list.filter((c) => {
      if (onlyChosen && !tasks.some((t) => c.tasks[t.key]?.source === 'company')) return false;
      if (needle && !`${c.company_id} ${c.display_name} ${c.plan_name}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [data, q, onlyChosen, tasks]);

  if (error) return <ErrorBox error={error} />;
  if (!data) return <div className="empty">Loading…</div>;

  const chosenCount = (data.companies as Row[]).filter((c) => tasks.some((t) => c.tasks[t.key]?.source === 'company')).length;

  const exportCsv = () => downloadCsv('company_models.csv', rows.map((c) => ({
    company_id: c.company_id,
    company: c.display_name,
    plan: c.plan_name,
    credit_left: c.remaining_usd == null ? '' : c.remaining_usd,
    ...Object.fromEntries(tasks.flatMap((t) => [[`${t.key}_model`, c.tasks[t.key]?.model_name], [`${t.key}_source`, c.tasks[t.key]?.source]])),
  })), [
    { key: 'company_id', label: 'company_id' }, { key: 'company', label: 'company' }, { key: 'plan', label: 'plan' }, { key: 'credit_left', label: 'credit_left_usd' },
    ...tasks.flatMap((t) => [{ key: `${t.key}_model`, label: `${t.label} model` }, { key: `${t.key}_source`, label: `${t.label} chosen or recommended` }]),
  ]);

  return (
    <div className={`stack ${loading ? 'loading' : ''}`}>
      <div className="filters">
        <label className="field">Search<input className="input" placeholder="Company id, name or plan" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        <label className="field">Show
          <select className="select" value={onlyChosen ? 'chosen' : 'all'} onChange={(e) => setOnlyChosen(e.target.value === 'chosen')}>
            <option value="all">All companies</option>
            <option value="chosen">Only companies that chose their own models</option>
          </select>
        </label>
      </div>
      <Card
        title={`Subscriptions (${rows.length})`}
        sub={`The model each company uses for each kind of task. "chosen" means the company picked it on Settings > Nova > Models; "recommended" is the platform default. ${chosenCount} of ${data.companies.length} companies chose their own. Click a company to open it.`}
        right={<button className="btn sm" onClick={exportCsv}>Export CSV</button>}
      >
        <DataTable
          rows={rows}
          initialSort={{ key: 'display_name' }}
          empty="No companies yet"
          onRow={(r) => go(`company/${encodeURIComponent(r.company_id)}`)}
          cols={[
            { key: 'display_name', label: 'Company', sortValue: (r) => (r.display_name || r.company_id).toLowerCase(), render: (r) => <span>{r.display_name ? <b>{r.display_name}</b> : null} <span className="muted id">{r.company_id}</span></span> },
            { key: 'plan_name', label: 'Plan', render: (r) => r.plan_name || <span className="muted">no plan</span> },
            { key: 'remaining_usd', label: 'Credit left', align: 'r', render: (r) => (r.enforced && r.remaining_usd != null ? usd(r.remaining_usd) : <span className="muted">unlimited</span>) },
            ...tasks.map((t) => ({
              key: `task_${t.key}`,
              label: t.label,
              sortValue: (r: Row) => String(r.tasks[t.key]?.model_name || ''),
              render: (r: Row) => <ModelCell task={r.tasks[t.key]} />,
            })),
          ]}
        />
      </Card>
    </div>
  );
}
