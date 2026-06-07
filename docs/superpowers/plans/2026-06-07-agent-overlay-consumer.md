# Agent Overlay (fds-viewer consumer) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Render JuPedSim agents from a `.sqlite` as a persistent 3D overlay in fds-viewer, coloured by FED or speed, time-synced to the FDS smoke on one clock.

**Architecture:** Mirror fds-viewer's existing `reader → overlay → output-page wiring` pattern. A pure dataset builder (unit-testable in bun) + a thin sql.js loader; a Three.js `InstancedMesh` overlay driven by **time** (`setTime(t)`), not frame index; an "Agents" panel and a `syncAgents()` hook so agents always show the same simulation second as the active smoke/slice/boundary overlay.

**Tech stack:** Vanilla JS, global `<script>` tags (no build, no ES modules), Three.js r128 (CDN), sql.js 1.10.3 (CDN, WASM). No package.json / no JS unit framework — pure logic is tested with ad-hoc **bun** scripts; DOM/WebGL is verified in a headed browser.

**Branch:** `feat/agent-overlay` on remote `chraibi` (`PedestrianDynamics/fds-viewer`). Open the PR against `origin` (`ProfRino/fds-viewer`).

**Producer contract (already shipped in pyFDS-Evac):** the sqlite has JuPedSim `metadata` (`fps`, `xmin/xmax/ymin/ymax`), `trajectory_data(frame, id, pos_x, pos_y, ori_x, ori_y)`, and an optional `agent_scalars(frame, id, fed, speed)` (one row per `(frame,id)`). Coordinates are in FDS world units (same domain as the mesh).

**Coordinate transform (copy from existing overlays):** `function fdsToScene(x, y, z) { return new THREE.Vector3(x, z, y); }`. Agents map `(pos_x, pos_y)` at standing height `h` → `fdsToScene(pos_x, pos_y, h)`.

**Demo fixture for verification:** generate `demo4.sqlite` in the pyFDS-Evac repo with `--output-sqlite demo4.sqlite --output-fed-history fed.csv` plus FDS smoke under `fds_data/demo/` (already used in prior testing).

---

### Task 1: `trajectory-reader.js` — pure dataset builder (TDD)

Separate the testable transform (rows → frames) from sql.js I/O.

**Files:**
- Create: `js/trajectory-reader.js`
- Test: `tests/trajectory-reader.test.mjs`

- [ ] **Step 1: Write the failing test** — create `tests/trajectory-reader.test.mjs`:

```js
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

// frames grouped by frame, ordered, with time = frame / fps
assert.deepStrictEqual(ds.frames.map(f => f.time), [0, 1]);
assert.strictEqual(ds.frames[0].count, 2);
assert.strictEqual(ds.frames[1].count, 1);

// quantities present because agent_scalars supplied
assert.deepStrictEqual(ds.quantities.sort(), ['fed', 'speed']);

// scalar join: frame 0 / id 1 fed=0.1 speed=1.2
const f0 = ds.frames[0];
const i = f0.ids.indexOf(1);
assert.strictEqual(f0.fed[i], 0.1);
assert.strictEqual(f0.speed[i], 1.2);

// timeRange + nearest-frame-by-time (hold/clamp at ends)
assert.deepStrictEqual(ds.timeRange, [0, 1]);
assert.strictEqual(ds.frameIndexAtTime(-5), 0);   // clamp low
assert.strictEqual(ds.frameIndexAtTime(0.4), 0);  // nearest
assert.strictEqual(ds.frameIndexAtTime(0.6), 1);  // nearest
assert.strictEqual(ds.frameIndexAtTime(99), 1);   // clamp high

// without agent_scalars: speed derived, fed absent
const ds2 = build(meta, traj, []);
assert.deepStrictEqual(ds2.quantities, ['speed']);
assert.ok(Number.isFinite(ds2.frames[1].speed[0]));

console.log('trajectory-reader: all assertions passed');
```

