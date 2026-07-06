# Invoice playbook

## Before `create_invoice`
- **customer_id** (300-series) required.
- Line items and tax must be valid for the company.
- Prefer `get_invoice_details` / `list_invoices` before updates.

## Typical flow
1. Confirm customer via `list_customers` / `get_customer_details`
2. `create_invoice` with customer_id, line_items, dates
3. Payment tracking via list filters (Open/Paid) — use status filters, not free-text in search

## Recovery
- Tax errors: `list_taxes`, then retry create.
- Duplicate or wrong id: use `list_invoices` with filters before create.
