import { useState } from 'react';
import { Range, Row, api, compact, downloadCsv, go, int, pct, pct100, usd, useApi } from '../lib';
import { BarList } from '../components/charts';
import CompanyApps from '../components/CompanyApps';
import ByApp from '../components/ByApp';
import { AppScope, Badge, Card, ChartCard, DataTable, ErrorBox, Kpi, Modal, walletBadge } from '../components/ui';

type Action = null | 'allowance' | 'credits' | 'markup' | 'name' | 'seats' | 'reconcile' | 'plan' | 'tiers';

const TX_LABEL: Record<string, string> = { grant: 'Credits added', trial: 'Trial', allowance_set: 'Allowance change', reconcile: 'Reconciled' };

export default function CompanyDetail({ id, range, app = '' }: { id: string; range: Range; app?: AppScope }) {
  const { data, error, loading, reload } = useApi<Row>(`/analytics/companies/${encodeURIComponent(id)}/detail`, { ...range, app });
  const [action, setAction] = useState<Action>(null);
  const history = useApi<Row[]>(`/analytics/companies/${encodeURIComponent(id)}/wallet/transactions`, { limit: 50 });

  if (error) return <ErrorBox error={error} />;
  if (!data) return <div className="empty">Loading…</div>;
  const t = data.totals, w = data.wallet;

  return (
    <div className={`stack ${loading ? 'loading' : ''}`}>
      <div className="row">
        <a href="#/companies">← Companies</a>
        {w.display_name ? <b>{w.display_name}</b> : null}
        <span className="grow" style={{ flex: 1 }} />
        <button className="btn sm" onClick={() => setAction('name')}>Edit name</button>
      </div>

      <div className="grid k4">
        <Kpi label="Revenue (billable)" value={usd(t.billable_usd)} />
        <Kpi label="Anthropic cost" value={usd(t.cost_usd)} hint={`${pct100(t.margin_pct)} margin`} />
        <Kpi label="Employees using it" value={int(data.users.length)} hint={`${int(data.daily.reduce((a: number, d: Row) => a + d.turns, 0))} turns`} />
        <Kpi label="Model calls" value={compact(t.call_count)} hint={`${pct(t.cache_hit_rate, 0)} cache hit`} />
      </div>

      <CompanyApps id={id} />

      <ByApp rows={data.by_app} />

      <div className="grid c3">
        <ChartCard
          title="Daily spend"
          data={data.daily}
          yFmt={(n) => usd(n, { compact: true })}
          series={[
            { key: 'billable_usd', label: 'Revenue (billable)', color: 'var(--series-1)', fmt: usd },
            { key: 'cost_usd', label: 'Anthropic cost', color: 'var(--series-2)', fmt: usd },
          ]}
        />
        <Card title="Wallet" right={walletBadge(w.exists ? (w.enforced ? (w.exhausted || w.remaining_usd <= 0 ? 'exhausted' : w.low_balance ? 'low' : 'ok') : 'unlimited') : undefined)}>
          <dl className="kv">
            <dt>Remaining</dt><dd className="num"><b>{w.exists && w.enforced ? usd(w.remaining_usd) : '—'}</b></dd>
            <dt>Free allowance</dt><dd className="num">{usd(w.free_allowance_usd)}</dd>
            <dt>Purchased credit</dt><dd className="num">{usd(w.purchased_credit_usd)}</dd>
            <dt>Spent (billable)</dt><dd className="num">{usd(w.spent_usd)}</dd>
            <dt>Plan</dt><dd>{w.plan_name || 'not set'}</dd>
            <dt>Models</dt><dd>{w.model_tiers && (w.model_tiers.daily || w.model_tiers.medium) ? `daily ${w.model_tiers.daily || 'default'}, medium ${w.model_tiers.medium || 'default'}` : 'platform defaults'}</dd>
            <dt>Seats</dt><dd>{w.seats != null ? `${data.users.length} of ${w.seats} active (${Math.round((data.users.length / Math.max(1, w.seats)) * 100)}%)` : 'not set'}</dd>
            <dt>Markup</dt><dd>{w.markup_rate != null ? `${(w.markup_rate * 100).toFixed(0)}% (override)` : `${(w.effective_markup_rate * 100).toFixed(0)}% (default)`}</dd>
          </dl>
          <div className="sep" />
          <div className="row">
            <button className="btn primary sm" onClick={() => setAction('credits')}>Grant credits</button>
            <button className="btn sm" onClick={() => setAction('plan')}>Plan</button>
            <button className="btn sm" onClick={() => setAction('tiers')}>Models</button>
            <button className="btn sm" onClick={() => setAction('allowance')}>Set allowance</button>
            <button className="btn sm" onClick={() => setAction('markup')}>Markup</button>
            <button className="btn sm" onClick={() => setAction('seats')}>Seats</button>
            <button className="btn sm" onClick={() => setAction('reconcile')}>Reconcile</button>
          </div>
          {!w.exists && <div className="note" style={{ marginTop: 8 }}>No wallet yet — usage is unlimited until you set an allowance or grant credits (unless trial credit is configured, which creates the wallet on first use).</div>}
        </Card>
      </div>

      <Card title="Wallet history" sub="Credit purchases, grants, trial and allowance changes. Usage is in the explorer.">
        <DataTable
          rows={history.data || []}
          initialSort={{ key: 'created_at', desc: true }}
          empty={history.loading ? 'Loading…' : 'No wallet activity yet'}
          cols={[
            { key: 'created_at', label: 'When', render: (r) => (r.created_at ? new Date(r.created_at).toLocaleString() : '—') },
            { key: 'type', label: 'Type', render: (r) => <Badge tone={r.type === 'grant' ? 'good' : r.type === 'reconcile' ? 'warn' : 'neutral'}>{TX_LABEL[r.type] || r.type}</Badge> },
            { key: 'amount_usd', label: 'Amount', align: 'r', render: (r) => <span className="num">{r.amount_usd > 0 ? '+' : ''}{usd(r.amount_usd)}</span> },
            { key: 'balance_after_usd', label: 'Balance after', align: 'r', render: (r) => (r.balance_after_usd == null ? '—' : usd(r.balance_after_usd)) },
            { key: 'reason', label: 'Reason' },
            { key: 'payment_ref', label: 'Payment ref', className: 'id' },
          ]}
        />
      </Card>

      <Card
        title={`Employees (${data.users.length})`}
        sub="Usage per employee in this range. Click to explore their daily usage."
        right={<button className="btn sm" onClick={() => downloadCsv(`${id}_employees_${range.from}_${range.to}.csv`, data.users, [
          { key: 'user_id', label: 'user_id' }, { key: 'turns', label: 'turns' }, { key: 'conversations', label: 'conversations' }, { key: 'call_count', label: 'calls' },
          { key: 'billable_usd', label: 'revenue_usd' }, { key: 'cost_usd', label: 'cost_usd' }, { key: 'active_days', label: 'active_days' }, { key: 'first_active', label: 'first_active' }, { key: 'last_active', label: 'last_active' },
        ])}>Export CSV</button>}
      >
        <DataTable
          rows={data.users}
          onRow={(r) => go('explorer', { company: id, user: r.user_id, group: 'date' })}
          initialSort={{ key: 'billable_usd', desc: true }}
          empty="No employee activity in this range"
          cols={[
            { key: 'user_id', label: 'Employee (user id)', className: 'id' },
            { key: 'turns', label: 'Turns', align: 'r', render: (r) => int(r.turns) },
            { key: 'conversations', label: 'Chats', align: 'r', render: (r) => int(r.conversations) },
            { key: 'call_count', label: 'Calls', align: 'r', render: (r) => compact(r.call_count) },
            { key: 'billable_usd', label: 'Revenue', align: 'r', render: (r) => usd(r.billable_usd) },
            { key: 'cost_usd', label: 'Cost', align: 'r', render: (r) => usd(r.cost_usd) },
            { key: 'active_days', label: 'Active days', align: 'r', render: (r) => int(r.active_days) },
            { key: 'first_active', label: 'First active' },
            { key: 'last_active', label: 'Last active' },
          ]}
        />
      </Card>

      <div className="grid c2">
        <Card title="By agent"><BarList rows={data.agents} labelKey="agent_key" valueKey="billable_usd" fmt={(n) => usd(n)} /></Card>
        <Card title="By model"><BarList rows={data.models} labelKey="model" valueKey="billable_usd" fmt={(n) => usd(n)} /></Card>
      </div>

      {action && <WalletModal id={id} action={action} wallet={w} onClose={() => setAction(null)} onDone={() => { setAction(null); reload(); history.reload(); }} />}
    </div>
  );
}

