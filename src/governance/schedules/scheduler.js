/**
 * Background scheduler for Scribe definitions (criteria reports + flow recipes).
 */

import ScheduleDefinition from '../models/ScheduleDefinition.js';
import { executeScheduleDefinition } from './engine.js';

const TICK_MS = 60_000;
let timer = null;
let ticking = false;

async function tickScheduleScheduler() {
  if (ticking) return;
  ticking = true;
  try {
    const now = new Date();
    const due = await ScheduleDefinition.find({
      active: true,
      $or: [{ deleted_at: { $exists: false } }, { deleted_at: null }],
      next_run_at: { $lte: now },
    }).limit(20);

    for (const definition of due) {
      try {
        await executeScheduleDefinition(definition, { trigger: 'scheduled' });
        const kind = definition.kind === 'flow_recipe' ? 'flow' : 'report';
        console.log(
          `📊 Scribe ${kind} completed: ${definition.name} (company ${definition.company_id})`,
        );
      } catch (error) {
        console.error(
          `❌ Scribe schedule failed: ${definition.name} (company ${definition.company_id}):`,
          error instanceof Error ? error.message : error,
        );
        // Persist backoff even when execute* already tried — ensure tick never leaves next_run_at stuck.
        definition.next_run_at = new Date(Date.now() + 60 * 60 * 1000);
        await definition.save().catch(() => {});
      }
    }
  } finally {
    ticking = false;
  }
}

export function startScheduleScheduler() {
  if (timer) return;
  timer = setInterval(() => {
    tickScheduleScheduler().catch((error) => {
      console.error('❌ Report scheduler tick failed:', error);
    });
  }, TICK_MS);
  tickScheduleScheduler().catch((error) => {
    console.error('❌ Report scheduler initial tick failed:', error);
  });
  console.log('📊 Report scheduler started (Scribe — criteria + flow recipes)');
}

export function stopScheduleScheduler() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

export { tickScheduleScheduler };
