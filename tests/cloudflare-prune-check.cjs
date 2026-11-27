const assert = require('node:assert/strict');
const { selectDeployments } = require('../scripts/cloudflare-prune-deployments.cjs');

const list = [
  { id: 'current', environment: 'production', created_on: '2026-11-27T12:00:00Z' },
  { id: 'previous', environment: 'production', created_on: '2026-11-27T11:00:00Z' },
  { id: 'old', environment: 'production', created_on: '2026-11-27T10:00:00Z' },
  { id: 'preview', environment: 'preview', created_on: '2026-11-27T13:00:00Z' },
];

assert.deepEqual(selectDeployments(list, 2).map((deployment) => deployment.id).sort(), ['old', 'preview']);
assert.deepEqual(selectDeployments(list.slice(0, 2), 2), []);
assert.deepEqual(selectDeployments(list.slice(0, 2), 1).map((deployment) => deployment.id), ['previous']);
assert.deepEqual(selectDeployments([], 2), []);
assert.deepEqual(selectDeployments([...list].reverse(), 2).map((deployment) => deployment.id).sort(), ['old', 'preview']);

console.log('Cloudflare prune checks passed: keep two newest production, remove older and preview deployments.');
