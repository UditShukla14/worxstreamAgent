// ─────────────────────────────────────────────────────────────
// Control Tower — All Mock Data & TypeScript Interfaces
// Replace fetch calls here when connecting to real APIs.
// ─────────────────────────────────────────────────────────────

// ── Types ─────────────────────────────────────────────────────

export type EventType =
  | 'estimate.created'
  | 'estimate.updated'
  | 'invoice.created'
  | 'invoice.updated'
  | 'invoice.paid'
  | 'customer.created'
  | 'customer.updated'
  | 'product.updated'
  | 'job.created'

export type RunStatus = 'pass' | 'flagged' | 'error'
export type AgentVerdict = 'pass' | 'flag' | 'error'
export type AlertSeverity = 'critical' | 'warning' | 'info'
export type AlertStatus = 'open' | 'resolved'
export type PolicyType = 'policy' | 'rule'
export type PolicyStatus = 'active' | 'draft'
export type MasterAgentKey = 'profitPolicy' | 'inventoryCheck' | 'customerCheck'

export interface ToolCall {
  name: string
  input: Record<string, string | number>
  success: boolean
  durationMs: number
}

export interface AgentStep {
  agentKey: MasterAgentKey
  agentName: string
  verdict: AgentVerdict
  responseExcerpt: string
  toolsUsed: ToolCall[]
  durationMs: number
  tokens: number
}

export interface PipelineRun {
  runId: string
  eventId: string
  eventType: EventType
  entityLabel: string
  companyId: number
  pipeline: MasterAgentKey[]
  steps: AgentStep[]
  status: RunStatus
  totalDurationMs: number
  totalTokens: number
  timestamp: string
}

export interface Alert {
  alertId: string
  severity: AlertSeverity
  message: string
  detail: string
  triggeredBy: string
  relatedEntity: string
  eventType: EventType
  policyViolated: string
  suggestedAction: string
  agentResponseExcerpt: string
  status: AlertStatus
  timestamp: string
}

export interface Policy {
  id: string
  name: string
  type: PolicyType
  status: PolicyStatus
  content: string
  updatedAt: string
}

export interface Rule {
  id: string
  name: string
  eventType: EventType
  condition: string
  action: string
  priority: number
  active: boolean
  updatedAt: string
}

export interface MasterAgentStat {
  key: MasterAgentKey
  name: string
  description: string
  status: 'healthy' | 'degraded'
  runsToday: number
  avgDurationMs: number
  lastRunAt: string
  passRate: number
}

// ── Helpers ───────────────────────────────────────────────────

function daysAgo(n: number, hour = 10, min = 0): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  d.setHours(hour, min, 0, 0)
  return d.toISOString()
}

// ── Pipeline Runs ─────────────────────────────────────────────

