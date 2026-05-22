# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

FDS Viewer is a **zero-build, zero-dependency, pure client-side** browser app for viewing Fire Dynamics Simulator (FDS) input files and simulation outputs. There is no package manager, no bundler, no `node_modules`. Every JS file is a plain script loaded via `<script src="...">` tags in `index.html`.

The only external dependency is **Three.js r128** loaded from public CDNs. All other code is vanilla JS.

## Running the app

**Option A (normal use):** Just open `index.html` directly in a browser. Works offline from `file://`. Drag-and-drop, Open File, and Load Sample all function without a server.

**Option B (for `?file=` URL params):** Run a local server, since `fetch()` is blocked on `file://`:
```
python -m http.server 8765
```
Then open `http://localhost:8765/`. On Windows, double-click `serve.bat`.

## Running tests

The only test suite is for the FDS linter. Run it with Node.js (no install needed):
```
node test-linter.js
```
This loads `js/fds-linter.js` via Node's `vm` module, generates ~1000 test cases across all 54 linter rules, and reports `[PASS]`/`[FAIL]` for each.

## Architecture

### Script loading order (index.html)
The load order in `index.html` is significant — each script attaches globals that later ones depend on:
1. `sample-data.js` — embeds a hardcoded FDS file string as `SAMPLE_FDS_TEXT`
2. `fds-parser.js` — defines `FDSParser` class
3. `viewer.js` — defines `FDSViewer` class (Three.js scene, Walk mode, clipping)
4. `fds-linter.js` — defines `fdsLint(text)` function (67 rules)
5. `fire-panel.js` — defines `buildFirePanel(data)`, `buildMeshPanel(data)`, `buildCodePanel(text, filename)`, `highlightFds(text)`
6. `mesh-panel.js` — defines `buildMeshPanel(data)`
7. `slice-reader.js` / `slice-renderer.js` — `.sf` binary reader and WebGL2 overlay
8. `smoke3d-reader.js` / `smoke3d-overlay.js` — `.s3d` binary reader and volume ray-march overlay
9. `boundary-reader.js` / `boundary-overlay.js` — `.bf` binary reader and surface patch overlay
10. `fds-out-parser.js` — defines `parseFdsOut(outText, fdsText)` → `{ findings, summary }`
11. `charts-panel.js` — defines `buildChartsPanel()`, `chartsPanelHandleFiles(files)`
12. `output-page.js` — wires together the Output tab (all three overlay types + second viewer instance)
13. `app.js` — top-level event wiring, page tabs, file loading, theme, URL params

### Cache-busting
Script tags use `?v=YYYYMMDD<letter>` query strings for cache-busting (e.g. `?v=20260520G`). Bump the version string whenever you change a JS file.

### Page structure
The app has seven tabs. All panels except the 3D viewer and Output are plain HTML `<div>` elements that are shown/hidden by `app.js` when the tab buttons are clicked:
- **3D Geometry** (`#viewer-container` inside `#app-layout`) — Three.js canvas, sidebar with layers/opacity/views/walk mode/clip panel
- **Mesh** (`#mesh-panel`) — rendered by `buildMeshPanel(data)`
- **Fire & Combustion** (`#fire-panel`) — rendered by `buildFirePanel(data)`
- **Code** (`#fds-code-panel`) — syntax-highlighted source, static linter (⚡ Linter button), `.out` log viewer (Load .out button), in-browser edit
- **Charts** (`#charts-panel`) — CSV time-series plotter; managed by `charts-panel.js`
- **Output** (`#output-panel`) — second Three.js viewer + soot/slice/boundary overlays; managed entirely by `output-page.js`
- **Help** (`#help-panel`) — static multi-page user guide in `index.html`

### Data flow
1. User drops/opens a `.fds` file → `app.js` reads it as text
2. `FDSParser.parse(text)` returns a structured object with `meshes`, `obsts`, `vents`, `holes`, `surfs`, `devcs`, `geoms`, `hvacs`, `zones`, `slcfs`, `reacs`, `matls`, `ramps`, etc.
3. `FDSViewer.loadData(data)` builds the Three.js scene from that object
4. `buildCodePanel(text, filename)` populates the Code tab (syntax highlight + linter on demand via ⚡ Linter button)
5. `buildMeshPanel(data)` and `buildFirePanel(data)` populate their respective panels
6. Output overlays (`smoke3d-overlay.js`, `slice-renderer.js`, `boundary-overlay.js`) are independent — they load binary simulation output files directly and render on top of the Output tab's viewer instance
7. `.out` log: user clicks "Load .out" in the Code tab → `parseFdsOut(outText, fdsText)` maps runtime errors back to source lines

### Output overlay rendering
All three output overlay types use **WebGL2** directly (not Three.js). They each manage their own WebGL program and share the scene's depth buffer when "Solid-aware" rendering is selected. The `output-page.js` module coordinates which overlay is active and owns the playback timeline.

### FDS linter (`fds-linter.js`)
Exposes a single function `fdsLint(text)` that returns an array of finding objects `{ rule, severity, message, hint, line, lineEnd }`. Covers 67 rules. The test harness in `test-linter.js` uses Node's `vm` module to load and execute the browser-targeted script without modification. Results are shown in the Code tab via the "⚡ Linter" button.

### FDS .out parser (`fds-out-parser.js`)
Exposes `parseFdsOut(outText, fdsText) → { findings, summary }`. Parses the FDS runtime diagnostic log for `ERROR`, `WARNING`, `FATAL`, and `STOP` messages. `summary` includes CHID, FDS version, MPI process count, wall-clock time, and run status. `findings` use the same `{ severity, message, hint, line, lineEnd, rule, code, entity }` shape as linter findings. Integrated into the Code tab via the "Load .out" button.

### CSV plotter (`charts-panel.js`)
Exposes `buildChartsPanel()` and `chartsPanelHandleFiles(files)`. Parses FDS CSV output files (two-row header format: units row then names row) and renders an interactive canvas chart with auto-scaled axes, legend, and hover tooltip. No external dependencies.
