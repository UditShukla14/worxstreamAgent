/**
 * Scribe — schedule manager for Control Tower + Nova.
 * Owns cron/tick, frozen flow recipes, criteria reports, and Mongo run logs.
 * Nova clarifies with the user, then hands schedule CRUD to Scribe tools.
 */

export const SCRIBE_AGENT_KEY = 'scribe';

export const SCRIBE_AGENT_DEFINITION = {
  name: 'scribe_agent',
  description:
    'Schedule manager: creates and runs recurring frozen messages (email or SMS) '
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

You own recurring work. Nova (chat) clarifies with the user once; you store a frozen message and re-send it on cadence — you do NOT re-ask Nova, re-query reports, or invent new content at fire time.

SCHEDULE KINDS:
1) flow_recipe (from Nova) — scheduled_message:
   - Frozen channel (email | sms), recipients, subject_template / message_template
   - Send on cadence via send_email or Telnyx SMS
2) criteria_report (Control Tower) — missing_fields / negative_profit scans over estimates/invoices.

When translating a Nova request into a schedule, collect before create:
- name
- channel (email or sms)
- recipients (emails or E.164 phones)
- message_template (+ subject_template for email); {{date}} / {{name}} ok
- cadence: interval (days + UTC hour) or monthly (day_of_month + local hour + timezone)

Echo the frozen flow back, then use scribe_create_schedule. After create, Scribe owns pause/resume/delete/run history.

Run logs live in Mongo (like chat turns). Use scribe_list_schedule_runs / scribe_get_schedule_run for failures.

Do not invent data. Do not claim Nova will "remember" to run later — that is your job.`,
};