export const MOCK_RUNS: PipelineRun[] = [
  {
    runId: 'run_001',
    eventId: 'evt_001',
    eventType: 'estimate.created',
    entityLabel: 'Estimate #1001',
    companyId: 1,
    pipeline: ['profitPolicy', 'inventoryCheck', 'customerCheck'],
    status: 'flagged',
    totalDurationMs: 4820,
    totalTokens: 3240,
    timestamp: daysAgo(0, 9, 10),
    steps: [
      {
        agentKey: 'profitPolicy',
        agentName: 'Profit Policy Agent',
        verdict: 'flag',
        responseExcerpt: 'Margin calculated at 14.2% which is below the minimum 20% threshold defined in the Minimum Margin Policy. Flagging for review.',
        toolsUsed: [
          { name: 'get_estimate_details', input: { estimate_id: 1001 }, success: true, durationMs: 320 },
          { name: 'get_product_details', input: { product_id: 101 }, success: true, durationMs: 210 },
        ],
        durationMs: 1820,
        tokens: 1100,
      },
      {
        agentKey: 'inventoryCheck',
        agentName: 'Inventory Check Agent',
        verdict: 'pass',
        responseExcerpt: 'All 3 products on estimate #1001 have sufficient stock. No inventory issues detected.',
        toolsUsed: [
          { name: 'get_product_details', input: { product_id: 101 }, success: true, durationMs: 190 },
          { name: 'get_product_details', input: { product_id: 102 }, success: true, durationMs: 180 },
          { name: 'get_product_details', input: { product_id: 103 }, success: true, durationMs: 175 },
        ],
        durationMs: 1400,
        tokens: 980,
      },
      {
        agentKey: 'customerCheck',
        agentName: 'Customer Check Agent',
        verdict: 'pass',
        responseExcerpt: 'Customer Acme Corp (ID 2001) has a clean payment history. No overdue invoices. Credit limit not exceeded.',
        toolsUsed: [
          { name: 'get_customer_details', input: { customer_id: 2001 }, success: true, durationMs: 240 },
          { name: 'list_invoices', input: { customer_id: 2001, status: 'overdue' }, success: true, durationMs: 290 },
        ],
        durationMs: 1600,
        tokens: 1160,
      },
    ],
  },
  {
    runId: 'run_002',
    eventId: 'evt_002',
    eventType: 'invoice.created',
    entityLabel: 'Invoice #2001',
    companyId: 1,
    pipeline: ['customerCheck', 'profitPolicy'],
    status: 'pass',
    totalDurationMs: 3100,
    totalTokens: 2100,
    timestamp: daysAgo(0, 11, 25),
    steps: [
      {
        agentKey: 'customerCheck',
        agentName: 'Customer Check Agent',
        verdict: 'pass',
        responseExcerpt: 'Customer TechFlow Inc (ID 2002) has no overdue invoices and is within credit limit of $50,000.',
        toolsUsed: [
          { name: 'get_customer_details', input: { customer_id: 2002 }, success: true, durationMs: 210 },
          { name: 'list_invoices', input: { customer_id: 2002, status: 'overdue' }, success: true, durationMs: 260 },
        ],
        durationMs: 1500,
        tokens: 1050,
      },
      {
        agentKey: 'profitPolicy',
        agentName: 'Profit Policy Agent',
        verdict: 'pass',
        responseExcerpt: 'Invoice margin is 28.5%, above the 20% minimum threshold. Policy satisfied.',
        toolsUsed: [
          { name: 'get_invoice_details', input: { invoice_id: 2001 }, success: true, durationMs: 230 },
        ],
        durationMs: 1600,
        tokens: 1050,
      },
    ],
  },
  {
    runId: 'run_003',
    eventId: 'evt_003',
    eventType: 'estimate.created',
    entityLabel: 'Estimate #1002',
    companyId: 1,
    pipeline: ['profitPolicy', 'inventoryCheck', 'customerCheck'],
    status: 'error',
    totalDurationMs: 2200,
    totalTokens: 800,
    timestamp: daysAgo(0, 14, 5),
    steps: [
      {
        agentKey: 'profitPolicy',
        agentName: 'Profit Policy Agent',
        verdict: 'error',
        responseExcerpt: 'Failed to retrieve estimate details. Tool call get_estimate_details returned an error: estimate not found.',
        toolsUsed: [
          { name: 'get_estimate_details', input: { estimate_id: 1002 }, success: false, durationMs: 500 },
        ],
        durationMs: 2200,
        tokens: 800,
      },
    ],
  },
  {
    runId: 'run_004',
    eventId: 'evt_004',
    eventType: 'customer.updated',
    entityLabel: 'Customer #2003',
    companyId: 1,
    pipeline: ['customerCheck'],
    status: 'flagged',
    totalDurationMs: 1900,
    totalTokens: 1400,
    timestamp: daysAgo(1, 9, 0),
    steps: [
      {
        agentKey: 'customerCheck',
        agentName: 'Customer Check Agent',
        verdict: 'flag',
        responseExcerpt: 'Customer BuildRight LLC (ID 2003) now has 3 overdue invoices totalling $24,500. Credit hold policy triggered. Recommend placing account on hold.',
        toolsUsed: [
          { name: 'get_customer_details', input: { customer_id: 2003 }, success: true, durationMs: 220 },
          { name: 'list_invoices', input: { customer_id: 2003, status: 'overdue' }, success: true, durationMs: 280 },
        ],
        durationMs: 1900,
        tokens: 1400,
      },
    ],
  },
  {
    runId: 'run_005',
    eventId: 'evt_005',
    eventType: 'invoice.paid',
    entityLabel: 'Invoice #1987',
    companyId: 1,
    pipeline: ['customerCheck'],
    status: 'pass',
    totalDurationMs: 1650,
    totalTokens: 980,
    timestamp: daysAgo(1, 13, 30),
    steps: [
      {
        agentKey: 'customerCheck',
        agentName: 'Customer Check Agent',
        verdict: 'pass',
        responseExcerpt: 'Invoice #1987 paid in full. Customer payment history updated. No outstanding issues.',
        toolsUsed: [
          { name: 'get_customer_details', input: { customer_id: 2001 }, success: true, durationMs: 200 },
        ],
        durationMs: 1650,
        tokens: 980,
      },
    ],
  },
  {
    runId: 'run_006',
    eventId: 'evt_006',
    eventType: 'estimate.updated',
    entityLabel: 'Estimate #998',
    companyId: 1,
    pipeline: ['profitPolicy', 'inventoryCheck', 'customerCheck'],
    status: 'pass',
    totalDurationMs: 5100,
    totalTokens: 3600,
    timestamp: daysAgo(1, 16, 0),
    steps: [
      {
        agentKey: 'profitPolicy',
        agentName: 'Profit Policy Agent',
        verdict: 'pass',
        responseExcerpt: 'Updated estimate margin is 22.1%. Above minimum threshold. Policy satisfied.',
        toolsUsed: [
          { name: 'get_estimate_details', input: { estimate_id: 998 }, success: true, durationMs: 300 },
        ],
        durationMs: 1700,
        tokens: 1200,
      },
      {
        agentKey: 'inventoryCheck',
        agentName: 'Inventory Check Agent',
        verdict: 'pass',
        responseExcerpt: 'All products in stock. No inventory concerns.',
        toolsUsed: [
          { name: 'get_product_details', input: { product_id: 105 }, success: true, durationMs: 190 },
        ],
        durationMs: 1600,
        tokens: 1100,
      },
      {
        agentKey: 'customerCheck',
        agentName: 'Customer Check Agent',
        verdict: 'pass',
        responseExcerpt: 'Customer in good standing. No holds or overdue invoices.',
        toolsUsed: [
          { name: 'get_customer_details', input: { customer_id: 2004 }, success: true, durationMs: 210 },
        ],
        durationMs: 1800,
        tokens: 1300,
      },
    ],
  },
  {
    runId: 'run_007',
    eventId: 'evt_007',
    eventType: 'product.updated',
    entityLabel: 'Product #101',
    companyId: 1,
    pipeline: ['inventoryCheck', 'profitPolicy'],
    status: 'flagged',
    totalDurationMs: 3300,
    totalTokens: 2200,
    timestamp: daysAgo(2, 10, 45),
    steps: [
      {
        agentKey: 'inventoryCheck',
        agentName: 'Inventory Check Agent',
        verdict: 'flag',
        responseExcerpt: 'Product #101 (HVAC Unit 3-Ton) stock has dropped to 2 units. Reorder point is 5 units. Low stock alert triggered.',
        toolsUsed: [
          { name: 'get_product_details', input: { product_id: 101 }, success: true, durationMs: 210 },
        ],
        durationMs: 1600,
        tokens: 1100,
      },
      {
        agentKey: 'profitPolicy',
        agentName: 'Profit Policy Agent',
        verdict: 'pass',
        responseExcerpt: 'Product cost price update does not violate any margin policies at current sales price.',
        toolsUsed: [
          { name: 'get_product_details', input: { product_id: 101 }, success: true, durationMs: 195 },
        ],
        durationMs: 1700,
        tokens: 1100,
      },
    ],
  },
  {
    runId: 'run_008',
    eventId: 'evt_008',
    eventType: 'invoice.created',
    entityLabel: 'Invoice #2008',
    companyId: 1,
    pipeline: ['customerCheck', 'profitPolicy'],
    status: 'flagged',
    totalDurationMs: 3500,
    totalTokens: 2400,
    timestamp: daysAgo(2, 14, 20),
    steps: [
      {
        agentKey: 'customerCheck',
        agentName: 'Customer Check Agent',
        verdict: 'flag',
        responseExcerpt: 'Customer SunBelt Services (ID 2005) has 2 overdue invoices. Per credit hold rules, new invoice creation triggers a warning.',
        toolsUsed: [
          { name: 'get_customer_details', input: { customer_id: 2005 }, success: true, durationMs: 220 },
          { name: 'list_invoices', input: { customer_id: 2005, status: 'overdue' }, success: true, durationMs: 270 },
        ],
        durationMs: 1800,
        tokens: 1200,
      },
      {
        agentKey: 'profitPolicy',
        agentName: 'Profit Policy Agent',
        verdict: 'pass',
        responseExcerpt: 'Invoice margin at 31%. Above minimum threshold.',
        toolsUsed: [
          { name: 'get_invoice_details', input: { invoice_id: 2008 }, success: true, durationMs: 210 },
        ],
        durationMs: 1700,
        tokens: 1200,
      },
    ],
  },
  {
    runId: 'run_009',
    eventId: 'evt_009',
    eventType: 'estimate.created',
    entityLabel: 'Estimate #1005',
    companyId: 1,
    pipeline: ['profitPolicy', 'inventoryCheck', 'customerCheck'],
    status: 'pass',
    totalDurationMs: 4600,
    totalTokens: 3100,
    timestamp: daysAgo(3, 8, 15),
    steps: [
      {
        agentKey: 'profitPolicy',
        agentName: 'Profit Policy Agent',
        verdict: 'pass',
        responseExcerpt: 'Margin 25.4%. Policy satisfied.',
        toolsUsed: [{ name: 'get_estimate_details', input: { estimate_id: 1005 }, success: true, durationMs: 310 }],
        durationMs: 1500,
        tokens: 1000,
      },
      {
        agentKey: 'inventoryCheck',
        agentName: 'Inventory Check Agent',
        verdict: 'pass',
        responseExcerpt: 'All products in stock.',
        toolsUsed: [{ name: 'get_product_details', input: { product_id: 108 }, success: true, durationMs: 190 }],
        durationMs: 1500,
        tokens: 1000,
      },
      {
        agentKey: 'customerCheck',
        agentName: 'Customer Check Agent',
        verdict: 'pass',
        responseExcerpt: 'Customer in good standing.',
        toolsUsed: [{ name: 'get_customer_details', input: { customer_id: 2006 }, success: true, durationMs: 200 }],
        durationMs: 1600,
        tokens: 1100,
      },
    ],
  },
  {
    runId: 'run_010',
    eventId: 'evt_010',
    eventType: 'customer.created',
    entityLabel: 'Customer #2007',
    companyId: 1,
    pipeline: ['customerCheck'],
    status: 'pass',
    totalDurationMs: 1400,
    totalTokens: 900,
    timestamp: daysAgo(3, 11, 0),
    steps: [
      {
        agentKey: 'customerCheck',
        agentName: 'Customer Check Agent',
        verdict: 'pass',
        responseExcerpt: 'New customer ArcLight Systems created. No history to check. Account cleared.',
        toolsUsed: [{ name: 'get_customer_details', input: { customer_id: 2007 }, success: true, durationMs: 215 }],
        durationMs: 1400,
        tokens: 900,
      },
    ],
  },
  {
    runId: 'run_011',
    eventId: 'evt_011',
    eventType: 'estimate.created',
    entityLabel: 'Estimate #1006',
    companyId: 1,
    pipeline: ['profitPolicy', 'inventoryCheck', 'customerCheck'],
    status: 'flagged',
    totalDurationMs: 4900,
    totalTokens: 3300,
    timestamp: daysAgo(4, 9, 30),
    steps: [
      {
        agentKey: 'profitPolicy',
        agentName: 'Profit Policy Agent',
        verdict: 'pass',
        responseExcerpt: 'Margin 21%. Policy satisfied.',
        toolsUsed: [{ name: 'get_estimate_details', input: { estimate_id: 1006 }, success: true, durationMs: 300 }],
        durationMs: 1600,
        tokens: 1100,
      },
      {
        agentKey: 'inventoryCheck',
        agentName: 'Inventory Check Agent',
        verdict: 'flag',
        responseExcerpt: 'Product #103 has only 1 unit in stock but estimate requires 4. Cannot fulfil order as-is.',
        toolsUsed: [
          { name: 'get_product_details', input: { product_id: 103 }, success: true, durationMs: 195 },
        ],
        durationMs: 1600,
        tokens: 1100,
      },
      {
        agentKey: 'customerCheck',
        agentName: 'Customer Check Agent',
        verdict: 'pass',
        responseExcerpt: 'Customer in good standing.',
        toolsUsed: [{ name: 'get_customer_details', input: { customer_id: 2008 }, success: true, durationMs: 210 }],
        durationMs: 1700,
        tokens: 1100,
      },
    ],
  },
  {
    runId: 'run_012',
    eventId: 'evt_012',
    eventType: 'invoice.paid',
    entityLabel: 'Invoice #1995',
    companyId: 1,
    pipeline: ['customerCheck'],
    status: 'pass',
    totalDurationMs: 1500,
    totalTokens: 920,
    timestamp: daysAgo(4, 15, 0),
    steps: [
      {
        agentKey: 'customerCheck',
        agentName: 'Customer Check Agent',
        verdict: 'pass',
        responseExcerpt: 'Payment received. Customer history updated.',
        toolsUsed: [{ name: 'get_customer_details', input: { customer_id: 2003 }, success: true, durationMs: 205 }],
        durationMs: 1500,
        tokens: 920,
      },
    ],
  },
  {
    runId: 'run_013',
    eventId: 'evt_013',
    eventType: 'estimate.created',
    entityLabel: 'Estimate #1007',
    companyId: 1,
    pipeline: ['profitPolicy', 'inventoryCheck', 'customerCheck'],
    status: 'pass',
    totalDurationMs: 4700,
    totalTokens: 3200,
    timestamp: daysAgo(5, 10, 0),
    steps: [
      {
        agentKey: 'profitPolicy',
        agentName: 'Profit Policy Agent',
        verdict: 'pass',
        responseExcerpt: 'Margin 33%. Well above threshold.',
        toolsUsed: [{ name: 'get_estimate_details', input: { estimate_id: 1007 }, success: true, durationMs: 290 }],
        durationMs: 1550,
        tokens: 1050,
      },
      {
        agentKey: 'inventoryCheck',
        agentName: 'Inventory Check Agent',
        verdict: 'pass',
        responseExcerpt: 'Adequate stock for all line items.',
        toolsUsed: [{ name: 'get_product_details', input: { product_id: 110 }, success: true, durationMs: 185 }],
        durationMs: 1550,
        tokens: 1050,
      },
      {
        agentKey: 'customerCheck',
        agentName: 'Customer Check Agent',
        verdict: 'pass',
        responseExcerpt: 'No issues with customer account.',
        toolsUsed: [{ name: 'get_customer_details', input: { customer_id: 2009 }, success: true, durationMs: 205 }],
        durationMs: 1600,
        tokens: 1100,
      },
    ],
  },
  {
    runId: 'run_014',
    eventId: 'evt_014',
    eventType: 'invoice.created',
    entityLabel: 'Invoice #2014',
    companyId: 1,
    pipeline: ['customerCheck', 'profitPolicy'],
    status: 'pass',
    totalDurationMs: 3000,
    totalTokens: 2000,
    timestamp: daysAgo(5, 14, 0),
    steps: [
      {
        agentKey: 'customerCheck',
        agentName: 'Customer Check Agent',
        verdict: 'pass',
        responseExcerpt: 'No overdue invoices. Clear to proceed.',
        toolsUsed: [{ name: 'get_customer_details', input: { customer_id: 2010 }, success: true, durationMs: 215 }],
        durationMs: 1500,
        tokens: 1000,
      },
      {
        agentKey: 'profitPolicy',
        agentName: 'Profit Policy Agent',
        verdict: 'pass',
        responseExcerpt: 'Margin 24%. Policy satisfied.',
        toolsUsed: [{ name: 'get_invoice_details', input: { invoice_id: 2014 }, success: true, durationMs: 220 }],
        durationMs: 1500,
        tokens: 1000,
      },
    ],
  },
  {
    runId: 'run_015',
    eventId: 'evt_015',
    eventType: 'estimate.created',
    entityLabel: 'Estimate #1009',
    companyId: 1,
    pipeline: ['profitPolicy', 'inventoryCheck', 'customerCheck'],
    status: 'flagged',
    totalDurationMs: 5000,
    totalTokens: 3400,
    timestamp: daysAgo(6, 9, 0),
    steps: [
      {
        agentKey: 'profitPolicy',
        agentName: 'Profit Policy Agent',
        verdict: 'flag',
        responseExcerpt: 'Margin at 11%. Significantly below the 20% minimum. High-risk estimate.',
        toolsUsed: [{ name: 'get_estimate_details', input: { estimate_id: 1009 }, success: true, durationMs: 310 }],
        durationMs: 1700,
        tokens: 1200,
      },
      {
        agentKey: 'inventoryCheck',
        agentName: 'Inventory Check Agent',
        verdict: 'pass',
        responseExcerpt: 'Adequate inventory.',
        toolsUsed: [{ name: 'get_product_details', input: { product_id: 112 }, success: true, durationMs: 180 }],
        durationMs: 1500,
        tokens: 1050,
      },
      {
        agentKey: 'customerCheck',
        agentName: 'Customer Check Agent',
        verdict: 'pass',
        responseExcerpt: 'Customer account clean.',
        toolsUsed: [{ name: 'get_customer_details', input: { customer_id: 2001 }, success: true, durationMs: 200 }],
        durationMs: 1800,
        tokens: 1150,
      },
    ],
  },
]

