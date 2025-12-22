/**
 * MCP Tools Index - Register all tools
 */

import { registerSubscriptionTools } from './subscriptions.js';
import { registerCompanyTools } from './company.js';
import { registerHRTools } from './hr.js';
import { registerProductTools } from './products.js';
import { registerCustomerTools } from './customers.js';
import { registerContactTools } from './contacts.js';
import { registerVendorTools } from './vendors.js';
import { registerFinanceTools } from './finance.js';
import { registerConfigTools } from './config.js';
import { registerEstimateTools } from './estimates.js';
import { registerInvoiceTools } from './invoices.js';
import { registerTaskTools } from './tasks.js';
import { registerJobTools } from './jobs.js';
import { registerWorkflowTools } from './workflows.js';
import { registerHelperTools } from './helpers.js';
import { registerAddressTools } from './addresses.js';
import { registerSystemFinderTools } from './systemFinder.js';
import { registerProjectTools } from './projects.js';
import { registerPriceComparisonTools } from './priceComparison.js';

/**
 * Register all tools
 */
export function registerAllTools() {
  console.log('📦 Registering MCP tools...');

  registerSubscriptionTools();
  console.log('  ✓ Subscription tools registered');

  registerCompanyTools();
  console.log('  ✓ Company tools registered');

  registerHRTools();
  console.log('  ✓ HR tools registered');

  registerProductTools();
  console.log('  ✓ Product tools registered');

  registerCustomerTools();
  console.log('  ✓ Customer tools registered');

  registerContactTools();
  console.log('  ✓ Contact tools registered');

  registerVendorTools();
  console.log('  ✓ Vendor tools registered');

  registerFinanceTools();
  console.log('  ✓ Finance tools registered');

  registerConfigTools();
  console.log('  ✓ Config tools registered');

  registerEstimateTools();
  console.log('  ✓ Estimate tools registered');

  registerInvoiceTools();
  console.log('  ✓ Invoice tools registered');

  registerTaskTools();
  console.log('  ✓ Task tools registered');

  registerJobTools();
  console.log('  ✓ Job tools registered');

  registerWorkflowTools();
  console.log('  ✓ Workflow tools registered');

  registerHelperTools();
  console.log('  ✓ Helper tools registered');

  registerAddressTools();
  console.log('  ✓ Address tools registered');

  registerSystemFinderTools();
  console.log('  ✓ System Finder tools registered');

  registerProjectTools();
  console.log('  ✓ Project tools registered');

  registerPriceComparisonTools();
  console.log('  ✓ Price Comparison tools registered');

  console.log('✅ All MCP tools registered');
}

// Auto-register tools on import
registerAllTools();
