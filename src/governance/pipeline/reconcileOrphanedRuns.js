/**
 * Runs left status=running when the process dies. Mark them error on boot.
 */

import PipelineRun from '../models/PipelineRun.js';

export const ORPHAN_RUN_DETAIL = 'Agent process restarted before this check finished.';

export function interruptOrphanedRun(doc, { at = new Date(), reason = ORPHAN_RUN_DETAIL } = {}) {
  const steps = (doc.steps || []).map((step) => {
    const plain = typeof step.toObject === 'function' ? step.toObject() : { ...step };
    if (plain.verdict !== 'running') return plain;
    return {
      ...plain,
      verdict: 'error',
      message: plain.message || 'Interrupted',
      detail: reason,
      responseExcerpt: plain.responseExcerpt || reason,
    };
  });

  return {
    status: 'error',
    steps,
    plan_reason: reason,
    timestamp: doc.timestamp || at,
  };
}

export async function reconcileOrphanedRuns() {
  const orphans = await PipelineRun.find({
    status: 'running',
    $or: [{ deleted_at: { $exists: false } }, { deleted_at: null }],
  });

  let marked = 0;
  for (const doc of orphans) {
    const patch = interruptOrphanedRun(doc);
    doc.status = patch.status;
    doc.steps = patch.steps;
    doc.plan_reason = patch.plan_reason;
    await doc.save();
    marked += 1;
  }

  if (marked > 0) {
    console.warn(`🛡️  Marked ${marked} orphaned running pipeline(s) as error`);
  }
  return marked;
}
