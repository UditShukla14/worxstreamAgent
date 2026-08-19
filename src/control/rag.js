/**
 * Company-scoped policy/rule retrieval for governance agents.
 *
 * v1 uses lexical overlap (not a hosted vector DB). Chunks are re-indexed
 * whenever a policy or rule is created/updated/deleted. Swap the scorer for
 * embeddings later without changing retrieveRelevantChunks's callers.
 */

import GovernanceChunk from '../models/GovernanceChunk.js';
import GovernancePolicy from '../models/GovernancePolicy.js';
import GovernanceRule from '../models/GovernanceRule.js';
import { ruleAppliesToEvent } from './ruleEvents.js';

const DEFAULT_TOP_K = 5;
const MAX_CHUNK_CHARS = 900;

const STOP = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'are', 'was', 'were',
  'has', 'have', 'been', 'will', 'into', 'over', 'under', 'than', 'then',
  'when', 'what', 'which', 'your', 'you', 'our', 'any', 'all', 'not',
]);

export function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

export function chunkText(text, maxChars = MAX_CHUNK_CHARS) {
  const source = String(text || '').trim();
  if (!source) return [];

  const paragraphs = source.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks = [];
  let buf = '';

  const flush = () => {
    const piece = buf.trim();
    if (piece) chunks.push(piece);
    buf = '';
  };

  for (const para of paragraphs) {
    if (para.length > maxChars) {
      flush();
      for (let i = 0; i < para.length; i += maxChars) {
        chunks.push(para.slice(i, i + maxChars).trim());
      }
      continue;
    }
    if (buf && buf.length + para.length + 2 > maxChars) {
      flush();
    }
    buf = buf ? `${buf}\n\n${para}` : para;
  }
  flush();
  return chunks;
}

export function scoreChunk(queryTokens, text) {
  if (!queryTokens.length) return 0;
  const textSet = new Set(tokenize(text));
  if (textSet.size === 0) return 0;
  let hits = 0;
  for (const token of queryTokens) {
    if (textSet.has(token)) hits += 1;
  }
  return hits / queryTokens.length;
}

export async function reindexDocument({ companyId, documentId, documentType, name, content }) {
  const company_id = String(companyId);
  const document_id = String(documentId);
  await GovernanceChunk.deleteMany({ company_id, document_id });

  const pieces = chunkText(content);
  if (pieces.length === 0) return 0;

  await GovernanceChunk.insertMany(
    pieces.map((text) => ({
      company_id,
      document_id,
      document_type: documentType,
      name: name || '',
      text,
    })),
  );
  return pieces.length;
}

export async function removeDocumentChunks(companyId, documentId) {
  await GovernanceChunk.deleteMany({
    company_id: String(companyId),
    document_id: String(documentId),
  });
}

/**
 * Index an active policy/rule, or drop chunks when it is inactive/draft.
 * Inactive rules must not stay in RAG or Aegis will still evaluate them.
 */
export async function syncGovernanceDocumentChunks({
  companyId,
  documentId,
  documentType,
  name,
  content,
  enabled,
}) {
  if (!enabled) {
    await removeDocumentChunks(companyId, documentId);
    return 0;
  }
  return reindexDocument({ companyId, documentId, documentType, name, content });
}

async function activeGovernanceDocumentIds(companyId, { eventType } = {}) {
  const company_id = String(companyId);
  const [policies, rules] = await Promise.all([
    GovernancePolicy.find({ company_id, status: 'active' }).select('_id').lean(),
    GovernanceRule.find({ company_id, active: true }).select('_id event_type event_types').lean(),
  ]);
  const matchingRules = eventType
    ? (rules || []).filter((rule) => ruleAppliesToEvent(rule, eventType))
    : (rules || []);
  return [
    ...(policies || []).map((row) => String(row._id)),
    ...matchingRules.map((row) => String(row._id)),
  ];
}

function chunksForActiveDocuments(companyId, documentIds) {
  return GovernanceChunk.find({
    company_id: String(companyId),
    document_id: { $in: documentIds },
  });
}

/**
 * @param {string} companyId
 * @param {string} query
 * @param {{ topK?: number, eventType?: string }} [opts]
 */
export async function retrieveRelevantChunks(companyId, query, opts = {}) {
  const topK = Number.isFinite(opts.topK) ? opts.topK : DEFAULT_TOP_K;
  const queryTokens = tokenize(query);
  const documentIds = await activeGovernanceDocumentIds(companyId, { eventType: opts.eventType });
  if (documentIds.length === 0) return [];
  const chunks = await chunksForActiveDocuments(companyId, documentIds).lean();

  const scored = chunks.map((chunk) => {
    let s = scoreChunk(queryTokens, `${chunk.name} ${chunk.text}`);
    if (opts.eventType && String(chunk.text).includes(opts.eventType)) {
      s += 0.15;
    }
    return { ...chunk, score: s };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.filter((c) => c.score > 0).slice(0, topK);
}

/**
 * Load indexed chunks for active policies and active rules only.
 * Pass eventType so rules that do not match this event are omitted.
 */
export async function retrieveAllGovernanceChunks(companyId, { maxChunks = 40, eventType } = {}) {
  const documentIds = await activeGovernanceDocumentIds(companyId, { eventType });
  if (documentIds.length === 0) return [];
  return chunksForActiveDocuments(companyId, documentIds)
    .sort({ document_type: 1, name: 1 })
    .limit(maxChunks)
    .lean();
}
