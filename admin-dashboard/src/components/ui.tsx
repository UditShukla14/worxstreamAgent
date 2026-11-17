import { ReactNode, useMemo, useState } from 'react';
import { Range, Row, delta, rangeLastDays } from '../lib';
import { LineChart, Series } from './charts';

export function Card({ title, sub, right, children, className = '' }: { title?: ReactNode; sub?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || right) && (
        <div className="card-head">
          <div>{title && <h2>{title}</h2>}{sub && <div className="sub">{sub}</div>}</div>
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

/** Titled group of cards on a page. */
export function Section({ title, desc, right, children }: { title: string; desc?: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="section">
      <div className="section-head">
        <div><h2>{title}</h2>{desc && <p>{desc}</p>}</div>
        {right}
      </div>
      <div className="stack">{children}</div>
    </section>
  );
}

export function Kpi({ label, value, cur, prev, hint }: { label: string; value: ReactNode; cur?: number; prev?: number; hint?: string }) {
  const d = cur !== undefined && prev !== undefined ? delta(cur, prev) : null;
  return (
    <div className="card kpi">
      <div className="label">{label}</div>
      <div className="value num">{value}</div>
      <div className="delta">{d ? `${d.text} vs previous period` : hint || ' '}</div>
    </div>
  );
}

/** Status badge — icon + label, never color alone. */
export function Badge({ tone = 'neutral', children }: { tone?: 'good' | 'warn' | 'bad' | 'neutral'; children: ReactNode }) {
  const icon = tone === 'good' ? '✓' : tone === 'warn' ? '!' : tone === 'bad' ? '✕' : '•';
  return <span className={`badge ${tone === 'neutral' ? '' : tone}`}><span aria-hidden>{icon}</span>{children}</span>;
}

export function walletBadge(status?: string) {
  if (!status) return <Badge>no wallet</Badge>;
  if (status === 'exhausted') return <Badge tone="bad">exhausted</Badge>;
  if (status === 'low') return <Badge tone="warn">low balance</Badge>;
  if (status === 'ok') return <Badge tone="good">funded</Badge>;
  return <Badge>unlimited</Badge>;
}

export function ErrorBox({ error }: { error: string }) {
  return error ? <div className="err" role="alert">{error}</div> : null;
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-label={title}>
        <h3>{title}</h3>
        {children}
      </div>
    </div>
  );
}

const PRESETS: { label: string; days: number }[] = [{ label: '7d', days: 7 }, { label: '14d', days: 14 }, { label: '30d', days: 30 }, { label: '90d', days: 90 }];

export function DateRangeBar({ range, onChange }: { range: Range; onChange: (r: Range) => void }) {
  const days = Math.round((Date.parse(range.to) - Date.parse(range.from)) / 86_400_000) + 1;
  const preset = rangeLastDays(days);
  const active = preset.from === range.from && preset.to === range.to ? days : -1;
  return (
    <div className="row">
      <div className="seg" role="group" aria-label="Date range presets">
        {PRESETS.map((p) => (
          <button key={p.days} className={active === p.days ? 'on' : ''} onClick={() => onChange(rangeLastDays(p.days))}>{p.label}</button>
        ))}
      </div>
      <input className="input" type="date" value={range.from} max={range.to} onChange={(e) => e.target.value && onChange({ ...range, from: e.target.value })} aria-label="From date" />
      <span className="muted">→</span>
      <input className="input" type="date" value={range.to} min={range.from} onChange={(e) => e.target.value && onChange({ ...range, to: e.target.value })} aria-label="To date" />
    </div>
  );
}

export type Col = {
  key: string;
  label: string;
  align?: 'r';
  render?: (r: Row) => ReactNode;
  sortValue?: (r: Row) => number | string;
  className?: string;
};

/** Sortable table; click a header to sort. */
export function DataTable({ rows, cols, onRow, initialSort, empty = 'No rows' }: { rows: Row[]; cols: Col[]; onRow?: (r: Row) => void; initialSort?: { key: string; desc?: boolean }; empty?: string }) {
  const [sort, setSort] = useState(initialSort || null);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = cols.find((c) => c.key === sort.key);
    const val = (r: Row) => (col?.sortValue ? col.sortValue(r) : r[sort.key]);
    return [...rows].sort((a, b) => {
      const av = val(a), bv = val(b);
      const c = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av ?? '').localeCompare(String(bv ?? ''));
      return sort.desc ? -c : c;
    });
  }, [rows, sort, cols]);
  if (!rows.length) return <div className="empty">{empty}</div>;
  return (
    <div className="tablewrap">
      <table>
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c.key} className={c.align === 'r' ? 'r' : ''} onClick={() => setSort((s) => (s?.key === c.key ? { key: c.key, desc: !s.desc } : { key: c.key, desc: true }))} aria-sort={sort?.key === c.key ? (sort.desc ? 'descending' : 'ascending') : 'none'}>
                {c.label}{sort?.key === c.key ? (sort.desc ? ' ↓' : ' ↑') : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => (
            <tr key={i} className={onRow ? 'click' : ''} onClick={onRow ? () => onRow(r) : undefined}>
              {cols.map((c) => (<td key={c.key} className={`${c.align === 'r' ? 'r num' : ''} ${c.className || ''}`}>{c.render ? c.render(r) : String(r[c.key] ?? '')}</td>))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Chart with a table-view toggle (accessibility: every chart has a table equivalent). */
export function ChartCard({ title, sub, data, series, yFmt, cols, height }: { title: string; sub?: string; data: Row[]; series: Series[]; yFmt: (n: number) => string; cols?: Col[]; height?: number }) {
  const [table, setTable] = useState(false);
  const tableCols: Col[] = cols || [
    { key: 'date', label: 'Date' },
    ...series.map((s) => ({ key: s.key, label: s.label, align: 'r' as const, render: (r: Row) => (s.fmt || yFmt)(Number(r[s.key]) || 0) })),
  ];
  return (
    <Card title={title} sub={sub} right={<div className="seg"><button className={!table ? 'on' : ''} onClick={() => setTable(false)}>Chart</button><button className={table ? 'on' : ''} onClick={() => setTable(true)}>Table</button></div>}>
      {table ? <DataTable rows={data} cols={tableCols} initialSort={{ key: 'date', desc: true }} /> : <LineChart data={data} series={series} yFmt={yFmt} height={height} />}
    </Card>
  );
}

/** Subscription state of an AI app. `implicit` = Nova for a company with no subscription row (it keeps working). */
export function appStatusBadge(status?: string | null) {
  if (status === 'active') return <Badge tone="good">active</Badge>;
  if (status === 'implicit') return <Badge tone="good">active (no plan set)</Badge>;
  if (status === 'paused') return <Badge tone="warn">paused</Badge>;
  if (status === 'off') return <Badge>off</Badge>;
  return <Badge>not subscribed</Badge>;
}

export type AppScope = '' | 'nova' | 'raven';

/** Which AI app the usage tabs show: both together (cumulative, the default) or one of them. */
export function AppScopeBar({ value, onChange }: { value: AppScope; onChange: (v: AppScope) => void }) {
  return (
    <div className="seg" role="group" aria-label="AI app">
      {([['', 'Nova + Raven'], ['nova', 'Nova'], ['raven', 'Raven']] as [AppScope, string][]).map(([v, label]) => (
        <button key={v || 'all'} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>{label}</button>
      ))}
    </div>
  );
}

export function appBadge(app?: string) {
  return <Badge>{app === 'raven' ? 'Raven' : 'Nova'}</Badge>; // neutral: an app name is not a status
}
