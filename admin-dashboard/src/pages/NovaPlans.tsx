import { useState } from 'react';
import { Row, api, usd, useApi } from '../lib';
import { Badge, Card, DataTable, ErrorBox, Modal } from '../components/ui';

type Tier = { min_usd: number; margin_rate: number };

/** The two apps sell credit through the same screens; only the endpoints and a few words differ. */
const APP_CFG = {
  nova: { name: 'Nova', plans: '/analytics/nova-plans', pricing: '/analytics/nova-pricing', env: 'NOVA_MARKUP_RATE', unit: 'request', unitPlural: 'requests', samples: [20, 50, 250, 500, 1000, 5000], desc: 'What companies can buy for the Nova app, separate from the Worxstream app subscription plans.' },
  raven: { name: 'Raven', plans: '/analytics/apps/raven/plans', pricing: '/analytics/apps/raven/pricing', env: 'RAVEN_MARKUP_RATE (or NOVA_MARKUP_RATE)', unit: 'mail analysis', unitPlural: 'mails analysed', samples: [5, 20, 100, 500, 1000, 2000], desc: 'What companies can buy for Raven, the mail agent. Raven has its own wallet, so this credit is separate from Nova credit.' },
} as const;
type Cfg = (typeof APP_CFG)[keyof typeof APP_CFG];
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Mirrors the server's quote: the margin for the amount (never above the markup), the credit it buys, and what it covers. */
function quote(price: number, tiers: Tier[], markup: number) {
  let margin = tiers[0]?.margin_rate ?? markup;
  for (const t of tiers) if (price >= t.min_usd) margin = t.margin_rate;
  margin = Math.min(margin, markup);
  const credit = r2((price * (1 + markup)) / (1 + margin));
  const value = r2(credit / (1 + markup));
  return { margin, credit, value, profit: r2(price - value), bonusPct: Math.round((credit / price - 1) * 1000) / 10 };
}

/** Credit plans and pricing for each AI app: pick the app, then the same editor. */
export default function NovaPlans() {
  const [app, setApp] = useState<'nova' | 'raven'>('nova');
  return (
    <div className="stack">
      <div className="row">
        <div className="seg" role="group" aria-label="AI app">
          {(['nova', 'raven'] as const).map((a) => (<button key={a} className={app === a ? 'on' : ''} onClick={() => setApp(a)}>{APP_CFG[a].name}</button>))}
        </div>
      </div>
      <AppPlans key={app} cfg={APP_CFG[app]} />
    </div>
  );
}

function AppPlans({ cfg }: { cfg: Cfg }) {
  const { data, error, loading, reload } = useApi<Row>(cfg.plans);
  const [editing, setEditing] = useState<Row | 'new' | null>(null);

  if (error) return <ErrorBox error={error} />;
  if (!data) return <div className="empty">Loading…</div>;
  const plans: Row[] = data.plans || [];
  const markup: number = data.usage_markup_rate ?? 0;
  const pricing: Row = data.pricing;

  return (
    <div className={`stack ${loading ? 'loading' : ''}`}>
      <Card
        title={`${cfg.name} credit plans`}
        sub={`${cfg.desc} A company pays the price and receives that much credit, plus bonus credit on larger plans. Companies never see Anthropic's cost or your margin.`}
        right={<button className="btn primary sm" onClick={() => setEditing('new')}>New plan</button>}
      >
        {markup <= 0 ? (
          <div className="err" role="alert" style={{ marginBottom: 12 }}>
            The margin ({cfg.env}) is 0, so every plan is sold at Anthropic's cost with no margin. Set it to 0.2 for +20%.
          </div>
        ) : (
          <div className="note" style={{ marginBottom: 12 }}>
            Base margin on Anthropic's price: <b>{Math.round(markup * 1000) / 10}%</b> ({cfg.env}). Larger purchases earn less (see Volume discounts below) and the difference is given back as bonus credit.
          </div>
        )}
        <DataTable
          rows={plans}
          initialSort={{ key: 'sort' }}
          empty="No plans yet"
          onRow={(r) => setEditing(r)}
          cols={[
            { key: 'name', label: 'Plan', render: (r) => <span><b>{r.name}</b> <span className="muted id">{r.plan_id}</span></span> },
            { key: 'price_usd', label: 'Company pays', align: 'r', render: (r) => <b>{usd(r.price_usd)}</b> },
            { key: 'credit_usd', label: 'Company receives', align: 'r', render: (r) => <span>{usd(r.credit_usd)}{r.bonus_pct > 0 ? <span className="muted"> (+{r.bonus_pct}%)</span> : null}</span> },
            { key: 'anthropic_value_usd', label: 'Covers Anthropic usage of', align: 'r', render: (r) => usd(r.anthropic_value_usd) },
            { key: 'margin_usd', label: 'Your margin', align: 'r', render: (r) => <span>{usd(r.margin_usd)} <span className="muted">({Math.round(r.margin_rate * 1000) / 10}%)</span></span> },
            { key: 'active', label: 'Status', render: (r) => (r.active ? <Badge tone="good">on sale</Badge> : <Badge>hidden</Badge>) },
          ]}
        />
      </Card>

      <PricingCard cfg={cfg} pricing={pricing} markup={markup} onSaved={reload} />

      {editing && <PlanModal cfg={cfg} plan={editing === 'new' ? null : editing} pricing={pricing} markup={markup} onClose={() => setEditing(null)} onDone={() => { setEditing(null); reload(); }} />}
    </div>
  );
}