// ── Alerts ────────────────────────────────────────────────────

export const MOCK_ALERTS: Alert[] = [
  {
    alertId: 'alr_001',
    severity: 'critical',
    message: 'Margin below minimum on Estimate #1001 (14.2%)',
    detail: 'Estimate #1001 for Acme Corp has a calculated margin of 14.2%, which is below the company minimum of 20% as defined in the Minimum Margin Policy.',
    triggeredBy: 'Profit Policy Agent',
    relatedEntity: 'Estimate #1001',
    eventType: 'estimate.created',
    policyViolated: 'Minimum Margin Policy',
    suggestedAction: 'Review the line items on Estimate #1001 and either increase pricing or reduce cost to meet the 20% margin threshold before sending to customer.',
    agentResponseExcerpt: 'Margin calculated at 14.2% which is below the minimum 20% threshold defined in the Minimum Margin Policy. Flagging for review.',
    status: 'open',
    timestamp: daysAgo(0, 9, 11),
  },
  {
    alertId: 'alr_002',
    severity: 'warning',
    message: 'Credit hold triggered: BuildRight LLC has 3 overdue invoices',
    detail: 'Customer BuildRight LLC (ID 2003) currently has 3 overdue invoices totalling $24,500. The Credit Hold Policy states that customers with 2+ overdue invoices should be placed on hold.',
    triggeredBy: 'Customer Check Agent',
    relatedEntity: 'Customer #2003',
    eventType: 'customer.updated',
    policyViolated: 'Credit Hold Policy',
    suggestedAction: 'Place BuildRight LLC account on credit hold. Contact the customer to arrange payment of outstanding invoices before processing new orders.',
    agentResponseExcerpt: 'Customer BuildRight LLC has 3 overdue invoices totalling $24,500. Credit hold policy triggered.',
    status: 'open',
    timestamp: daysAgo(1, 9, 1),
  },
  {
    alertId: 'alr_003',
    severity: 'warning',
    message: 'Low stock: HVAC Unit 3-Ton (Product #101) — 2 units remaining',
    detail: 'Product #101 stock has dropped to 2 units, below the reorder threshold of 5 units. Multiple open estimates include this product.',
    triggeredBy: 'Inventory Check Agent',
    relatedEntity: 'Product #101',
    eventType: 'product.updated',
    policyViolated: 'Inventory Reorder Policy',
    suggestedAction: 'Create a purchase order for Product #101 to replenish stock to at least 20 units. Check open estimates for pending demand.',
    agentResponseExcerpt: 'Product #101 stock has dropped to 2 units. Reorder point is 5 units. Low stock alert triggered.',
    status: 'open',
    timestamp: daysAgo(2, 10, 46),
  },
  {
    alertId: 'alr_004',
    severity: 'warning',
    message: 'New invoice created for customer with 2 overdue invoices (SunBelt Services)',
    detail: 'Invoice #2008 was created for SunBelt Services (ID 2005), who has 2 overdue invoices. The credit hold rule requires a warning when new invoices are created for such customers.',
    triggeredBy: 'Customer Check Agent',
    relatedEntity: 'Invoice #2008',
    eventType: 'invoice.created',
    policyViolated: 'Credit Hold Policy',
    suggestedAction: 'Confirm with the accounts team that this invoice has management approval given the customer\'s overdue balance.',
    agentResponseExcerpt: 'Customer SunBelt Services has 2 overdue invoices. Per credit hold rules, new invoice creation triggers a warning.',
    status: 'open',
    timestamp: daysAgo(2, 14, 21),
  },
  {
    alertId: 'alr_005',
    severity: 'warning',
    message: 'Insufficient stock for Estimate #1006 — Product #103 (1 unit, need 4)',
    detail: 'Estimate #1006 requires 4 units of Product #103 but only 1 is in stock. This estimate cannot be fulfilled as-is without a restock.',
    triggeredBy: 'Inventory Check Agent',
    relatedEntity: 'Estimate #1006',
    eventType: 'estimate.created',
    policyViolated: 'Inventory Fulfilment Policy',
    suggestedAction: 'Place a purchase order for Product #103 or update the estimate to reflect a future delivery date. Notify the customer of the expected lead time.',
    agentResponseExcerpt: 'Product #103 has only 1 unit in stock but estimate requires 4. Cannot fulfil order as-is.',
    status: 'open',
    timestamp: daysAgo(4, 9, 31),
  },
  {
    alertId: 'alr_006',
    severity: 'critical',
    message: 'Margin at 11% on Estimate #1009 — significantly below minimum',
    detail: 'Estimate #1009 has a margin of only 11%, nearly half the minimum required 20%. This represents a significant risk to company profitability.',
    triggeredBy: 'Profit Policy Agent',
    relatedEntity: 'Estimate #1009',
    eventType: 'estimate.created',
    policyViolated: 'Minimum Margin Policy',
    suggestedAction: 'Do not send this estimate to the customer without management approval. Re-price all line items to achieve at least 20% margin.',
    agentResponseExcerpt: 'Margin at 11%. Significantly below the 20% minimum. High-risk estimate.',
    status: 'resolved',
    timestamp: daysAgo(6, 9, 1),
  },
  {
    alertId: 'alr_007',
    severity: 'info',
    message: 'Pipeline error: Estimate #1002 could not be retrieved',
    detail: 'The governance pipeline for event estimate.created (evt_003) encountered an error. The get_estimate_details tool returned "estimate not found" for ID 1002. The pipeline was aborted.',
    triggeredBy: 'Profit Policy Agent',
    relatedEntity: 'Estimate #1002',
    eventType: 'estimate.created',
    policyViolated: 'N/A — System Error',
    suggestedAction: 'Verify that Estimate #1002 exists in the system. If deleted, no action needed. If present, re-trigger the webhook or run the pipeline manually.',
    agentResponseExcerpt: 'Failed to retrieve estimate details. Tool call get_estimate_details returned an error: estimate not found.',
    status: 'resolved',
    timestamp: daysAgo(0, 14, 6),
  },
  {
    alertId: 'alr_008',
    severity: 'info',
    message: 'New customer ArcLight Systems onboarded — no history',
    detail: 'New customer ArcLight Systems (ID 2007) was created. No payment history exists. Standard onboarding checks passed.',
    triggeredBy: 'Customer Check Agent',
    relatedEntity: 'Customer #2007',
    eventType: 'customer.created',
    policyViolated: 'N/A — Informational',
    suggestedAction: 'No action required. Standard credit terms apply for new customers.',
    agentResponseExcerpt: 'New customer ArcLight Systems created. No history to check. Account cleared.',
    status: 'resolved',
    timestamp: daysAgo(3, 11, 1),
  },
]

