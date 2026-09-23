/**
 * Deterministic catalog checks for quantitative rules (Phase 2).
 * Only fires when the LIVE catalog item text encodes an extractable threshold.
 * Prose-only policies stay with Aegis — never invent defaults.
 */

function asNumber(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function readMarginPct(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const keys = [
    'grossProfitPercentage',
    'gross_profit_percentage',
    'marginPercentage',
    'margin_percentage',
  ];
  for (const k of keys) {
    const n = asNumber(payload[k]);
    if (n != null) return n;
  }
  return null;
}

function collectStockRows(payload, enrichment) {
  const rows = [];
  const products = enrichment?.products;
  if (Array.isArray(products)) {
    for (const p of products) {
      const qty = asNumber(p?.stock_qty ?? p?.qty ?? p?.availableQty ?? p?.available_qty);
      const label = p?.name || p?.sku || p?.product_service_id || p?.id || 'product';
      if (qty != null) rows.push({ label: String(label), qty });
    }
  }
  const sections = payload?.sections;
  if (Array.isArray(sections)) {
    for (const section of sections) {
      for (const item of section?.items || []) {
        const qty = asNumber(item?.availableQty ?? item?.available_qty ?? item?.stock_qty ?? item?.qty);
        const label = item?.name || item?.productServiceName || item?.sku || 'line item';
        if (qty != null) rows.push({ label: String(label), qty });
      }
    }
  }
  return rows;
}

/**
 * Extract { kind, threshold } from catalog condition/content text.
 * @param {string} text
 * @returns {{ kind: 'margin_below'|'stock_below', threshold: number } | null}
 */
export function extractNumericThreshold(text) {
  const t = String(text || '');
  const margin = t.match(
    /(?:margin|gross\s*profit(?:\s*percentage)?|gp\s*%?)\s*(?:is\s+)?(?:below|under|less than|<|≤)\s*(\d+(?:\.\d+)?)\s*%?/i,
  );
  if (margin) {
    return { kind: 'margin_below', threshold: Number(margin[1]) };
  }
  const stock = t.match(
    /(?:stock|qty|quantity|inventory|available(?:\s*qty)?)\s*(?:is\s+)?(?:below|under|less than|<|≤)\s*(\d+(?:\.\d+)?)/i,
  );
  if (stock) {
    return { kind: 'stock_below', threshold: Number(stock[1]) };
  }
  return null;
}

/**
 * @param {object} params
 * @param {{ name: string, content?: string, condition?: string, action?: string }[]} params.catalogItems
 * @param {object} params.payload
 * @param {object} [params.enrichment]
 * @returns {object[]} findings compatible with Aegis findings[]
 */
export function runStructuredCatalogChecks({ catalogItems = [], payload = {}, enrichment = {} }) {
  const findings = [];

  for (const item of catalogItems) {
    const blob = [item.content, item.condition, item.action, item.name].filter(Boolean).join('\n');
    const rule = extractNumericThreshold(blob);
    if (!rule) continue;

    const checkName = item.name || 'Structured check';

    if (rule.kind === 'margin_below') {
      const margin = readMarginPct(payload);
      if (margin == null) {
        findings.push({
          check: checkName,
          verdict: 'error',
          severity: 'warning',
          message: 'Margin field missing for structured check',
          detail: `Catalog item "${checkName}" requires grossProfitPercentage (or equivalent); it was null in the payload.`,
          policyViolated: null,
          suggestedAction: 'Ensure WorxStream sends grossProfitPercentage on the event payload.',
          relatedEntity: null,
          structured: true,
        });
        continue;
      }
      const flagged = margin < rule.threshold;
      findings.push({
        check: checkName,
        verdict: flagged ? 'flag' : 'pass',
        severity: flagged ? 'warning' : null,
        message: flagged
          ? `Margin ${margin}% is below ${rule.threshold}%`
          : `Margin ${margin}% meets threshold ${rule.threshold}%`,
        detail: `Structured check against catalog item "${checkName}": payload margin ${margin}% vs threshold ${rule.threshold}%.`,
        policyViolated: flagged ? checkName : null,
        suggestedAction: flagged ? 'Review pricing/cost before approving.' : null,
        relatedEntity: null,
        structured: true,
      });
      continue;
    }

    if (rule.kind === 'stock_below') {
      const rows = collectStockRows(payload, enrichment);
      if (rows.length === 0) {
        findings.push({
          check: checkName,
          verdict: 'error',
          severity: 'warning',
          message: 'No stock quantities available for structured check',
          detail: `Catalog item "${checkName}" needs product stock qty; none found on payload/enrichment.`,
          policyViolated: null,
          suggestedAction: 'Enrich the event with product stock before re-running.',
          relatedEntity: null,
          structured: true,
        });
        continue;
      }
      const low = rows.filter((r) => r.qty < rule.threshold);
      const flagged = low.length > 0;
      findings.push({
        check: checkName,
        verdict: flagged ? 'flag' : 'pass',
        severity: flagged ? 'warning' : null,
        message: flagged
          ? `${low.length} product(s) below stock ${rule.threshold}`
          : `All checked stock levels meet threshold ${rule.threshold}`,
        detail: flagged
          ? `Structured check "${checkName}": low stock → ${low.map((r) => `${r.label}=${r.qty}`).join(', ')}.`
          : `Structured check "${checkName}": all ${rows.length} stock row(s) ≥ ${rule.threshold}.`,
        policyViolated: flagged ? checkName : null,
        suggestedAction: flagged ? 'Reorder or adjust line items before fulfillment.' : null,
        relatedEntity: low[0]?.label || null,
        structured: true,
      });
    }
  }

  return findings;
}

/**
 * Prefer structured findings when both cover the same catalog check name.
 * @param {object[]} llmFindings
 * @param {object[]} structuredFindings
 */
export function mergeStructuredOverLlm(llmFindings = [], structuredFindings = []) {
  if (!structuredFindings.length) return llmFindings;
  const byCheck = new Map();
  for (const f of llmFindings) {
    const key = String(f.check || '').toLowerCase();
    if (key) byCheck.set(key, f);
  }
  for (const f of structuredFindings) {
    const key = String(f.check || '').toLowerCase();
    if (key) byCheck.set(key, f);
  }
  // Preserve order: structured first for known keys, then remaining llm
  const structuredKeys = new Set(
    structuredFindings.map((f) => String(f.check || '').toLowerCase()).filter(Boolean),
  );
  const out = [...structuredFindings];
  for (const f of llmFindings) {
    const key = String(f.check || '').toLowerCase();
    if (key && structuredKeys.has(key)) continue;
    out.push(f);
  }
  return out;
}
