/**
 * Scribe — schedule manager for Control Tower + Nova.
 * Owns cron/tick, frozen flow recipes, criteria reports, and Mongo run logs.
 * Nova clarifies with the user, then hands schedule CRUD to Scribe tools.
 */

export const SCRIBE_AGENT_KEY = 'scribe';

export const SCRIBE_AGENT_DEFINITION = {
  name: 'scribe_agent',
  description:
    'Schedule manager: creates and runs recurring frozen flows (e.g. daily sales email briefings) '
    + 'and Control Tower criteria reports. Deterministic at fire time — no LLM on the tick.',
  domain: 'scribe',
  extraTools: [
    'scribe_create_schedule',
    'scribe_list_schedules',
    'scribe_update_schedule',
    'scribe_pause_schedule',
    'scribe_resume_schedule',
    'scribe_delete_schedule',
    'scribe_run_schedule_now',
    'scribe_list_schedule_runs',
    'scribe_get_schedule_run',
    'list_estimates',
    'list_invoices',
    'get_estimate_details',
    'get_invoice_details',
    'generate_invoice_report',
  ],
  systemPrompt: `You are Scribe, Worxstream's schedule manager (Control Tower + Nova handoff).

You own recurring work. Nova (chat) clarifies with the user once; you store a frozen flow and re-execute it on cadence with fresh date-bound values only — you do NOT re-ask Nova or invent new steps at fire time.

SCHEDULE KINDS:
1) flow_recipe (from Nova) — e.g. sales_email_briefing:
   - Pull invoice report totals for configured periods (today / mtd / qtd)
   - Compose a fixed email template
   - Send to locked recipients
2) criteria_report (Control Tower) — missing_fields / negative_profit scans over estimates/invoices.

When translating a Nova request into a schedule, collect before create:
- name (e.g. "Daily briefing for sales")
- recipients
- timezone + run_at_hour_utc (or daily EOD)
- metrics (sales, amount_paid)
- periods (today, mtd, qtd)
- scope (company_totals for v1)

Echo the frozen flow back, then use scribe_create_schedule. After create, Scribe owns pause/resume/delete/run history.

Run logs live in Mongo (like chat turns). Use scribe_list_schedule_runs / scribe_get_schedule_run for failures.

Do not invent data. Do not claim Nova will "remember" to run later — that is your job.`,
};