function PricingCard({ cfg, pricing, markup, onSaved }: { cfg: Cfg; pricing: Row; markup: number; onSaved: () => void }) {
  const [tiers, setTiers] = useState<{ min: string; margin: string }[]>(
    (pricing.tiers as Tier[]).map((t) => ({ min: String(t.min_usd), margin: String(Math.round(t.margin_rate * 1000) / 10) })),
  );
  const [min, setMin] = useState(String(pricing.custom_min_usd));
  const [max, setMax] = useState(String(pricing.custom_max_usd));
  const [typical, setTypical] = useState(String(pricing.typical_request_usd));
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const setTier = (i: number, k: 'min' | 'margin', v: string) => { setSaved(false); setTiers((t) => t.map((x, j) => (j === i ? { ...x, [k]: v } : x))); };

  const save = async () => {
    setBusy(true); setErr(''); setSaved(false);
    try {
      await api(cfg.pricing, {
        method: 'PUT',
        body: {
          tiers: tiers.map((t) => ({ min_usd: Number(t.min), margin_rate: Number(t.margin) / 100 })),
          custom_min_usd: Number(min), custom_max_usd: Number(max), typical_request_usd: Number(typical),
        },
      });
      setSaved(true);
      onSaved();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  const sample = cfg.samples.map((amount) => ({ amount, ...quote(amount, tiers.map((t) => ({ min_usd: Number(t.min) || 0, margin_rate: (Number(t.margin) || 0) / 100 })), markup) }));

  return (
    <Card title="Volume discounts and custom amount" sub="Larger purchases earn a lower margin (typically 20% down to 15%). The company still pays the amount it chose and receives bonus credit for the difference.">
      <div className="stack">
        <div>
          <div className="muted" style={{ marginBottom: 6 }}>Margin by purchase size (it can only go down as the amount grows)</div>
          {tiers.map((t, i) => (
            <div className="row" key={i} style={{ marginBottom: 6 }}>
              <span>From $</span>
              <input className="input" style={{ width: 110 }} type="number" min="0" value={t.min} disabled={i === 0} onChange={(e) => setTier(i, 'min', e.target.value)} aria-label="From amount" />
              <span>margin</span>
              <input className="input" style={{ width: 90 }} type="number" min="0" step="0.5" value={t.margin} onChange={(e) => setTier(i, 'margin', e.target.value)} aria-label="Margin percent" />
              <span>%</span>
              {i > 0 && <button className="btn sm" onClick={() => { setSaved(false); setTiers((x) => x.filter((_, j) => j !== i)); }}>Remove</button>}
            </div>
          ))}
          <button className="btn sm" onClick={() => { setSaved(false); setTiers((x) => [...x, { min: '', margin: x[x.length - 1]?.margin ?? '15' }]); }}>Add a tier</button>
        </div>
        <div className="grid c3">
          <label className="field">Custom amount: minimum (USD)<input className="input" type="number" min="1" value={min} onChange={(e) => { setSaved(false); setMin(e.target.value); }} /></label>
          <label className="field">Custom amount: maximum (USD)<input className="input" type="number" min="1" value={max} onChange={(e) => { setSaved(false); setMax(e.target.value); }} /></label>
          <label className="field">Typical cost of one {cfg.unit} (USD, charged)<input className="input" type="number" min="0.01" step="0.01" value={typical} onChange={(e) => { setSaved(false); setTypical(e.target.value); }} /></label>
        </div>
        <div className="note">The typical cost only drives the "about N {cfg.unitPlural}" estimate shown on the pricing cards.</div>
        <DataTable
          rows={sample}
          empty=""
          cols={[
            { key: 'amount', label: 'Company pays', align: 'r', render: (r) => usd(r.amount) },
            { key: 'credit', label: 'Receives', align: 'r', render: (r) => <span>{usd(r.credit)}{r.bonusPct > 0 ? <span className="muted"> (+{r.bonusPct}%)</span> : null}</span> },
            { key: 'margin', label: 'Your margin', align: 'r', render: (r) => <span>{usd(r.profit)} <span className="muted">({Math.round(r.margin * 1000) / 10}%)</span></span> },
          ]}
        />
        <ErrorBox error={err} />
        <div className="row">
          {saved && <Badge tone="good">saved</Badge>}
          <span style={{ flex: 1 }} />
          <button className="btn primary" disabled={busy} onClick={save}>Save pricing</button>
        </div>
      </div>
    </Card>
  );
}

function PlanModal({ cfg, plan, pricing, markup, onClose, onDone }: { cfg: Cfg; plan: Row | null; pricing: Row; markup: number; onClose: () => void; onDone: () => void }) {
  const [v, setV] = useState({
    name: plan?.name || '',
    description: plan?.description || '',
    features: (plan?.features || []).join('\n'),
    price: plan ? String(plan.price_usd) : '',
    active: plan ? Boolean(plan.active) : true,
    sort: plan ? String(plan.sort ?? 0) : '0',
  });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: string, val: any) => setV((s) => ({ ...s, [k]: val }));
  const price = Number(v.price);
  const valid = v.name.trim() && price > 0;
  const q = price > 0 ? quote(price, pricing.tiers as Tier[], markup) : null;

  const submit = async () => {
    setBusy(true); setErr('');
    const body = { name: v.name.trim(), description: v.description, features: v.features, price_usd: price, active: v.active, sort: Number(v.sort) || 0 };
    try {
      if (plan) await api(`${cfg.plans}/${encodeURIComponent(plan.plan_id)}`, { method: 'PUT', body });
      else await api(cfg.plans, { method: 'POST', body });
      onDone();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <Modal title={plan ? `Edit ${plan.name}` : `New ${cfg.name} plan`} onClose={onClose}>
      <div className="stack">
        <label className="field">Name<input className="input" value={v.name} onChange={(e) => set('name', e.target.value)} autoFocus /></label>
        <label className="field">Short description (shown to companies)<input className="input" value={v.description} onChange={(e) => set('description', e.target.value)} /></label>
        <label className="field">What is included (one point per line, shown on the pricing card)
          <textarea className="input" rows={4} value={v.features} onChange={(e) => set('features', e.target.value)} />
        </label>
        <label className="field">Price (USD): what the company pays<input className="input" type="number" min="0" step="1" value={v.price} onChange={(e) => set('price', e.target.value)} /></label>
        {q && (
          <div className="note">
            The company receives <b>{usd(q.credit)}</b> of credit{q.bonusPct > 0 ? <> (<b>+{q.bonusPct}%</b> bonus)</> : null}. It covers about <b>{usd(q.value)}</b> of Anthropic usage, so your margin is about <b>{usd(q.profit)}</b> ({Math.round(q.margin * 1000) / 10}%). Companies see only what they pay and receive.
          </div>
        )}
        <div className="grid c2">
          <label className="field">Order on the Billing page<input className="input" type="number" step="1" value={v.sort} onChange={(e) => set('sort', e.target.value)} /></label>
          <label className="field">On sale<select className="input" value={v.active ? 'yes' : 'no'} onChange={(e) => set('active', e.target.value === 'yes')}><option value="yes">Yes, companies can buy it</option><option value="no">Hidden</option></select></label>
        </div>
        {plan && <div className="note">Changing the price does not affect credit companies already bought.</div>}
        <ErrorBox error={err} />
        <div className="row">
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy || !valid} onClick={submit}>Save</button>
        </div>
      </div>
    </Modal>
  );
}
