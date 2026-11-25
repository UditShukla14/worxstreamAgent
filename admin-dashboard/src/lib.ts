import { useCallback, useEffect, useRef, useState } from 'react';

export type Row = Record<string, any>;

// ---------- auth + api ----------
const KEY_STORE = 'wx_admin_key';
export const getKey = () => {
  try { return sessionStorage.getItem(KEY_STORE) || ''; } catch { return ''; }
};
export const setKey = (k: string) => {
  try { k ? sessionStorage.setItem(KEY_STORE, k) : sessionStorage.removeItem(KEY_STORE); } catch { /* private mode */ }
};

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

export async function api<T = any>(path: string, opts: { method?: string; params?: Record<string, any>; body?: any } = {}): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(opts.params || {})) if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  const url = `/api/admin${path}${qs.toString() ? `?${qs}` : ''}`;
  const res = await fetch(url, {
    method: opts.method || 'GET',
    headers: { 'x-admin-api-key': getKey(), ...(opts.body ? { 'content-type': 'application/json' } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let json: any = null;
  try { json = await res.json(); } catch { /* non-json */ }
  if (!res.ok || json?.success === false) throw new ApiError(json?.error || `Request failed (${res.status})`, res.status);
  return json.data as T;
}

/** Fetches a printable HTML page (an invoice) with the admin key; the caller opens it in a new tab. */
export async function apiHtml(path: string, params: Record<string, any> = {}): Promise<string> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  const res = await fetch(`/api/admin${path}?${qs}`, { headers: { 'x-admin-api-key': getKey() } });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try { message = (await res.json())?.error || message; } catch { /* not json */ }
    throw new ApiError(message, res.status);
  }
  return res.text();
}

export function useApi<T = any>(path: string | null, params: Record<string, any> = {}) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const key = path ? `${path}?${JSON.stringify(params)}` : '';
  const seq = useRef(0);
  const run = useCallback(() => {
    if (!path) return;
    const id = ++seq.current;
    setLoading(true);
    setError('');
    api<T>(path, { params })
      .then((d) => { if (id === seq.current) setData(d); })
      .catch((e) => {
        if (id !== seq.current) return;
        if (e instanceof ApiError && e.status === 401) { setKey(''); location.reload(); }
        setError(e.message);
      })
      .finally(() => { if (id === seq.current) setLoading(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(run, [run]);
  return { data, error, loading, reload: run };
}

// ---------- formatting ----------
export const usd = (n: number | null | undefined, opts: { compact?: boolean } = {}) => {
  const v = Number(n || 0);
  if (opts.compact && Math.abs(v) >= 1000) return `$${(v / 1000).toFixed(1)}k`;
  const abs = Math.abs(v);
  const digits = abs >= 100 ? 0 : abs >= 1 ? 2 : abs === 0 ? 2 : 4;
  return `${v < 0 ? '-' : ''}$${abs.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
};
export const int = (n: number | null | undefined) => Math.round(Number(n || 0)).toLocaleString('en-US');
export const compact = (n: number | null | undefined) => {
  const v = Number(n || 0);
  if (Math.abs(v) >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (Math.abs(v) >= 1e3) return `${(v / 1e3).toFixed(1)}k`;
  return String(Math.round(v));
};
export const dur = (ms: number | null | undefined) => {
  if (ms == null) return '–';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  return s < 60 ? `${s.toFixed(1)} s` : `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
};
export const pct = (n: number | null | undefined, digits = 1) => `${(Number(n || 0) * 100).toFixed(digits)}%`;
export const pct100 = (n: number | null | undefined, digits = 1) => `${Number(n || 0).toFixed(digits)}%`;
export const shortDate = (d: string) => {
  const [, m, day] = d.split('-');
  return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m) - 1]} ${Number(day)}`;
};

export function delta(cur: number, prev: number): { text: string; dir: 'up' | 'down' | 'flat' } {
  if (!prev && !cur) return { text: 'no change', dir: 'flat' };
  if (!prev) return { text: 'new', dir: 'up' };
  const p = ((cur - prev) / prev) * 100;
  if (Math.abs(p) < 0.5) return { text: 'flat', dir: 'flat' };
  return { text: `${p > 0 ? '▲' : '▼'} ${Math.abs(p).toFixed(0)}%`, dir: p > 0 ? 'up' : 'down' };
}

// ---------- date range ----------
export type Range = { from: string; to: string };
const iso = (d: Date) => d.toISOString().slice(0, 10);
export const rangeLastDays = (days: number): Range => {
  const to = new Date();
  const from = new Date(Date.now() - (days - 1) * 86_400_000);
  return { from: iso(from), to: iso(to) };
};

// ---------- csv ----------
export function downloadCsv(name: string, rows: Row[], columns: { key: string; label: string }[]) {
  const esc = (v: any) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [columns.map((c) => esc(c.label)).join(','), ...rows.map((r) => columns.map((c) => esc(r[c.key])).join(','))].join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------- hash routing ----------
export type Route = { page: string; id?: string; query: Record<string, string> };
export function parseHash(): Route {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, qs = ''] = raw.split('?');
  const [page = 'overview', id] = path.split('/');
  return { page: page || 'overview', id: id ? decodeURIComponent(id) : undefined, query: Object.fromEntries(new URLSearchParams(qs)) };
}
export const go = (path: string, query: Record<string, string | undefined> = {}) => {
  const qs = new URLSearchParams(Object.entries(query).filter(([, v]) => v) as [string, string][]).toString();
  location.hash = `/${path}${qs ? `?${qs}` : ''}`;
};
export function useRoute(): Route {
  const [r, setR] = useState<Route>(parseHash());
  useEffect(() => {
    const on = () => setR(parseHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return r;
}
