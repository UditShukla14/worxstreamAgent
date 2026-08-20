/**
 * Optional lexical index of policy/rule text. Aegis evaluation does not
 * retrieve these chunks — it uses the persistent catalog context. Indexing
 * still runs on save so leftover inactive text can be dropped.
 */

import GovernanceChunk from '../models/GovernanceChunk.js';

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
