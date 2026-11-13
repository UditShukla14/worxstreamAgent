import { useState } from 'react';
import { Row, api, usd, useApi } from '../lib';
import { Badge, Card, DataTable, ErrorBox, Modal } from '../components/ui';

/** Price a plan sells for: Anthropic credit plus the margin, rounded to the cent (mirrors the server rule). */
const priceFor = (credit: number, marginPct: number) => Math.round(credit * 100 * (1 + marginPct / 100)) / 100;

export default function NovaPlans() {
  const { data, error, loading, reload } = useApi<Row>('/analytics/nova-plans');
  const [editing, setEditing] = useState<Row | 'new' | null>(null);

  if (error) return <ErrorBox error={error} />;
  if (!data) return <div className="empty">Loading…</div>;
  const plans: Row[] = data.plans || [];

  return (
    <div className={`stack ${loading ? 'loading' : ''}`}>
      <Card
        title="Nova credit plans"
        sub="What companies can buy for the Nova app. These are separate from the Worxstream app subscription plans. A company pays credit + margin and receives the credit."
        right={<button className="btn primary sm" onClick={() => setEditing('new')}>New plan</button>}
      >
        {data.usage_markup_rate > 0 && (
          <div className="err" role="alert" style={{ marginBottom: 12 }}>
            A per-call markup of {Math.round(data.usage_markup_rate * 100)}% is also set (NOVA_MARKUP_RATE). Plans already include the margin, so companies would pay it twice. Set NOVA_MARKUP_RATE to 0.
          </div>
        )}
        <DataTable
          rows={plans}
          initialSort={{ key: 'sort' }}
          empty="No plans yet"
          onRow={(r) => setEditing(r)}
          cols={[
            { key: 'name', label: 'Plan', render: (r) => <span><b>{r.name}</b> <span className="muted id">{r.plan_id}</span></span> },
            { key: 'credit_usd', label: 'Credit they receive', align: 'r', render: (r) => usd(r.credit_usd) },
            { key: 'margin_rate', label: 'Margin', align: 'r', render: (r) => `${Math.round(r.margin_rate * 1000) / 10}%` },
            { key: 'price_usd', label: 'Price they pay', align: 'r', render: (r) => <b>{usd(r.price_usd)}</b> },
            { key: 'active', label: 'Status', render: (r) => (r.active ? <Badge tone="good">on sale</Badge> : <Badge>hidden</Badge>) },
            { key: 'description', label: 'Description' },
          ]}
        />
      </Card>
      {editing && <PlanModal plan={editing === 'new' ? null : editing} defaultMargin={data.default_margin_rate} onClose={() => setEditing(null)} onDone={() => { setEditing(null); reload(); }} />}
    </div>
  );
}

function PlanModal({ plan, defaultMargin, onClose, onDone }: { plan: Row | null; defaultMargin: number; onClose: () => void; onDone: () => void }) {
  const [v, setV] = useState({
    name: plan?.name || '',
    description: plan?.description || '',
    credit: plan ? String(plan.credit_usd) : '',
    margin: String(Math.round((plan?.margin_rate ?? defaultMargin) * 1000) / 10),
    active: plan ? Boolean(plan.active) : true,
    sort: plan ? String(plan.sort ?? 0) : '0',
  });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: string, val: any) => setV((s) => ({ ...s, [k]: val }));
  const credit = Number(v.credit);
  const margin = Number(v.margin);
  const valid = v.name.trim() && credit > 0 && margin >= 0;

  const submit = async () => {
    setBusy(true); setErr('');
    const body = { name: v.name.trim(), description: v.description, credit_usd: credit, margin_rate: margin / 100, active: v.active, sort: Number(v.sort) || 0 };
    try {
      if (plan) await api(`/analytics/nova-plans/${encodeURIComponent(plan.plan_id)}`, { method: 'PUT', body });
      else await api('/analytics/nova-plans', { method: 'POST', body });
      onDone();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <Modal title={plan ? `Edit ${plan.name}` : 'New Nova plan'} onClose={onClose}>
      <div className="stack">
        <label className="field">Name<input className="input" value={v.name} onChange={(e) => set('name', e.target.value)} autoFocus /></label>
        <label className="field">Description (shown to companies)<input className="input" value={v.description} onChange={(e) => set('description', e.target.value)} /></label>
        <div className="grid c2">
          <label className="field">Credit they receive (USD of Anthropic usage)<input className="input" type="number" min="0" step="1" value={v.credit} onChange={(e) => set('credit', e.target.value)} /></label>
          <label className="field">Margin (%)<input className="input" type="number" min="0" step="0.5" value={v.margin} onChange={(e) => set('margin', e.target.value)} /></label>
        </div>
        <div className="note">
          Price the company pays: <b>{credit > 0 && margin >= 0 ? usd(priceFor(credit, margin)) : '—'}</b>. The price is always credit + margin, rounded to the cent.
        </div>
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