- [ ] **Step 2: Run it, expect failure** — `bun tests/trajectory-reader.test.mjs` → fails (`buildTrajectoryDataset is not defined`).

- [ ] **Step 3: Implement** — create `js/trajectory-reader.js`:

```js
/* Reads a JuPedSim trajectory sqlite (+ optional agent_scalars) into a
 * frame-indexed dataset for the agent overlay. The pure builder is separated
 * from sql.js I/O so it can be unit-tested without WASM.
 *
 * Base JuPedSim schema is read-only; agent_scalars is optional. See the
 * pyFDS-Evac producer contract.
 */
(function (global) {
    'use strict';

    // Group flat (frame,id,...) rows into per-frame columnar records.
    function buildTrajectoryDataset(meta, trajRows, scalarRows) {
        const fps = Number(meta.fps) || 1;
        const byFrame = new Map();
        for (const r of trajRows) {
            let f = byFrame.get(r.frame);
            if (!f) {
                f = { frame: r.frame, time: r.frame / fps, ids: [], x: [], y: [], orix: [], oriy: [] };
                byFrame.set(r.frame, f);
            }
            f.ids.push(r.id);
            f.x.push(r.pos_x);
            f.y.push(r.pos_y);
            f.orix.push(r.ori_x);
            f.oriy.push(r.ori_y);
        }

        const frames = Array.from(byFrame.values()).sort((a, b) => a.frame - b.frame);
        for (const f of frames) f.count = f.ids.length;

        const hasScalars = scalarRows && scalarRows.length > 0;
        const scalarKey = (frame, id) => frame + ':' + id;
        const fedByKey = new Map();
        const speedByKey = new Map();
        if (hasScalars) {
            for (const s of scalarRows) {
                fedByKey.set(scalarKey(s.frame, s.id), s.fed);
                speedByKey.set(scalarKey(s.frame, s.id), s.speed);
            }
        }

        for (let fi = 0; fi < frames.length; fi++) {
            const f = frames[fi];
            f.speed = new Array(f.count);
            if (hasScalars) f.fed = new Array(f.count);
            for (let i = 0; i < f.count; i++) {
                const k = scalarKey(f.frame, f.ids[i]);
                if (hasScalars && speedByKey.has(k)) {
                    f.speed[i] = speedByKey.get(k);
                    f.fed[i] = fedByKey.get(k);
                } else {
                    f.speed[i] = derivedSpeed(frames, fi, i, fps);
                    if (hasScalars) f.fed[i] = 0;
                }
            }
        }

        const quantities = hasScalars ? ['fed', 'speed'] : ['speed'];
        const timeRange = frames.length ? [frames[0].time, frames[frames.length - 1].time] : [0, 0];

        function frameIndexAtTime(t) {
            if (!frames.length) return 0;
            if (t <= frames[0].time) return 0;
            if (t >= frames[frames.length - 1].time) return frames.length - 1;
            // binary search nearest
            let lo = 0, hi = frames.length - 1;
            while (hi - lo > 1) {
                const mid = (lo + hi) >> 1;
                if (frames[mid].time <= t) lo = mid; else hi = mid;
            }
            return (t - frames[lo].time) <= (frames[hi].time - t) ? lo : hi;
        }

        return {
            fps, meta, frames, quantities, timeRange, frameIndexAtTime,
            bounds: { xmin: +meta.xmin, xmax: +meta.xmax, ymin: +meta.ymin, ymax: +meta.ymax },
        };
    }

    // Per-agent speed from successive positions when agent_scalars is absent.
    function derivedSpeed(frames, fi, i, fps) {
        const id = frames[fi].ids[i];
        const prev = fi > 0 ? frames[fi - 1] : null;
        if (!prev) return 0;
        const j = prev.ids.indexOf(id);
        if (j < 0) return 0;
        const dt = frames[fi].time - prev.time;
        if (dt <= 0) return 0;
        const dx = frames[fi].x[i] - prev.x[j];
        const dy = frames[fi].y[i] - prev.y[j];
        return Math.hypot(dx, dy) / dt;
    }

    // Thin sql.js loader (browser only). Returns a dataset or throws.
    async function loadTrajectorySqlite(arrayBuffer) {
        if (typeof initSqlJs !== 'function') {
            throw new Error('sql.js (initSqlJs) not loaded');
        }
        const SQL = await initSqlJs({
            locateFile: (f) => 'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/' + f,
        });
        const db = new SQL.Database(new Uint8Array(arrayBuffer));
        try {
            const meta = {};
            for (const row of queryAll(db, 'SELECT key, value FROM metadata')) {
                meta[row.key] = row.value;
            }
            const trajRows = queryAll(db,
                'SELECT frame, id, pos_x, pos_y, ori_x, ori_y FROM trajectory_data ORDER BY frame, id');
            let scalarRows = [];
            if (tableExists(db, 'agent_scalars')) {
                scalarRows = queryAll(db, 'SELECT frame, id, fed, speed FROM agent_scalars');
            }
            return buildTrajectoryDataset(meta, trajRows, scalarRows);
        } finally {
            db.close();
        }
    }

    function tableExists(db, name) {
        const r = db.exec(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='" + name + "'");
        return r.length > 0 && r[0].values.length > 0;
    }

    function queryAll(db, sql) {
        const res = db.exec(sql);
        if (!res.length) return [];
        const cols = res[0].columns;
        return res[0].values.map((v) => {
            const o = {};
            for (let i = 0; i < cols.length; i++) o[cols[i]] = v[i];
            return o;
        });
    }

    global.buildTrajectoryDataset = buildTrajectoryDataset;
    global.loadTrajectorySqlite = loadTrajectorySqlite;
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 4: Run the test** — `bun tests/trajectory-reader.test.mjs` → prints `trajectory-reader: all assertions passed`.

- [ ] **Step 5: Commit:**
```bash
git add js/trajectory-reader.js tests/trajectory-reader.test.mjs
git commit -m "feat(output): trajectory sqlite reader (pure builder + sql.js loader)"
```

---

### Task 2: `agent-overlay.js` — Three.js instanced agents (TDD for pure parts)

**Files:**
- Create: `js/agent-overlay.js`
- Test: `tests/agent-overlay.test.mjs`

The colormap + time→frame selection are pure and tested; the Three.js mesh build is browser-verified in Task 5.

- [ ] **Step 1: Write the failing test** — create `tests/agent-overlay.test.mjs`:

```js
import assert from 'node:assert';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../js/agent-overlay.js', import.meta.url), 'utf8');
const sandbox = {};
new Function('globalThis', src
  + '\nglobalThis.__colorForValue = colorForValue;'
  + '\nglobalThis.__normalize = normalizeQuantity;')(sandbox);

