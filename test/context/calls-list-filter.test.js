/**
 * Calls list tool must match the web Calls API filter shape.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const callsPath = join(__dirname, '../../src/mcp/tools/calls.js');

describe('calls list tool API contract', () => {
  it('filters by started_at BETWEEN with array dates (not created_at comma string)', () => {
    const src = readFileSync(callsPath, 'utf8');
    assert.ok(src.includes("db_attribute: 'started_at'"));
    assert.ok(src.includes("operator: 'BETWEEN'"));
    assert.ok(src.includes('value: [start, end]'));
    assert.ok(src.includes('started_from'));
    assert.ok(src.includes('started_to'));
    assert.ok(src.includes('/livekit/voice-agent/session-report/list'));
    // Must not send the broken created_at "from,to" string form
    assert.ok(!src.includes("db_attribute: 'created_at'"));
    assert.ok(!src.includes('value: `${from},${to}`'));
  });

  it('supports status and outcome advance filters', () => {
    const src = readFileSync(callsPath, 'utf8');
    assert.ok(src.includes("db_attribute: 'status'"));
    assert.ok(src.includes("db_attribute: 'outcome'"));
  });
});
