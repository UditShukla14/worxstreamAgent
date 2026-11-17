import { FormEvent, ReactNode, useEffect, useState } from 'react';
import { Range, api, getKey, rangeLastDays, setKey, useRoute } from './lib';
import { AppScope, AppScopeBar, DateRangeBar, ErrorBox } from './components/ui';
import Overview from './pages/Overview';
import Companies from './pages/Companies';
import CompanyDetail from './pages/CompanyDetail';
import Explorer from './pages/Explorer';
import Wallets from './pages/Wallets';
import Reconcile from './pages/Reconcile';
import Growth from './pages/Growth';
import Economics from './pages/Economics';
import Quality from './pages/Quality';
import Models from './pages/Models';
import NovaPlans from './pages/NovaPlans';
import Subscriptions from './pages/Subscriptions';
import AiApps from './pages/AiApps';

const icon = (d: string) => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>);
const NAV: { group: string; items: { page: string; label: string; icon: ReactNode }[] }[] = [
  { group: 'Monitor', items: [
    { page: 'overview', label: 'Overview', icon: icon('M3 12l9-9 9 9M5 10v10h14V10') },
    { page: 'growth', label: 'Growth', icon: icon('M3 17l6-6 4 4 8-8M15 7h6v6') },
    { page: 'economics', label: 'Economics', icon: icon('M12 2v20M17 6H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6') },
    { page: 'quality', label: 'Quality', icon: icon('M22 12h-4l-3 9L9 3l-3 9H2') },
  ] },
  { group: 'Manage', items: [
    { page: 'companies', label: 'Companies', icon: icon('M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6') },
    { page: 'explorer', label: 'Usage explorer', icon: icon('M3 3v18h18M7 15l4-4 3 3 5-6') },
    { page: 'apps', label: 'AI apps', icon: icon('M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM17 13v7M13.5 16.5h7') },
    { page: 'wallets', label: 'Wallets', icon: icon('M3 7h18v12H3zM3 7l3-4h12l3 4M16 13h2') },
    { page: 'subscriptions', label: 'Subscriptions', icon: icon('M9 11l3 3 8-8M20 12v7a2 2 0 01-2 2H6a2 2 0 01-2-2V5a2 2 0 012-2h9') },
    { page: 'plans', label: 'Plans & pricing', icon: icon('M20 12V8H6a2 2 0 010-4h12v4M4 6v12a2 2 0 002 2h14v-4M18 12a2 2 0 000 4h4v-4z') },
  ] },
  { group: 'Platform', items: [
    { page: 'models', label: 'Models', icon: icon('M12 2l9 5v10l-9 5-9-5V7zM12 12l9-5M12 12v10M12 12L3 7') },
    { page: 'reconcile', label: 'Reconcile', icon: icon('M20 6L9 17l-5-5') },
  ] },
];
const TITLES: Record<string, string> = { overview: 'Overview', growth: 'Growth & adoption', economics: 'Economics', quality: 'Quality & reliability', companies: 'Companies', company: 'Company', explorer: 'Usage explorer', apps: 'AI apps (Nova and Raven)', wallets: 'Wallets & credit', plans: 'Credit plans & pricing (Nova and Raven)', subscriptions: 'Company subscriptions', models: 'Models', reconcile: 'Reconcile with Anthropic' };

function loadRange(): Range {
  try {
    const raw = localStorage.getItem('wx_admin_range');
    if (raw) { const r = JSON.parse(raw); if (r.from && r.to) return r; }
  } catch { /* ignore */ }
  return rangeLastDays(30);
}

function Login({ onDone }: { onDone: () => void }) {
  const [v, setV] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    setKey(v.trim());
    try { await api('/analytics/wallets'); onDone(); } catch (x: any) { setKey(''); setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <form className="card login stack" onSubmit={submit}>
      <div><h1>Worxstream AI Admin</h1><div className="muted">Enter the platform admin key (ADMIN_API_KEY). It stays in this tab only.</div></div>
      <input className="input" type="password" placeholder="Admin API key" value={v} onChange={(e) => setV(e.target.value)} autoFocus autoComplete="off" />
      <ErrorBox error={err} />
      <button className="btn primary" disabled={!v.trim() || busy}>{busy ? 'Checking…' : 'Sign in'}</button>
    </form>
  );
}

