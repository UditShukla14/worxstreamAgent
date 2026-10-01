/**
 * Domain playbooks — workflow knowledge injected into specialist prompts.
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// src/nova/agents → repo docs/playbooks
const PLAYBOOK_DIR = join(__dirname, '../../../docs/playbooks');

const cache = new Map();

const DOMAIN_FILES = {
  estimate: 'estimate.md',
  invoice: 'invoice.md',
  customer: 'customer.md',
  workflow: 'workflow.md',
  reports: 'reports.md',
};

/** Extra markdown fragments loaded after the domain playbook (e.g. chart XML). */
const DOMAIN_EXTRAS = {
  reports: ['reports-charts.md'],
};

/**
 * @returns {string[]}
 */
export function listPlaybookDomains() {
  return Object.keys(DOMAIN_FILES);
}

/**
 * @param {string|null|undefined} domain
 * @returns {string}
 */
export function getPlaybookForDomain(domain) {
  const key = String(domain || '').toLowerCase();
  if (!key || !DOMAIN_FILES[key]) return '';
  if (cache.has(key)) return cache.get(key);

  const path = join(PLAYBOOK_DIR, DOMAIN_FILES[key]);
  if (!existsSync(path)) {
    cache.set(key, '');
    return '';
  }
  let text = readFileSync(path, 'utf8').trim();
  const extras = getPlaybookExtrasFragment(key);
  if (extras) {
    text = `${text}\n\n${extras}`;
  }
  cache.set(key, text);
  return text;
}

/**
 * Load DOMAIN_EXTRAS only (e.g. chart/table XML for orchestrator Nova).
 * @param {string|null|undefined} domain
 * @returns {string}
 */
export function getPlaybookExtrasFragment(domain) {
  const key = String(domain || '').toLowerCase();
  const extras = DOMAIN_EXTRAS[key];
  if (!extras?.length) return '';
  const cacheKey = `extras:${key}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);
  const parts = [];
  for (const extra of extras) {
    const extraPath = join(PLAYBOOK_DIR, extra);
    if (existsSync(extraPath)) {
      parts.push(readFileSync(extraPath, 'utf8').trim());
    }
  }
  const text = parts.join('\n\n');
  cache.set(cacheKey, text);
  return text;
}

export function appendPlaybookToPrompt(systemPrompt, domain) {
  const playbook = getPlaybookForDomain(domain);
  if (!playbook) return systemPrompt;
  return `${systemPrompt}\n\n[Domain playbook]\n${playbook}`;
}
