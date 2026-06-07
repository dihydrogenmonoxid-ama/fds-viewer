# Agents-in-fds-viewer: 3D agent overlay over FDS smoke

**Date:** 2026-06-07
**Status:** Design approved, pending spec review

## Goal

Visualise evacuation agents walking through volumetric FDS smoke in a single
interactive 3D scene, with agents coloured by **FED** and/or **speed**. Replace
the unmaintained local Smokeview fork (`../smv/build-fork`) as the agent+smoke
viewer.

## Decision

Delegate visualisation to **fds-viewer** (browser, Three.js, MIT, listed on the
FDS Third-Party Tools wiki). It already renders the hard 80%: FDS geometry,
WebGL volumetric smoke (`.s3d`), slices (`.sf`), boundary (`.bf`), a shared
timeline, camera and playback. It has **no** particle/agent support — that is
the one layer we add.

Rejected alternatives:
- **Build everything in py-fdsevac**: its webapp (FastHTML + MonsterUI, 2D
  `<canvas>`) would have to become a WebGL volume-smoke engine, re-implementing
  fds-viewer's hardest parts. Pure duplication.
- **Consolidate into Web-Based-JuPedSim**: heavy stack (React + 2 backends +
  Mongo); still needs FDS smoke volume rendering built; wrong home for
  FDS-specific concerns.
- **PRT5 path**: PRT5 is produced by the dead FDS+Evac and has no future; the
  SQLite JuPedSim format is what we already produce and visualise elsewhere.

Development happens on our fork **`PedestrianDynamics/fds-viewer`** (git remote
`chraibi` in the local checkout; `origin` = upstream `ProfRino/fds-viewer`).
The fds-viewer author accepts our PRs, so changes land upstream → no permanent
fork.

## Data contract (interface between the two repos)

py-fdsevac writes an **optional** side table into the same JuPedSim `.sqlite`:

```sql
CREATE TABLE agent_scalars (
  frame INTEGER NOT NULL,
  id    INTEGER NOT NULL,
  fed   REAL,            -- fed_cumulative; NULL if FED not computed
  speed REAL             -- achieved speed = base_speed * speed_factor (m/s)
);
CREATE INDEX agent_scalars_idx ON agent_scalars(frame, id);
```

- `frame`/`id` match `trajectory_data`. Written only when `--output-sqlite`
  **and** FED/tenability are active.
- The base JuPedSim schema (`trajectory_data`, `metadata`, `geometry`,
  `frame_data`) is **untouched**, so `jupedsim` replay and Web-Based-JuPedSim
  still read the file unchanged. A reader without `agent_scalars` simply falls
  back to speed-from-positions and no FED.
- FED is sampled coarser (≈1 s) than trajectory (fps = 10, i.e. 0.1 s). Each
  FED sample maps to `frame = round(time_s * fps)`; the viewer holds-last /
  interpolates between provided frames.

## Producer — py-fdsevac (small)

- New `pyfds_evac/core/agent_scalars.py`: after the JuPedSim writer produces the
  sqlite, open it and populate `agent_scalars` from the FED history already held
  in memory (the same source as `fed.csv`: `fed_cumulative`, `base_speed`,
  `speed_factor`).
- Integration point: the existing `--output-sqlite` path (writer in
  `pyfds_evac/jpstooling.py` / `core/scenario.py`). Table is additive and
  guarded on FED being enabled.
- Tests (pytest): table present and frame/id-aligned when FED on; absent when
  FED off; values match the FED history.

## Consumer — fds-viewer (the bulk)

Follows fds-viewer's existing **reader → overlay → wiring** pattern (mirrors
`smoke3d-reader.js` / `smoke3d-overlay.js`).

### 1. `js/trajectory-reader.js`
- Load `sql.js` (WASM SQLite) from a CDN, the same way the project loads
  Three.js from a CDN (no build step).
- Open the sqlite `ArrayBuffer`; read `metadata` (fps, xmin/xmax/ymin/ymax),
  `trajectory_data` → `frames[{ time, id[], x[], y[], ori[] }]`, and
  `agent_scalars` if present → `fed[]`, `speed[]`.
- Returns a `TrajectoryDataset` with `frames[]`, available `quantities`
  (`speed` always, `fed` if the table exists), and `timeRange`.
- Speed fallback: if `agent_scalars` is absent, derive per-agent speed from
  successive positions and fps.

### 2. `js/agent-overlay.js`
- Three.js `InstancedMesh` of N agents (spheres / billboard discs for v1).
- Per frame: update instance positions (`x,y` → world coords via the same FDS
  coordinate mapping geometry uses; `z` = constant standing height) and
  per-instance colour from a colormap over the selected quantity.
- Mirrors the smoke/boundary overlay interface (`activeFrames`,
  `currentTime()`, playback hooks) and registers with the **shared master
  timeline**.

### 3. `output-page.js` wiring — persistent overlay (not an exclusive tab)
- Smoke / Slice / Boundary are mutually exclusive modes today. Agents are a
  **co-existing overlay**: they draw on top of whatever smoke/slice is shown.
  This is a deliberate, small change to the mode handling so agents and smoke
  render together.
- New UI: an "Open trajectory (.sqlite)" file picker (the sqlite lives outside
  the FDS output folder by default), a **colour-by** dropdown (Speed / FED), a
  colorbar, and an opacity control.

## Time synchronisation (hard requirement)

There is **one global clock**. At any moment both layers show the *same
simulation second* — never smoke at t=100 s with agents at t=0 s. Mechanics:
- Each source exposes its own `timeRange`; the viewer's existing "align to
  common timestamps" logic produces the master time axis.
- Scrubbing/playing sets a single `currentTime`; each overlay renders the frame
  nearest that time.
- Where a source does not cover the current time (e.g. agents evacuated before
  smoke ends, or differing start/stop), **hold the nearest end frame / hide**
  rather than letting the layers drift apart.

## Coordinate & colormap details

- The sqlite domain (`0–30 × 0–13`) equals the FDS mesh, so `x,y` need no
  transform beyond the existing geometry mapping; only a constant `z` for
  standing height.
- Colormaps: **Speed** 0…~1.5 m/s; **FED** 0…1 with the incapacitation
  threshold (1.0) visually marked. Show a colorbar for the active quantity.

## Scope

**v1 (in):** colored instanced spheres; Speed + FED coloring; single sqlite
picker; agents rendered over smoke on a synced clock; speed-from-positions
fallback when `agent_scalars` is absent.

**Deferred:** humanoid avatars / per-agent orientation rotation; click-to-inspect
an agent (per-agent FED/CO readout); multiple simultaneous trajectories;
streaming very large sqlite files.

## Testing

- **py-fdsevac:** pytest on the `agent_scalars` writer (presence, alignment,
  values, optionality).
- **fds-viewer:** a bun/node parse test of `trajectory-reader.js` against
  `demo4.sqlite` (asserting frame/agent/quantity counts — the same kind of
  parser check already validated for `Smoke3DReader`), plus a headed-browser
  render check showing agents over smoke at a matching time.

## Rollout

1. Land the `agent_scalars` writer in py-fdsevac (`feat/web-gui` or a follow-up
   branch).
2. Implement reader + overlay + wiring on a feature branch of the `chraibi`
   fork; open a PR to `origin` (ProfRino) upstream.
3. Keep our additions modular so a self-hosted build remains possible if an
   upstream PR ever stalls.
