/**
 * Background scheduler for report definitions (Scribe agent jobs).
 */

import ReportDefinition from '../models/ReportDefinition.js';
import { executeReportDefinition } from './reportEngine.js';

const TICK_MS = 60_000;
let timer = null;
let ticking = false;

async function tickReportScheduler() {
  if (ticking) return;
  ticking = true;
  try {
    const now = new Date();
    const due = await ReportDefinition.find({
      active: true,
      $or: [{ deleted_at: { $exists: false } }, { deleted_at: null }],
      next_run_at: { $lte: now },
    }).limit(20);

    for (const definition of due) {
      try {
        await executeReportDefinition(definition, { trigger: 'scheduled' });
        console.log(`📊 Report completed: ${definition.name} (company ${definition.company_id})`);
      } catch (error) {
        console.error(
          `❌ Report failed: ${definition.name} (company ${definition.company_id}):`,
          error instanceof Error ? error.message : error,
        );
        definition.next_run_at = new Date(Date.now() + 60 * 60 * 1000);
        await definition.save();
      }
    }
  } finally {
    ticking = false;
  }
}

export function startReportScheduler() {
  if (timer) return;
  timer = setInterval(() => {
    tickReportScheduler().catch((error) => {
      console.error('❌ Report scheduler tick failed:', error);
    });
  }, TICK_MS);
  tickReportScheduler().catch((error) => {
    console.error('❌ Report scheduler initial tick failed:', error);
  });
  console.log('📊 Report scheduler started (Scribe)');
}

export function stopReportScheduler() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

export { tickReportScheduler };
