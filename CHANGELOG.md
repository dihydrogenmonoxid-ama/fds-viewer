# Changelog

All notable changes to FDS Viewer are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [Unreleased]

### Added

- **Charts tab** — browser-based time-series plotter for FDS CSV output files.
  - Accepts `CHID_devc.csv`, `CHID_hrr.csv`, and any other FDS-format CSV
    (two-row header: units row then column-name row).
  - Multiple files can be loaded simultaneously; each is shown as a
    collapsible dataset group in the left sidebar.
  - Per-channel checkbox selection with "All / None" bulk toggles.
  - Canvas-based chart with auto-scaled axes, labelled with correct units
    (X = Time (s); Y = unit from CSV header, or "Value (mixed units)"
    when channels with different units are plotted together).
  - Dashed grid lines, axis tick labels with nice rounding, inline legend
    below the plot.
  - Hover tooltip: nearest time-step values for every active channel.
  - "Export PNG" button saves the current plot as a PNG file.
  - Theme-aware rendering — updates automatically when switching
    dark ↔ light theme.
  - Zero external dependencies (pure Canvas API, no third-party charting
    library).

- **`.out` log viewer in Code tab** — load a FDS runtime diagnostic log
  alongside the source code.
  - New "Load .out" button in the Code tab header opens a file picker
    (accepts `.out` and `.txt`).
  - Parses FDS `ERROR(NNN)`, `WARNING(NNN)`, `FATAL`, and `STOP` messages
    from the log, with multi-line continuation support.
  - Displays a summary banner: run status (COMPLETED OK / FAILED /
    INCOMPLETE), FDS revision, CHID, MPI process count, and total
    wall-clock time.
  - Findings list uses the same severity badge style as the static linter
    (red ERROR, amber WARNING).
  - Clicking a finding scrolls the source code to the affected namelist
    and highlights the relevant lines.
  - Best-effort entity mapping: FDS error messages that reference
    `OBST 3`, `SURF_ID 'WALL'`, etc. are matched back to the
    corresponding line in the `.fds` source.
  - Hints for common error codes (101, 102, 103, 201, 206) guide the user
    to the fix.

- **Linter button in Code tab** — new "⚡ Linter" button runs the static
  linter on demand and shows findings in the same side-panel as the `.out`
  viewer.
  - Findings are clickable: selecting one scrolls to and highlights the
    affected source line.
  - Close button (✕) dismisses the panel and clears all line highlights.

- `js/fds-out-parser.js` is now loaded in `index.html` (it existed
  previously but was not wired into the page).

- **Charts tab enhancements** (all existing features retained):
  - **Scientific serif font** — all axis labels, tick marks, and legends
    now render in Palatino / Georgia serif, matching publication style.
  - **Per-chart title** — editable title field in each card header;
    title renders centred above the plot on canvas and in SVG/PDF exports.
  - **Decimal separator setting (per chart)** — ⚙ options panel on each
    card lets the user choose period (`.`) or comma (`,`) as the decimal
    marker; selecting comma automatically switches the column separator
    to semicolon; changing the setting re-parses the raw CSV data live.
  - **Per-chart options panel** — ⚙ gear button in each card header
    toggles a compact control strip with: decimal separator radios,
    grid on/off + dashed/solid, custom X / Y / Y₂ axis label overrides,
    and watermark toggle.
  - **Dual Y-axis** — when selected channels have mixed units (e.g.
    temperature °C and mass-loss rate kg/s), channels whose unit differs
    from the first active channel's unit are plotted against a second
    Y-axis on the right side; each axis is independently auto-scaled and
    labelled.
  - **FDS Viewer watermark** — small semi-transparent "FDS Viewer" text
    in the bottom-right corner of the plot area; shown in the live canvas
    view and in SVG/PDF exports; togglable per chart in the ⚙ panel.
  - **Colour picker** — clicking a colour swatch next to any channel
    opens an inline popup with 15 preset swatches, a native OS colour
    picker, and a hex code input field; colours update live.
  - **One chart per CSV file** — each loaded CSV gets its own chart
    card (title bar + canvas + export buttons) stacked vertically in a
    scrollable container.
  - **SVG export** — "↓ SVG" button on each card saves a
    publication-quality vector SVG (1000 × 600 units, serif font,
    correct axis labels and legend).
  - **PDF export** — "↓ PDF" button renders the chart as SVG, wraps
    it in a minimal HTML page with `@page { size: A4 landscape }`, and
    opens the browser print dialog; no external library required.

### Changed

- `index.html`: "Charts" tab inserted between "Code" and "Output".
- `index.html`: Charts panel restructured — static canvas replaced by
  `#charts-cards-list`; Options section added above Channels in sidebar.
- `js/app.js`: `activatePage()` handles the new `charts` page,
  calling `buildChartsPanel()` on first activation.
- `js/charts-panel.js`: version bumped to `20260522D`.
- Cache-busting version strings bumped for all modified files
  (`app.js`, `fire-panel.js`) to `20260522A`.

---

## [2.0.0] — 2026-05-17

### Added

- Output tab: volume-rendered smoke (`.s3d`), slice files (`.sf`),
  boundary patches (`.bf`).
- Walk mode (first-person FPS navigation).
- In-app User Guide (Help tab).
- Orthographic / perspective projection toggle.

---

## [1.x] — earlier

Initial releases: 3D geometry viewer, Mesh panel, Fire & Combustion panel,
Code tab with static linter.
