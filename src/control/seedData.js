/**
 * Default governance policies and rules used to seed a company.
 * Content matches the Control Tower mock catalog so RAG has something to retrieve.
 */

export const SEED_POLICIES = [
  {
    seed_key: 'minimum_margin',
    name: 'Minimum Margin Policy',
    type: 'policy',
    status: 'active',
    content: `# Minimum Margin Policy

## Objective
Ensure all estimates and invoices maintain a minimum gross margin to protect company profitability.

## Rule
All estimates and invoices must have a minimum gross margin of **20%**.

## Calculation
Use the **grossProfitPercentage** field from the WorxStream event payload (pre-tax margin on subtotal — the same value shown in the estimate/invoice UI). Do not recalculate margin from grandTotal, tax, or costs.

Fallback only when grossProfitPercentage is absent: grossProfitTotal ÷ subTotal × 100.

## Enforcement
- Estimates below 20% margin must be flagged for manager review before sending to customer.
- Invoices below 20% margin generated without an approved estimate must be reviewed.
- Exceptions require written approval from the Finance Director.

## Escalation
Margins below 10% are considered critical and must be escalated to the VP of Sales immediately.`,
  },
  {
    seed_key: 'credit_hold',
    name: 'Credit Hold Policy',
    type: 'policy',
    status: 'active',
    content: `# Credit Hold Policy

## Objective
Manage credit risk by placing holds on customers with outstanding overdue invoices.

## Thresholds
- **Warning:** 1–2 overdue invoices or overdue balance > $10,000
- **Hold:** 3+ overdue invoices or overdue balance > $25,000

## Process
When a customer reaches the Hold threshold:
1. Automatically flag all new estimates and invoices for that customer.
2. Notify the Accounts Receivable team.
3. No new work should commence until overdue balances are resolved.

## Resolution
A credit hold is lifted once all overdue invoices are paid or a payment arrangement is formally agreed.`,
  },
  {
    seed_key: 'inventory_reorder',
    name: 'Inventory Reorder Policy',
    type: 'policy',
    status: 'active',
    content: `# Inventory Reorder Policy

## Objective
Maintain adequate stock levels to fulfil customer orders without delays.

## Reorder Points
Each product has a defined reorder point. When stock falls below this threshold, a purchase order must be raised.

## Default Thresholds
- Standard products: reorder at 5 units
- High-demand products: reorder at 10 units
- Seasonal products: reorder schedule defined separately

## Automation
The Inventory Check Agent monitors stock levels on every estimate.created and product.updated event and raises a flag when stock falls below the reorder point.`,
  },
  {
    seed_key: 'inventory_fulfilment',
    name: 'Inventory Fulfilment Policy',
    type: 'policy',
    status: 'active',
    content: `# Inventory Fulfilment Policy

## Objective
Ensure estimates are only approved when sufficient stock exists to fulfil all line items.

## Rule
If any product on an estimate has insufficient stock to cover the required quantity, the estimate must be flagged before it is sent to the customer.

## Actions
- Agent flags the estimate with a stock shortage notice.
- Sales must either update the delivery date, raise a PO, or advise the customer.`,
  },
  {
    seed_key: 'new_customer_onboarding',
    name: 'New Customer Onboarding Policy',
    type: 'policy',
    status: 'draft',
    content: `# New Customer Onboarding Policy

## Objective
Define standard checks performed when a new customer account is created.

## Checks
1. Verify business name and contact details are complete.
2. Confirm credit terms are set (default: Net 30).
3. Log the onboarding event for audit purposes.

## Note
This policy is currently in draft and pending Finance Director approval.`,
  },
];

export const SEED_RULES = [
  {
    seed_key: 'flag_low_margin',
    name: 'Flag Low Margin Estimates',
    event_type: 'estimate.created',
    condition: 'Payload grossProfitPercentage < 20%',
    action: 'Flag estimate for manager review. Create a critical alert.',
    priority: 1,
    active: true,
  },
  {
    seed_key: 'flag_critical_margin',
    name: 'Flag Critically Low Margin Estimates',
    event_type: 'estimate.created',
    condition: 'Payload grossProfitPercentage < 10%',
    action: 'Flag estimate as critical. Alert VP of Sales immediately.',
    priority: 1,
    active: true,
  },
  {
    seed_key: 'credit_hold_overdue',
    name: 'Credit Hold — 3+ Overdue Invoices',
    event_type: 'customer.updated',
    condition: 'Customer has 3 or more overdue invoices',
    action: 'Place customer on credit hold. Alert Accounts Receivable. Flag all new estimates and invoices.',
    priority: 1,
    active: true,
  },
  {
    seed_key: 'credit_warning_invoice',
    name: 'Credit Warning — 2 Overdue Invoices',
    event_type: 'invoice.created',
    condition: 'Customer has 2 overdue invoices at time of invoice creation',
    action: 'Add warning to invoice. Alert AR team.',
    priority: 2,
    active: true,
  },
  {
    seed_key: 'low_stock_reorder',
    name: 'Low Stock Reorder Alert',
    event_type: 'product.updated',
    condition: 'Product stock quantity falls below reorder point',
    action: 'Create a warning alert. Notify purchasing team to raise a PO.',
    priority: 2,
    active: true,
  },
  {
    seed_key: 'insufficient_stock_estimate',
    name: 'Insufficient Stock for Estimate',
    event_type: 'estimate.created',
    condition: 'Any line item product quantity on estimate exceeds current stock',
    action: 'Flag estimate. Notify sales to update delivery date or raise PO.',
    priority: 2,
    active: true,
  },
];