// ── Policies ──────────────────────────────────────────────────

export const MOCK_POLICIES: Policy[] = [
  {
    id: 'pol_001',
    name: 'Minimum Margin Policy',
    type: 'policy',
    status: 'active',
    content: `# Minimum Margin Policy

## Objective
Ensure all estimates and invoices maintain a minimum gross margin to protect company profitability.

## Rule
All estimates and invoices must have a minimum gross margin of **20%**.

## Calculation
Gross Margin = (Grand Total - Cost of Goods) / Grand Total × 100

## Enforcement
- Estimates below 20% margin must be flagged for manager review before sending to customer.
- Invoices below 20% margin generated without an approved estimate must be reviewed.
- Exceptions require written approval from the Finance Director.

## Escalation
Margins below 10% are considered critical and must be escalated to the VP of Sales immediately.`,
    updatedAt: daysAgo(14),
  },
  {
    id: 'pol_002',
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
    updatedAt: daysAgo(30),
  },
  {
    id: 'pol_003',
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
    updatedAt: daysAgo(7),
  },
  {
    id: 'pol_004',
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
    updatedAt: daysAgo(21),
  },
  {
    id: 'pol_005',
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
    updatedAt: daysAgo(2),
  },
]

// ── Rules ─────────────────────────────────────────────────────

