# FDS Viewer

[![Listed on FDS Third-Party Tools](https://img.shields.io/badge/Listed%20on-FDS%20Third--Party%20Tools-1f5b96?logo=github&logoColor=white)](https://github.com/firemodels/fds/wiki/Third-Party-Tools)
[![Latest release](https://img.shields.io/github/v/release/ProfRino/fds-viewer?logo=github&label=latest)](https://github.com/ProfRino/fds-viewer/releases/latest)
[![GitHub Downloads](https://img.shields.io/github/downloads/ProfRino/fds-viewer/total?logo=github&label=downloads&color=blue)](https://github.com/ProfRino/fds-viewer/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A browser-based 3D previewer for **Fire Dynamics Simulator (FDS)** input files.
Drop in any `.fds` file and inspect meshes, obstructions, vents, holes,
devices, slice planes, fire sources and HVAC networks **before** launching a
multi-hour FDS simulation — catching geometry errors in seconds instead of
after a failed run.

![FDS Viewer demo](assets/demo.gif)

> **Project Lead:** Prof Rino Lovreglio, PhD — Massey University
>
> **Disclaimer:** No responsibility is taken for the use or output of this tool.
> All results must be independently verified by a qualified fire engineer
> before use in any design or regulatory context.

---

## Features

- Pure client‑side — no installation, no build step, no backend.
- Parses FDS namelist input (`&MESH`, `&OBST`, `&VENT`, `&HOLE`, `&DEVC`,
  `&INIT`, `&GEOM`, `&HVAC`, `&ZONE`, `&SLCF`, `&SURF`, `&REAC`, `&MATL`, …).
- Four pages:
  - **3D Geometry** — interactive Three.js scene with layer toggles, opacity,
    canonical camera views and click‑to‑inspect object properties.
  - **Mesh** — resolution, cell count, parallel‑MPI breakdown.
  - **Fire & Combustion** — burner HRR, reaction chemistry, materials.
  - **FDS Code** — the full source with syntax highlighting.
- Light & dark theme.
- Keyboard shortcuts: `W A S D` move, `Q E` up/down, arrows rotate, `1`–`6`
  canonical views, `0` iso, `R` reset.
- Drag‑and‑drop or "Open File" — multiple files can be dropped sequentially
  on the same session.

## Download

- **Latest packaged release** (recommended): **[Download the latest release](https://github.com/ProfRino/fds-viewer/releases/latest)** — clean zip, no git history. The exact version is shown in the `latest` badge at the top.
- **All releases** (with per-version download counts): <https://github.com/ProfRino/fds-viewer/releases>
- **Clone the development branch:** `git clone https://github.com/ProfRino/fds-viewer.git`

> Listed on the official [FDS Third-Party Tools wiki](https://github.com/firemodels/fds/wiki/Third-Party-Tools) — maintained by the FDS development community (firemodels/fds, NIST).

## Quick start

### Option A — Just open the file (no server, any OS)

1. Download the [latest release zip](https://github.com/ProfRino/fds-viewer/releases/latest) and unzip it (or clone the repo).
2. Double‑click **`index.html`** — it opens in your default browser.
3. Click **Load Sample**, drop any `.fds` file on the page, or use
   **Open File**. Done.

The bundled sample is embedded directly in the page, so it works offline
straight from `file://`. The only network call is to the Three.js CDN
(first load only — caches afterwards).

### Option B — Online (GitHub Pages)

Use the live URL — no download needed, handy for sharing with colleagues:

```
https://profrino.github.io/fds-viewer/
```

You can also auto-load a bundled example via the `?file=` parameter:

```
https://profrino.github.io/fds-viewer/?file=examples/sample_room_fire.fds
```

### Option C — Local server (only needed for `?file=` URL params)

The `?file=` URL parameter uses `fetch()`, which browsers block on
`file://` URLs. If you want to use that feature locally, run the
included server:

- **Windows:** double‑click `serve.bat` (requires Python 3 on `PATH`).
- **Any OS:** `python -m http.server 8765` from the repo root, then open
  <http://localhost:8765/>.

For normal use (drag‑drop, Open File, Load Sample) you do **not** need
this — Option A is enough.

## URL parameters

| Parameter | Effect |
|-----------|--------|
| `?file=<path>` | Auto-load a `.fds` file at server-relative `<path>`. Requires GitHub Pages or a local server (Option B or C). Example: `?file=examples/sample_room_fire.fds` |

## Bundled examples

`examples/` contains nine `.fds` files demonstrating different FDS feature
sets (geometry primitives, terrain, extruded polygons, HVAC, fans, sphere
intersections, and a sample room‑fire scenario). They are convenient sanity
inputs for the viewer; they are **not** intended as validated design fires.

## Repository layout

```
.
├── index.html          Application shell
├── css/style.css       Styles (light & dark themes)
├── js/
│   ├── app.js          Wiring, event handling, theme, URL params
│   ├── fds-parser.js   Namelist parser
│   ├── viewer.js       Three.js scene
│   ├── mesh-panel.js   Mesh / parallel panel
│   ├── fire-panel.js   Fire & combustion panel
│   └── sample-data.js  Embedded sample (for offline Load Sample)
├── examples/*.fds      Sample inputs (also editable on disk)
├── serve.bat           Optional local server (only for ?file= URL params)
└── README.md
```

## Dependencies

Three.js r128 is loaded from a public CDN — there is no package manager and
no node_modules. To work fully offline, download `three.min.js` and
`OrbitControls.js` and replace the two `<script src="https://…">` lines near
the bottom of `index.html` with local paths.

## License

MIT — see [LICENSE](LICENSE).

## Recognition

Listed on the official [FDS Third-Party Tools wiki](https://github.com/firemodels/fds/wiki/Third-Party-Tools) maintained by the FDS development community (firemodels/fds, NIST).

## Citation

If you use this tool in published work, please cite:

> Lovreglio, R. *FDS Viewer*. Massey University.
> https://github.com/ProfRino/fds-viewer
