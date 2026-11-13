import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.WORXSTREAM_BASE_URL ||= 'http://localhost';
process.env.ANTHROPIC_API_KEY ||= 'sk-test';

const { resolveTaskModelMap, DEFAULT_TASK_MODELS } = await import('../../src/analytics/taskModels.js');

describe('model tier resolution', () => {
  it('uses the company model over a personal preference', () => {
    const map = resolveTaskModelMap({ medium: 'company-model' }, { medium: 'personal-model' });
    assert.equal(map.medium, 'company-model');
  });

  it('falls back to a personal preference only where the company set nothing', () => {
    const map = resolveTaskModelMap({ medium: 'company-model' }, { daily: 'personal-daily' });
    assert.equal(map.daily, 'personal-daily');
    assert.equal(map.medium, 'company-model');
  });

  it('falls back to the platform default', () => {
    assert.deepEqual(resolveTaskModelMap({}, {}), { ...DEFAULT_TASK_MODELS });
  });
});
