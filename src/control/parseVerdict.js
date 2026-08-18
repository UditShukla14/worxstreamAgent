/**
 * Parse structured JSON from Aegis (or a legacy single-verdict master).
 */

const VERDICTS = new Set(['pass', 'flag', 'error']);
const SEVERITIES = new Set(['critical', 'warning', 'info']);

export function stripJsonCodeFence(text) {
  const t = String(text || '').trim();
  const m = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return m ? m[1].trim() : t;
}

function extractJsonObject(text) {
  const stripped = stripJsonCodeFence(text);
  try {
    return JSON.parse(stripped);
  } catch {
    const start = stripped.indexOf('{');
    const end = stripped.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(stripped.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function asString(value, fallback = '') {
  if (value == null) return fallback;
  const s = String(value).trim();
  return s || fallback;
}

function normalizeVerdict(parsed, fallbacks = {}, excerpt = '') {
  const verdictRaw = String(parsed?.verdict || '').toLowerCase();
  const verdict = VERDICTS.has(verdictRaw) ? verdictRaw : 'error';

  let severity = parsed?.severity == null || parsed?.severity === ''
    ? null
    : String(parsed.severity).toLowerCase();
  if (severity && !SEVERITIES.has(severity)) severity = null;
  if (verdict === 'flag' && !severity) severity = 'warning';
  if (verdict === 'error' && !severity) severity = 'info';
  if (verdict === 'pass') severity = severity === 'info' ? 'info' : null;

  return {
    verdict,
    severity,
    message: asString(parsed?.message, fallbacks.message || 'Governance check complete'),
    detail: asString(parsed?.detail, excerpt),
    policyViolated: parsed?.policyViolated ? asString(parsed.policyViolated) : null,
    suggestedAction: parsed?.suggestedAction ? asString(parsed.suggestedAction) : null,
    relatedEntity: asString(parsed?.relatedEntity, fallbacks.relatedEntity || 'Unknown'),
    responseExcerpt: asString(parsed?.detail) || excerpt,
  };
}

/**
 * @returns {{
 *   verdict: 'pass'|'flag'|'error',
 *   severity: 'critical'|'warning'|'info'|null,
 *   message: string,
 *   detail: string,
 *   policyViolated: string|null,
 *   suggestedAction: string|null,
 *   relatedEntity: string,
 *   responseExcerpt: string,
 * }}
 */
export function parseAgentVerdict(rawText, fallbacks = {}) {
  const excerpt = asString(rawText).slice(0, 800);
  const parsed = extractJsonObject(rawText);

  if (!parsed || typeof parsed !== 'object') {
    return {
      verdict: 'error',
      severity: 'info',
      message: fallbacks.message || 'Agent did not return structured JSON',
      detail: excerpt || 'Empty agent response.',
      policyViolated: null,
      suggestedAction: 'Re-run the pipeline or inspect agent logs.',
      relatedEntity: fallbacks.relatedEntity || 'Unknown',
      responseExcerpt: excerpt,
    };
  }

  return normalizeVerdict(parsed, fallbacks, excerpt);
}

function findingKey(check, index) {
  const slug = String(check || `finding_${index + 1}`)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40);
  return `aegis_${index}_${slug || 'check'}`;
}

/**
 * Aegis returns findings[] (one per policy/rule). Legacy masters returned a single verdict.
 * @returns {{ check: string, agentKey: string, ...parseAgentVerdict }[]}
 */
export function parseGovernanceFindings(rawText, fallbacks = {}) {
  const excerpt = asString(rawText).slice(0, 800);
  const parsed = extractJsonObject(rawText);

  if (!parsed || typeof parsed !== 'object') {
    return [{
      check: 'Aegis',
      agentKey: 'aegis',
      verdict: 'error',
      severity: 'info',
      message: fallbacks.message || 'Aegis did not return structured JSON',
      detail: excerpt || 'Empty agent response.',
      policyViolated: null,
      suggestedAction: 'Re-run the pipeline or inspect agent logs.',
      relatedEntity: fallbacks.relatedEntity || 'Unknown',
      responseExcerpt: excerpt,
    }];
  }

  const rows = Array.isArray(parsed.findings) && parsed.findings.length > 0
    ? parsed.findings
    : [parsed];

  return rows.map((row, index) => {
    const item = row && typeof row === 'object' ? row : {};
    const normalized = normalizeVerdict(item, fallbacks, excerpt);
    const check = asString(
      item.check || item.policyViolated || item.message,
      `Check ${index + 1}`,
    );
    return {
      ...normalized,
      check,
      agentKey: findingKey(check, index),
    };
  });
}

export function runStatusFromSteps(steps) {
  const list = steps || [];
  if (list.some((s) => s.verdict === 'running')) return 'error';
  const done = list.filter((s) => s.verdict !== 'skipped');
  if (done.length === 0) return 'error';
  if (done.some((s) => s.verdict === 'error')) return 'error';
  if (done.some((s) => s.verdict === 'flag')) return 'flagged';
  return 'pass';
}
