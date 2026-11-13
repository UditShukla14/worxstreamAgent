# Nova wallet

How a company pays for and is limited in Nova (the chat agent) and Scribe (scheduled runs).

## Model

- One wallet per company (`company_nova_wallets`), money in **integer micro-USD** (1 USD = 1,000,000), billable dollars.
- `remaining = free_allowance + purchased_credit - spent`. Every Claude call debits `spent` by its billable cost
  (provider cost x (1 + markup)); the usage ledger (`llm_usage_events`) is the source of truth, the wallet is the running balance.
- A wallet is **enforced** (`limits_enabled`) once an allowance is set or credits are granted. A company with no wallet is
  unlimited, unless one of the options below is on.
- History of everything that adds or removes spendable credit: `nova_wallet_transactions`
  (types `grant`, `trial`, `allowance_set`, `reconcile`).

## Behaviour

| Situation | What happens |
|---|---|
| Remaining <= 0 | Chat and scheduled runs get **402** with `code: "NOVA_CREDIT_EXHAUSTED"`; the web app shows the paywall. |
| Remaining low (under `NOVA_LOW_BALANCE_RATIO` of everything granted, or under `NOVA_LOW_BALANCE_USD`) | Wallet reports `low_balance: true`; the web app shows a warning. |
| Credit runs out in the middle of a turn | The turn stops once its provider cost reaches what is left (capped also by `NOVA_MAX_TURN_COST_USD`) and tells the user to add credits. |
| First use by a company with no wallet | `NOVA_TRIAL_ALLOWANCE_USD > 0`: a wallet with that free allowance is created (once, race-safe) and a `trial` history row is written. |
| No wallet and `NOVA_REQUIRE_WALLET=true` | 402 until credits are bought or granted ("Nova is not activated"). |

## Settings (agent `.env`)

| Variable | Default | Meaning |
|---|---|---|
| `NOVA_TRIAL_ALLOWANCE_USD` | `0` (off) | Free credit created on a company's first use |
| `NOVA_REQUIRE_WALLET` | `false` | Block companies that have no wallet |
| `NOVA_LOW_BALANCE_RATIO` | `0.1` | "Low" below this share of everything granted |
| `NOVA_LOW_BALANCE_USD` | `2` | ...or below this many dollars |
| `NOVA_MARKUP_RATE` | `0` | Default markup on provider cost (per-company override in the admin dashboard) |
| `NOVA_MAX_TURN_COST_USD` | `3` | Hard stop for one turn's provider cost |

## Endpoints

Customer (agent routes, same per-request credentials as chat: `companyId`, `userId`, `apiToken`):

- `GET /api/agents/wallet` - customer-safe wallet: `enforced`, `free_allowance_usd`, `purchased_credit_usd`, `spent_usd`,
  `remaining_usd`, `exhausted`, `low_balance`, `model_tiers`. Never the markup.
- `GET /api/agents/wallet/transactions?limit=25&before=<ISO date>` - credit history, newest first.

Ops (`x-admin-api-key: ADMIN_API_KEY`):

- `GET  /api/admin/analytics/companies/:id/wallet` - wallet incl. markup and display name.
- `PUT  /api/admin/analytics/companies/:id/wallet` - set allowance, markup, display name, seats, model tiers.
- `POST /api/admin/analytics/companies/:id/wallet/credits` - grant credits (see below).
- `GET  /api/admin/analytics/companies/:id/wallet/transactions` - history.
- `GET|POST /api/admin/analytics/companies/:id/wallet/reconcile` - wallet spend vs the usage ledger.

## Nova credit plans and pricing

Nova is an app under Worxstream and has **its own credit plans**, separate from the Worxstream app subscription plans. Staff
manage them in the admin dashboard (**Nova plans**): name, description, the credit a company receives, the margin, and
whether the plan is on sale. Defaults on a first boot: Starter $50, Growth $250, Scale $1,000 of credit.

`price = credit x (1 + margin)`, rounded to the cent. The default margin is 20% (`NOVA_PLAN_MARGIN_RATE`). The company
receives the full credit and each request is then charged at Anthropic's real cost, so **the margin is earned once, in the
plan price**. Keep `NOVA_MARKUP_RATE` at 0 (the per-request markup): otherwise the margin is charged twice. The dashboard
warns when it is not 0.

## Who manages what

| Who | Can do |
|---|---|
| A company (Settings > Apps > Nova) | **Usage:** usage by day, employee and model. **Billing:** their Nova credit, the Nova plans they can buy with Stripe, and their invoices (plan, amount paid, credit, reference). |
| Worxstream staff (admin dashboard, `ADMIN_API_KEY`) | Create, price and hide Nova plans; grant credit by plan or by amount (with an invoice reference); set the AI allowance, seats, markup and the models for a company; reconcile the balance against the usage ledger. |

Customer endpoints (agent routes; same per-request credentials as chat): `GET /api/agents/wallet`,
`GET /api/agents/wallet/transactions`, `GET /api/agents/plans`, `GET /api/agents/usage?from=&to=`,
`GET /api/agents/usage/users/:userId`. Usage shows only what the company is charged (never Anthropic's cost); plans never show
the margin.

Staff endpoints (`x-admin-api-key`): `GET|POST /api/admin/analytics/nova-plans`, `GET|PUT /api/admin/analytics/nova-plans/:planId`.

**Buying** goes through Laravel and Stripe: Laravel prices the payment from the agent's plan, and after Stripe confirms it
calls `POST /api/admin/analytics/companies/:id/wallet/credits` with `{ plan_id, payment_ref }`. See `docs/BACKEND_HANDOVER.md`.

**Granting credit** (admin dashboard, or the same endpoint): pick a plan (credit and price come from it) or enter an amount,
plus a reason and the **invoice or payment reference**. A reference is credited once: submitting the same reference again
changes nothing, so a double click or a retried call never credits twice.

**Models:** the company's models (daily and medium tier) are set by Worxstream and apply to every employee, over any earlier
personal choice.
