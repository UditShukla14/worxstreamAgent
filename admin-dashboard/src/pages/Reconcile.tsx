import { KeyboardEvent, useEffect, useMemo, useState } from 'react';
import { Range, Row, apiHtml, compact, shortDate, usd, useApi } from '../lib';
import { Badge, Card, ChartCard, DataTable, ErrorBox, Kpi, Modal } from '../components/ui';

const statusBadge = (s: string) => {
  if (s === 'ok') return <Badge tone="good">matches</Badge>;
  if (s === 'pending') return <Badge>today (may lag)</Badge>;
  if (s === 'under_recorded') return <Badge tone="bad">under-recorded</Badge>;
  return <Badge tone="warn">over-recorded</Badge>;
};

const STORE = 'wx_reconcile_keys';
const KEY_ID = /^apikey_[A-Za-z0-9]{8,64}$/;

/** Splits what was typed or pasted (commas, spaces, new lines) into key ids. */
const tokens = (text: string) => text.split(/[\s,;]+/).map((t) => t.trim()).filter(Boolean);

/** Several API key ids as chips: type or paste one or many, press Enter or comma to add, pick by name from the list. */
function KeyPicker({ ids, onChange, keys }: { ids: string[]; onChange: (ids: string[]) => void; keys: Row[] }) {
  const [text, setText] = useState('');
  const [problem, setProblem] = useState('');
  const nameOf = useMemo(() => new Map(keys.map((k) => [String(k.id), String(k.name || '')])), [keys]);

  const add = (raw: string) => {
    const wanted = tokens(raw);
    if (!wanted.length) return;
    // A key's name is accepted too: "worxstream_mail" is turned into its id.
    const byName = new Map(keys.map((k) => [String(k.name).toLowerCase(), String(k.id)]));
    const resolved = wanted.map((w) => (KEY_ID.test(w) ? w : byName.get(w.toLowerCase()) || w));
    const bad = resolved.find((w) => !KEY_ID.test(w));
    if (bad) {
      setProblem(`"${bad}" is not an API key id (they look like apikey_01AbC...) or a known key name.`);
      return;
    }
    setProblem('');
    onChange([...new Set([...ids, ...resolved])]);
    setText('');
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (['Enter', ',', ' ', 'Tab'].includes(e.key) && text.trim()) {
      e.preventDefault();
      add(text);
    } else if (e.key === 'Backspace' && !text && ids.length) {
      onChange(ids.slice(0, -1));
    }
  };

  return (
    <div className="stack" style={{ gap: 6 }}>
      <label className="field">API keys to check (leave empty for everything)
        <div className="input" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', minHeight: 36 }} onClick={(e) => (e.currentTarget.querySelector('input') as HTMLInputElement | null)?.focus()}>
          {ids.map((id) => (
            <span key={id} className="badge" title={id}>
              {nameOf.get(id) || id}
              <button type="button" aria-label={`Remove ${nameOf.get(id) || id}`} className="btn sm" style={{ padding: '0 5px', marginLeft: 4 }} onClick={() => onChange(ids.filter((x) => x !== id))}>×</button>
            </span>
          ))}
          <input
            style={{ flex: 1, minWidth: 220, border: 0, background: 'transparent', outline: 'none', color: 'inherit', font: 'inherit' }}
            list="wx-reconcile-keys"
            placeholder={ids.length ? 'Add another key id or name' : 'Paste apikey_… ids or pick a key by name'}
            value={text}
            onChange={(e) => { setText(e.target.value); setProblem(''); }}
            onKeyDown={onKey}
            onPaste={(e) => { const pasted = e.clipboardData.getData('text'); if (tokens(pasted).length > 1) { e.preventDefault(); add(pasted); } }}
            onBlur={() => text.trim() && add(text)}
          />
        </div>
      </label>
      <datalist id="wx-reconcile-keys">
        {keys.filter((k) => !ids.includes(String(k.id))).map((k) => (<option key={k.id} value={k.id}>{k.name}{k.status && k.status !== 'active' ? ` (${k.status})` : ''}</option>))}
      </datalist>
      {problem && <div className="err" role="alert">{problem}</div>}
      <div className="note">With keys chosen, Anthropic's side is the tokens of just those keys, priced at our catalog (Anthropic's cost report cannot be filtered by key). Choose every key the agent and the mail service use.</div>
    </div>
  );
}

/** Generates a printable usage invoice for one company over the selected dates and opens it in a new tab. */
function InvoiceDialog({ range, onClose }: { range: Range; onClose: () => void }) {
  const list = useApi<Row[]>('/analytics/invoices/usage/companies', range);
  const [company, setCompany] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const companies = list.data || [];
  const chosen = company || companies[0]?.company_id || '';
  const picked = companies.find((c) => c.company_id === chosen);

  const generate = async () => {
    setBusy(true); setErr('');
    try {
      const html = await apiHtml('/analytics/invoices/usage', { ...range, company_id: chosen });
      const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      onClose();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <Modal title="Generate usage invoice" onClose={onClose}>
      <div className="stack">
        <div className="note">Period: <b>{range.from}</b> to <b>{range.to}</b>. It is the standard invoice with one line for the total billable amount, no usage details. It is generated now and not stored.</div>
        <label className="field">Company
          <select className="input" value={chosen} onChange={(e) => setCompany(e.target.value)} disabled={list.loading || !companies.length}>
            {!companies.length && <option value="">{list.loading ? 'Loading…' : 'No company has usage in this period'}</option>}
            {companies.map((c) => (<option key={c.company_id} value={c.company_id}>{c.display_name ? `${c.display_name} (${c.company_id})` : c.company_id}: {usd(c.billable_usd)}</option>))}
          </select>
        </label>
        {picked && <div className="note">Total to charge for this company: <b>{usd(picked.billable_usd)}</b></div>}
        <ErrorBox error={err || list.error} />
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onClose}>Close</button>
          <button className="btn primary" disabled={busy || !chosen} onClick={generate}>{busy ? 'Generating…' : 'Generate invoice'}</button>
        </div>
      </div>
    </Modal>
  );
}

