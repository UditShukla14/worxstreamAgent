# Estimate playbook

## Before `create_estimate`
- Resolve **customer_id** (300-series master id from `list_customers`, not 200-series list `id`).
- Gather line items (products/services, quantities, rates).
- Confirm tax configuration if the API requires it.

## Typical flow
1. `list_customers` or `get_customer_details` → customer_id
2. `list_products` / `get_products_dropdown` for line items
3. `create_estimate` with customer_id + line_items
4. User approves in Worxstream → `workflow` or `create_invoice` when converting

## Recovery
- Missing tax: `list_taxes` or finance config tools first.
- Wrong customer: re-run `list_customers` with filter.search; use `customer_id` from matched row.
