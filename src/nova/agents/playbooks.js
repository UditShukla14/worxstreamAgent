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
  for (const extra of DOMAIN_EXTRAS[key] || []) {
    const extraPath = join(PLAYBOOK_DIR, extra);
    if (existsSync(extraPath)) {
      text = `${text}\n\n${readFileSync(extraPath, 'utf8').trim()}`;
    }
  }
  cache.set(key, text);
  return text;
}

export function appendPlaybookToPrompt(systemPrompt, domain) {
  const playbook = getPlaybookForDomain(domain);
  if (!playbook) return systemPrompt;
  return `${systemPrompt}\n\n[Domain playbook]\n${playbook}`;
}
