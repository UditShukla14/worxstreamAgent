import { describe, it, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.WORXSTREAM_BASE_URL ||= 'http://localhost';
process.env.APP_SERVICE_KEY = 'svc-secret';

const { appForAgentKey, isAppKey } = await import('../../src/apps/registry.js');
const { walletView, remainingMicros, defaultMarkup } = await import('../../src/apps/appWallet.js');
const { checkAppAccess, assertApp, AppInputError } = await import('../../src/apps/subscriptions.js');
const { recordRavenUsage } = await import('../../src/apps/ravenUsage.js');
const { requireServiceAuth } = await import('../../src/middleware/requireServiceAuth.js');
const Subscription = (await import('../../src/apps/models/CompanyAppSubscription.js')).default;
const AppWallet = (await import('../../src/apps/models/CompanyAppWallet.js')).default;

const lean = (value) => ({ lean: async () => value });
afterEach(() => mock.restoreAll());

describe('app registry', () => {
  it('maps the raven agent to Raven and everything else to Nova', () => {
    assert.equal(appForAgentKey('raven'), 'raven');
    for (const key of ['nova', 'estimate', 'router', 'formatter', '', undefined]) assert.equal(appForAgentKey(key), 'nova');
  });
  it('knows its apps', () => {
    assert.ok(isAppKey('nova') && isAppKey('raven'));
    assert.ok(!isAppKey('mail'));
    assert.throws(() => assertApp('mail'), AppInputError);
  });
});

describe('app wallet view', () => {
  const doc = (spent) => ({ company_id: 'c1', limits_enabled: true, free_allowance_micros: 5_000_000, purchased_credit_micros: 15_000_000, spent_micros: spent, markup_rate: 0.3 });
  it('remaining = allowance + purchased - spent', () => assert.equal(remainingMicros(doc(8_000_000)), 12_000_000));
  it('reports remaining dollars and the effective markup', () => {
    const v = walletView(doc(8_000_000), 'raven');
    assert.equal(v.remaining_usd, 12);
    assert.equal(v.effective_markup_rate, 0.3);
    assert.equal(v.exhausted, false);
  });
  it('is exhausted only when enforced and (almost) empty', () => {
    assert.equal(walletView(doc(20_000_000), 'raven').exhausted, true);
    assert.equal(walletView({ ...doc(20_000_000), limits_enabled: false }, 'raven').exhausted, false);
  });
  it('no wallet = nothing enforced', () => {
    const v = walletView(null, 'raven');
    assert.deepEqual([v.exists, v.enforced, v.remaining_usd, v.exhausted], [false, false, null, false]);
  });
  it('default markup is bounded', () => assert.ok(defaultMarkup('raven') >= 0 && defaultMarkup('raven') <= 5));
});

describe('access check', () => {
  const sub = (status) => mock.method(Subscription, 'findOne', () => lean(status ? { status } : null));
  const wallet = (...docs) => {
    const queue = [...docs];
    return mock.method(AppWallet, 'findOne', () => lean(queue.length > 1 ? queue.shift() : queue[0]));
  };
  const enforced = (free, purchased, spent) => ({ company_id: 'c1', limits_enabled: true, free_allowance_micros: free, purchased_credit_micros: purchased, spent_micros: spent });
  let provisioned;
  const deps = () => ({ provisionWallet: async () => { provisioned += 1; return true; } });
  const withDefault = (value, fn) => async () => {
    const before = process.env.RAVEN_DEFAULT_CREDIT_USD;
    if (value === undefined) delete process.env.RAVEN_DEFAULT_CREDIT_USD; else process.env.RAVEN_DEFAULT_CREDIT_USD = value;
    provisioned = 0;
    try { await fn(); } finally { if (before === undefined) delete process.env.RAVEN_DEFAULT_CREDIT_USD; else process.env.RAVEN_DEFAULT_CREDIT_USD = before; }
  };

  it('a company that has never had Raven gets nothing free: it must add credit, and its mail is not affected', withDefault(undefined, async () => {
    sub(null);
    const r = await checkAppAccess('c1', 'raven', deps());
    assert.deepEqual([r.allowed, r.reason, provisioned], [false, 'not_subscribed', 0]);
    assert.match(r.message, /Add credits to start using Raven/);
  }));
  it('an existing company on an unlimited wallet is capped at the default credit', withDefault(undefined, async () => {
    sub('active');
    wallet({ company_id: 'c1', limits_enabled: false, free_allowance_micros: 0, purchased_credit_micros: 0, spent_micros: 0 }, enforced(5_000_000, 0, 0));
    const r = await checkAppAccess('c1', 'raven', deps());
    assert.deepEqual([r.allowed, r.remaining_usd, provisioned], [true, 5, 1]);
  }));
  it('an existing active subscription with no wallet at all is capped too', withDefault(undefined, async () => {
    sub('active');
    wallet(null, enforced(5_000_000, 0, 0));
    assert.equal((await checkAppAccess('c1', 'raven', deps())).remaining_usd, 5);
    assert.equal(provisioned, 1);
  }));
  it('an enforced wallet is not touched again', withDefault(undefined, async () => {
    sub('active');
    wallet(enforced(5_000_000, 0, 1_000_000));
    const r = await checkAppAccess('c1', 'raven', deps());
    assert.equal(r.remaining_usd, 4);
    assert.equal(provisioned, 0);
  }));
  it('paused or switched-off stays that way', withDefault(undefined, async () => {
    sub('paused');
    assert.equal((await checkAppAccess('c1', 'raven', deps())).reason, 'paused');
    mock.restoreAll();
    sub('off');
    assert.equal((await checkAppAccess('c1', 'raven', deps())).reason, 'off');
    assert.equal(provisioned, 0);
  }));
  it('credit used up blocks Raven', withDefault(undefined, async () => {
    sub('active');
    wallet(enforced(5_000_000, 0, 5_000_000));
    const r = await checkAppAccess('c1', 'raven', deps());
    assert.deepEqual([r.allowed, r.reason], [false, 'exhausted']);
  }));
  it('credit left is reported', withDefault(undefined, async () => {
    sub('active');
    wallet(enforced(0, 9_000_000, 4_000_000));
    const r = await checkAppAccess('c1', 'raven', deps());
    assert.equal(r.allowed, true);
    assert.equal(r.remaining_usd, 5);
  }));
  it('with the default credit off nothing is capped', withDefault('0', async () => {
    sub('active');
    wallet({ company_id: 'c1', limits_enabled: false, free_allowance_micros: 0, purchased_credit_micros: 0, spent_micros: 0 });
    const r = await checkAppAccess('c1', 'raven', deps());
    assert.equal(provisioned, 0);
    assert.equal(r.allowed, true);
  }));
  it('Nova without a subscription row keeps working (existing customers)', withDefault(undefined, async () => {
    sub(null);
    assert.equal((await checkAppAccess('c1', 'nova', deps())).allowed, true);
  }));
  it('Nova paused is blocked', withDefault(undefined, async () => {
    sub('paused');
    assert.equal((await checkAppAccess('c1', 'nova', deps())).allowed, false);
  }));
});

describe('capping existing Raven companies', async () => {
  const { capExistingRavenCompanies } = await import('../../src/apps/subscriptions.js');
  const setup = (rows) => {
    mock.method(Subscription, 'find', () => lean(rows));
    const created = [];
    mock.method(Subscription, 'updateOne', async (filter) => { created.push(filter.company_id); return {}; });
    const provisioned = [];
    return { created, provisioned, provisionWallet: async (company) => { provisioned.push(company); return true; } };
  };

  it('caps active subscriptions and companies that already used Raven; leaves paused, off and never-used ones alone', async () => {
    const t = setup([{ company_id: 'active1', status: 'active' }, { company_id: 'paused1', status: 'paused' }, { company_id: 'off1', status: 'off' }]);
    const out = await capExistingRavenCompanies({ usageCompanyIds: async () => ['used-before', 'active1', 'paused1', '_unattributed'], provisionWallet: t.provisionWallet });
    assert.deepEqual(t.created, ['used-before']); // had Raven usage but no row: added as an existing user
    assert.deepEqual(t.provisioned.sort(), ['active1', 'used-before']);
    assert.deepEqual(out, { capped: 2, subscribed: 1 });
  });
  it('does nothing when the default credit is off', async () => {
    const before = process.env.RAVEN_DEFAULT_CREDIT_USD;
    process.env.RAVEN_DEFAULT_CREDIT_USD = '0';
    const t = setup([{ company_id: 'active1', status: 'active' }]);
    try {
      assert.deepEqual(await capExistingRavenCompanies({ provisionWallet: t.provisionWallet }), { capped: 0, subscribed: 0 });
      assert.equal(t.provisioned.length, 0);
    } finally { if (before === undefined) delete process.env.RAVEN_DEFAULT_CREDIT_USD; else process.env.RAVEN_DEFAULT_CREDIT_USD = before; }
  });
});

describe('Raven usage ingest validation', () => {
  const ok = { company_id: 'c1', user_id: '7', model: 'claude-haiku-4-5', message_id: 'msg_1', usage: { input_tokens: 1000, output_tokens: 100 } };
  for (const field of ['company_id', 'user_id', 'model', 'message_id']) {
    it(`requires ${field}`, async () => {
      await assert.rejects(recordRavenUsage({ ...ok, [field]: '' }), AppInputError);
    });
  }
  it('rejects a report with no tokens', async () => {
    await assert.rejects(recordRavenUsage({ ...ok, usage: { input_tokens: 0, output_tokens: 0 } }), AppInputError);
  });
});

describe('service auth', () => {
  const run = (headers) => {
    const res = { code: 0, status(c) { this.code = c; return this; }, json() { return this; } };
    let called = false;
    requireServiceAuth({ headers }, res, () => { called = true; });
    return { called, code: res.code };
  };
  it('accepts the right key as header or bearer', () => {
    assert.equal(run({ 'x-service-key': 'svc-secret' }).called, true);
    assert.equal(run({ authorization: 'Bearer svc-secret' }).called, true);
  });
  it('rejects a wrong or missing key', () => {
    assert.deepEqual(run({ 'x-service-key': 'nope' }), { called: false, code: 401 });
    assert.deepEqual(run({}), { called: false, code: 401 });
  });
});

describe('admin app scope', async () => {
  const { normalizeApp, agentScope, agentListScope, foldByApp } = await import('../../src/analytics/adminQueries.js');

  it('only nova and raven narrow a query; anything else is the cumulative view', () => {
    assert.equal(normalizeApp('raven'), 'raven');
    assert.equal(normalizeApp('nova'), 'nova');
    for (const v of ['', undefined, 'all', 'mail', 'RAVEN']) assert.equal(normalizeApp(v), '');
  });
  it('maps an app to the agent rows of the rollup', () => {
    assert.equal(agentScope(''), '');
    assert.equal(agentScope('raven'), 'raven');
    assert.deepEqual(agentScope('nova'), { $nin: ['', 'raven'] });
    assert.deepEqual(agentListScope(''), { $ne: '' });
    assert.equal(agentListScope('raven'), 'raven');
  });
  it('folds agent rows into Nova and Raven that add up to the total', () => {
    const row = (agent, billable, calls) => ({ _id: agent, billable_usd: billable, cost_usd: billable / 1.2, call_count: calls, total_tokens: calls * 100, input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 });
    const [nova, raven] = foldByApp([row('estimate', 6, 10), row('router', 1.2, 4), row('raven', 2.4, 30)]);
    assert.deepEqual([nova.app, raven.app], ['nova', 'raven']);
    assert.equal(nova.billable_usd, 7.2);
    assert.equal(nova.call_count, 14);
    assert.equal(raven.billable_usd, 2.4);
    assert.equal(raven.call_count, 30);
    assert.equal(Number((nova.billable_usd + raven.billable_usd).toFixed(6)), 9.6);
  });
  it('an app with no usage is still listed, at zero', () => {
    const [nova, raven] = foldByApp([]);
    assert.deepEqual([nova.billable_usd, raven.billable_usd, raven.name], [0, 0, 'Raven']);
  });
});

describe('Raven pricing and purchases', async () => {
  const { DEFAULT_APP_PRICING, quoteForPrice, toCustomerQuote, bonusTiers } = await import('../../src/apps/pricing.js');
  const { toAdminPlan, toCustomerPlan } = await import('../../src/apps/plans.js');
  const { customerWalletView, defaultCreditUsd } = await import('../../src/apps/appWallet.js');
  const { isAppCreditsKind, appCreditsKind } = await import('../../src/billing/stripe/appCheckout.js');
  const settings = DEFAULT_APP_PRICING.raven;
  const markup = 0.2;

  it('a small purchase gets no bonus, a larger one earns it as extra credit', () => {
    assert.equal(quoteForPrice(20, settings, markup).credit_usd, 20);
    const big = quoteForPrice(500, settings, markup);
    assert.ok(big.credit_usd > 500 && big.bonus_pct > 0);
    assert.equal(big.margin_rate, 0.15);
  });
  it('the customer view of a quote hides the margin and Anthropic value', () => {
    const q = toCustomerQuote(quoteForPrice(100, settings, markup));
    assert.deepEqual(Object.keys(q).sort(), ['bonus_pct', 'credit_usd', 'estimated_requests', 'price_usd']);
  });
  it('estimated requests are mails analysed (Raven: about a third of a cent each)', () => {
    assert.equal(quoteForPrice(20, settings, markup).estimated_requests, 5000);
  });
  it('bonus steps start where the tiers do', () => {
    assert.deepEqual(bonusTiers(settings, markup).map((t) => t.min_usd), [100, 500]);
  });
  it('plan views: staff see the margin, customers do not', () => {
    const doc = { app: 'raven', plan_id: 'starter', name: 'Raven Starter', price_usd: 20, features: ['a'], active: true, sort: 1 };
    const ctx = { settings, markup };
    assert.ok('margin_usd' in toAdminPlan(doc, ctx) && 'anthropic_value_usd' in toAdminPlan(doc, ctx));
    const c = toCustomerPlan(doc, ctx);
    assert.ok(!('margin_usd' in c) && !('anthropic_value_usd' in c) && !('margin_rate' in c));
    assert.equal(c.credit_usd, 20);
  });
  it('the customer wallet never shows the markup or staff notes', () => {
    const v = customerWalletView({ company_id: 'c1', limits_enabled: true, free_allowance_micros: 0, purchased_credit_micros: 10_000_000, spent_micros: 9_500_000, markup_rate: 0.5, notes: 'staff only' }, 'raven');
    assert.ok(!('markup_rate' in v) && !('notes' in v) && !('effective_markup_rate' in v));
    assert.equal(v.low_balance, true);
    assert.equal(v.remaining_usd, 0.5);
  });
  it('Stripe payment kinds: Raven is told apart from Nova', () => {
    assert.equal(appCreditsKind('raven'), 'raven_credits');
    assert.equal(isAppCreditsKind('raven_credits'), true);
    for (const k of ['nova_credits', 'other', '', undefined, 'mail_credits']) assert.equal(isAppCreditsKind(k), false);
  });
  it('the default credit is $5 unless configured, and never negative', () => {
    const before = process.env.RAVEN_DEFAULT_CREDIT_USD;
    delete process.env.RAVEN_DEFAULT_CREDIT_USD;
    assert.equal(defaultCreditUsd(), 5);
    process.env.RAVEN_DEFAULT_CREDIT_USD = '12.5';
    assert.equal(defaultCreditUsd(), 12.5);
    process.env.RAVEN_DEFAULT_CREDIT_USD = '0';
    assert.equal(defaultCreditUsd(), 0);
    process.env.RAVEN_DEFAULT_CREDIT_USD = '-3';
    assert.equal(defaultCreditUsd(), 0);
    process.env.RAVEN_DEFAULT_CREDIT_USD = 'abc';
    assert.equal(defaultCreditUsd(), 5);
    if (before === undefined) delete process.env.RAVEN_DEFAULT_CREDIT_USD; else process.env.RAVEN_DEFAULT_CREDIT_USD = before;
  });
});

describe('Raven 80% credit alert', async () => {
  const { buildUsageAlert, sendUsageAlert, alertRecipients, USAGE_ALERT_RATIO } = await import('../../src/apps/alerts.js');
  const { checkUsageAlert } = await import('../../src/apps/appWallet.js');
  const wallet = (spent, granted = 5_000_000) => ({ _id: 'w1', company_id: 'c1', limits_enabled: true, free_allowance_micros: granted, purchased_credit_micros: 0, spent_micros: spent });
  const claim = (modifiedCount) => mock.method(AppWallet, 'updateOne', async () => ({ modifiedCount }));
  const fakeSend = () => { const sent = []; return { sent, send: async (mail) => { sent.push(mail); return { success: true }; } }; };

  it('triggers at 80% of the credit given', () => assert.equal(USAGE_ALERT_RATIO, 0.8));
  it('goes to udit@acunitsforless.com unless RAVEN_ALERT_EMAIL says otherwise (commas for several)', () => {
    const before = process.env.RAVEN_ALERT_EMAIL;
    delete process.env.RAVEN_ALERT_EMAIL;
    assert.deepEqual(alertRecipients(), ['udit@acunitsforless.com']);
    process.env.RAVEN_ALERT_EMAIL = 'a@x.com, b@y.com';
    assert.deepEqual(alertRecipients(), ['a@x.com', 'b@y.com']);
    process.env.RAVEN_ALERT_EMAIL = '';
    assert.deepEqual(alertRecipients(), []);
    if (before === undefined) delete process.env.RAVEN_ALERT_EMAIL; else process.env.RAVEN_ALERT_EMAIL = before;
  });
  it('the email names the company, the percentage and the amounts', () => {
    const m = buildUsageAlert({ companyId: '30000000037', grantedUsd: 5, spentUsd: 4.1, remainingUsd: 0.9 });
    assert.match(m.subject, /Raven credit 82% used: company 30000000037/);
    assert.match(m.body, /\$5\.00/);
    assert.match(m.body, /\$4\.10/);
    assert.match(m.body, /\$0\.90/);
  });
  it('a company id cannot inject markup into the email', () => {
    assert.ok(!buildUsageAlert({ companyId: '<script>x</script>', grantedUsd: 5, spentUsd: 4, remainingUsd: 1 }).body.includes('<script>'));
  });
  it('a failed send is reported, never thrown', async () => {
    const r = await sendUsageAlert({ companyId: 'c1', grantedUsd: 5, spentUsd: 4, remainingUsd: 1 }, { send: async () => { throw new Error('boom'); } });
    assert.equal(r.sent, false);
  });
  it('sends once when spend first reaches 80%', async () => {
    claim(1);
    const { sent, send } = fakeSend();
    assert.equal(await checkUsageAlert(wallet(4_000_000), 'raven', { send }), true);
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].mailTo, alertRecipients());
  });
  it('does nothing below 80%', async () => {
    const spy = claim(1);
    const { sent, send } = fakeSend();
    assert.equal(await checkUsageAlert(wallet(3_900_000), 'raven', { send }), false);
    assert.equal(spy.mock.callCount(), 0);
    assert.equal(sent.length, 0);
  });
  it('does not send again for the same credit (the claim is already taken)', async () => {
    claim(0);
    const { sent, send } = fakeSend();
    assert.equal(await checkUsageAlert(wallet(4_500_000), 'raven', { send }), false);
    assert.equal(sent.length, 0);
  });
  it('a wallet that is not enforced or has no credit never alerts', async () => {
    claim(1);
    const { sent, send } = fakeSend();
    assert.equal(await checkUsageAlert({ ...wallet(4_000_000), limits_enabled: false }, 'raven', { send }), false);
    assert.equal(await checkUsageAlert(wallet(1, 0), 'raven', { send }), false);
    assert.equal(sent.length, 0);
  });
});

