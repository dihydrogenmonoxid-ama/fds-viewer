/* Reads a JuPedSim trajectory sqlite (+ optional agent_scalars) into a
 * frame-indexed dataset for the agent overlay. The pure builder is separated
 * from sql.js I/O so it can be unit-tested without WASM.
 *
 * Base JuPedSim schema is read-only; agent_scalars is optional. See the
 * pyFDS-Evac producer contract.
 */

// Group flat (frame,id,...) rows into per-frame columnar records.
function buildTrajectoryDataset(meta, trajRows, scalarRows) {
    'use strict';
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
                f.speed[i] = _derivedSpeed(frames, fi, i, fps);
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
function _derivedSpeed(frames, fi, i, fps) {
    'use strict';
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

(function (global) {
    'use strict';

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
