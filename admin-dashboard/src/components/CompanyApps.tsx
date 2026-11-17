import { useState } from 'react';
import { Row, api, usd, useApi } from '../lib';
import { Badge, Card, DataTable, ErrorBox, Modal, appStatusBadge } from './ui';

type Action = null | { app: 'nova' | 'raven'; kind: 'subscription' | 'allowance' | 'credit' | 'markup' };
const TX_LABEL: Record<string, string> = { grant: 'Credit added', trial: 'Trial', allowance_set: 'Allowance change', reconcile: 'Reconciled', reversal: 'Credit taken back' };

/** Per-company AI apps: subscribe, pause or switch off Nova and Raven, and manage Raven's own wallet. Nova's wallet is the panel below. */
export default function CompanyApps({ id }: { id: string }) {
  const { data, error, reload } = useApi<Row>(`/analytics/companies/${encodeURIComponent(id)}/apps`);
  const history = useApi<Row[]>(`/analytics/companies/${encodeURIComponent(id)}/apps/raven/wallet/transactions`, { limit: 25 });
  const [action, setAction] = useState<Action>(null);
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;
  const apps: Row[] = data.apps;
  const current = action ? apps.find((a) => a.key === action.app) : null;

  return (
    <Card title="AI apps" sub="Each app is subscribed and paid for separately.">
      <div className="stack">
        {apps.map((a) => {
          const sub = a.subscription;
          const w = a.wallet;
          const shown = sub.status ?? (a.key === 'nova' ? 'implicit' : null);
          return (
            <div key={a.key}>
              <div className="row">
                <b>{a.name}</b>
                {appStatusBadge(shown)}
                {sub.plan_name ? <span className="muted">{sub.plan_name}</span> : null}
                <span style={{ flex: 1 }} />
                <button className="btn sm" onClick={() => setAction({ app: a.key, kind: 'subscription' })}>{sub.subscribed ? 'Subscription' : a.key === 'raven' ? 'Subscribe' : 'Set plan'}</button>
                {a.key === 'raven' && (<>
                  <button className="btn sm" onClick={() => setAction({ app: a.key, kind: 'allowance' })}>Set allowance</button>
                  <button className="btn sm" onClick={() => setAction({ app: a.key, kind: 'markup' })}>Markup</button>
                  <button className="btn primary sm" onClick={() => setAction({ app: a.key, kind: 'credit' })}>Add credit</button>
                </>)}
              </div>
              <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>
                {a.key === 'raven'
                  ? `Credit: ${w.enforced && w.remaining_usd != null ? `${usd(w.remaining_usd)} left` : 'none yet (a new company must add credit to start)'} (free ${usd(w.free_allowance_usd)}, purchased ${usd(w.purchased_credit_usd)}, spent ${usd(w.spent_usd)}). Markup ${(w.effective_markup_rate * 100).toFixed(0)}%. An email goes to staff at 80% used.`
                  : 'Credit, plans and markup are in the wallet below. Paused or off blocks Nova chat and scheduled runs for this company.'}
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 14 }}>
        <div className="muted" style={{ marginBottom: 6 }}>Raven credit history</div>
        <DataTable
          rows={history.data || []}
          initialSort={{ key: 'created_at', desc: true }}
          empty={history.loading ? 'Loading…' : 'No Raven credit activity yet'}
          cols={[
            { key: 'created_at', label: 'When', render: (r) => (r.created_at ? new Date(r.created_at).toLocaleString() : '—') },
            { key: 'type', label: 'Type', render: (r) => <Badge tone={r.type === 'grant' ? 'good' : r.type === 'reversal' ? 'bad' : 'neutral'}>{TX_LABEL[r.type] || r.type}</Badge> },
            { key: 'amount_usd', label: 'Amount', align: 'r', render: (r) => <span className="num">{r.amount_usd > 0 ? '+' : ''}{usd(r.amount_usd)}</span> },
            { key: 'paid_usd', label: 'Paid', align: 'r', render: (r) => (r.paid_usd == null ? '—' : usd(r.paid_usd)) },
            { key: 'plan_name', label: 'Plan' },
            { key: 'reason', label: 'Reason' },
            { key: 'payment_ref', label: 'Payment ref', className: 'id' },
          ]}
        />
      </div>
      {action && current && <AppModal id={id} action={action} app={current} onClose={() => setAction(null)} onDone={() => { setAction(null); reload(); history.reload(); }} />}
    </Card>
  );
}

function AppModal({ id, action, app, onClose, onDone }: { id: string; action: Exclude<Action, null>; app: Row; onClose: () => void; onDone: () => void }) {
  const [status, setStatus] = useState<string>(app.subscription.status || 'active');
  const [plan, setPlan] = useState<string>(app.subscription.plan_name || '');
  const [allowance, setAllowance] = useState<string>(app.wallet.exists ? String(app.wallet.free_allowance_usd) : '');
  const [markup, setMarkup] = useState<string>(app.wallet.markup_rate != null ? String(app.wallet.markup_rate * 100) : '');
  const [amount, setAmount] = useState('');
  const [planId, setPlanId] = useState('');
  const plansCatalog = useApi<Row>(action.kind === 'credit' ? `/analytics/apps/${action.app}/plans` : null);
  const planOptions: Row[] = (plansCatalog.data?.plans || []).filter((pl: Row) => pl.active);
  const [reason, setReason] = useState('');
  const [ref, setRef] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const base = `/analytics/companies/${encodeURIComponent(id)}/apps/${action.app}`;

  const submit = async () => {
    setBusy(true); setErr('');
    try {
      if (action.kind === 'subscription') await api(base, { method: 'PUT', body: { status, plan_name: plan } });
      else if (action.kind === 'allowance') await api(`${base}/wallet`, { method: 'PUT', body: { free_allowance_usd: Number(allowance) } });
      else if (action.kind === 'markup') await api(`${base}/wallet`, { method: 'PUT', body: { markup_rate: markup === '' ? null : Number(markup) / 100 } });
      else {
        const res = await api(`${base}/credits`, { method: 'POST', body: planId ? { plan_id: planId, reason, payment_ref: ref } : { amount_usd: Number(amount), reason, payment_ref: ref } });
        if (res?.duplicate) { setErr(`Payment reference "${ref}" was already credited, so nothing changed.`); return; }
      }
      onDone();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  const titles = { subscription: `${app.name} subscription`, allowance: `${app.name} free allowance`, credit: `Add ${app.name} credit`, markup: `${app.name} markup override` };
  return (
    <Modal title={titles[action.kind]} onClose={onClose}>
      <div className="stack">
        {action.kind === 'subscription' && (<>
          <label className="field">Status
            <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="active">Active</option>
              <option value="paused">Paused (temporarily blocked)</option>
              <option value="off">Off</option>
            </select>
          </label>
          <label className="field">Plan label shown to the company<input className="input" value={plan} onChange={(e) => setPlan(e.target.value)} placeholder="e.g. Starter" /></label>
          <div className="note">{app.key === 'raven' ? 'Raven only analyses mail for companies with an active subscription.' : 'A company with no Nova subscription keeps using Nova as before. Paused or off blocks it.'}</div>
        </>)}
        {action.kind === 'allowance' && (<>
          <label className="field">Free allowance (USD, billable)<input className="input" type="number" min="0" step="0.01" value={allowance} onChange={(e) => setAllowance(e.target.value)} autoFocus /></label>
          <div className="note">Setting an allowance turns credit enforcement on for Raven: analysis stops once credit is used up.</div>
        </>)}
        {action.kind === 'markup' && (<>
          <label className="field">Markup % on Anthropic cost (blank = platform default)<input className="input" type="number" min="0" max="500" step="1" value={markup} onChange={(e) => setMarkup(e.target.value)} autoFocus /></label>
          <div className="note">Applies to new usage only. Never shown to the customer.</div>
        </>)}
        {action.kind === 'credit' && (<>
          <label className="field">Plan (credit and price paid come from the plan)
            <select className="input" value={planId} onChange={(e) => setPlanId(e.target.value)}>
              <option value="">Custom amount (goodwill top-up)</option>
              {planOptions.map((pl: Row) => <option key={pl.plan_id} value={pl.plan_id}>{pl.name}: pays {usd(pl.price_usd)}, receives {usd(pl.credit_usd)}</option>)}
            </select>
          </label>
          {!planId && <label className="field">Amount (USD credit)<input className="input" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus /></label>}
          <label className="field">Reason<input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Raven top-up" /></label>
          <label className="field">Payment reference<input className="input" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="invoice / payment id" /></label>
          <div className="note">A payment reference is credited once: submitting the same reference again changes nothing.</div>
        </>)}
        <ErrorBox error={err} />
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onClose}>Close</button>
          <button className="btn primary" disabled={busy || (action.kind === 'credit' && !planId && !(Number(amount) > 0)) || (action.kind === 'allowance' && allowance === '')} onClick={submit}>Save</button>
        </div>
      </div>
    </Modal>
  );
}