describe('customer Raven usage view', async () => {
  const { fillDays } = await import('../../src/apps/customerUsage.js');
  it('has one row per day, zeros for quiet days, and never carries the provider cost', () => {
    const rows = [{ _id: '2026-11-02', call_count: 7, total_tokens: 12000, billable_usd: 0.0245, cost_usd: 0.02 }];
    const days = fillDays(rows, { from: '2026-11-01', to: '2026-11-03' });
    assert.deepEqual(days.map((d) => d.date), ['2026-11-01', '2026-11-02', '2026-11-03']);
    assert.deepEqual(days.map((d) => d.calls), [0, 7, 0]);
    assert.equal(days[1].charged_usd, 0.0245);
    assert.ok(days.every((d) => !('cost_usd' in d) && !('billable_usd' in d)));
  });
});

describe('Raven usage by employee', async () => {
  const { summarizeUsers } = await import('../../src/apps/customerUsage.js');
  it('lists each employee, biggest spender first, without the provider cost', () => {
    const out = summarizeUsers([
      { _id: '7', call_count: 3, total_tokens: 6000, billable_usd: 0.01, cost_usd: 0.008, active_days: 2, last_active: '2026-11-10' },
      { _id: '9', call_count: 40, total_tokens: 90000, billable_usd: 0.14, active_days: 9, last_active: '2026-11-17' },
    ]);
    assert.deepEqual(out.map((u) => u.user_id), ['9', '7']);
    assert.equal(out[0].calls, 40);
    assert.ok(out.every((u) => !('cost_usd' in u) && !('billable_usd' in u)));
  });
});
