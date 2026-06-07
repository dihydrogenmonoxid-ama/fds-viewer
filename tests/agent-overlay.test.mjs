import assert from 'node:assert';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../js/agent-overlay.js', import.meta.url), 'utf8');
const sandbox = {};
new Function('globalThis', src
  + '\nglobalThis.__colorForValue = colorForValue;'
  + '\nglobalThis.__normalize = normalizeQuantity;')(sandbox);

const c0 = sandbox.__colorForValue(0, 'fed');
const c1 = sandbox.__colorForValue(1, 'fed');
assert.ok(c1.r > c0.r, 'fed=1 redder than fed=0');
const cHi = sandbox.__colorForValue(5, 'fed');
assert.deepStrictEqual(cHi, sandbox.__colorForValue(1, 'fed'), 'fed clamps at 1');

assert.strictEqual(sandbox.__normalize(0, 'fed'), 0);
assert.strictEqual(sandbox.__normalize(1, 'fed'), 1);
assert.strictEqual(sandbox.__normalize(0, 'speed'), 0);
assert.ok(sandbox.__normalize(1.5, 'speed') <= 1);

console.log('agent-overlay: all assertions passed');