function WalletModal({ id, action, wallet, onClose, onDone }: { id: string; action: Exclude<Action, null>; wallet: Row; onClose: () => void; onDone: () => void }) {
  const [v, setV] = useState<Row>({ amount: '', reason: '', ref: '', allowance: wallet.free_allowance_usd ?? '', markup: wallet.markup_rate != null ? String(wallet.markup_rate * 100) : '', name: wallet.display_name || '', seats: wallet.seats != null ? String(wallet.seats) : '', planId: '', plan: wallet.plan_name || '', tierDaily: wallet.model_tiers?.daily || '', tierMedium: wallet.model_tiers?.medium || '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [drift, setDrift] = useState<Row | null>(null);
  const set = (k: string, val: string) => setV((s) => ({ ...s, [k]: val }));
  const base = `/analytics/companies/${encodeURIComponent(id)}/wallet`;
  const catalog = useApi<Row>(action === 'tiers' ? '/analytics/models' : null);
  const plansCatalog = useApi<Row>(action === 'credits' ? '/analytics/nova-plans' : null);
  const planOptions: Row[] = (plansCatalog.data?.plans || []).filter((pl: Row) => pl.active);
  const modelOptions: Row[] = (catalog.data?.models || []).filter((m: Row) => m.available_on_key !== false);

  const submit = async () => {
    setBusy(true); setErr('');
    try {
      if (action === 'credits') {
        const res = await api(`${base}/credits`, { method: 'POST', body: v.planId ? { plan_id: v.planId, reason: v.reason, payment_ref: v.ref } : { amount_usd: Number(v.amount), reason: v.reason, payment_ref: v.ref } });
        if (res?.duplicate) {
          setErr(`Payment reference "${v.ref}" was already credited, so nothing changed.`);
          return;
        }
      } else if (action === 'allowance') {
        await api(base, { method: 'PUT', body: { free_allowance_usd: Number(v.allowance) } });
      } else if (action === 'markup') {
        await api(base, { method: 'PUT', body: { markup_rate: v.markup === '' ? null : Number(v.markup) / 100 } });
      } else if (action === 'seats') {
        await api(base, { method: 'PUT', body: { seats: v.seats === '' ? null : Number(v.seats) } });
      } else if (action === 'plan') {
        await api(base, { method: 'PUT', body: { plan_name: v.plan } });
      } else if (action === 'tiers') {
        await api(base, { method: 'PUT', body: { model_tiers: { daily: v.tierDaily, medium: v.tierMedium } } });
      } else if (action === 'name') {
        await api(base, { method: 'PUT', body: { display_name: v.name } });
      }
      onDone();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  const checkDrift = async (apply: boolean) => {
    setBusy(true); setErr('');
    try { setDrift(await api(`${base}/reconcile`, apply ? { method: 'POST', body: { apply: true } } : {})); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  const titles: Record<string, string> = { credits: 'Grant credits', allowance: 'Set free allowance', markup: 'Markup override', name: 'Company name', seats: 'Seats on plan', plan: 'Plan', tiers: 'Models for this company', reconcile: 'Reconcile wallet with ledger' };

  return (
    <Modal title={titles[action]} onClose={onClose}>
      <div className="stack">
        {action === 'credits' && (<>
          <label className="field">Nova plan (credit and price paid come from the plan)
            <select className="input" value={v.planId} onChange={(e) => set('planId', e.target.value)}>
              <option value="">Custom amount</option>
              {planOptions.map((pl: Row) => <option key={pl.plan_id} value={pl.plan_id}>{pl.name}: pays {usd(pl.price_usd)}, receives {usd(pl.credit_usd)}</option>)}
            </select>
          </label>
          {!v.planId && <label className="field">Amount (USD credit)<input className="input" type="number" min="0" step="0.01" value={v.amount} onChange={(e) => set('amount', e.target.value)} autoFocus /></label>}
          <label className="field">Reason<input className="input" value={v.reason} onChange={(e) => set('reason', e.target.value)} placeholder="e.g. Pro plan top-up" /></label>
          <label className="field">Payment reference<input className="input" value={v.ref} onChange={(e) => set('ref', e.target.value)} placeholder="invoice / payment id" /></label>
          <div className="note">A payment reference is credited once: submitting the same reference again changes nothing. Leave it empty for a goodwill top-up.</div>
        </>)}
        {action === 'allowance' && (<>
          <label className="field">Free allowance (USD, billable)<input className="input" type="number" min="0" step="0.01" value={v.allowance} onChange={(e) => set('allowance', e.target.value)} autoFocus /></label>
          <div className="note">Setting an allowance turns wallet enforcement on: requests get a 402 once credits are used up.</div>
        </>)}
        {action === 'markup' && (<>
          <label className="field">Markup % on Anthropic cost (blank = platform default)<input className="input" type="number" min="0" max="500" step="1" value={v.markup} onChange={(e) => set('markup', e.target.value)} autoFocus /></label>
          <div className="note">Applies to new usage only. Past events keep the rate they were billed at. Never shown to the customer.</div>
        </>)}
        {action === 'plan' && (<>
          <label className="field">Plan name shown to the company<input className="input" value={v.plan} onChange={(e) => set('plan', e.target.value)} placeholder="e.g. Pro, Enterprise" autoFocus /></label>
          <div className="note">The company sees this under Settings &gt; Nova, next to their included credit and invoices. It does not change what they can spend: use Set allowance and Grant credits for that.</div>
        </>)}
        {action === 'tiers' && (<>
          {(['tierDaily', 'tierMedium'] as const).map((key) => (
            <label className="field" key={key}>{key === 'tierDaily' ? 'Daily tier (routing, planning, summaries)' : 'Medium tier (reports, Shopify, estimates, invoices)'}
              <select className="input" value={v[key]} onChange={(e) => set(key, e.target.value)}>
                <option value="">Platform default</option>
                {modelOptions.map((m: Row) => <option key={m.id} value={m.id}>{m.name} ({m.id})</option>)}
              </select>
            </label>
          ))}
          {catalog.loading && <div className="note">Loading models…</div>}
          <div className="note">Companies can no longer choose models themselves. This applies to every employee, over any earlier personal choice.</div>
        </>)}
        {action === 'seats' && (<>
          <label className="field">Employees on this company's Worxstream plan (blank = unknown)<input className="input" type="number" min="0" step="1" value={v.seats} onChange={(e) => set('seats', e.target.value)} autoFocus /></label>
          <div className="note">Used for seat-adoption %: active employees ÷ seats.</div>
        </>)}
        {action === 'name' && (<label className="field">Display name (ops label — names live in Worxstream, not here)<input className="input" value={v.name} onChange={(e) => set('name', e.target.value)} autoFocus /></label>)}
        {action === 'reconcile' && (<>
          <div className="note">Compares the wallet's spent amount with the sum of billable amounts in the usage ledger (the source of truth).</div>
          {drift && (
            <dl className="kv">
              <dt>Ledger billable</dt><dd className="num">{usd(drift.ledger_billable_usd)}</dd>
              <dt>Wallet spent</dt><dd className="num">{usd(drift.wallet_spent_usd)}</dd>
              <dt>Drift</dt><dd>{drift.drift_micros === 0 ? <Badge tone="good">none</Badge> : <Badge tone="bad">{usd(drift.drift_usd)}</Badge>}</dd>
              <dt>Pending wallet debits</dt><dd className="num">{int(drift.events_pending_wallet_debit)}</dd>
              <dt>Estimated-cost events</dt><dd className="num">{int(drift.events_with_estimated_cost)}</dd>
              {drift.applied && (<><dt>Applied</dt><dd><Badge tone="good">wallet rewritten to ledger</Badge></dd></>)}
            </dl>
          )}
        </>)}
        <ErrorBox error={err} />
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onClose}>Close</button>
          {action === 'reconcile' ? (<>
            <button className="btn" disabled={busy} onClick={() => checkDrift(false)}>Check drift</button>
            {drift && drift.drift_micros !== 0 && !drift.applied && (
              <button className="btn danger" disabled={busy} onClick={() => { if (confirm(`Rewrite wallet spent from ${usd(drift.wallet_spent_usd)} to ${usd(drift.ledger_billable_usd)}?`)) checkDrift(true); }}>Apply ledger total</button>
            )}
          </>) : (
            <button className="btn primary" disabled={busy || (action === 'credits' && !v.planId && !(Number(v.amount) > 0))} onClick={submit}>Save</button>
          )}
        </div>
      </div>
    </Modal>
  );
}
