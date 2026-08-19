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

export function findingKey(check, index) {
  const slug = String(check || `finding_${index + 1}`)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40);
  return `aegis_${index}_${slug || 'check'}`;
}

function findMatchingBrace(text, start) {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === '\\') {
        escape = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Salvage complete findings objects when the model truncates the JSON array. */
function recoverPartialFindings(text) {
  const stripped = stripJsonCodeFence(text);
  const marker = stripped.search(/"findings"\s*:\s*\[/);
  if (marker < 0) return null;
  const start = stripped.indexOf('[', marker);
  if (start < 0) return null;
  const rows = [];
  let i = start + 1;
  while (i < stripped.length) {
    while (i < stripped.length && /[\s,]/.test(stripped[i])) i += 1;
    if (stripped[i] === ']') break;
    if (stripped[i] !== '{') break;
    const end = findMatchingBrace(stripped, i);
    if (end < 0) break;
    try {
      rows.push(JSON.parse(stripped.slice(i, end + 1)));
    } catch {
      break;
    }
    i = end + 1;
  }
  return rows.length > 0 ? rows : null;
}

function normalizeFindingRow(row, index, fallbacks, excerpt) {
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
}

/**
 * Aegis returns findings[] (one per policy/rule). Legacy masters returned a single verdict.
 * @returns {{ ok: boolean, findings: Array<object>, excerpt: string }}
 */
export function parseGovernanceFindings(rawText, fallbacks = {}) {
  const excerpt = asString(rawText).slice(0, 800);
  const parsed = extractJsonObject(rawText);
  const recovered = (!parsed || typeof parsed !== 'object')
    ? recoverPartialFindings(rawText)
    : null;

  if ((!parsed || typeof parsed !== 'object') && !recovered) {
    return { ok: false, findings: [], excerpt };
  }

  const source = parsed && typeof parsed === 'object' ? parsed : { findings: recovered };
  if (!Array.isArray(source.findings)) {
    return { ok: false, findings: [], excerpt };
  }

  return {
    ok: true,
    findings: source.findings.map((row, index) => normalizeFindingRow(row, index, fallbacks, excerpt)),
    excerpt,
  };
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
