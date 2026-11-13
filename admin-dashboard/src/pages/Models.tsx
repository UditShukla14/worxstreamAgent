import { useMemo, useState } from 'react';
import { Range, Row, compact, int, usd, useApi } from '../lib';
import { Badge, Card, DataTable, ErrorBox, Section } from '../components/ui';

const CAPS: [string, string][] = [
  ['thinking', 'thinking'], ['effort', 'effort'], ['structured_outputs', 'structured out'], ['context_management', 'ctx mgmt'],
  ['citations', 'citations'], ['image_input', 'images'], ['pdf_input', 'pdf'], ['batch', 'batch'], ['code_execution', 'code exec'],
];
const price = (n: number | null | undefined) => (n == null ? '–' : `$${n < 1 ? n.toFixed(3) : n.toFixed(2)}`);

export default function Models({ range }: { range: Range }) {
  const { data, error, loading } = useApi<Row>('/analytics/models', range);
  const [fam, setFam] = useState('');
  const [onlyAvail, setOnlyAvail] = useState(false);
  const [tin, setTin] = useState(20000);
  const [tout, setTout] = useState(1500);
  const [cached, setCached] = useState(60);

  const rows: Row[] = useMemo(() => (data?.models || []).filter((m: Row) => (!fam || m.family === fam) && (!onlyAvail || m.available_on_key)), [data, fam, onlyAvail]);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <div className="empty">Loading…</div>;
  const families: string[] = [...new Set<string>(data.models.map((m: Row) => m.family))];
  const markupPct = Math.round(data.markup_rate * 100);

  // per-request estimate: cached share of the input is read from cache, rest is uncached input
  const estimate = (m: Row) => {
    const cachedTok = tin * (cached / 100);
    const base = ((tin - cachedTok) * m.input_per_million + cachedTok * m.cache_read_per_million + tout * m.output_per_million) / 1e6;
    return { cost: base, price: base * (1 + data.markup_rate) };
  };

  return (
    <div className={loading ? 'loading' : ''}>
      <Section
        title="Models we offer"
        desc={`Context window and max output come from ${data.limits_from_api ? "Anthropic's Models API (live)" : 'the built-in catalog (Models API unavailable)'}. Prices are per million tokens from our catalog (version ${data.pricing_version}).`}
        right={<div className="row"><Badge>{markupPct}% markup</Badge><a href={data.pricing_source} target="_blank" rel="noreferrer">pricing source ↗</a></div>}
      >
        <div className="row">
          <div className="seg" role="group" aria-label="Family">
            <button className={!fam ? 'on' : ''} onClick={() => setFam('')}>All</button>
            {families.map((f) => (<button key={f} className={fam === f ? 'on' : ''} onClick={() => setFam(f)}>{f}</button>))}
          </div>
          <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={onlyAvail} onChange={(e) => setOnlyAvail(e.target.checked)} /> Only models available on our API key</label>
        </div>

        <Card>
          <DataTable
            rows={rows}
            initialSort={{ key: 'output_per_million', desc: true }}
            cols={[
              { key: 'name', label: 'Model', render: (m) => (<div><b>{m.name}</b><div className="id muted">{m.id}</div></div>) },
              { key: 'in_use_as', label: 'Used for', sortValue: (m) => m.in_use_as.length, render: (m) => (m.in_use_as.length ? <div className="chipset">{m.in_use_as.map((u: string) => (<Badge key={u} tone={u.includes('not active') ? 'neutral' : 'good'}>{u}</Badge>))}</div> : <span className="muted">—</span>) },
              { key: 'context_window', label: 'Input limit', align: 'r', render: (m) => `${compact(m.context_window)} tok` },
              { key: 'max_output', label: 'Output limit', align: 'r', render: (m) => `${compact(m.max_output)} tok` },
              { key: 'input_per_million', label: 'Our cost in / out', align: 'r', sortValue: (m) => m.input_per_million, render: (m) => (<div>{price(m.input_per_million)} / {price(m.output_per_million)}{m.long_context ? <div className="muted" style={{ fontSize: 11 }}>{price(m.long_context.input_per_million)} / {price(m.long_context.output_per_million)} above {compact(m.long_context.above_tokens)}</div> : null}</div>) },
              { key: 'customer_input_per_million', label: 'Customer price in / out', align: 'r', sortValue: (m) => m.customer_input_per_million, render: (m) => `${price(m.customer_input_per_million)} / ${price(m.customer_output_per_million)}` },
              { key: 'cache_read_per_million', label: 'Cache read / write', align: 'r', render: (m) => `${price(m.cache_read_per_million)} / ${price(m.cache_write_per_million)}` },
              { key: 'usage', label: 'Usage (range)', align: 'r', sortValue: (m) => m.usage?.calls || 0, render: (m) => (m.usage ? `${compact(m.usage.calls)} calls · ${usd(m.usage.revenue_usd)}` : '—') },
              { key: 'status', label: 'Status', render: (m) => (<div className="chipset">{m.available_on_key ? <Badge tone="good">available</Badge> : <Badge tone="warn">not on our key</Badge>}{!m.pricing_verified && <Badge tone="warn">price unverified</Badge>}{m.limits_source !== 'api' && <Badge>limits: {m.limits_source}</Badge>}</div>) },
              { key: 'capabilities', label: 'Capabilities', render: (m) => (m.capabilities ? <div className="chipset">{CAPS.map(([k, label]) => (<span key={k} className={`mini ${m.capabilities[k] ? '' : 'off'}`}>{label}</span>))}</div> : <span className="muted">unknown</span>) },
            ]}
          />
        </Card>
        {data.unpriced_available.length > 0 && (
          <div className="callout">
            <b>{data.unpriced_available.length} model(s) are available on our API key but missing from the price catalog</b> — usage on them would be billed as an estimate: {data.unpriced_available.map((m: Row) => m.id).join(', ')}. Add them in <code>analytics/modelPricing.js</code>.
          </div>
        )}
      </Section>

      <Section title="Cost estimator" desc="Rough cost of one request on each model. Cached input is read from the prompt cache at the cache-read price.">
        <Card>
          <div className="filters" style={{ marginBottom: 12 }}>
            <label className="field">Input tokens<input className="input" type="number" min={0} value={tin} onChange={(e) => setTin(Math.max(0, Number(e.target.value)))} /></label>
            <label className="field">Output tokens<input className="input" type="number" min={0} value={tout} onChange={(e) => setTout(Math.max(0, Number(e.target.value)))} /></label>
            <label className="field">Cached share of input ({cached}%)<input type="range" min={0} max={100} value={cached} onChange={(e) => setCached(Number(e.target.value))} /></label>
          </div>
          <DataTable
            rows={rows.map((m) => ({ ...m, est: estimate(m) }))}
            initialSort={{ key: 'est_cost' }}
            cols={[
              { key: 'name', label: 'Model' },
              { key: 'est_cost', label: 'Our cost', align: 'r', sortValue: (m) => m.est.cost, render: (m) => usd(m.est.cost) },
              { key: 'est_price', label: 'Customer price', align: 'r', sortValue: (m) => m.est.price, render: (m) => usd(m.est.price) },
              { key: 'per1k', label: 'Customer price per 1,000 requests', align: 'r', sortValue: (m) => m.est.price, render: (m) => usd(m.est.price * 1000) },
              { key: 'fits', label: 'Fits context?', render: (m) => (tin + tout <= m.context_window ? <Badge tone="good">yes</Badge> : <Badge tone="bad">no</Badge>) },
            ]}
          />
        </Card>
        <div className="note">Models the agent actually uses today: {data.configured.medium} for agent work and {data.configured.daily} for routing, planning and summaries. Per-company overrides can change this. {int(data.models.length)} models listed.</div>
      </Section>
    </div>
  );
}
