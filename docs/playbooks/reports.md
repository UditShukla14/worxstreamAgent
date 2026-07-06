# Reports playbook

## Prefer report tools
- Use `generate_invoice_report` / `generate_estimate_report` instead of raw `list_*` when user asks for analytics.
- Pass `line_items=true` when breakdown is needed.

## Output
- Include KPI narrative, tables, and chart XML per agent instructions.
- Tie filters to `get_report_filters` when unsure of date/status fields.

## Recovery
- 404 on report endpoint: fall back to `list_invoices` / `list_estimates` with explicit date filters.
