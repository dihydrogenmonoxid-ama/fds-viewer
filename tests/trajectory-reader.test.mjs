import assert from 'node:assert';
import fs from 'node:fs';

// Load the non-module global into scope.
const src = fs.readFileSync(new URL('../js/trajectory-reader.js', import.meta.url), 'utf8');
const sandbox = { THREE: {} };
new Function('globalThis', src + '\nglobalThis.__buildTrajectoryDataset = buildTrajectoryDataset;')(sandbox);
const build = sandbox.__buildTrajectoryDataset;

const meta = { fps: 10, xmin: 0, xmax: 30, ymin: 0, ymax: 13 };
const traj = [
  { frame: 0, id: 1, pos_x: 1, pos_y: 2, ori_x: 1, ori_y: 0 },
  { frame: 0, id: 2, pos_x: 3, pos_y: 4, ori_x: 0, ori_y: 1 },
  { frame: 10, id: 1, pos_x: 5, pos_y: 6, ori_x: 1, ori_y: 0 },
];
const scalars = [
  { frame: 0, id: 1, fed: 0.1, speed: 1.2 },
  { frame: 0, id: 2, fed: 0.2, speed: 0.6 },
  { frame: 10, id: 1, fed: 0.3, speed: 0.9 },
];

const ds = build(meta, traj, scalars);

assert.deepStrictEqual(ds.frames.map(f => f.time), [0, 1]);
assert.strictEqual(ds.frames[0].count, 2);
assert.strictEqual(ds.frames[1].count, 1);
assert.deepStrictEqual(ds.quantities.sort(), ['fed', 'speed']);

const f0 = ds.frames[0];
const i = f0.ids.indexOf(1);
assert.strictEqual(f0.fed[i], 0.1);
assert.strictEqual(f0.speed[i], 1.2);

assert.deepStrictEqual(ds.timeRange, [0, 1]);
assert.strictEqual(ds.frameIndexAtTime(-5), 0);
assert.strictEqual(ds.frameIndexAtTime(0.4), 0);
assert.strictEqual(ds.frameIndexAtTime(0.6), 1);
assert.strictEqual(ds.frameIndexAtTime(99), 1);

const ds2 = build(meta, traj, []);
assert.deepStrictEqual(ds2.quantities, ['speed']);
assert.ok(Number.isFinite(ds2.frames[1].speed[0]));

// derived-speed fallback (no agent_scalars): exact values + edge cases
assert.deepStrictEqual(ds2.frames[0].speed, [0, 0]); // first frame -> 0
assert.ok(Math.abs(ds2.frames[1].speed[0] - Math.hypot(4, 4)) < 1e-9); // moved (4,4) over dt=1

const trajGap = [
  { frame: 0, id: 1, pos_x: 0, pos_y: 0, ori_x: 1, ori_y: 0 },
  { frame: 10, id: 1, pos_x: 0, pos_y: 0, ori_x: 1, ori_y: 0 },
  { frame: 10, id: 9, pos_x: 0, pos_y: 0, ori_x: 1, ori_y: 0 },
];
const dsGap = build(meta, trajGap, []);
const frGap = dsGap.frames[1];
assert.strictEqual(frGap.speed[frGap.ids.indexOf(1)], 0); // present but didn't move
assert.strictEqual(frGap.speed[frGap.ids.indexOf(9)], 0); // absent in previous frame

console.log('trajectory-reader: all assertions passed');