export const MOCK_RULES: Rule[] = [
  {
    id: 'rule_001',
    name: 'Flag Low Margin Estimates',
    eventType: 'estimate.created',
    condition: 'Gross margin < 20%',
    action: 'Flag estimate for manager review. Create a critical alert.',
    priority: 1,
    active: true,
    updatedAt: daysAgo(14),
  },
  {
    id: 'rule_002',
    name: 'Flag Critically Low Margin Estimates',
    eventType: 'estimate.created',
    condition: 'Gross margin < 10%',
    action: 'Flag estimate as critical. Alert VP of Sales immediately.',
    priority: 1,
    active: true,
    updatedAt: daysAgo(14),
  },
  {
    id: 'rule_003',
    name: 'Credit Hold — 3+ Overdue Invoices',
    eventType: 'customer.updated',
    condition: 'Customer has 3 or more overdue invoices',
    action: 'Place customer on credit hold. Alert Accounts Receivable. Flag all new estimates and invoices.',
    priority: 1,
    active: true,
    updatedAt: daysAgo(30),
  },
  {
    id: 'rule_004',
    name: 'Credit Warning — 2 Overdue Invoices',
    eventType: 'invoice.created',
    condition: 'Customer has 2 overdue invoices at time of invoice creation',
    action: 'Add warning to invoice. Alert AR team.',
    priority: 2,
    active: true,
    updatedAt: daysAgo(30),
  },
  {
    id: 'rule_005',
    name: 'Low Stock Reorder Alert',
    eventType: 'product.updated',
    condition: 'Product stock quantity falls below reorder point',
    action: 'Create a warning alert. Notify purchasing team to raise a PO.',
    priority: 2,
    active: true,
    updatedAt: daysAgo(7),
  },
  {
    id: 'rule_006',
    name: 'Insufficient Stock for Estimate',
    eventType: 'estimate.created',
    condition: 'Any line item product quantity on estimate exceeds current stock',
    action: 'Flag estimate. Notify sales to update delivery date or raise PO.',
    priority: 2,
    active: true,
    updatedAt: daysAgo(21),
  },
]

