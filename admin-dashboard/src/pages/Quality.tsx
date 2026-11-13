import { useState } from 'react';
import { Range, Row, compact, dur, go, int, pct100, usd, useApi } from '../lib';
import { Badge, Card, ChartCard, DataTable, ErrorBox, Kpi, Section } from '../components/ui';

export default function Quality({ range }: { range: Range }) {
  const { data, error, loading } = useApi<Row>('/analytics/quality', range);
  const [showUnused, setShowUnused] = useState(false);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <div className="empty">Loading…</div>;
  const o = data.outcomes, l = data.latency, c = data.context, un = data.unused_tools;

  if (!data.turns) {
    return <div className="callout">No chat turns in this range yet, so there is nothing to measure. Quality metrics are computed from the turn log as people use the agent.</div>;
  }

  return (
    <div className={loading ? 'loading' : ''}>
      <Section title="Reliability" desc={`${int(data.turns)} turns in range. “Incomplete” means the agent paused and asked the user to say continue.`}>
        <div className="grid k5">
          <Kpi label="Completed" value={pct100(o.success_rate_pct, 1)} hint={`${int(o.completed)} turns`} />
          <Kpi label="Errors" value={pct100(o.error_rate_pct, 1)} hint={`${int(o.error)} turns`} />
          <Kpi label="Incomplete (hit budget)" value={pct100(o.incomplete_rate_pct, 1)} hint={`${int(o.waiting_continue)} turns`} />
          <Kpi label="Asked to clarify" value={int(o.clarify)} hint={`${int(o.pending_confirmation)} awaiting confirmation`} />
          <Kpi label="Spend-cap stops" value={int(o.spend_cap_hits)} hint="turns that hit the per-turn cost cap" />
        </div>
        <ChartCard title="Daily error rate" data={data.daily} yFmt={(n) => `${Math.round(n)}%`} height={190} series={[{ key: 'error_rate_pct', label: 'Error rate', color: 'var(--series-2)', fmt: (n) => `${n.toFixed(1)}%` }]} />
      </Section>

      <Section title="Latency" desc="Wall-clock time per turn, from the request arriving to the answer being saved.">
        {l.available ? (
          <>
            <div className="grid k4">
              <Kpi label="Median (p50)" value={dur(l.p50_ms)} />
              <Kpi label="Slow tail (p95)" value={dur(l.p95_ms)} />
              <Kpi label="Average" value={dur(l.avg_ms)} />
              <Kpi label="Turns measured" value={int(l.sample)} />
            </div>
            <ChartCard title="Daily average turn time" data={l.daily} yFmt={(n) => dur(n)} height={190} series={[{ key: 'avg_ms', label: 'Average', color: 'var(--series-1)', fmt: (n) => dur(n) }]} />
          </>
        ) : (
          <div className="callout">Latency is recorded on new turns only. Nothing has been measured yet in this range — it fills in as people chat.</div>
        )}
      </Section>

      <Section title="Tools" desc="Which of the agent's tools are used, and which fail.">
        <div className="grid c2">
          <Card title="Most failing tools" sub="Failures per tool call in this range">
            <DataTable
              rows={data.tool_failures}
              empty="No tool failures"
              initialSort={{ key: 'failures', desc: true }}
              cols={[
                { key: 'tool', label: 'Tool' },
                { key: 'calls', label: 'Calls', align: 'r', render: (r) => int(r.calls) },
                { key: 'failures', label: 'Failures', align: 'r', render: (r) => int(r.failures) },
                { key: 'failure_rate_pct', label: 'Failure rate', align: 'r', render: (r) => (r.failure_rate_pct >= 20 ? <Badge tone="bad">{pct100(r.failure_rate_pct, 0)}</Badge> : pct100(r.failure_rate_pct, 1)) },
              ]}
            />
          </Card>
          <Card title="Most used tools" right={un.registered ? <button className="btn sm" onClick={() => setShowUnused((v) => !v)}>{un.unused_count} of {un.registered} never used</button> : undefined}>
            {showUnused ? (
              <div className="chipset">{un.sample.map((n: string) => (<span key={n} className="mini">{n}</span>))}{un.unused_count > un.sample.length && <span className="muted">+{un.unused_count - un.sample.length} more</span>}</div>
            ) : (
              <DataTable rows={data.tools.slice(0, 12)} initialSort={{ key: 'calls', desc: true }} cols={[{ key: 'tool', label: 'Tool' }, { key: 'calls', label: 'Calls', align: 'r', render: (r) => compact(r.calls) }]} />
            )}
          </Card>
        </div>
      </Section>

      <Section title="Most expensive turns" desc="Provider cost of single turns. These usually point at prompt or tool problems worth fixing.">
        <Card>
          <DataTable
            rows={data.expensive_turns}
            empty="Cost per turn is recorded on new turns only"
            onRow={(r) => go(`company/${encodeURIComponent(r.company_id)}`)}
            cols={[
              { key: 'at', label: 'When', render: (r) => String(r.at).slice(0, 16).replace('T', ' ') },
              { key: 'company_id', label: 'Company', className: 'id' },
              { key: 'user_id', label: 'Employee', className: 'id' },
              { key: 'provider_cost_usd', label: 'Cost', align: 'r', render: (r) => usd(r.provider_cost_usd) },
              { key: 'tokens', label: 'Tokens', align: 'r', render: (r) => compact(r.tokens) },
              { key: 'tool_calls', label: 'Tools', align: 'r', render: (r) => int(r.tool_calls) },
              { key: 'duration_ms', label: 'Time', align: 'r', render: (r) => dur(r.duration_ms) },
              { key: 'status', label: 'Outcome', render: (r) => (r.hit_cap ? <Badge tone="bad">cost cap</Badge> : r.status === 'error' ? <Badge tone="bad">error</Badge> : r.status === 'waiting_continue' ? <Badge tone="warn">incomplete</Badge> : (r.status || 'completed') === 'completed' ? <Badge tone="good">completed</Badge> : <Badge>{String(r.status).replace('_', ' ')}</Badge>) },
            ]}
          />
        </Card>
      </Section>

      <Section title="Context pressure" desc="How full the model's context gets. Chats that reach the soft or hard threshold get summarised or have old tool results cleared.">
        {c.measured_turns ? (
          <div className="grid k5">
            <Kpi label="Avg context used" value={pct100(c.avg_used_pct_of_budget, 0)} hint="of the usable budget" />
            <Kpi label="Peak" value={pct100(c.max_used_pct_of_budget, 0)} />
            <Kpi label="Over soft threshold" value={int(c.over_soft)} hint={`${pct100(c.over_soft_pct, 1)} of measured turns`} />
            <Kpi label="Over hard threshold" value={int(c.over_hard)} hint={`${int(c.tool_results_cleared)} had tool results cleared`} />
            <Kpi label="History trimmed" value={int(c.history_trimmed)} hint="turns that dropped older messages" />
          </div>
        ) : (
          <div className="callout">Context usage is recorded on new turns only; nothing measured in this range yet.</div>
        )}
      </Section>
    </div>
  );
}
