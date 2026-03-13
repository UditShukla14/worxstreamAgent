# Worxstream Webhooks Required for Governance Control Flow

This document describes the **webhook events and payload structures** that the **Worxstream backend** should expose and send to the Worxstream AI Agent (control layer). The agent uses these events to trigger governance pipelines (e.g. Profit Policy, Inventory Check, Customer Check) without user interaction.

---

## 1. Overview

| Purpose | The Worxstream backend fires webhooks when key entities change. The AI control layer receives them and runs the appropriate agent pipeline (e.g. on `estimate.created` → run Profit Policy Agent, Inventory Check Agent, Customer Check Agent). |
| Endpoint | Worxstream backend **sends** HTTP POST to the agent’s webhook URL (e.g. `https://<agent-host>/api/webhooks/worxstream`). |
| Direction | **Worxstream → Worxstream AI Agent** (outbound from Worxstream backend). |

---

## 2. Delivery Contract

- **Method:** `POST`
- **Content-Type:** `application/json`
- **Authentication:** Recommended: shared secret in header (e.g. `X-Worxstream-Webhook-Secret`) or HMAC signature over body so the agent can verify the request is from Worxstream.
- **Idempotency:** Optional but recommended: `X-Idempotency-Key` (or `idempotency_key` in body) so the agent can deduplicate retries.
- **Retries:** Worxstream may retry on 5xx or timeout; agent should respond `200` quickly and process asynchronously (e.g. queue) to avoid timeouts.

---

## 3. Common Envelope (all events)

Every webhook payload should use a **common envelope** so the agent can route by `event_type` and read `payload` consistently.

```json
{
  "event_type": "estimate.created",
  "event_id": "evt_550e8400-e29b-41d4-a716-446655440000",
  "timestamp": "2025-02-27T10:15:00.000Z",
  "company_id": 1,
  "user_id": 10000000010,
  "payload": { }
}
```

| Field        | Type   | Required | Description |
|-------------|--------|----------|-------------|
| `event_type`| string | Yes      | Event identifier (e.g. `estimate.created`, `invoice.paid`). |
| `event_id`  | string | Yes      | Unique id for this delivery (for idempotency / dedup). |
| `timestamp` | string | Yes      | ISO 8601 UTC when the event occurred. |
| `company_id`| number | Yes      | Worxstream company context. |
| `user_id`   | number | Optional | User who triggered the action, if applicable. |
| `payload`   | object | Yes      | Event-specific data (see below). |

---

## 4. Event Types and Payload Structures

Payloads below include **minimum fields** the control agents need to fetch details via existing MCP tools (e.g. `get_estimate_details`, `get_customer_details`, `list_invoices`). Extra fields (e.g. snapshot) are optional.

---

### 4.1 Estimate events

**Event type:** `estimate.created`

Fired when a new estimate/quote is created. Used to run: **Profit Policy Agent**, **Inventory Check Agent**, **Customer Check Agent**.

```json
{
  "event_type": "estimate.created",
  "event_id": "evt_550e8400-e29b-41d4-a716-446655440001",
  "timestamp": "2025-02-27T10:15:00.000Z",
  "company_id": 1,
  "user_id": 10000000010,
  "payload": {
    "estimate_id": 1001,
    "customer_id": 2001,
    "contact_id": 20000000010,
    "grand_total": 8572.20,
    "status": "draft",
    "product_ids": [101, 102, 103]
  }
}
```

| Payload field    | Type    | Description |
|------------------|---------|-------------|
| `estimate_id`    | number  | Required. Used for `get_estimate_details(estimate_id)`. |
| `customer_id`    | number  | Required. For Customer Check Agent. |
| `contact_id`     | number  | Optional. CRM contact if linked. |
| `grand_total`    | number  | Optional. For quick checks without a second call. |
| `status`         | string  | Optional. e.g. draft, sent, approved. |
| `product_ids`    | number[]| Optional. Line item product IDs for Inventory / Profit checks. |