// ── Master Agent Stats ────────────────────────────────────────

export const MOCK_AGENT_STATS: MasterAgentStat[] = [
  {
    key: 'profitPolicy',
    name: 'Profit Policy Agent',
    description: 'Checks margin policies on estimates and invoices',
    status: 'healthy',
    runsToday: 4,
    avgDurationMs: 1640,
    lastRunAt: daysAgo(0, 14, 5),
    passRate: 62,
  },
  {
    key: 'inventoryCheck',
    name: 'Inventory Check Agent',
    description: 'Verifies inventory levels against estimates and products',
    status: 'healthy',
    runsToday: 5,
    avgDurationMs: 1520,
    lastRunAt: daysAgo(0, 14, 5),
    passRate: 75,
  },
  {
    key: 'customerCheck',
    name: 'Customer Check Agent',
    description: 'Checks customer payment history and credit hold rules',
    status: 'healthy',
    runsToday: 6,
    avgDurationMs: 1680,
    lastRunAt: daysAgo(0, 11, 25),
    passRate: 80,
  },
]

// ── Dashboard KPIs ────────────────────────────────────────────

export const MOCK_KPI = {
  runsToday: 4,
  passRate: 67,
  openAlerts: 5,
  activePipelines: 3,
}

// ── Event Distribution (last 7 days) ─────────────────────────