export default function Reconcile({ range }: { range: Range }) {
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [ids, setIds] = useState<string[]>(() => { try { return (JSON.parse(localStorage.getItem(STORE) || '[]') as string[]).filter((i) => KEY_ID.test(i)); } catch { return []; } });
  useEffect(() => { try { localStorage.setItem(STORE, JSON.stringify(ids)); } catch { /* ignore */ } }, [ids]);
  const keys = useApi<Row[]>('/analytics/reconcile/anthropic/keys');
  // Anthropic's report allows ≤31 daily buckets per page; the server pages through, but keep the view readable.
  const { data, error, loading, reload } = useApi<Row>('/analytics/reconcile/anthropic', { ...range, api_key_ids: ids.join(',') });
  const picker = <KeyPicker ids={ids} onChange={setIds} keys={keys.data || []} />;
  if (error) return <div className="stack">{picker}<ErrorBox error={error} /><button className="btn" onClick={reload}>Retry</button></div>;
  if (!data) return <div className="stack">{picker}<div className="empty">Loading…</div></div>;

  if (!data.configured) {
    return (
      <Card title="Anthropic reconciliation is not set up">
        <p className="secondary">{data.message}</p>
        <p className="note">Our ledger total for this range is <b>{usd(data.ours_total_usd)}</b>. Set <code>ANTHROPIC_ADMIN_API_KEY</code> (and optionally <code>ANTHROPIC_RECONCILE_WORKSPACE_ID</code> to restrict it to this agent's workspace) on the agent server, then reload.</p>
      </Card>
    );
  }

  return (
    <div className={`stack ${loading ? 'loading' : ''}`}>
      {picker}
      <div className="grid k5">
        <Kpi label="Our ledger (provider cost)" value={usd(data.totals.ours_usd)} />
        <Kpi label={ids.length ? 'Anthropic tokens of the selected keys, priced' : 'Anthropic cost report'} value={usd(data.totals.anthropic_usd)} />
        <Kpi label="Difference" value={usd(data.totals.diff_usd)} hint={`${data.totals.diff_pct}% of Anthropic`} />
        <Kpi label="Customer billable (to charge)" value={usd(data.totals.billable_usd)} hint={`${usd(data.totals.billable_usd - data.totals.ours_usd)} over our cost`} />
        <Kpi label="Days needing a look" value={String(data.flagged_days)} hint={data.scope} />
      </div>

      <ChartCard
        title="Ledger vs Anthropic, per day"
        data={data.rows}
        yFmt={(n) => usd(n, { compact: true })}
        series={[
          { key: 'ours_usd', label: 'Our ledger', color: 'var(--series-1)', fmt: usd },
          { key: 'anthropic_usd', label: 'Anthropic', color: 'var(--series-2)', fmt: usd },
        ]}
      />

      <Card title="Daily comparison" right={<button className="btn primary sm" onClick={() => setInvoiceOpen(true)}>Generate invoice</button>} sub="Under-recorded = Anthropic charged more than we metered (aborted calls, other apps on the org, tool fees, wrong catalog price).">
        <DataTable
          rows={data.rows}
          initialSort={{ key: 'date', desc: true }}
          cols={[
            { key: 'date', label: 'Day (UTC)', render: (r: Row) => `${shortDate(r.date)} ${r.date.slice(0, 4)}` },
            { key: 'ours_usd', label: 'Ours', align: 'r', render: (r) => usd(r.ours_usd) },
            { key: 'anthropic_usd', label: 'Anthropic', align: 'r', render: (r) => usd(r.anthropic_usd) },
            { key: 'diff_usd', label: 'Diff', align: 'r', render: (r) => <span>{usd(r.diff_usd)} <span className="muted">({r.diff_pct}%)</span></span> },
            { key: 'billable_usd', label: 'Customer billable', align: 'r', render: (r) => <b>{usd(r.billable_usd)}</b> },
            { key: 'ours_tokens', label: 'Our tokens', align: 'r', render: (r) => compact(r.ours_tokens) },
            { key: 'anthropic_tokens', label: 'Anthropic tokens', align: 'r', render: (r) => compact(r.anthropic_tokens) },
            { key: 'status', label: 'Status', render: (r) => statusBadge(r.status) },
          ]}
        />
      </Card>

      {invoiceOpen && <InvoiceDialog range={range} onClose={() => setInvoiceOpen(false)} />}

      <div className="grid c2">
        <Card title="Anthropic cost by type">
          <dl className="kv">{Object.entries(data.anthropic_cost_by_type_usd as Record<string, number>).map(([k, v]) => (<><dt key={`k${k}`}>{k}</dt><dd key={`v${k}`} className="num">{usd(v)}</dd></>))}</dl>
        </Card>
        <Card title="Notes"><ul className="note" style={{ margin: 0, paddingLeft: 18 }}>{(data.notes as string[]).map((n) => (<li key={n}>{n}</li>))}</ul></Card>
      </div>
    </div>
  );
}
