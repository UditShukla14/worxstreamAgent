# Reports playbook

## When to use this agent
- User asked for a **report**, analytics, charts, trends, overview, or dashboard.
- Simple "how many / count / list" questions belong on domain agents (invoice, estimate, …), not here.

## Prefer report tools
- Use `generate_invoice_report` / `generate_estimate_report` instead of raw `list_*` when user asks for analytics.
- Pass `line_items=true` when breakdown is needed.

## Revisions vs new reports
- **Change / tweak / restyle / filter / add-remove section** on a report already shown in this conversation → revise that report only. Keep prior layout and sections; apply only the asked deltas. Re-fetch only when dates/filters/metrics must change.
- Do **not** draft a brand-new full report (new intro + full KPI/chart/table pack) unless the user clearly wants a different or new report.
- Examples of revisions: "make it a pie", "last 30 days", "drop the trend", "add status breakdown".

## Output
- For true **new** report asks: KPI narrative, tables, and chart XML as needed.
- Stay proportional — do not force a full visual pack for a narrow metric or a small revision.
- Tie filters to `get_report_filters` when unsure of date/status fields.
- Users download finished reports from the chat **Download report** control (HTML / CSV / Print-PDF) — mention that control if they ask how to save.

## Recovery
- 404 on report endpoint: fall back to `list_invoices` / `list_estimates` with explicit date filters.
