# Worxstream AI Admin hub

Ops dashboard for the Worxstream AI agent (companies, employees, usage, spend, wallets, reconciliation).

```bash
npm run admin:build      # from the agent root → builds admin-dashboard/dist, served at /admin
npm run admin:dev        # Vite dev server on :5174, proxies /api to http://localhost:3000 (AGENT_URL to override)
```

Sign in with the agent's `ADMIN_API_KEY`. Reconcile needs `ANTHROPIC_ADMIN_API_KEY` (and optionally
`ANTHROPIC_RECONCILE_WORKSPACE_ID`) on the agent server. Markup: `NOVA_MARKUP_RATE` (default 0 = off) or a
per-company override in the wallet panel.

## Pages
- **Monitor** — Overview, Growth & adoption, Economics, Quality & reliability
- **Manage** — Companies (+ company page), Usage explorer, **AI apps** (Nova + Raven subscriptions, credit and usage per company; see `docs/ai-apps.md`), Wallets & credit
- **Platform** — Models (limits, capabilities, Anthropic cost vs customer price, cost estimator), Reconcile

Latency, cost-per-turn and context-pressure panels fill from turns created after they were introduced.
Seat adoption needs `seats` set per company (Company page → Seats).
