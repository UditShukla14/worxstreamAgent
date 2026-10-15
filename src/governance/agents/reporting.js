/**
 * Scribe — schedule manager for Control Tower + Nova.
 * Owns cron/tick, frozen flow recipes, criteria reports, and Mongo run logs.
 * Nova clarifies with the user, then hands schedule CRUD to Scribe tools.
 */

export const SCRIBE_AGENT_KEY = 'scribe';

export const SCRIBE_AGENT_DEFINITION = {
  name: 'scribe_agent',
  description:
    'Schedule manager: creates and runs recurring frozen processes (steps → deliver) '
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

You own recurring work. Nova clarifies once; you store a frozen PROCESS and re-execute those steps on cadence — you do NOT re-ask Nova or invent new steps at fire time.

SCHEDULE KINDS:
1) flow_recipe (from Nova) — scheduled_message:
   - Frozen steps (invoice_report / tool / compose / deliver) + channel + recipients
   - Tick re-runs the process, then sends email or SMS
2) criteria_report (Control Tower) — missing_fields / negative_profit scans.

When translating a Nova request into a schedule, collect:
- name
- channel (email or sms) + recipients
- process: steps OR periods+metrics (for live invoice totals)
- subject_template (email)
- cadence: interval or monthly

Echo the frozen process, then scribe_create_schedule.

Run logs live in Mongo. Use scribe_list_schedule_runs / scribe_get_schedule_run for failures.

Do not invent data. Do not claim Nova will "remember" to run later — that is your job.`,
};