// FED colormap: 0 -> green-ish, >=1 -> red; clamps.
const c0 = sandbox.__colorForValue(0, 'fed');
const c1 = sandbox.__colorForValue(1, 'fed');
assert.ok(c1.r > c0.r, 'fed=1 redder than fed=0');
const cHi = sandbox.__colorForValue(5, 'fed');
assert.deepStrictEqual(cHi, sandbox.__colorForValue(1, 'fed'), 'fed clamps at 1');

// normalizeQuantity maps value to 0..1 for the active quantity range
assert.strictEqual(sandbox.__normalize(0, 'fed'), 0);
assert.strictEqual(sandbox.__normalize(1, 'fed'), 1);
assert.strictEqual(sandbox.__normalize(0, 'speed'), 0);
assert.ok(sandbox.__normalize(1.5, 'speed') <= 1);

console.log('agent-overlay: all assertions passed');
```

- [ ] **Step 2: Run it, expect failure** — `bun tests/agent-overlay.test.mjs` → fails.

- [ ] **Step 3: Implement** — create `js/agent-overlay.js`:

```js
/* Persistent 3D overlay of JuPedSim agents, coloured by FED or speed and
 * driven by simulation time (setTime) so it stays in lockstep with the smoke
 * clock. Mirrors the Smoke3DOverlay interface (group, setVisible, currentTime,
 * dispose). Three.js r128 globals.
 */