export const MOCK_EVENT_DISTRIBUTION = [
  { eventType: 'estimate.created' as EventType, count: 6, pct: 40 },
  { eventType: 'invoice.created' as EventType, count: 3, pct: 20 },
  { eventType: 'customer.updated' as EventType, count: 2, pct: 13 },
  { eventType: 'invoice.paid' as EventType, count: 2, pct: 13 },
  { eventType: 'product.updated' as EventType, count: 1, pct: 7 },
  { eventType: 'customer.created' as EventType, count: 1, pct: 7 },
]

// ── Utilities ─────────────────────────────────────────────────

export function formatTs(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  const diffH = Math.floor(diffMs / 3600000)
  const diffD = Math.floor(diffMs / 86400000)
  if (diffMin < 2) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  if (diffH < 24) return `${diffH}h ago`
  if (diffD === 1) return 'yesterday'
  return `${diffD}d ago`
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  'estimate.created': 'Estimate Created',
  'estimate.updated': 'Estimate Updated',
  'invoice.created': 'Invoice Created',
  'invoice.updated': 'Invoice Updated',
  'invoice.paid': 'Invoice Paid',
  'customer.created': 'Customer Created',
  'customer.updated': 'Customer Updated',
  'product.updated': 'Product Updated',
  'job.created': 'Job Created',
}

export const ALL_EVENT_TYPES: EventType[] = [
  'estimate.created',
  'estimate.updated',
  'invoice.created',
  'invoice.updated',
  'invoice.paid',
  'customer.created',
  'customer.updated',
  'product.updated',
  'job.created',
]
