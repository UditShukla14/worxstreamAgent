function asNumber(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isEmpty(value) {
  if (value == null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (typeof value === 'number') return false;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function fieldVariants(name) {
  const snake = name.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '');
  return [name, snake];
}

export function readField(record, fieldName) {
  if (!record || typeof record !== 'object') return undefined;
  for (const key of fieldVariants(fieldName)) {
    if (key in record && record[key] != null) return record[key];
  }
  return undefined;
}

/**
 * @param {Record<string, unknown>} record
 * @param {'missing_fields' | 'negative_profit'} criteriaType
 * @param {string[]} criteriaFields
 */
export function evaluateReportCriteria(record, criteriaType, criteriaFields = []) {
  if (criteriaType === 'missing_fields') {
    const fields = criteriaFields.length > 0
      ? criteriaFields
      : ['trackingNo', 'trackingUrl', 'trackingCompany'];
    const missing = fields.filter((field) => isEmpty(readField(record, field)));
    if (missing.length === 0) return null;
    return {
      reason: `Missing: ${missing.join(', ')}`,
      missing,
    };
  }

  if (criteriaType === 'negative_profit') {
    const total = asNumber(readField(record, 'grossProfitTotal'));
    const pct = asNumber(readField(record, 'grossProfitPercentage'));
    const parts = [];
    if (total != null && total < 0) parts.push(`grossProfitTotal=${total}`);
    if (pct != null && pct < 0) parts.push(`grossProfitPercentage=${pct}`);
    if (parts.length === 0) return null;
    return { reason: `Negative gross profit (${parts.join(', ')})` };
  }

  return null;
}

export function buildRowSnapshot(record, criteriaType, criteriaFields) {
  const base = {
    customNumber: readField(record, 'customNumber') ?? readField(record, 'custom_number') ?? '',
    grossProfitTotal: readField(record, 'grossProfitTotal') ?? readField(record, 'gross_profit_total'),
    grossProfitPercentage: readField(record, 'grossProfitPercentage') ?? readField(record, 'gross_profit_percentage'),
    trackingNo: readField(record, 'trackingNo') ?? readField(record, 'tracking_no'),
    trackingUrl: readField(record, 'trackingUrl') ?? readField(record, 'tracking_url'),
    trackingCompany: readField(record, 'trackingCompany') ?? readField(record, 'tracking_company'),
    createdAt: readField(record, 'createdAt') ?? readField(record, 'created_at'),
  };
  if (criteriaType === 'missing_fields') {
    const fields = criteriaFields.length > 0
      ? criteriaFields
      : ['trackingNo', 'trackingUrl', 'trackingCompany'];
    for (const field of fields) {
      base[field] = readField(record, field);
    }
  }
  return base;
}