---

**Event type:** `estimate.updated`

Fired when an estimate is updated (e.g. status change, line items changed).

```json
{
  "event_type": "estimate.updated",
  "event_id": "evt_550e8400-e29b-41d4-a716-446655440002",
  "timestamp": "2025-02-27T11:00:00.000Z",
  "company_id": 1,
  "user_id": 10000000010,
  "payload": {
    "estimate_id": 1001,
    "customer_id": 2001,
    "previous_status": "draft",
    "status": "sent",
    "product_ids": [101, 102, 103]
  }
}
```

---

### 4.2 Invoice events

**Event type:** `invoice.created`

Fired when a new invoice is created. Used for: **Customer Check Agent**, optionally **Profit Policy Agent**.

```json
{
  "event_type": "invoice.created",
  "event_id": "evt_550e8400-e29b-41d4-a716-446655440003",
  "timestamp": "2025-02-27T12:00:00.000Z",
  "company_id": 1,
  "user_id": 10000000010,
  "payload": {
    "invoice_id": 2001,
    "customer_id": 2001,
    "contact_id": 20000000010,
    "grand_total": 10000.00,
    "status": "draft",
    "estimate_id": 1001
  }
}
```

| Payload field    | Type   | Description |
|------------------|--------|-------------|
| `invoice_id`     | number | Required. For `get_invoice_details(invoice_id)`. |
| `customer_id`    | number | Required. For Customer Check (credit, overdue). |
| `contact_id`     | number | Optional. |
| `grand_total`    | number | Optional. |
| `status`         | string | Optional. |
| `estimate_id`    | number | Optional. Source estimate if converted from estimate. |

---

**Event type:** `invoice.updated`

Fired when an invoice is updated (e.g. status, amounts).

```json
{
  "event_type": "invoice.updated",
  "event_id": "evt_550e8400-e29b-41d4-a716-446655440004",
  "timestamp": "2025-02-27T14:00:00.000Z",
  "company_id": 1,
  "user_id": 10000000010,
  "payload": {
    "invoice_id": 2001,
    "customer_id": 2001,
    "previous_status": "sent",
    "status": "paid"
  }
}
```

---

**Event type:** `invoice.paid`

Fired when an invoice is marked paid. Used for: **Customer Check Agent** (e.g. update credit / payment history).

```json
{
  "event_type": "invoice.paid",
  "event_id": "evt_550e8400-e29b-41d4-a716-446655440005",
  "timestamp": "2025-02-27T15:30:00.000Z",
  "company_id": 1,
  "payload": {
    "invoice_id": 2001,
    "customer_id": 2001,
    "amount_paid": 10000.00,
    "paid_at": "2025-02-27T15:30:00.000Z"
  }
}
```

---

### 4.3 Customer events

**Event type:** `customer.created`

Fired when a new customer (business entity) is created. Used for: **Customer Check Agent** (initial checks if any).

```json
{
  "event_type": "customer.created",
  "event_id": "evt_550e8400-e29b-41d4-a716-446655440006",
  "timestamp": "2025-02-27T09:00:00.000Z",
  "company_id": 1,
  "user_id": 10000000010,
  "payload": {
    "customer_id": 2001,
    "name": "Acme Corp",
    "email": "billing@acme.example.com"
  }
}
```

---

**Event type:** `customer.updated`

Fired when customer details are updated (e.g. credit limit, payment terms).

```json
{
  "event_type": "customer.updated",
  "event_id": "evt_550e8400-e29b-41d4-a716-446655440007",
  "timestamp": "2025-02-27T16:00:00.000Z",
  "company_id": 1,
  "user_id": 10000000010,
  "payload": {
    "customer_id": 2001,
    "updated_fields": ["credit_limit", "payment_terms"]
  }
}
```

---

### 4.4 Product / inventory events (optional)

**Event type:** `product.updated`