(function (global) {
    'use strict';

    function fdsToScene(x, y, z) { return new THREE.Vector3(x, z, y); }

    const QUANTITY_RANGE = { fed: [0, 1], speed: [0, 1.5] };

    function normalizeQuantity(value, quantity) {
        const [lo, hi] = QUANTITY_RANGE[quantity] || [0, 1];
        if (hi <= lo) return 0;
        const t = (value - lo) / (hi - lo);
        return t < 0 ? 0 : t > 1 ? 1 : t;
    }

    // green (low) -> yellow -> red (high). Returns {r,g,b} in 0..1.
    function colorForValue(value, quantity) {
        const t = normalizeQuantity(value, quantity);
        // 0 -> (0.2,0.8,0.2), 0.5 -> (0.95,0.9,0.2), 1 -> (0.9,0.15,0.15)
        const r = 0.2 + t * 0.7;
        const g = t < 0.5 ? 0.8 + t * 0.2 : 0.9 - (t - 0.5) * 1.5;
        const b = 0.2 - t * 0.05;
        return { r, g: g < 0 ? 0 : g, b: b < 0 ? 0 : b };
    }

    class AgentOverlay {
        constructor(scene) {
            this.scene = scene;
            this.group = new THREE.Group();
            this.group.name = 'agents';
            scene.add(this.group);
            this.dataset = null;
            this.mesh = null;
            this.frameIndex = 0;
            this.quantity = 'speed';
            this.height = 0.9;     // FDS Z standing height -> Three Y
            this.radius = 0.25;    // agent disc/sphere radius (m)
            this._color = new THREE.Color();
        }

        get activeFrames() { return this.dataset ? this.dataset.frames : []; }

        load(dataset) {
            this._disposeMesh();
            this.dataset = dataset;
            if (dataset.quantities.indexOf(this.quantity) < 0) {
                this.quantity = dataset.quantities[0];
            }
            const maxCount = dataset.frames.reduce((m, f) => Math.max(m, f.count), 0);
            const geo = new THREE.SphereGeometry(this.radius, 12, 8);
            const mat = new THREE.MeshLambertMaterial({ vertexColors: false });
            this.mesh = new THREE.InstancedMesh(geo, mat, Math.max(maxCount, 1));
            this.mesh.instanceColor = new THREE.InstancedBufferAttribute(
                new Float32Array(Math.max(maxCount, 1) * 3), 3);
            this.group.add(this.mesh);
            this.frameIndex = 0;
            this._renderFrame();
        }

        availableQuantities() { return this.dataset ? this.dataset.quantities : []; }

        setQuantity(q) {
            if (!this.dataset || this.dataset.quantities.indexOf(q) < 0) return;
            this.quantity = q;
            this._renderFrame();
        }

        setVisible(v) { this.group.visible = !!v; }
        setOpacity(a) { if (this.mesh) { this.mesh.material.transparent = a < 1; this.mesh.material.opacity = a; } }
        setHeight(h) { this.height = h; this._renderFrame(); }

        currentTime() {
            const f = this.activeFrames[this.frameIndex];
            return f ? f.time : 0;
        }

        // Drive by simulation time: render the frame nearest t (clamped).
        setTime(t) {
            if (!this.dataset) return;
            const idx = this.dataset.frameIndexAtTime(t);
            if (idx !== this.frameIndex) {
                this.frameIndex = idx;
                this._renderFrame();
            }
        }

        setFrame(idx) {
            if (!this.dataset) return;
            const n = this.dataset.frames.length;
            this.frameIndex = idx < 0 ? 0 : idx >= n ? n - 1 : idx;
            this._renderFrame();
        }

        _renderFrame() {
            if (!this.mesh || !this.dataset) return;
            const f = this.dataset.frames[this.frameIndex];
            const dummy = new THREE.Object3D();
            const values = this.quantity === 'fed' ? f.fed : f.speed;
            for (let i = 0; i < f.count; i++) {
                dummy.position.copy(fdsToScene(f.x[i], f.y[i], this.height));
                dummy.updateMatrix();
                this.mesh.setMatrixAt(i, dummy.matrix);
                const c = colorForValue(values ? values[i] : 0, this.quantity);
                this._color.setRGB(c.r, c.g, c.b);
                this.mesh.setColorAt(i, this._color);
            }
            // Hide unused instances by scaling to zero.
            const zero = new THREE.Object3D();
            zero.scale.set(0, 0, 0); zero.updateMatrix();
            for (let i = f.count; i < this.mesh.count; i++) this.mesh.setMatrixAt(i, zero.matrix);
            this.mesh.count = this.mesh.instanceMatrix.count; // keep buffer length
            this.mesh.instanceMatrix.needsUpdate = true;
            if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
        }

        _disposeMesh() {
            if (!this.mesh) return;
            this.group.remove(this.mesh);
            this.mesh.geometry.dispose();
            this.mesh.material.dispose();
            this.mesh = null;
        }

        dispose() {
            this._disposeMesh();
            this.scene.remove(this.group);
            this.dataset = null;
        }
    }

    global.AgentOverlay = AgentOverlay;
    global.colorForValue = colorForValue;
    global.normalizeQuantity = normalizeQuantity;
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 4: Run the test** — `bun tests/agent-overlay.test.mjs` → `agent-overlay: all assertions passed`.

- [ ] **Step 5: Commit:**
```bash
git add js/agent-overlay.js tests/agent-overlay.test.mjs
git commit -m "feat(output): agent overlay (instanced spheres, time-driven, FED/speed colour)"
```

---

### Task 3: HTML — load deps + add the Agents panel

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Add sql.js + the two new scripts.** After the Three.js controls scripts (`index.html:1169`) add:
```html
    <script src="https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/sql-wasm.js"></script>
```
And immediately before `<script src="js/output-page.js?...">` (`index.html:1184`) add:
```html
    <script src="js/trajectory-reader.js?v=20260607a"></script>
    <script src="js/agent-overlay.js?v=20260607a"></script>
```

- [ ] **Step 2: Add the Agents panel UI** in the Output page's data sidebar. Locate the DATA panel that holds the `Soot | Slice | Boundary` buttons and the smoke/slice/boundary panels. After the boundary panel's closing tag, insert:
```html
    <div id="output-agents-panel" class="output-subpanel">
      <h4>Agents</h4>
      <input type="file" id="output-agents-file" accept=".sqlite,.db" />
      <div id="output-agents-status">No trajectory loaded.</div>
      <label>Colour by
        <select id="output-agents-colorby">
          <option value="speed">Speed</option>
          <option value="fed">FED</option>
        </select>
      </label>
      <canvas id="output-agents-colorbar" width="160" height="14"></canvas>
      <label>Opacity
        <input type="range" id="output-agents-opacity" min="0.1" max="1" step="0.05" value="1" />
      </label>
      <div class="agents-playbar">
        <input type="range" id="output-agents-frame-slider" min="0" max="0" value="0" disabled />
        <span id="output-agents-time">0.000 s</span>
      </div>
    </div>
```
Agents are a persistent overlay, so this panel is always visible (not gated by `mode`). If layout requires, place it directly under the mode buttons so it sits alongside whichever mode panel is shown.

- [ ] **Step 3: Manual check** — open `index.html` in a browser; the Output page shows the Agents panel with a file input and Speed/FED dropdown. No console errors from the new scripts (sql.js loads lazily on first trajectory load).

- [ ] **Step 4: Commit:**
```bash
git add index.html
git commit -m "feat(output): load sql.js + agent scripts and add Agents panel UI"
```

---

### Task 4: `output-page.js` — wire the overlay, loading, and time-sync

**Files:**
- Modify: `js/output-page.js`

- [ ] **Step 1: Declare the overlay** near the other overlay vars (alongside `smokeOverlay`, `boundaryOverlay`, `sliceOverlay`, and `let mode = 'smoke'` at line 27):
```js
    let agentOverlay = null;
```

- [ ] **Step 2: Construct it where the scene/viewer is ready.** Where `smokeOverlay = new Smoke3DOverlay(...)` is created (output-page.js ~839), add:
```js
        if (!agentOverlay) agentOverlay = new AgentOverlay(viewer.scene);
```

- [ ] **Step 3: Add the time-sync helper + display-time accessor.** Add near the other helper functions:
```js
    // The simulation time currently shown by the active smoke/slice/boundary overlay.
    function activeDisplayTime() {
        if (mode === 'smoke' && smokeOverlay && smokeOverlay.activeFrames.length) return smokeOverlay.currentTime();
        if (mode === 'boundary' && boundaryOverlay && boundaryOverlay.activeFrames.length) return boundaryOverlay.currentTime();
        if (mode === 'slice' && sliceOverlay && currentDataset && currentDataset.frames.length) {
            return currentDataset.frames[sliceOverlay.frameIndex] ? currentDataset.frames[sliceOverlay.frameIndex].time : 0;
        }
        return null; // nothing time-bearing loaded
    }

    // Keep agents on the same simulation second as the active overlay.
    function syncAgents() {
        if (!agentOverlay || !agentOverlay.dataset) return;
        const t = activeDisplayTime();
        if (t !== null) agentOverlay.setTime(t);
    }
```

- [ ] **Step 4: Call `syncAgents()` after every master-bar / play update.** At the end of the `vpSlider` `input` handler (output-page.js ~772, after the if/else mode branches) add `syncAgents();`. In the playback tick (the `startPlayback` loop that advances `setFrame`), after the active overlay's frame is advanced, add `syncAgents();`. In the frame-status block (~344–364) where each mode updates the vp-slider, add `syncAgents();` at the end.

- [ ] **Step 5: Load a trajectory on file pick.** Add a handler for `#output-agents-file`:
```js
    const agentsFile = document.getElementById('output-agents-file');
    if (agentsFile) agentsFile.addEventListener('change', async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        const status = document.getElementById('output-agents-status');
        try {
            if (status) status.textContent = 'Loading ' + file.name + '…';
            const buf = await file.arrayBuffer();
            const ds = await loadTrajectorySqlite(buf);
            if (!agentOverlay) agentOverlay = new AgentOverlay(viewer.scene);
            agentOverlay.load(ds);
            populateAgentColorby(ds);
            wireAgentControls(ds);
            // Show agents at the current master time immediately (or t=0 if nothing else loaded).
            const t = activeDisplayTime();
            if (t !== null) agentOverlay.setTime(t); else agentOverlay.setFrame(0);
            drawAgentColorbar();
            if (status) status.textContent = file.name + ' — ' + ds.frames.length + ' frames, '
                + ds.frames.reduce((m, f) => Math.max(m, f.count), 0) + ' agents max';
        } catch (err) {
            if (status) status.textContent = 'Error: ' + err.message;
            if (typeof console !== 'undefined') console.error(err);
        }
    });
```

- [ ] **Step 6: Wire the agent controls (colour-by, opacity, standalone slider, colorbar).** Add:
```js
    function populateAgentColorby(ds) {
        const sel = document.getElementById('output-agents-colorby');
        if (!sel) return;
        const fedOpt = sel.querySelector('option[value="fed"]');
        if (fedOpt) fedOpt.disabled = ds.quantities.indexOf('fed') < 0;
        if (ds.quantities.indexOf(sel.value) < 0) sel.value = ds.quantities[0];
        agentOverlay.setQuantity(sel.value);
    }

    function wireAgentControls(ds) {
        const sel = document.getElementById('output-agents-colorby');
        if (sel && !sel._wired) {
            sel._wired = true;
            sel.addEventListener('change', () => { agentOverlay.setQuantity(sel.value); drawAgentColorbar(); });
        }
        const op = document.getElementById('output-agents-opacity');
        if (op && !op._wired) {
            op._wired = true;
            op.addEventListener('input', () => agentOverlay.setOpacity(parseFloat(op.value)));
        }
        // Standalone agent slider: used when no smoke/slice/boundary provides the clock.
        const slider = document.getElementById('output-agents-frame-slider');
        const tlabel = document.getElementById('output-agents-time');
        if (slider) {
            slider.min = 0; slider.max = Math.max(0, ds.frames.length - 1);
            slider.value = agentOverlay.frameIndex; slider.disabled = ds.frames.length <= 1;
            if (!slider._wired) {
                slider._wired = true;
                slider.addEventListener('input', () => {
                    agentOverlay.setFrame(parseInt(slider.value, 10) || 0);
                    if (tlabel) tlabel.textContent = agentOverlay.currentTime().toFixed(3) + ' s';
                });
            }
        }
    }

    function drawAgentColorbar() {
        const cv = document.getElementById('output-agents-colorbar');
        if (!cv || !agentOverlay || !agentOverlay.dataset) return;
        const ctx = cv.getContext('2d');
        const q = agentOverlay.quantity;
        const range = q === 'fed' ? [0, 1] : [0, 1.5];
        for (let px = 0; px < cv.width; px++) {
            const val = range[0] + (range[1] - range[0]) * (px / (cv.width - 1));
            const c = colorForValue(val, q);
            ctx.fillStyle = 'rgb(' + (c.r * 255 | 0) + ',' + (c.g * 255 | 0) + ',' + (c.b * 255 | 0) + ')';
            ctx.fillRect(px, 0, 1, cv.height);
        }
    }
```
Also: when the agent overlay is driven by the master clock (`syncAgents()`), update the standalone slider + time label to follow. Append to `syncAgents()`:
```js
        const slider = document.getElementById('output-agents-frame-slider');
        const tlabel = document.getElementById('output-agents-time');
        if (slider) slider.value = agentOverlay.frameIndex;
        if (tlabel) tlabel.textContent = agentOverlay.currentTime().toFixed(3) + ' s';
```

- [ ] **Step 7: Browser smoke check** — `python3 -m http.server` in the repo, open the Output page, load a `demo4.sqlite`; agents appear, the status shows frame/agent counts, no console errors. (Full sync verification is Task 5.)

- [ ] **Step 8: Commit:**
```bash
git add js/output-page.js
git commit -m "feat(output): wire agent overlay, sqlite loading, and time-sync to the smoke clock"
```

---

### Task 5: Time-sync + render verification (headed browser)

**Files:** none (verification only). Use the gstack `browse` tooling in headed mode (real WebGL).

- [ ] **Step 1: Build fixtures.** In the pyFDS-Evac repo, produce `demo4.sqlite` (with `agent_scalars`) and ensure `fds_data/demo/` has the smoke `.s3d` + `.smv` + `.fds`. Stage the FDS folder + sqlite so the viewer can load both.

- [ ] **Step 2: Load smoke + trajectory, scrub to a mid time.** Drive the headed browser: open the Output page, load the FDS smoke folder, load `demo4.sqlite`, set the master play-bar to a mid frame.

- [ ] **Step 3: Assert the clocks match.** Read `#output-vp-time` (smoke) and `#output-agents-time` (agents); assert they are equal to within one agent frame period (≤ 0.1 s). This is the hard requirement: never smoke@100 s with agents@0 s.

- [ ] **Step 4: Visual check.** Screenshot; confirm coloured agent spheres sit on the floor inside the corridor, overlapping the smoke region, and move when the timebar moves. Toggle colour-by Speed↔FED and confirm the colorbar + agent colours change.

- [ ] **Step 5: Edge clamp.** Scrub the smoke beyond the agents' end time (agents evacuate before smoke ends); confirm agents hold their last frame (no jump to frame 0, no desync).

- [ ] **Step 6: Record the result** in the PR description (screenshots + the matched time readouts).

---

### Task 6: Docs + PR

**Files:**
- Modify: `README.md` (fds-viewer)
- Modify: `docs/superpowers/specs/2026-06-07-fds-viewer-agent-overlay-design.md` (mark Status: implemented)

- [ ] **Step 1: README** — add an "Agents (JuPedSim trajectories)" subsection under the Output documentation: load a `.sqlite` with `trajectory_data` (+ optional `agent_scalars`), colour by Speed or FED, agents render over the smoke on a shared clock. Note the producer: pyFDS-Evac `--output-sqlite`.

- [ ] **Step 2: Spec status** — change the spec's `Status:` line to `implemented`.

- [ ] **Step 3: Commit + push + PR:**
```bash
git add README.md docs/superpowers/specs/2026-06-07-fds-viewer-agent-overlay-design.md
git commit -m "docs: document agent overlay (JuPedSim trajectories) in fds-viewer"
git push chraibi feat/agent-overlay
gh pr create --repo ProfRino/fds-viewer --base main --head PedestrianDynamics:feat/agent-overlay \
  --title "Agent overlay: render JuPedSim trajectories over FDS smoke" \
  --body "Adds an optional 3D agent overlay (sql.js reader + instanced overlay) coloured by speed/FED, time-synced to the smoke clock. Reads JuPedSim trajectory sqlite with an optional agent_scalars(frame,id,fed,speed) table. See docs/superpowers/specs."
```

---

## Self-Review

- **Spec coverage:** reader/sql.js (Task 1), instanced overlay + FED/speed colour (Task 2), deps + panel (Task 3), persistent overlay + loading + **time-sync on one clock** (Task 4), the hard time-match requirement + clamp-at-ends (Task 5), docs + PR to upstream via the `chraibi` fork (Task 6). Coordinate transform `fdsToScene(x,y,z)→(x,z,y)` used in Task 2.
- **Placeholders:** none — full code for reader + overlay; concrete diffs/anchors for HTML + output-page; explicit browser-verification assertions.
- **Type/name consistency:** `buildTrajectoryDataset`/`loadTrajectorySqlite` (Task 1) used in Task 4; `AgentOverlay` with `load/setTime/setFrame/setQuantity/setOpacity/currentTime/activeFrames/dataset/frameIndex` consistent across Tasks 2 and 4; `colorForValue` reused by the colorbar in Task 4; element ids (`output-agents-file/-colorby/-opacity/-frame-slider/-time/-colorbar/-status`) consistent between Task 3 and Task 4.

## Risks / notes

- **No JS unit harness:** overlay rendering + DOM wiring are browser-verified (Task 5), not unit-tested. Pure logic (reader builder, colormap, nearest-frame) is bun-tested.
- **`output-page.js` anchors** (smoke overlay construction ~839, vpSlider handler ~748, status block ~344) may shift; locate by the surrounding code shown, not by line number.
- **Standalone vs synced control:** when smoke/slice/boundary is loaded, the master bar is the clock and agents follow (`syncAgents`); when only a trajectory is loaded, the Agents panel slider drives agent time directly.
- **sql.js WASM** loads from CDN on first trajectory open; offline use would need a vendored copy (out of scope for v1).
