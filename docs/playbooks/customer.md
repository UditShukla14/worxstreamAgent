# Customer playbook

## IDs
- **Master customer id** is 300-series (`customer_id` / `customerId`).
- List row `id` may be 200-series — do **not** pass to `get_customer_details`.

## Typical flow
1. `list_customers` with filter.search (name/email)
2. Match row → `resolveCustomerRecordId` → use **300-series** for all follow-ups
3. `get_customer_details` with master id
4. Related docs: `list_estimates`, `list_invoices` with customer_id filter

## Recovery
- Ambiguous search (multiple Acme): ask user to pick #1/#2 or match by email before detail calls.
