# Workflow playbook

## When to use
- "Convert estimate to invoice", approvals, linked workflow nodes.
- Cross-object operations that span estimate → invoice → payment.

## Typical flow
1. Load source document (`get_estimate_details` / `get_invoice_details`)
2. `list_workflows` or `get_workflows_by_object` for the entity type
3. `link_workflow_nodes` / `update_workflow` per API rules

## Recovery
- Missing entity id: return to customer/estimate agent context and re-fetch ids from Redis context.