Fired when product/service is updated (e.g. cost, price, stock). Used for: **Inventory Check Agent**, **Profit Policy Agent**.

```json
{
  "event_type": "product.updated",
  "event_id": "evt_550e8400-e29b-41d4-a716-446655440008",
  "timestamp": "2025-02-27T11:30:00.000Z",
  "company_id": 1,
  "user_id": 10000000010,
  "payload": {
    "product_id": 101,
    "updated_fields": ["cost_price", "sales_price", "quantity_on_hand"]
  }
}
```

---

### 4.5 Job events (optional)

**Event type:** `job.created`

Fired when a new job is created. Can trigger job-related governance (e.g. required fields, customer/contact checks).

```json
{
  "event_type": "job.created",
  "event_id": "evt_550e8400-e29b-41d4-a716-446655440009",
  "timestamp": "2025-02-27T08:00:00.000Z",
  "company_id": 1,
  "user_id": 10000000010,
  "payload": {
    "job_id": 501,
    "contact_id": 20000000010,
    "customer_id": 2001,
    "job_name": "HVAC Install - Site A"
  }
}
```

---

### 4.6 Purchase order / credit memo / bill (optional)

Same envelope; only `event_type` and `payload` differ.

**Example: `purchase_order.created`**

```json
{
  "event_type": "purchase_order.created",
  "event_id": "evt_550e8400-e29b-41d4-a716-44665544000a",
  "timestamp": "2025-02-27T13:00:00.000Z",
  "company_id": 1,
  "user_id": 10000000010,
  "payload": {
    "purchase_order_id": 301,
    "vendor_id": 401,
    "grand_total": 5000.00,
    "product_ids": [101, 102]
  }
}
```

**Example: `credit_memo.created`**

```json
{
  "event_type": "credit_memo.created",
  "event_id": "evt_550e8400-e29b-41d4-a716-44665544000b",
  "timestamp": "2025-02-27T14:30:00.000Z",
  "company_id": 1,
  "user_id": 10000000010,
  "payload": {
    "credit_memo_id": 601,
    "customer_id": 2001,
    "invoice_id": 2001,
    "grand_total": -500.00
  }
}
```

---

## 5. Event Type Summary (for pipeline mapping)

| Event type              | Typical control pipeline use |
|-------------------------|-------------------------------|
| `estimate.created`      | Profit Policy → Inventory Check → Customer Check |
| `estimate.updated`      | Re-run checks if needed (e.g. status → sent) |
| `invoice.created`       | Customer Check → (optional) Profit Policy |
| `invoice.updated`       | Customer Check (e.g. status change) |
| `invoice.paid`          | Customer Check (payment history / credit) |
| `customer.created`      | Customer Check (initial) |
| `customer.updated`      | Customer Check (e.g. credit limit change) |
| `product.updated`       | Inventory Check, Profit Policy |
| `job.created`           | Job-related governance (optional) |
| `purchase_order.created`| Vendor / PO policy (optional) |
| `credit_memo.created`   | Customer Check (refund / balance) (optional) |

The agent maps each `event_type` to a list of agents and runs them in order, passing `payload` (and `company_id`, `user_id`) as context so agents can call `get_estimate_details(payload.estimate_id)` etc. via existing MCP tools.

---

## 6. Security and Implementation Notes

- **Verification:** Agent should verify `X-Worxstream-Webhook-Secret` or HMAC (e.g. `X-Worxstream-Signature: sha256=<hex>`) so only Worxstream can trigger control flows.
- **Idempotency:** Store `event_id` (or `idempotency_key`); ignore duplicate deliveries.
- **Async:** Respond `200 OK` quickly; enqueue event for pipeline execution in a worker so Worxstream retries don’t hit long-running agent calls.
- **Scoping:** Agent uses `company_id` (and optionally `user_id`) for API calls and audit.

---

*This spec is for the Worxstream backend team to implement outbound webhooks and for the Worxstream AI Agent to consume them in the governance control flow.*