export default function App() {
  const [authed, setAuthed] = useState(Boolean(getKey()));
  const [range, setRange] = useState<Range>(loadRange);
  const [theme, setTheme] = useState<string>(() => { try { return localStorage.getItem('wx_admin_theme') || ''; } catch { return ''; } });
  const [app, setApp] = useState<AppScope>(() => { try { const v = localStorage.getItem('wx_admin_app'); return v === 'nova' || v === 'raven' ? v : ''; } catch { return ''; } });
  const route = useRoute();

  useEffect(() => { try { localStorage.setItem('wx_admin_app', app); } catch { /* ignore */ } }, [app]);
  useEffect(() => { try { localStorage.setItem('wx_admin_range', JSON.stringify(range)); } catch { /* ignore */ } }, [range]);
  useEffect(() => {
    if (theme) document.documentElement.setAttribute('data-theme', theme); else document.documentElement.removeAttribute('data-theme');
    try { localStorage.setItem('wx_admin_theme', theme); } catch { /* ignore */ }
  }, [theme]);

  if (!authed) return <Login onDone={() => setAuthed(true)} />;

  const page = route.page;
  const showRange = page !== 'wallets' && page !== 'plans' && page !== 'subscriptions';
  // Pages whose numbers can be limited to one AI app. The rest are about both apps already (the AI apps hub) or about the platform.
  const showApp = ['overview', 'economics', 'explorer', 'companies', 'company', 'wallets'].includes(page);
  let body: ReactNode;
  switch (page) {
    case 'companies': body = <Companies range={range} app={app} />; break;
    case 'company': body = route.id ? <CompanyDetail id={route.id} range={range} app={app} key={route.id} /> : <Companies range={range} app={app} />; break;
    case 'explorer': body = <Explorer range={range} app={app} />; break;
    case 'apps': body = <AiApps range={range} />; break;
    case 'wallets': body = <Wallets app={app} />; break;
    case 'plans': body = <NovaPlans />; break;
    case 'subscriptions': body = <Subscriptions />; break;
    case 'growth': body = <Growth range={range} />; break;
    case 'economics': body = <Economics range={range} app={app} />; break;
    case 'quality': body = <Quality range={range} />; break;
    case 'models': body = <Models range={range} />; break;
    case 'reconcile': body = <Reconcile range={range} />; break;
    default: body = <Overview range={range} app={app} />;
  }
  const activeNav = page === 'company' ? 'companies' : page;
  const isDark = theme === 'dark' || (!theme && window.matchMedia?.('(prefers-color-scheme: dark)').matches);

  return (
    <div className="app">
      <aside className="side">
        <div className="brand">
          <div className="logo"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M3 17l4-9 4 6 4-10 4 13" /></svg></div>
          <div>Worxstream AI<small>Admin hub</small></div>
        </div>
        <nav className="nav">
          {NAV.map((g) => (
            <div key={g.group}>
              <div className="nav-group">{g.group}</div>
              {g.items.map((n) => (<a key={n.page} href={`#/${n.page}`} className={activeNav === n.page ? 'active' : ''}>{n.icon}{n.label}</a>))}
            </div>
          ))}
        </nav>
        <div className="spacer" />
        <button className="btn sm" onClick={() => setTheme(isDark ? 'light' : 'dark')}>{isDark ? 'Light mode' : 'Dark mode'}</button>
        <button className="btn sm" onClick={() => { setKey(''); setAuthed(false); }}>Sign out</button>
      </aside>
      <main className="main">
        <div className="topbar">
          <h1>{page === 'company' ? `Company ${route.id ?? ''}` : TITLES[page] || 'Overview'}</h1>
          <span className="grow" />
          {showApp && <AppScopeBar value={app} onChange={setApp} />}
          {showRange && <DateRangeBar range={range} onChange={setRange} />}
        </div>
        {body}
      </main>
    </div>
  );
}
