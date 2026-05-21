/**
 * FDS Linter — client-side static analysis for FDS input files.
 *
 * Covers all rules from validate_fds.py plus additional checks sourced from
 * fds_possible_input_errors.md (FDS User Guide error codes + forum patterns).
 *
 * Entry point:  fdsLint(text)  →  [{severity, message, hint, line, rule}, ...]
 * Severities: 'ERROR' | 'WARNING' | 'INFO'
 */

// ── Known-valid quantity sets ─────────────────────────────────────────────────
// Sources: FDS User Guide Table 22.4 (gas phase), 22.5 (solid phase), 22.6 (device/misc)
// File type key: D=device CSV, S=slice file, B=boundary file, I=isosurface, P=Plot3D

// Table 22.4 gas-phase (D,I,P,S unless noted) + Table 22.5 solid-phase (B,D) + Table 22.6 (D or D,S)
const _KNOWN_DEVC_Q = new Set([
    // Table 22.4 — gas phase (all have D)
    'BACKGROUND PRESSURE','BULK DENSITY','CELL REYNOLDS NUMBER',
    'CELL U','CELL V','CELL W','CFL','CFL MAX',
    'CHEMISTRY SUBITERATIONS','CHI_R','COMBUSTION EFFICIENCY',
    'CONDUCTIVITY','C_SMAG','DENSITY','DIVERGENCE',
    'EFFECTIVE FLAME TEMPERATURE','ENTHALPY',
    'ENTHALPY FLUX X','ENTHALPY FLUX Y','ENTHALPY FLUX Z',
    'EXTINCTION','EXTINCTION COEFFICIENT',
    'F_X','F_Y','F_Z','H','HRRPUV','HRRPUV REAC',
    'IDEAL GAS PRESSURE','INTEGRATED INTENSITY','INTERNAL ENERGY',
    'KINETIC ENERGY','KOLMOGOROV LENGTH SCALE',
    'MACH NUMBER','MASS FRACTION','MASS FLUX X','MASS FLUX Y','MASS FLUX Z',
    'MAXIMUM VELOCITY ERROR','MIXING TIME','MIXTURE FRACTION',
    'MOLECULAR CONDUCTIVITY','MOLECULAR VISCOSITY',
    'OPTICAL DENSITY','ORIENTED VELOCITY','PRESSURE','PRESSURE ITERATIONS','PRESSURE ZONE',
    'Q CRITERION','RADIAL VELOCITY',
    'RADIATION ABSORPTION','RADIATION EMISSION','RADIATION LOSS',
    'RADIATIVE HEAT FLUX GAS',
    'REAC SOURCE TERM','RELATIVE HUMIDITY',
    'RESOLVED KINETIC ENERGY','RTE SOURCE CORRECTION FACTOR',
    'SENSIBLE ENTHALPY','SPECIFIC ENTHALPY','SPECIFIC HEAT',
    'SPECIFIC INTERNAL ENERGY','SPECIFIC SENSIBLE ENTHALPY',
    'STRAIN RATE','STRAIN RATE X','STRAIN RATE Y','STRAIN RATE Z',
    'SUBGRID KINETIC ENERGY','SUM LUMPED MASS FRACTIONS','SUM PRIMITIVE MASS FRACTIONS',
    'TEMPERATURE','TOTAL MASS FLUX X','TOTAL MASS FLUX Y','TOTAL MASS FLUX Z',
    'U-VELOCITY','V-VELOCITY','W-VELOCITY','VELOCITY','VISCOSITY','VISIBILITY',
    'VN','VN MAX','VOLUME FRACTION',
    'VORTICITY','VORTICITY X','VORTICITY Y','VORTICITY Z',
    'WAVELET ERROR',
    // Table 22.5 — solid phase (B,D)
    'ADIABATIC SURFACE TEMPERATURE','BACK WALL TEMPERATURE',
    'BURNING RATE','CONVECTIVE HEAT FLUX','CONVECTIVE HEAT FLUX GAUGE',
    'GAUGE HEAT FLUX','INCIDENT HEAT FLUX','NET HEAT FLUX',
    'HEAT TRANSFER COEFFICIENT','HRRPUA',
    'INSIDE WALL TEMPERATURE','INSIDE WALL DEPTH',
    'MASS FLUX WALL','NORMAL VELOCITY',
    'RADIATIVE HEAT FLUX','RADIOMETER','TOTAL HEAT FLUX',
    'WALL TEMPERATURE','WALL THICKNESS',
    // Table 22.6 — device/misc (D or D,S)
    'FED','FIC',
    'LAYER HEIGHT','LOWER TEMPERATURE','UPPER TEMPERATURE',
    'LINK TEMPERATURE','SPRINKLER LINK TEMPERATURE','THERMOCOUPLE',
    'CONTROL','CONTROL VALUE','CONTROL FUNCTION',
    'TIME','FIRE DEPTH','PATH OBSCURATION','ASPIRATION',
    'CHAMBER OBSCURATION','TRANSMISSION',
    // Additional common aliases
    'PARTICLE TEMPERATURE','PARTICLE MASS',
    'HRR','MASS FLOW','VOLUME FLOW','HEAT FLOW',
    'HEAT RELEASE RATE PER UNIT AREA',
]);

const _REJECTED_DEVC_Q = {
    'HEAT RELEASE RATE': "Use QUANTITY='HRR' with XB for an integrated volume; total HRR is written to <chid>_hrr.csv automatically.",
    'SOOT MASS FRACTION':   "Not available with implicit soot (SOOT_YIELD in &REAC). Use QUANTITY='VISIBILITY'.",
    'SOOT VOLUME FRACTION': "Not available with implicit soot (SOOT_YIELD in &REAC). Use QUANTITY='VISIBILITY'.",
};

// Table 22.4 quantities with File Type that includes S (slice)
// Excludes: D-only entries and solid-phase (Table 22.5) entries which are B,D only
const _KNOWN_SLCF_Q = new Set([
    // Table 22.4 — gas phase with S in file type (D,I,P,S or D,S or S)
    'BACKGROUND PRESSURE','BULK DENSITY','CELL REYNOLDS NUMBER',
    'CELL U','CELL V','CELL W','CFL',
    'CHEMISTRY SUBITERATIONS','CHI_R','COMBUSTION EFFICIENCY',
    'CONDUCTIVITY','C_SMAG','DENSITY','DIVERGENCE',
    'EFFECTIVE FLAME TEMPERATURE','ENTHALPY',
    'ENTHALPY FLUX X','ENTHALPY FLUX Y','ENTHALPY FLUX Z',
    'EXTINCTION','EXTINCTION COEFFICIENT',
    'F_X','F_Y','F_Z','H','HRRPUV','HRRPUV REAC',
    'IDEAL GAS PRESSURE','INTEGRATED INTENSITY','INTERNAL ENERGY',
    'KINETIC ENERGY','KOLMOGOROV LENGTH SCALE',
    'MACH NUMBER','MASS FRACTION','MASS FLUX X','MASS FLUX Y','MASS FLUX Z',
    'MIXING TIME','MIXTURE FRACTION',
    'MOLECULAR CONDUCTIVITY','MOLECULAR VISCOSITY',
    'OPTICAL DENSITY','PRESSURE','PRESSURE ZONE',
    'Q CRITERION','RADIAL VELOCITY',
    'RADIATION ABSORPTION','RADIATION EMISSION','RADIATION LOSS',
    'REAC SOURCE TERM','RELATIVE HUMIDITY',
    'RESOLVED KINETIC ENERGY',
    'SENSIBLE ENTHALPY','SPECIFIC ENTHALPY','SPECIFIC HEAT',
    'SPECIFIC INTERNAL ENERGY','SPECIFIC SENSIBLE ENTHALPY',
    'STRAIN RATE','STRAIN RATE X','STRAIN RATE Y','STRAIN RATE Z',
    'SUBGRID KINETIC ENERGY','SUM LUMPED MASS FRACTIONS','SUM PRIMITIVE MASS FRACTIONS',
    'TEMPERATURE','TOTAL MASS FLUX X','TOTAL MASS FLUX Y','TOTAL MASS FLUX Z',
    'U-VELOCITY','V-VELOCITY','W-VELOCITY','VELOCITY','VISCOSITY','VISIBILITY',
    'VN','VOLUME FRACTION','MOLE FRACTION',
    'VORTICITY','VORTICITY X','VORTICITY Y','VORTICITY Z',
    'WAVELET ERROR',
    // Table 22.6 — FIC is D,S (valid for SLCF)
    'FIC',
    // Table 22.6 — CELL INDEX is D,S
    'CELL INDEX I','CELL INDEX J','CELL INDEX K',
]);

const _REJECTED_SLCF_Q = {
    // Table 22.6 — D only (not S)
    'FED':                  "FED (Fractional Effective Dose) is a device-only quantity (FDS User Guide Table 22.6, File Type D). Use &DEVC QUANTITY='FED' at a point. FIC is the slice-capable equivalent (File Type D,S).",
    // Table 22.4 — D only (not S)
    'RADIATIVE HEAT FLUX GAS': "RADIATIVE HEAT FLUX GAS has File Type D only (Table 22.4) — not valid for &SLCF. Use &DEVC instead.",
    // Table 22.5 — solid phase (B,D only, not S)
    'WALL TEMPERATURE':     "WALL TEMPERATURE is a solid-phase quantity (Table 22.5, File Type B,D) — not valid for &SLCF. Use &BNDF QUANTITY='WALL TEMPERATURE' / for full surface output.",
    'BURNING RATE':         "BURNING RATE is a solid-phase quantity (Table 22.5, File Type B,D) — not valid for &SLCF. Use &BNDF QUANTITY='BURNING RATE' / for surface output.",
    'HRRPUA':               "HRRPUA is a solid-phase quantity (Table 22.5, File Type B,D) — not valid for &SLCF. Use &BNDF QUANTITY='HRRPUA' / for surface output.",
    'GAUGE HEAT FLUX':      "GAUGE HEAT FLUX is a solid-phase quantity (Table 22.5, File Type B,D) — not valid for &SLCF. Use &BNDF QUANTITY='GAUGE HEAT FLUX' /.",
    'INCIDENT HEAT FLUX':   "INCIDENT HEAT FLUX is a solid-phase quantity (Table 22.5, File Type B,D) — not valid for &SLCF. Use &BNDF instead.",
    'CONVECTIVE HEAT FLUX': "CONVECTIVE HEAT FLUX is a solid-phase quantity (Table 22.5, File Type B,D) — not valid for &SLCF. Use &BNDF instead.",
    'ADIABATIC SURFACE TEMPERATURE': "ADIABATIC SURFACE TEMPERATURE is a solid-phase quantity (Table 22.5, File Type B,D) — not valid for &SLCF. Use &BNDF or &DEVC with IOR.",
    // Implicit-soot crashes
    'SOOT MASS FRACTION':   "Not available with implicit soot (SOOT_YIELD in &REAC). Use QUANTITY='VISIBILITY'.",
    'SOOT VOLUME FRACTION': "Not available with implicit soot (SOOT_YIELD in &REAC). Use QUANTITY='VISIBILITY'.",
    'HEAT RELEASE RATE':    "Not a valid SLCF quantity. Use QUANTITY='HRRPUV' for volumetric HRR rate slices.",
};

const _SPEC_ID_Q = new Set(['VOLUME FRACTION','MASS FRACTION','MOLE FRACTION']);

const _WALL_DEVC_Q = new Set([
    'WALL TEMPERATURE','INSIDE WALL TEMPERATURE','BACK WALL TEMPERATURE',
    'GAUGE HEAT FLUX','NET HEAT FLUX','CONVECTIVE HEAT FLUX',
    'RADIATIVE HEAT FLUX','TOTAL HEAT FLUX','INCIDENT HEAT FLUX',
    'BURNING RATE','WALL THICKNESS','ADIABATIC SURFACE TEMPERATURE',
    'HEAT TRANSFER COEFFICIENT','MASS FLUX WALL',
]);

const _ZONE_DEVC_Q = new Set([
    'LAYER HEIGHT','UPPER TEMPERATURE','LOWER TEMPERATURE','HRR',
    'VOLUME FLOW','MASS FLOW',
]);

const _BUILTIN_SPECIES = new Set([
    'AIR','NITROGEN','OXYGEN','CARBON DIOXIDE','CARBON MONOXIDE',
    'WATER VAPOR','HYDROGEN','METHANE','ETHYLENE','PROPANE',
    'BUTANE','HEPTANE','ETHANOL','METHANOL','TOLUENE',
    'N2','O2','CO2','CO','H2O','H2','PRODUCTS','FUEL',
]);

// ── Lightweight record parser (tracks source line numbers) ───────────────────

function _stripFdsComment(line) {
    let out = '', inQ = null;
    for (const ch of line) {
        if (inQ) { out += ch; if (ch === inQ) inQ = null; }
        else if (ch === "'" || ch === '"') { inQ = ch; out += ch; }
        else if (ch === '!') break;
        else out += ch;
    }
    return out;
}

function _coerceFds(raw) {
    raw = raw.trim().replace(/,\s*$/, '').trim();
    if (!raw) return '';
    if (raw[0] === "'" || raw[0] === '"') {
        const items = _csvSplitFds(raw).map(s => {
            s = s.trim();
            return (s.length >= 2 && s[0] === s[s.length - 1] && (s[0] === "'" || s[0] === '"')) ? s.slice(1, -1) : s;
        });
        return items.length === 1 ? items[0] : items;
    }
    const up = raw.toUpperCase().replace(/\./g, '');
    if (up === 'T' || up === 'TRUE')  return true;
    if (up === 'F' || up === 'FALSE') return false;
    const parts = raw.split(',').map(s => s.trim()).filter(Boolean);
    const nums = parts.map(p => { const n = parseFloat(p); return isNaN(n) ? null : n; });
    if (nums.every(n => n !== null)) return nums.length === 1 ? nums[0] : nums;
    return raw;
}

function _csvSplitFds(s) {
    const out = [], cur = [];
    let inQ = null;
    for (const ch of s) {
        if (inQ) { cur.push(ch); if (ch === inQ) inQ = null; }
        else if (ch === "'" || ch === '"') { inQ = ch; cur.push(ch); }
        else if (ch === ',') { out.push(cur.join('')); cur.length = 0; }
        else cur.push(ch);
    }
    if (cur.length) out.push(cur.join(''));
    return out.map(x => x.trim()).filter(Boolean);
}

// Replace contents of quoted strings with same-length placeholders so KEY=
// patterns inside strings (e.g. TITLE='HRRPUA=500 kW') don't get scanned as
// parameter assignments. Positions are preserved so callers can still slice
// the ORIGINAL body for value extraction.
function _maskFdsStrings(body) {
    let out = '';
    let inQ = null;
    for (let i = 0; i < body.length; i++) {
        const ch = body[i];
        if (inQ) {
            if (ch === inQ) { inQ = null; out += ch; }
            else out += ' '; // any non-key, non-= placeholder
        } else if (ch === "'" || ch === '"') {
            inQ = ch; out += ch;
        } else {
            out += ch;
        }
    }
    return out;
}

function _parseParamsFds(body) {
    const params = {};
    const masked = _maskFdsStrings(body);
    const KEY_RE = /\b([A-Za-z_]\w*(?:\([^)]*\))?)\s*=/g;
    const matches = [];
    let m;
    while ((m = KEY_RE.exec(masked)) !== null) {
        matches.push({ key: m[1], idx: m.index, end: m.index + m[0].length });
    }
    for (let i = 0; i < matches.length; i++) {
        const rawKey = matches[i].key.toUpperCase();
        const idxMatch = rawKey.match(/^([A-Z_][A-Z0-9_]*)\(\s*(\d+)\s*\)$/);
        const start = matches[i].end;
        const end = i + 1 < matches.length ? matches[i + 1].idx : body.length;
        const value = _coerceFds(body.slice(start, end));
        if (idxMatch) {
            // Array-indexed key: XB(1), IJK(2), MATL_ID(1,3), etc.
            // Merge into the base key as a 1-indexed -> 0-indexed array.
            const base = idxMatch[1];
            const slot = parseInt(idxMatch[2], 10) - 1;
            if (!Array.isArray(params[base])) {
                const existing = params[base];
                params[base] = [];
                if (existing !== undefined) params[base][0] = existing;
            }
            // _coerceFds returns either a scalar or an array; flatten 1-element arrays
            params[base][slot] = Array.isArray(value) && value.length === 1 ? value[0] : value;
        } else {
            params[rawKey] = value;
        }
    }
    return params;
}

function _lintParseRecords(text) {
    text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = text.split('\n');

    // Build a flat comment-stripped string with a parallel line-number array
    const chars = [], lineOf = [];
    for (let ln = 0; ln < lines.length; ln++) {
        for (const ch of _stripFdsComment(lines[ln])) {
            chars.push(ch); lineOf.push(ln + 1);
        }
        chars.push('\n'); lineOf.push(ln + 1);
    }
    const flat = chars.join('');

    const records = [];
    const HEAD_RE = /&(\w+)/g;
    let searchFrom = 0, mo;
    while ((mo = HEAD_RE.exec(flat)) !== null) {
        if (mo.index < searchFrom) continue;
        const name = mo[1].toUpperCase();
        const bodyStart = mo.index + mo[0].length;
        let j = bodyStart, inQ = null, found = false, unterminated = false;
        while (j < flat.length) {
            const ch = flat[j];
            if (inQ) { if (ch === inQ) inQ = null; }
            else if (ch === "'" || ch === '"') inQ = ch;
            else if (ch === '/') { found = true; break; }
            else if (ch === '&') {
                // Next record starts before we found / — this record is unterminated
                let k = j + 1;
                while (k < flat.length && (flat[k] === ' ' || flat[k] === '\t')) k++;
                if (/[A-Za-z]/.test(flat[k] || '')) { unterminated = true; break; }
            }
            j++;
        }
        // Reached EOF without finding / or the start of the next record.
        // The record is unterminated (e.g. &TAIL at EOF, or a / swallowed inside
        // a mismatched string literal).
        if (!found && !unterminated && j >= flat.length) unterminated = true;
        if (found || unterminated) {
            const body = flat.slice(bodyStart, j);
            // Last line of this record's content (the char before the / or &)
            const lastContentPos = j > bodyStart ? j - 1 : bodyStart;
            records.push({
                name,
                line: lineOf[mo.index] || 1,
                lineEnd: lineOf[lastContentPos] || lineOf[mo.index] || 1,
                params: _parseParamsFds(body),
                _body: body,
                _bodyLine: lineOf[bodyStart] || lineOf[mo.index] || 1,
                _unterminated: unterminated || undefined,
            });
            // If unterminated, restart from the & so the next record is re-parsed correctly
            HEAD_RE.lastIndex = unterminated ? j : j + 1;
            searchFrom = unterminated ? j : j + 1;
        }
    }
    return records;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _asList(v) {
    if (v === undefined || v === null || v === '') return [];
    return Array.isArray(v) ? v : [v];
}

function _definedSpecies(records) {
    const ids = new Set(_BUILTIN_SPECIES);
    for (const r of records) {
        if (r.name === 'SPEC' && r.params.ID) ids.add(String(r.params.ID).toUpperCase());
        if (r.name === 'REAC' && r.params.FUEL) ids.add(String(r.params.FUEL).toUpperCase());
    }
    return ids;
}

function _hasImplicitSoot(records) {
    return records.some(r => r.name === 'REAC' && r.params.SOOT_YIELD != null) &&
          !records.some(r => r.name === 'SPEC' && String(r.params.ID || '').toUpperCase() === 'SOOT');
}

// ── Rules ─────────────────────────────────────────────────────────────────────

const _LINT_RULES = [];
const _rule = (name, fn) => _LINT_RULES.push([name, fn]);

// ── Parse errors ─────────────────────────────────────────────────────────────

_rule('unterminated-record', (R, F) => {
    for (const r of R) {
        if (r._unterminated)
            F.push({
                severity: 'ERROR',
                message: `&${r.name} at line ${r.line} is missing its closing / — record is not terminated.`,
                hint: `Every FDS namelist record must end with /. Add / at the end of the &${r.name} block. Without it FDS raises ERROR(101) and subsequent records may be misread.`,
                line: r.line,
                lineEnd: r.lineEnd,
                rule: 'unterminated-record',
            });
    }
});

// ── Simulation control ────────────────────────────────────────────────────────

_rule('head-chid-required', (R, F) => {
    const heads = R.filter(r => r.name === 'HEAD');
    if (!heads.length) {
        return F.push({ severity:'ERROR', message:"&HEAD namelist is missing — CHID is required for FDS to produce output files.", hint:"Add &HEAD CHID='my_sim', TITLE='Description' /", line:1, rule:'head-chid-required' });
    }
    const chid = heads[0].params.CHID || '';
    if (!chid)
        F.push({ severity:'ERROR', message:"&HEAD has no CHID — required.", hint:"Add CHID='<sim_name>' to the &HEAD line.", line:heads[0].line, rule:'head-chid-required' });
    else if (/[ .\\/:\*?"<>|]/.test(String(chid)))
        F.push({ severity:'WARNING', message:`CHID '${chid}' contains a space or period — forbidden by FDS.`, hint:"No spaces or periods allowed in CHID (FDS User Guide §6.1). Use letters, digits, hyphens, and underscores only.", line:heads[0].line, rule:'head-chid-required' });
});

_rule('time-tend-required', (R, F) => {
    const times = R.filter(r => r.name === 'TIME');
    if (!times.length) {
        return F.push({ severity:'WARNING', message:"&TIME namelist missing; FDS will use default T_END=1.0 s.", hint:"Add &TIME T_END=<seconds> /", line:1, rule:'time-tend-required' });
    }
    if (times[0].params.T_END == null)
        F.push({ severity:'WARNING', message:"&TIME has no T_END; FDS will use 1.0 s by default.", hint:"Add T_END=<seconds> to the &TIME line.", line:times[0].line, rule:'time-tend-required' });
});

_rule('tail-missing', (R, F) => {
    if (!R.some(r => r.name === 'TAIL'))
        F.push({ severity:'INFO', message:"No &TAIL / found at end of file.", hint:"Add &TAIL / as the last line. FDS ignores anything after &TAIL, making it a clean end marker.", line:0, rule:'tail-missing' });
});

// ── Mesh ──────────────────────────────────────────────────────────────────────

_rule('mesh-required', (R, F) => {
    if (!R.some(r => r.name === 'MESH'))
        F.push({ severity:'ERROR', message:"No &MESH defined — FDS needs at least one mesh.", hint:"Add &MESH IJK=I,J,K, XB=x0,x1,y0,y1,z0,z1 /. FDS raises ERROR(113).", line:1, rule:'mesh-required' });
});

_rule('mesh-ijk-min', (R, F) => {
    for (const m of R.filter(r => r.name === 'MESH')) {
        const ijk = m.params.IJK;
        if (!Array.isArray(ijk) || ijk.length < 3) continue;
        if (ijk.some(n => n < 2))
            F.push({ severity:'ERROR', message:`&MESH at line ${m.line} has IJK dimension < 2 (${ijk.join(',')}).`, hint:"All IJK values must be ≥ 2; use ≥ 4 per direction for a proper 3D mesh. FDS raises ERROR(426) for degenerate meshes.", line:m.line, rule:'mesh-ijk-min' });
    }
});

_rule('mesh-xb-degenerate', (R, F) => {
    for (const m of R.filter(r => r.name === 'MESH')) {
        const xb = m.params.XB;
        if (!Array.isArray(xb) || xb.length !== 6) continue;
        if (xb[0] === xb[1] || xb[2] === xb[3] || xb[4] === xb[5])
            F.push({ severity:'ERROR', message:`&MESH at line ${m.line} has zero-length XB in at least one direction (${xb.join(',')}).`, hint:"FDS raises ERROR(119) when any axis of a mesh has equal bounds.", line:m.line, rule:'mesh-xb-degenerate' });
    }
});

_rule('mesh-balance', (R, F) => {
    const meshes = R.filter(r => r.name === 'MESH');
    if (meshes.length < 2) return;
    const cells = meshes
        .map(m => Array.isArray(m.params.IJK) && m.params.IJK.length === 3 ? Math.round(m.params.IJK.reduce((a,b)=>a*b,1)) : null)
        .filter(n => n !== null);
    if (cells.length > 1 && Math.max(...cells) > 4 * Math.min(...cells))
        F.push({ severity:'INFO', message:`Mesh cell counts are imbalanced (max ${Math.max(...cells).toLocaleString()} vs min ${Math.min(...cells).toLocaleString()}).`, hint:"With one MPI rank per mesh the slowest mesh sets wall time. Aim for counts within 2× of each other.", line:meshes[0].line, rule:'mesh-balance' });
});

// ── XB ordering (all namelists) ───────────────────────────────────────────────

_rule('xb-ordered', (R, F) => {
    for (const r of R) {
        const xb = r.params.XB;
        if (Array.isArray(xb) && xb.length === 6 && (xb[0] > xb[1] || xb[2] > xb[3] || xb[4] > xb[5]))
            F.push({ severity:'ERROR', message:`&${r.name} XB has reversed bounds: (${xb.join(',')}).`, hint:"XB order must be: x_min, x_max, y_min, y_max, z_min, z_max.", line:r.line, rule:'xb-ordered' });
    }
});

// ── Combustion ────────────────────────────────────────────────────────────────

_rule('reac-missing-fuel', (R, F) => {
    for (const r of R.filter(r => r.name === 'REAC')) {
        if (!r.params.FUEL)
            F.push({ severity:'ERROR', message:`&REAC at line ${r.line} has no FUEL defined.`, hint:"Add FUEL='<name>' (e.g. FUEL='PROPANE') and optionally C=3, H=8. FDS raises ERROR(190).", line:r.line, rule:'reac-missing-fuel' });
    }
});

_rule('surf-hrrpua-needs-reac', (R, F) => {
    const hasReac = R.some(r => r.name === 'REAC');
    for (const s of R.filter(r => r.name === 'SURF')) {
        if ((s.params.HRRPUA != null || s.params.MLRPUA != null) && !hasReac)
            F.push({ severity:'WARNING', message:`&SURF '${s.params.ID || '?'}' uses HRRPUA/MLRPUA but no &REAC is defined.`, hint:"Add &REAC FUEL='...', HEAT_OF_COMBUSTION=... / so FDS can compute combustion products. FDS raises ERROR(314).", line:s.line, rule:'surf-hrrpua-needs-reac' });
    }
});

// ── Surface / material ────────────────────────────────────────────────────────

_rule('surf-missing-id', (R, F) => {
    for (const s of R.filter(r => r.name === 'SURF')) {
        const id = s.params.ID;
        if (!id || (typeof id === 'string' && !id.trim()))
            F.push({ severity:'ERROR', message:`&SURF at line ${s.line} has no ID — required.`, hint:"Add ID='<name>' so it can be referenced by VENT/OBST. FDS raises ERROR(301).", line:s.line, rule:'surf-missing-id' });
    }
});

_rule('duplicate-ids', (R, F) => {
    for (const type of ['SURF','MATL','SPEC','RAMP','PART','PROP','CTRL','DEVC','VENT']) {
        const seen = {}, dupes = new Set();
        for (const r of R.filter(r => r.name === type)) {
            const id = String(r.params.ID || '');
            if (!id) continue;
            if (id in seen && !dupes.has(id)) {
                dupes.add(id);
                F.push({ severity:'ERROR', message:`&${type} ID '${id}' is defined more than once (first at line ${seen[id]}, again at line ${r.line}).`, hint:`Rename one instance. FDS raises an error for duplicate ${type} IDs (e.g. ERROR(302) for SURF).`, line:r.line, rule:'duplicate-ids' });
            }
            seen[id] = r.line;
        }
    }
});

_rule('burn-away-surf-id6', (R, F) => {
    const burnSurfs = new Set(
        R.filter(r => r.name === 'SURF' && r.params.BURN_AWAY === true).map(r => String(r.params.ID || ''))
    );
    if (!burnSurfs.size) return;
    for (const o of R.filter(r => r.name === 'OBST')) {
        for (const s of _asList(o.params.SURF_ID6)) {
            if (s && burnSurfs.has(String(s)))
                F.push({ severity:'ERROR', message:`&OBST at line ${o.line} uses SURF '${s}' (BURN_AWAY=.TRUE.) via SURF_ID6 — rejected by FDS.`, hint:`Remove BURN_AWAY from SURF '${s}' or move the combustible material to its own OBST.`, line:o.line, rule:'burn-away-surf-id6' });
        }
    }
});

_rule('burn-away-bulk-density', (R, F) => {
    const matls = {};
    for (const r of R.filter(r => r.name === 'MATL')) matls[String(r.params.ID || '')] = r;
    for (const s of R.filter(r => r.name === 'SURF')) {
        if (s.params.BURN_AWAY !== true || s.params.BULK_DENSITY != null) continue;
        if (_asList(s.params.MATL_ID).some(mid => (matls[mid] || {}).params && matls[mid].params.DENSITY != null)) continue;
        F.push({ severity:'ERROR', message:`&SURF '${s.params.ID}' has BURN_AWAY=.TRUE. but no BULK_DENSITY and no MATL with DENSITY.`, hint:"Add BULK_DENSITY=<kg/m³> to the SURF, or reference a MATL that defines DENSITY. FDS raises ERROR(607).", line:s.line, rule:'burn-away-bulk-density' });
    }
});

_rule('ht3d-burn-away', (R, F) => {
    for (const s of R.filter(r => r.name === 'SURF')) {
        if (s.params.HT3D === true && s.params.BURN_AWAY === true)
            F.push({ severity:'ERROR', message:`&SURF '${s.params.ID}' has both HT3D=.TRUE. and BURN_AWAY=.TRUE. — FDS raises ERROR(369).`, hint:"Use HT3D for conduction tracking or BURN_AWAY for mass removal, not both on the same surface.", line:s.line, rule:'ht3d-burn-away' });
    }
});

// ── VENT ──────────────────────────────────────────────────────────────────────

_rule('vent-not-planar', (R, F) => {
    for (const v of R.filter(r => r.name === 'VENT')) {
        const xb = v.params.XB;
        if (!Array.isArray(xb) || xb.length !== 6 || v.params.MB) continue;
        const equalPairs = [[xb[0],xb[1]],[xb[2],xb[3]],[xb[4],xb[5]]].filter(([a,b]) => a === b).length;
        if (equalPairs === 0)
            F.push({ severity:'ERROR', message:`&VENT at line ${v.line} XB=(${xb.join(',')}) is not planar — no coordinate pair is equal.`, hint:"A VENT must lie in a plane: set exactly one coordinate pair equal (e.g. x0=x1 for a YZ-plane). FDS raises ERROR(810).", line:v.line, rule:'vent-not-planar' });
    }
});

// ── Reference resolution ──────────────────────────────────────────────────────

_rule('surf-id-undefined', (R, F) => {
    const BUILTIN = new Set(['OPEN','MIRROR','INERT','PERIODIC','INTERPOLATED','HVAC']);
    const defined = new Set(R.filter(r => r.name === 'SURF').map(r => String(r.params.ID || '')));
    for (const b of BUILTIN) defined.add(b);
    for (const r of R) {
        if (!['VENT','OBST'].includes(r.name)) continue;
        for (const s of [..._asList(r.params.SURF_ID), ..._asList(r.params.SURF_IDS), ..._asList(r.params.SURF_ID6)]) {
            if (s && !defined.has(String(s)))
                F.push({ severity:'ERROR', message:`&${r.name} at line ${r.line} references SURF_ID '${s}' which is not defined.`, hint:`Define &SURF ID='${s}', ... / or fix the reference. FDS raises ERROR(605) or ERROR(812).`, line:r.line, rule:'surf-id-undefined' });
        }
    }
});

_rule('matl-id-undefined', (R, F) => {
    const defined = new Set(R.filter(r => r.name === 'MATL').map(r => String(r.params.ID || '')));
    for (const r of R.filter(r => r.name === 'SURF')) {
        for (const m of _asList(r.params.MATL_ID)) {
            if (m && !defined.has(String(m)))
                F.push({ severity:'ERROR', message:`&SURF '${r.params.ID}' references MATL_ID '${m}' which is not defined.`, hint:`Define &MATL ID='${m}', ... / earlier in the file. FDS raises ERROR(608).`, line:r.line, rule:'matl-id-undefined' });
        }
    }
});

_rule('ramp-id-undefined', (R, F) => {
    const defined = new Set(R.filter(r => r.name === 'RAMP').map(r => String(r.params.ID || '')));
    if (!defined.size) return;
    for (const r of R) {
        for (const [key, val] of Object.entries(r.params)) {
            if (!key.startsWith('RAMP_') || typeof val !== 'string' || !val) continue;
            if (!defined.has(val))
                F.push({ severity:'WARNING', message:`&${r.name} at line ${r.line} references ${key}='${val}' — no matching &RAMP ID found.`, hint:`Define &RAMP ID='${val}', T=..., F=... / or fix the reference. FDS raises ERROR(391).`, line:r.line, rule:'ramp-id-undefined' });
        }
    }
});

_rule('prop-id-undefined', (R, F) => {
    const defined = new Set(R.filter(r => r.name === 'PROP').map(r => String(r.params.ID || '')));
    if (!defined.size) return;
    for (const d of R.filter(r => r.name === 'DEVC')) {
        const pid = d.params.PROP_ID;
        if (pid && !defined.has(String(pid)))
            F.push({ severity:'ERROR', message:`&DEVC '${d.params.ID||'?'}' references PROP_ID='${pid}' which is not defined.`, hint:`Define &PROP ID='${pid}', ... / or fix the reference. FDS raises ERROR(1043).`, line:d.line, rule:'prop-id-undefined' });
    }
});

_rule('ctrl-id-undefined', (R, F) => {
    const defined = new Set(R.filter(r => r.name === 'CTRL').map(r => String(r.params.ID || '')));
    if (!defined.size) return;
    for (const r of R) {
        if (!['DEVC','VENT','OBST','HOLE'].includes(r.name)) continue;
        const cid = r.params.CTRL_ID;
        if (cid && !defined.has(String(cid)))
            F.push({ severity:'WARNING', message:`&${r.name} at line ${r.line} references CTRL_ID='${cid}' which is not defined.`, hint:`Define &CTRL ID='${cid}', FUNCTION_TYPE='...', INPUT_ID='...' / or fix the reference. FDS raises ERROR(938).`, line:r.line, rule:'ctrl-id-undefined' });
    }
});

_rule('mult-id-undefined', (R, F) => {
    const defined = new Set(R.filter(r => r.name === 'MULT').map(r => String(r.params.ID || '')));
    if (!defined.size) return;
    for (const r of R) {
        if (!['OBST','VENT','DEVC'].includes(r.name)) continue;
        const mid = r.params.MULT_ID;
        if (mid && !defined.has(String(mid)))
            F.push({ severity:'ERROR', message:`&${r.name} at line ${r.line} references MULT_ID='${mid}' which is not defined.`, hint:`Define &MULT ID='${mid}', ... / or fix the reference. FDS raises ERROR(811).`, line:r.line, rule:'mult-id-undefined' });
    }
});

// ── DEVC / CTRL / SLCF output quantities ─────────────────────────────────────

_rule('devc-quantity', (R, F) => {
    for (const d of R.filter(r => r.name === 'DEVC')) {
        const q = d.params.QUANTITY;
        if (!q) continue;
        const qU = String(q).toUpperCase();
        if (qU in _REJECTED_DEVC_Q)
            F.push({ severity:'ERROR', message:`&DEVC '${d.params.ID||'?'}' uses QUANTITY='${q}' which FDS6 rejects (ERROR 1042).`, hint:_REJECTED_DEVC_Q[qU], line:d.line, rule:'devc-quantity' });
        else if (!_KNOWN_DEVC_Q.has(qU))
            F.push({ severity:'WARNING', message:`&DEVC '${d.params.ID||'?'}' uses QUANTITY='${q}' — not in the known-valid list.`, hint:"Verify spelling/case in the FDS User Guide.", line:d.line, rule:'devc-quantity' });
    }
});

_rule('devc-missing-output', (R, F) => {
    for (const d of R.filter(r => r.name === 'DEVC')) {
        if (!d.params.QUANTITY && !d.params.PROP_ID && !d.params.STATISTICS)
            F.push({ severity:'WARNING', message:`&DEVC '${d.params.ID||'?'}' at line ${d.line} has no QUANTITY and no PROP_ID.`, hint:"Add QUANTITY='<name>' (gas-phase measurement) or PROP_ID='<name>' (sprinkler/detector). FDS raises ERROR(886).", line:d.line, rule:'devc-missing-output' });
    }
});

_rule('devc-wall-ior', (R, F) => {
    for (const d of R.filter(r => r.name === 'DEVC')) {
        const q = d.params.QUANTITY;
        if (!q || !_WALL_DEVC_Q.has(String(q).toUpperCase())) continue;
        if (Array.isArray(d.params.XYZ) && d.params.IOR == null && !Array.isArray(d.params.XB))
            F.push({ severity:'WARNING', message:`&DEVC '${d.params.ID||'?'}' measures '${q}' at XYZ without IOR.`, hint:"Add IOR=±1/±2/±3 to specify which surface face to measure. Without it FDS picks arbitrarily.", line:d.line, rule:'devc-wall-ior' });
    }
});

_rule('devc-zone-needs-xb', (R, F) => {
    for (const d of R.filter(r => r.name === 'DEVC')) {
        const q = d.params.QUANTITY;
        if (!q || !_ZONE_DEVC_Q.has(String(q).toUpperCase())) continue;
        if (Array.isArray(d.params.XYZ) && !(Array.isArray(d.params.XB) && d.params.XB.length === 6))
            F.push({ severity:'ERROR', message:`&DEVC '${d.params.ID||'?'}' uses QUANTITY='${q}' with XYZ instead of XB.`, hint:`'${q}' integrates over a volume — replace XYZ with XB=x0,x1,y0,y1,z0,z1.`, line:d.line, rule:'devc-zone-needs-xb' });
    }
});

_rule('devc-in-hole', (R, F) => {
    const holes = R.filter(r => r.name === 'HOLE' && Array.isArray(r.params.XB) && r.params.XB.length === 6);
    if (!holes.length) return;
    for (const d of R.filter(r => r.name === 'DEVC')) {
        const xyz = d.params.XYZ;
        if (!Array.isArray(xyz) || xyz.length !== 3) continue;
        const [x, y, z] = xyz;
        for (const h of holes) {
            const [x0,x1,y0,y1,z0,z1] = h.params.XB;
            if (x0<=x&&x<=x1&&y0<=y&&y<=y1&&z0<=z&&z<=z1) {
                const sev = d.params.IOR != null ? 'ERROR' : 'WARNING';
                const iorNote = d.params.IOR != null ? ` and uses IOR=${d.params.IOR}` : '';
                F.push({ severity:sev, message:`&DEVC '${d.params.ID||'?'}' XYZ=(${xyz.join(',')}) is inside &HOLE at line ${h.line}${iorNote}.`, hint:"The wall has been carved away. Move the device to where the surface still exists.", line:d.line, rule:'devc-in-hole' });
            }
        }
    }
});

_rule('devc-outside-domain', (R, F) => {
    const meshes = R.filter(r => r.name === 'MESH' && Array.isArray(r.params.XB) && r.params.XB.length === 6).map(r => r.params.XB);
    if (!meshes.length) return;
    const inside = ([x,y,z]) => meshes.some(([x0,x1,y0,y1,z0,z1]) => x0-1e-6<=x&&x<=x1+1e-6&&y0-1e-6<=y&&y<=y1+1e-6&&z0-1e-6<=z&&z<=z1+1e-6);
    for (const d of R.filter(r => r.name === 'DEVC')) {
        const xyz = d.params.XYZ;
        if (Array.isArray(xyz) && xyz.length === 3 && !inside(xyz))
            F.push({ severity:'WARNING', message:`&DEVC '${d.params.ID||'?'}' XYZ=(${xyz.join(',')}) is outside every &MESH.`, hint:"The device will be silently dropped or relocated. Move it inside a mesh boundary.", line:d.line, rule:'devc-outside-domain' });
    }
});

_rule('slcf-quantity', (R, F) => {
    for (const s of R.filter(r => r.name === 'SLCF')) {
        const q = s.params.QUANTITY;
        if (!q) continue;
        const qU = String(q).toUpperCase();
        if (qU in _REJECTED_SLCF_Q)
            F.push({ severity:'ERROR', message:`&SLCF uses QUANTITY='${q}' which FDS6 rejects (ERROR 1042).`, hint:_REJECTED_SLCF_Q[qU], line:s.line, rule:'slcf-quantity' });
        else if (!_KNOWN_SLCF_Q.has(qU))
            F.push({ severity:'WARNING', message:`&SLCF uses QUANTITY='${q}' — not in the known-valid list.`, hint:"Verify spelling/case in the FDS User Guide.", line:s.line, rule:'slcf-quantity' });
    }
});

_rule('spec-id-undefined', (R, F) => {
    const known = _definedSpecies(R);
    const implSoot = _hasImplicitSoot(R);
    for (const r of R) {
        if (r.name !== 'SLCF' && r.name !== 'DEVC') continue;
        const q = r.params.QUANTITY;
        if (!q || !_SPEC_ID_Q.has(String(q).toUpperCase())) continue;
        const sid = r.params.SPEC_ID;
        if (!sid) continue;
        const sU = String(sid).toUpperCase();
        if (sU === 'SOOT' && implSoot)
            F.push({ severity:'ERROR', message:`&${r.name} uses QUANTITY='${q}', SPEC_ID='SOOT' but soot is implicit (SOOT_YIELD in &REAC). FDS will abort with ERROR 1042.`, hint:"Use QUANTITY='VISIBILITY' (always available with implicit soot).", line:r.line, rule:'spec-id-undefined' });
        else if (!known.has(sU))
            F.push({ severity:'WARNING', message:`&${r.name} references SPEC_ID='${sid}' which is not defined via &SPEC.`, hint:`Define &SPEC ID='${sid}', FORMULA='...' / or fix the SPEC_ID spelling.`, line:r.line, rule:'spec-id-undefined' });
    }
});

_rule('ctrl-missing-function-type', (R, F) => {
    for (const c of R.filter(r => r.name === 'CTRL')) {
        if (!c.params.FUNCTION_TYPE)
            F.push({ severity:'ERROR', message:`&CTRL '${c.params.ID||'?'}' at line ${c.line} has no FUNCTION_TYPE.`, hint:"Add FUNCTION_TYPE='ANY'/'ALL'/'TIME_DELAY'/'DEADBAND'/etc. FDS raises ERROR(901).", line:c.line, rule:'ctrl-missing-function-type' });
    }
});

// ── GEOM ──────────────────────────────────────────────────────────────────────

_rule('geom-faces-stride', (R, F) => {
    for (const r of R.filter(r => r.name === 'GEOM')) {
        const faces = _asList(r.params.FACES);
        if (faces.length > 0 && faces.length % 4 !== 0)
            F.push({ severity:'ERROR', message:`&GEOM '${r.params.ID}' has FACES with ${faces.length} integers — not a multiple of 4.`, hint:"Each face is (v1,v2,v3,surf_id_idx) = 4 integers. Append the SURF_ID index to every face. FDS raises ERROR(701). See User Guide Sec. 7.3.2.", line:r.line, rule:'geom-faces-stride' });
    }
});

// ── SURF VEL sign convention ──────────────────────────────────────────────────

_rule('vel-sign-convention', (R, F) => {
    const EXHAUST = ['EXHAUST','EXTRACT','OUTLET','OUTFLOW','EXIT','EXPEL','SUCTION','DRAW'];
    const SUPPLY  = ['SUPPLY','INTAKE','INLET','INFLOW','BLOW','INJECT','FAN_IN'];
    for (const s of R.filter(r => r.name === 'SURF')) {
        const sid = String(s.params.ID || '').toUpperCase();
        if (!sid) continue;
        let flowVal = null, flowKey = null;
        for (const k of ['VEL','VEL_T','VOLUME_FLOW','MASS_FLUX','MASS_FLOW_RATE']) {
            const v = s.params[k];
            if (typeof v === 'number' && v !== 0) { flowVal = v; flowKey = k; break; }
        }
        if (flowVal === null) continue;
        const isEx = EXHAUST.some(t => sid.includes(t));
        const isSu = SUPPLY.some(t => sid.includes(t));
        if (isEx && flowVal < 0)
            F.push({ severity:'WARNING', message:`&SURF '${s.params.ID}' has ${flowKey}=${flowVal} (negative). Name implies EXHAUST but negative pushes flow INTO the domain.`, hint:`Positive ${flowKey} draws flow OUT of the domain (exhaust). Flip sign to ${-flowVal} for extraction.`, line:s.line, rule:'vel-sign-convention' });
        else if (isSu && flowVal > 0)
            F.push({ severity:'WARNING', message:`&SURF '${s.params.ID}' has ${flowKey}=${flowVal} (positive). Name implies SUPPLY but positive draws flow OUT.`, hint:`Negative ${flowKey} pushes flow INTO the domain (supply). Flip sign to ${-flowVal}.`, line:s.line, rule:'vel-sign-convention' });
    }
});

// ── RAMP T monotonicity ───────────────────────────────────────────────────────
// FDS User Guide §11.1: "each set of RAMP lines must be listed with monotonically increasing T"

_rule('ramp-t-monotonic', (R, F) => {
    const groups = {};
    for (const r of R.filter(r => r.name === 'RAMP')) {
        const id = String(r.params.ID || '');
        if (!id) continue;
        if (!groups[id]) groups[id] = [];
        groups[id].push(r);
    }
    for (const [id, ramps] of Object.entries(groups)) {
        ramps.sort((a, b) => a.line - b.line);
        for (let i = 1; i < ramps.length; i++) {
            const prevT = ramps[i-1].params.T, currT = ramps[i].params.T;
            if (typeof prevT !== 'number' || typeof currT !== 'number') continue;
            if (currT <= prevT)
                F.push({ severity:'ERROR', message:`&RAMP ID='${id}': T=${currT} at line ${ramps[i].line} is not greater than T=${prevT} at line ${ramps[i-1].line}.`, hint:"RAMP lines must be listed with monotonically increasing T (FDS User Guide §11.1). FDS may silently produce wrong interpolation.", line:ramps[i].line, rule:'ramp-t-monotonic' });
        }
    }
});

// ── Mesh cell aspect ratio ────────────────────────────────────────────────────
// FDS User Guide §2.3.1: "mesh cells that have an aspect ratio larger than 2 to 1" → numerical instability

_rule('mesh-cell-aspect-ratio', (R, F) => {
    for (const m of R.filter(r => r.name === 'MESH')) {
        const xb = m.params.XB, ijk = m.params.IJK;
        if (!Array.isArray(xb) || xb.length !== 6 || !Array.isArray(ijk) || ijk.length !== 3) continue;
        const dx = (xb[1]-xb[0]) / ijk[0];
        const dy = (xb[3]-xb[2]) / ijk[1];
        const dz = (xb[5]-xb[4]) / ijk[2];
        const dims = [dx, dy, dz].filter(d => d > 0);
        if (dims.length < 2) continue;
        const ratio = Math.max(...dims) / Math.min(...dims);
        if (ratio > 3)
            F.push({ severity:'WARNING', message:`&MESH at line ${m.line} cell aspect ratio ≈ ${ratio.toFixed(1)}:1 (dx=${dx.toFixed(3)}, dy=${dy.toFixed(3)}, dz=${dz.toFixed(3)} m).`, hint:"Cell aspect ratio >2:1 is a common cause of numerical instability (FDS User Guide §16.2.4). Refine or redistribute cells.", line:m.line, rule:'mesh-cell-aspect-ratio' });
        else if (ratio > 2)
            F.push({ severity:'INFO', message:`&MESH at line ${m.line} cell aspect ratio ≈ ${ratio.toFixed(1)}:1 (dx=${dx.toFixed(3)}, dy=${dy.toFixed(3)}, dz=${dz.toFixed(3)} m).`, hint:"Aspect ratios approaching 2:1 begin to degrade LES accuracy. Consider more uniform cell sizing.", line:m.line, rule:'mesh-cell-aspect-ratio' });
    }
});

// ── INIT PART_ID cross-reference ──────────────────────────────────────────────

_rule('init-part-id-undefined', (R, F) => {
    const parts = new Set(R.filter(r => r.name === 'PART').map(r => String(r.params.ID || '')));
    for (const r of R.filter(r => r.name === 'INIT')) {
        const pid = r.params.PART_ID;
        if (pid && !parts.has(String(pid)))
            F.push({ severity:'ERROR', message:`&INIT at line ${r.line} references PART_ID='${pid}' which is not defined.`, hint:`Define &PART ID='${pid}', SPEC_ID='...', ... / or fix the PART_ID.`, line:r.line, rule:'init-part-id-undefined' });
    }
});

// ── Deprecated parameter names ────────────────────────────────────────────────
// MOISTURE_CONTENT was renamed MOISTURE_FRACTION in FDS6 (User Guide §11.4)

_rule('deprecated-params', (R, F) => {
    for (const r of R) {
        if (r.params.MOISTURE_CONTENT != null)
            F.push({ severity:'WARNING', message:`&${r.name} at line ${r.line} uses MOISTURE_CONTENT — the old FDS5 parameter name.`, hint:"Rename to MOISTURE_FRACTION (FDS6 User Guide §11.4). MOISTURE_CONTENT is silently ignored in FDS6, giving zero moisture.", line:r.line, rule:'deprecated-params' });
    }
});

// ── DUMP NFRAMES ──────────────────────────────────────────────────────────────

_rule('dump-nframes-positive', (R, F) => {
    for (const r of R.filter(r => r.name === 'DUMP')) {
        const nf = r.params.NFRAMES;
        if (typeof nf === 'number' && nf < 1)
            F.push({ severity:'ERROR', message:`&DUMP NFRAMES=${nf} — must be a positive integer.`, hint:"NFRAMES is the number of output time frames. Default is 1000. Zero causes a division-by-zero at output time.", line:r.line, rule:'dump-nframes-positive' });
    }
});

// ── REAC FUEL must match a known or defined species ───────────────────────────
// If FUEL is not predefined and no &SPEC defines it, FDS assigns nitrogen properties

_rule('reac-fuel-species', (R, F) => {
    // Use only user-defined &SPEC IDs — not _definedSpecies() (adds REAC FUEL
    // itself) and not _BUILTIN_SPECIES (AIR, N2, etc. are not burnable fuels;
    // all legitimate builtin fuels are already covered by KNOWN_FUELS below).
    const specDefined = new Set(
        R.filter(r => r.name === 'SPEC' && r.params.ID)
            .map(r => String(r.params.ID).toUpperCase())
    );
    const KNOWN_FUELS = new Set([
        'METHANE','PROPANE','ETHYLENE','ACETYLENE','N-HEPTANE','HEPTANE',
        'ETHANOL','METHANOL','TOLUENE','BUTANE','HYDROGEN','ISOPROPANOL',
        'N-DECANE','N-HEXANE','ETHANE','NATURAL GAS','PROPYLENE','ACETONE',
        'WOOD','CELLULOSE','POLYURETHANE','POLYMETHYLMETHACRYLATE','PMMA',
        'DIESEL','KEROSENE','GASOLINE','BENZENE','STYRENE','NYLON',
    ]);
    for (const r of R.filter(r => r.name === 'REAC')) {
        const fuel = r.params.FUEL;
        if (!fuel) continue;
        const fU = String(fuel).toUpperCase();
        if (!specDefined.has(fU) && !KNOWN_FUELS.has(fU))
            F.push({ severity:'WARNING', message:`&REAC FUEL='${fuel}' is not a predefined FDS species and no &SPEC with this ID is defined.`, hint:`Define &SPEC ID='${fuel}', FORMULA='CxHy', MW=..., ... / or use a standard name like PROPANE or N-HEPTANE.`, line:r.line, rule:'reac-fuel-species' });
    }
});

// ── SURF conflicting flow boundary conditions ─────────────────────────────────

_rule('surf-vel-flow-conflict', (R, F) => {
    for (const s of R.filter(r => r.name === 'SURF')) {
        const hasVel  = s.params.VEL != null || s.params.VEL_T != null;
        const hasFlow = s.params.VOLUME_FLOW != null || s.params.MASS_FLUX != null || s.params.MASS_FLOW_RATE != null;
        if (hasVel && hasFlow)
            F.push({ severity:'WARNING', message:`&SURF '${s.params.ID||'?'}' specifies both velocity (VEL/VEL_T) and a flow rate (VOLUME_FLOW/MASS_FLUX/MASS_FLOW_RATE).`, hint:"Specify only one flow type. FDS will use one and silently ignore the other, giving unexpected flow rates.", line:s.line, rule:'surf-vel-flow-conflict' });
    }
});

// ── CHID length limit ─────────────────────────────────────────────────────────
// FDS hard-crashes if CHID exceeds 39 characters (used as base filename)

_rule('chid-length', (R, F) => {
    for (const r of R.filter(r => r.name === 'HEAD')) {
        const chid = String(r.params.CHID || '');
        if (chid.length > 39)
            F.push({ severity:'ERROR', message:`CHID '${chid}' is ${chid.length} characters — FDS rejects CHID longer than 39 characters.`, hint:`Shorten CHID to ≤39 characters. FDS uses CHID as the base filename prefix, and longer values cause a hard crash at startup.`, line:r.line, rule:'chid-length' });
    }
});

// ── XB / XYZ / IJK array length ───────────────────────────────────────────────
// XB always needs exactly 6 values; XYZ exactly 3; IJK (MESH only) exactly 3.

_rule('array-count', (R, F) => {
    for (const r of R) {
        const xb = r.params.XB;
        if (xb !== undefined) {
            const n = Array.isArray(xb) ? xb.length : 1;
            if (n !== 6)
                F.push({ severity:'ERROR', message:`&${r.name} at line ${r.line} XB has ${n} value${n===1?'':'s'} — exactly 6 required (x0,x1,y0,y1,z0,z1).`, hint:`Count the commas: XB must be six comma-separated numbers. FDS raises ERROR(119) with a wrong-length XB.`, line:r.line, rule:'array-count' });
        }
        const xyz = r.params.XYZ;
        if (xyz !== undefined) {
            const n = Array.isArray(xyz) ? xyz.length : 1;
            if (n !== 3)
                F.push({ severity:'ERROR', message:`&${r.name} at line ${r.line} XYZ has ${n} value${n===1?'':'s'} — exactly 3 required (x,y,z).`, hint:`XYZ must be three comma-separated numbers: XYZ=x,y,z.`, line:r.line, rule:'array-count' });
        }
        if (r.name === 'MESH') {
            const ijk = r.params.IJK;
            if (ijk !== undefined) {
                const n = Array.isArray(ijk) ? ijk.length : 1;
                if (n !== 3)
                    F.push({ severity:'ERROR', message:`&MESH at line ${r.line} IJK has ${n} value${n===1?'':'s'} — exactly 3 required (I,J,K).`, hint:`IJK must be three integers: IJK=I,J,K. FDS raises ERROR(113).`, line:r.line, rule:'array-count' });
            }
        }
    }
});

// ── TIME T_BEGIN must be before T_END ─────────────────────────────────────────

_rule('time-t-begin-end', (R, F) => {
    for (const r of R.filter(r => r.name === 'TIME')) {
        const tb = r.params.T_BEGIN, te = r.params.T_END;
        if (typeof tb === 'number' && typeof te === 'number' && tb >= te)
            F.push({ severity:'ERROR', message:`&TIME T_BEGIN=${tb} ≥ T_END=${te} — simulation would run for zero or negative time.`, hint:`T_BEGIN must be strictly less than T_END. The default T_BEGIN is 0.0.`, line:r.line, rule:'time-t-begin-end' });
    }
});

// ── REAC species yield sanity ─────────────────────────────────────────────────
// Yields are mass fractions (kg/kg): must be ≥ 0, each ≤ 1, combined ≤ 1.

_rule('reac-yield-range', (R, F) => {
    for (const r of R.filter(r => r.name === 'REAC')) {
        const sy = r.params.SOOT_YIELD, cy = r.params.CO_YIELD;
        for (const [k, v] of [['SOOT_YIELD', sy], ['CO_YIELD', cy]]) {
            if (typeof v !== 'number') continue;
            if (v < 0)
                F.push({ severity:'ERROR', message:`&REAC ${k}=${v} is negative — mass fractions cannot be negative.`, hint:`${k} is in kg soot (or CO) per kg fuel burned. Negative values are unphysical and FDS will abort.`, line:r.line, rule:'reac-yield-range' });
            else if (v > 1)
                F.push({ severity:'ERROR', message:`&REAC ${k}=${v} exceeds 1.0 — cannot produce more species mass than fuel mass.`, hint:`${k} is a mass fraction (kg/kg). Values >1 violate conservation of mass.`, line:r.line, rule:'reac-yield-range' });
        }
        if (typeof sy === 'number' && typeof cy === 'number' && sy + cy > 1)
            F.push({ severity:'WARNING', message:`&REAC SOOT_YIELD + CO_YIELD = ${(sy+cy).toFixed(3)} > 1.0 — combined yields exceed fuel mass.`, hint:`Typical values: SOOT_YIELD 0.01–0.10, CO_YIELD 0.01–0.05 depending on fuel. Their sum must be < 1.`, line:r.line, rule:'reac-yield-range' });
    }
});

// ── SURF HRRPUA / MLRPUA = 0 ──────────────────────────────────────────────────
// A fire surface with zero heat release does nothing — almost always a typo.

_rule('surf-hrrpua-zero', (R, F) => {
    for (const s of R.filter(r => r.name === 'SURF')) {
        for (const k of ['HRRPUA', 'MLRPUA']) {
            if (s.params[k] === 0)
                F.push({ severity:'WARNING', message:`&SURF '${s.params.ID||'?'}' has ${k}=0 — this surface releases no heat and produces no fire.`, hint:`${k}=0 is almost certainly a typo. Set a positive value (e.g. HRRPUA=250 kW/m²) or remove the parameter entirely.`, line:s.line, rule:'surf-hrrpua-zero' });
        }
    }
});

// ── RAMP with only one point ───────────────────────────────────────────────────
// A single-entry RAMP cannot interpolate; FDS may warn and treat it as a constant.

_rule('ramp-single-entry', (R, F) => {
    const groups = {};
    for (const r of R.filter(r => r.name === 'RAMP')) {
        const id = String(r.params.ID || '');
        if (!id) continue;
        (groups[id] = groups[id] || []).push(r);
    }
    for (const [id, entries] of Object.entries(groups)) {
        if (entries.length === 1)
            F.push({ severity:'WARNING', message:`&RAMP ID='${id}' has only 1 entry — interpolation requires at least 2 (T,F) pairs.`, hint:`Add a second &RAMP ID='${id}', T=..., F=... / entry. A single point makes the ramp act as a constant, which may not be what you intend.`, line:entries[0].line, rule:'ramp-single-entry' });
    }
});

// ── DEVC missing ID ───────────────────────────────────────────────────────────

_rule('devc-id-missing', (R, F) => {
    for (const d of R.filter(r => r.name === 'DEVC')) {
        const id = d.params.ID;
        if (!id || (typeof id === 'string' && !id.trim()))
            F.push({ severity:'WARNING', message:`&DEVC at line ${d.line} has no ID — output column will be unlabelled in _devc.csv.`, hint:`Add ID='<name>' so the device can be identified in output files and referenced by CTRL.`, line:d.line, rule:'devc-id-missing' });
    }
});

// ── VENT / OBST outside domain ────────────────────────────────────────────────
// Geometry outside all mesh bounds is silently dropped by FDS.

_rule('vent-outside-domain', (R, F) => {
    const meshes = R.filter(r => r.name === 'MESH' && Array.isArray(r.params.XB) && r.params.XB.length === 6).map(r => r.params.XB);
    if (!meshes.length) return;
    const overlaps = (a, b) =>
        a[0] <= b[1]+1e-6 && a[1] >= b[0]-1e-6 &&
        a[2] <= b[3]+1e-6 && a[3] >= b[2]-1e-6 &&
        a[4] <= b[5]+1e-6 && a[5] >= b[4]-1e-6;
    for (const v of R.filter(r => r.name === 'VENT')) {
        const xb = v.params.XB;
        if (!Array.isArray(xb) || xb.length !== 6 || v.params.MB) continue;
        if (!meshes.some(m => overlaps(xb, m)))
            F.push({ severity:'ERROR', message:`&VENT at line ${v.line} XB=(${xb.join(',')}) is outside all &MESH boundaries — it will be silently ignored by FDS.`, hint:`Move the VENT inside a mesh face, or use MB='XMIN'/'XMAX'/'YMIN'/'YMAX'/'ZMIN'/'ZMAX' to attach it to a mesh boundary.`, line:v.line, rule:'vent-outside-domain' });
    }
});

_rule('obst-outside-domain', (R, F) => {
    const meshes = R.filter(r => r.name === 'MESH' && Array.isArray(r.params.XB) && r.params.XB.length === 6).map(r => r.params.XB);
    if (!meshes.length) return;
    const overlaps = (a, b) =>
        a[0] < b[1]+1e-6 && a[1] > b[0]-1e-6 &&
        a[2] < b[3]+1e-6 && a[3] > b[2]-1e-6 &&
        a[4] < b[5]+1e-6 && a[5] > b[4]-1e-6;
    for (const o of R.filter(r => r.name === 'OBST')) {
        const xb = o.params.XB;
        if (!Array.isArray(xb) || xb.length !== 6) continue;
        if (!meshes.some(m => overlaps(xb, m)))
            F.push({ severity:'WARNING', message:`&OBST at line ${o.line} XB=(${xb.join(',')}) has no overlap with any &MESH — it will be silently ignored.`, hint:`Check the coordinates. FDS clips obstructions to mesh boundaries but drops those with zero overlap entirely.`, line:o.line, rule:'obst-outside-domain' });
    }
});

// ── VENT not on a mesh boundary or OBST face ─────────────────────────────────
// FDS requires every VENT to be placed flush against a solid surface: either a
// mesh boundary plane or a face of an OBST. A floating VENT is silently attached
// to whatever surface FDS finds nearby — usually the wrong one.
//
// Algorithm:
//  1. Determine the plane axis (X / Y / Z) from the equal coordinate pair.
//  2. Check if that plane coincides (within tolerance) with any mesh boundary.
//  3. Check if that plane coincides with a face of any OBST whose other two
//     extents overlap the VENT's extents.

_rule('vent-not-on-surface', (R, F) => {
    const EPS  = 1e-4;
    const meshes = R.filter(r => r.name === 'MESH' && Array.isArray(r.params.XB) && r.params.XB.length === 6).map(r => r.params.XB);
    const obsts  = R.filter(r => r.name === 'OBST' && Array.isArray(r.params.XB) && r.params.XB.length === 6).map(r => r.params.XB);
    if (!meshes.length) return;

    for (const v of R.filter(r => r.name === 'VENT')) {
        const xb = v.params.XB;
        if (!Array.isArray(xb) || xb.length !== 6) continue;
        if (v.params.MB) continue;          // MB= explicitly names a mesh boundary

        const [vx0,vx1,vy0,vy1,vz0,vz1] = xb;
        let axis = null, vp = 0;
        if (Math.abs(vx1-vx0) < EPS) { axis = 'X'; vp = (vx0+vx1)/2; }
        else if (Math.abs(vy1-vy0) < EPS) { axis = 'Y'; vp = (vy0+vy1)/2; }
        else if (Math.abs(vz1-vz0) < EPS) { axis = 'Z'; vp = (vz0+vz1)/2; }
        else continue;                      // non-planar — caught by vent-not-planar

        // On a mesh boundary?
        const onMesh = meshes.some(m => {
            if (axis === 'X') return Math.abs(vp-m[0]) < EPS || Math.abs(vp-m[1]) < EPS;
            if (axis === 'Y') return Math.abs(vp-m[2]) < EPS || Math.abs(vp-m[3]) < EPS;
                              return Math.abs(vp-m[4]) < EPS || Math.abs(vp-m[5]) < EPS;
        });
        if (onMesh) continue;

        // On an OBST face? (plane matches a face AND lateral extents overlap)
        const onObst = obsts.some(o => {
            const [ox0,ox1,oy0,oy1,oz0,oz1] = o;
            if (axis === 'X') {
                return (Math.abs(vp-ox0) < EPS || Math.abs(vp-ox1) < EPS) &&
                       vy0 < oy1+EPS && vy1 > oy0-EPS &&
                       vz0 < oz1+EPS && vz1 > oz0-EPS;
            }
            if (axis === 'Y') {
                return (Math.abs(vp-oy0) < EPS || Math.abs(vp-oy1) < EPS) &&
                       vx0 < ox1+EPS && vx1 > ox0-EPS &&
                       vz0 < oz1+EPS && vz1 > oz0-EPS;
            }
            return (Math.abs(vp-oz0) < EPS || Math.abs(vp-oz1) < EPS) &&
                   vx0 < ox1+EPS && vx1 > ox0-EPS &&
                   vy0 < oy1+EPS && vy1 > oy0-EPS;
        });
        if (onObst) continue;

        F.push({
            severity: 'WARNING',
            message: `&VENT at line ${v.line} XB=(${xb.join(',')}) is not on a mesh boundary or any &OBST face — FDS will snap it to the nearest surface, which may not be the intended one.`,
            hint: `Place the VENT flush against a mesh boundary (or use MB='XMIN'/'XMAX'/'YMIN'/'YMAX'/'ZMIN'/'ZMAX') or align it with an OBST face. A floating VENT is silently redirected by FDS.`,
            line: v.line,
            rule: 'vent-not-on-surface',
        });
    }
});

// ── MATL Arrhenius completeness ────────────────────────────────────────────────
// Arrhenius kinetics require both A (pre-exponential) and either E or REFERENCE_TEMPERATURE.

_rule('matl-arrhenius-incomplete', (R, F) => {
    for (const m of R.filter(r => r.name === 'MATL')) {
        const hasA   = m.params.A != null;
        const hasE   = m.params.E != null;
        const hasRef = m.params.REFERENCE_TEMPERATURE != null;
        if (hasA && !hasE && !hasRef)
            F.push({ severity:'WARNING', message:`&MATL '${m.params.ID||'?'}' has A but no E or REFERENCE_TEMPERATURE — Arrhenius pair is incomplete.`, hint:`Add E=<J/mol> (activation energy) or REFERENCE_TEMPERATURE=<°C>. FDS needs both A and E (or A and REFERENCE_TEMPERATURE) to compute pyrolysis rates.`, line:m.line, rule:'matl-arrhenius-incomplete' });
        if (hasE && !hasA)
            F.push({ severity:'WARNING', message:`&MATL '${m.params.ID||'?'}' has E but no A — Arrhenius pre-exponential factor is missing.`, hint:`Add A=<s⁻¹> (pre-exponential factor). FDS needs A alongside E for Arrhenius pyrolysis kinetics.`, line:m.line, rule:'matl-arrhenius-incomplete' });
    }
});

// ── SURF MATL_MASS_FRACTION consistency ───────────────────────────────────────
// Count must match MATL_ID count and values must sum to 1.

_rule('surf-matl-mass-fraction', (R, F) => {
    for (const s of R.filter(r => r.name === 'SURF')) {
        const ids   = _asList(s.params.MATL_ID);
        const fracs = _asList(s.params.MATL_MASS_FRACTION);
        if (!ids.length || !fracs.length) continue;
        if (fracs.length !== ids.length) {
            F.push({ severity:'WARNING', message:`&SURF '${s.params.ID||'?'}' has ${ids.length} MATL_ID entries but ${fracs.length} MATL_MASS_FRACTION values — counts must match.`, hint:`Provide one MATL_MASS_FRACTION value per MATL_ID. FDS may silently assign incorrect fractions.`, line:s.line, rule:'surf-matl-mass-fraction' });
        } else {
            const nums = fracs.filter(f => typeof f === 'number');
            if (nums.length === fracs.length) {
                const sum = nums.reduce((a, b) => a + b, 0);
                if (Math.abs(sum - 1.0) > 0.01)
                    F.push({ severity:'WARNING', message:`&SURF '${s.params.ID||'?'}' MATL_MASS_FRACTION sums to ${sum.toFixed(4)} — should be 1.0.`, hint:`MATL_MASS_FRACTION values are mass fractions and must sum to exactly 1.0.`, line:s.line, rule:'surf-matl-mass-fraction' });
            }
        }
    }
});

// ── Missing comma between parameters ─────────────────────────────────────────
// FDS namelists are comma-delimited. Catches both same-line (ID='A' COLOR='B')
// and cross-line (value on one line, IDENTIFIER= on the next) missing commas.
// Pattern: string or number value followed by whitespace (no comma) then IDENT=

_rule('missing-comma', (R, F) => {
    // Matches: closing quote or number, then whitespace (no comma), then IDENT=
    // The \s+ covers both spaces (same-line) and newlines (cross-line).
    const RE = /('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|\b[\d.]+(?:[eE][+-]?\d+)?)\s+(?=[A-Za-z_]\w*(?:\([^)]*\))?\s*=)/g;
    for (const r of R) {
        if (!r._body) continue;
        RE.lastIndex = 0;
        let m;
        while ((m = RE.exec(r._body)) !== null) {
            // Line where the value ends
            const valEnd = m.index + m[1].length;
            const lineOffset = (r._body.slice(0, valEnd).match(/\n/g) || []).length;
            const lineNum = r._bodyLine + lineOffset;
            const nextId = (r._body.slice(m.index + m[0].length).match(/^([A-Za-z_]\w*)/) || [])[1] || '?';
            F.push({
                severity: 'WARNING',
                message: `&${r.name} line ${lineNum}: missing comma after ${m[1]} before '${nextId}='.`,
                hint: `Add a comma after the value. FDS namelists are comma-delimited — a missing comma can cause the Fortran parser to silently misread '${nextId}'.`,
                line: lineNum,
                rule: 'missing-comma',
            });
        }
    }
});

// ── Unterminated / parameter-absorbing string literals ───────────────────────
// Catches SURF_ID='CONCRETE, COLOR='GRAY where the missing closing quote after
// CONCRETE causes the parser to read 'CONCRETE, COLOR=' as the full string value.
// We re-scan each record body for strings whose content contains a comma (or
// whitespace) followed by an ALL-CAPS identifier followed by '=' — a pattern
// that only appears legitimately BETWEEN parameters, never INSIDE a value.

_rule('unterminated-string', (R, F) => {
    // Matches ', PARAM=' or ' PARAM=' inside a string (min 2-char param name).
    const ABSORBED = /(?:,|\s)\s*([A-Z_][A-Z0-9_]{1,})\s*=/;
    for (const r of R) {
        if (!r._body) continue;
        const body = r._body;
        let i = 0;
        while (i < body.length) {
            const q = body[i];
            if (q !== "'" && q !== '"') { i++; continue; }
            const start = i;
            i++;
            while (i < body.length && body[i] !== q) i++;
            if (i >= body.length) {
                // Opening quote with no matching closing quote in the body
                const lineOffset = (body.slice(0, start).match(/\n/g) || []).length;
                F.push({
                    severity: 'ERROR',
                    message: `&${r.name} line ${r._bodyLine + lineOffset}: unterminated string — opening ${q} has no matching closing quote.`,
                    hint: `Add a closing ${q} to end the string value.`,
                    line: r._bodyLine + lineOffset,
                    rule: 'unterminated-string',
                });
                break;
            }
            const content = body.slice(start + 1, i);
            const am = content.match(ABSORBED);
            // Only fire the "absorbed param" heuristic if the string content
            // looks like FDS keyword fragments — all-caps identifiers plus
            // punctuation. A real title/description containing lowercase letters
            // (e.g. "Run with HRRPUA=500 kW") is legitimate FDS and must not fire.
            const prefix = am ? content.slice(0, content.search(ABSORBED)) : '';
            const isKeywordLike = am && !/[a-z]/.test(prefix);
            if (isKeywordLike) {
                const lineOffset = (body.slice(0, start).match(/\n/g) || []).length;
                const lineNum = r._bodyLine + lineOffset;
                const bare = prefix.trim();
                F.push({
                    severity: 'ERROR',
                    message: `&${r.name} line ${lineNum}: missing closing ${q} after '${bare}' — the ${am[1]} parameter was absorbed into the string value.`,
                    hint: `Change ${q}${content}${q} to ${q}${bare}${q}. Without the closing quote, the Fortran parser reads '${am[1]}' as part of the string instead of a separate parameter.`,
                    line: lineNum,
                    rule: 'unterminated-string',
                });
            }
            i++; // step past closing quote
        }
    }
});

// ── MATL zero physical properties ────────────────────────────────────────────
// ERROR(253/254/255): DENSITY/CONDUCTIVITY/SPECIFIC_HEAT = 0 causes division-by-zero.

_rule('matl-zero-properties', (R, F) => {
    for (const m of R.filter(r => r.name === 'MATL')) {
        for (const [k, code] of [['DENSITY',253],['CONDUCTIVITY',254],['SPECIFIC_HEAT',255]]) {
            if (m.params[k] === 0)
                F.push({ severity:'ERROR', message:`&MATL '${m.params.ID||'?'}' has ${k}=0 — FDS raises ERROR(${code}).`, hint:`${k} must be a positive value. Zero causes a division-by-zero or ill-conditioned heat transfer calculation.`, line:m.line, rule:'matl-zero-properties' });
        }
    }
});

// ── MATL HEAT_OF_REACTION must be positive ───────────────────────────────────
// ERROR(252): zero or negative HEAT_OF_REACTION is unphysical — pyrolysis absorbs energy.

_rule('matl-heat-of-reaction', (R, F) => {
    for (const m of R.filter(r => r.name === 'MATL')) {
        const hor = m.params.HEAT_OF_REACTION;
        if (typeof hor === 'number' && hor <= 0)
            F.push({ severity:'ERROR', message:`&MATL '${m.params.ID||'?'}' has HEAT_OF_REACTION=${hor} — must be positive (FDS raises ERROR(252)).`, hint:`HEAT_OF_REACTION is the energy absorbed during pyrolysis (kJ/kg). A zero or negative value is unphysical and causes FDS to abort.`, line:m.line, rule:'matl-heat-of-reaction' });
    }
});

// ── SURF HRRPUA/MLRPUA conflicts with pyrolysis MATL_ID ─────────────────────
// ERROR(357): HRRPUA/MLRPUA (prescribed fire) + MATL_ID (pyrolysis model) conflict.

_rule('surf-hrrpua-pyrolysis-conflict', (R, F) => {
    for (const s of R.filter(r => r.name === 'SURF')) {
        const hasHrrpua = s.params.HRRPUA != null || s.params.MLRPUA != null;
        const hasMatlId = _asList(s.params.MATL_ID).length > 0;
        if (hasHrrpua && hasMatlId)
            F.push({ severity:'ERROR', message:`&SURF '${s.params.ID||'?'}' has HRRPUA/MLRPUA and MATL_ID — FDS raises ERROR(357).`, hint:`Use either HRRPUA/MLRPUA (prescribed fire rate) or MATL_ID (pyrolysis reactions), not both. They specify the combustion rate in conflicting ways.`, line:s.line, rule:'surf-hrrpua-pyrolysis-conflict' });
    }
});

// ── SURF MASS_FLUX must be ≥ 0 ───────────────────────────────────────────────
// ERROR(321): negative MASS_FLUX is unphysical on a solid surface boundary.

_rule('surf-mass-flux-negative', (R, F) => {
    for (const s of R.filter(r => r.name === 'SURF')) {
        const mf = s.params.MASS_FLUX;
        if (typeof mf === 'number' && mf < 0)
            F.push({ severity:'ERROR', message:`&SURF '${s.params.ID||'?'}' has MASS_FLUX=${mf} — must be ≥ 0 (FDS raises ERROR(321)).`, hint:`MASS_FLUX is a non-negative mass flux (kg/m²/s) from the surface into the gas phase. For inflow use VEL or VOLUME_FLOW.`, line:s.line, rule:'surf-mass-flux-negative' });
    }
});

// ── SURF with MATL_ID requires THICKNESS ─────────────────────────────────────
// ERROR(307): a layered surface must specify the thickness of each layer.

_rule('surf-thickness-required', (R, F) => {
    for (const s of R.filter(r => r.name === 'SURF')) {
        if (_asList(s.params.MATL_ID).length > 0 && s.params.THICKNESS == null)
            F.push({ severity:'ERROR', message:`&SURF '${s.params.ID||'?'}' has MATL_ID but no THICKNESS — FDS raises ERROR(307).`, hint:`Add THICKNESS=<m> (one value per material layer). Without THICKNESS FDS cannot compute solid-phase heat conduction.`, line:s.line, rule:'surf-thickness-required' });
    }
});

// ── CTRL INPUT_ID must resolve to a known DEVC or CTRL ───────────────────────
// ERROR(916): INPUT_ID references a name not defined as any DEVC or CTRL.

_rule('ctrl-input-undefined', (R, F) => {
    const devcIds = new Set(R.filter(r => r.name === 'DEVC' && r.params.ID).map(r => String(r.params.ID)));
    const ctrlIds = new Set(R.filter(r => r.name === 'CTRL' && r.params.ID).map(r => String(r.params.ID)));
    const all = new Set([...devcIds, ...ctrlIds]);
    if (!all.size) return;
    for (const c of R.filter(r => r.name === 'CTRL')) {
        for (const iid of _asList(c.params.INPUT_ID)) {
            const s = String(iid);
            if (s && !all.has(s))
                F.push({ severity:'ERROR', message:`&CTRL '${c.params.ID||'?'}' INPUT_ID='${s}' is not defined as a DEVC or CTRL ID — FDS raises ERROR(916).`, hint:`Define &DEVC ID='${s}', ... / or &CTRL ID='${s}', ... / or fix the INPUT_ID spelling.`, line:c.line, rule:'ctrl-input-undefined' });
        }
    }
});

// ── CTRL logic types require at least one INPUT_ID ────────────────────────────
// ERROR(905): logic-type CTRL with no inputs defined.

_rule('ctrl-no-inputs', (R, F) => {
    const NEEDS_INPUT = new Set(['ANY','ALL','ONLY','AT_LEAST','EXACTLY','TIME_DELAY']);
    for (const c of R.filter(r => r.name === 'CTRL')) {
        const ft = String(c.params.FUNCTION_TYPE || '').toUpperCase();
        if (!NEEDS_INPUT.has(ft)) continue;
        if (!c.params.INPUT_ID)
            F.push({ severity:'WARNING', message:`&CTRL '${c.params.ID||'?'}' FUNCTION_TYPE='${c.params.FUNCTION_TYPE}' has no INPUT_ID — FDS raises ERROR(905).`, hint:`Add INPUT_ID='<devc_or_ctrl_id>' to link this controller to a sensor or another controller.`, line:c.line, rule:'ctrl-no-inputs' });
    }
});

// ── HOLE must overlap at least one OBST ──────────────────────────────────────
// A HOLE with no overlapping OBST is silently ignored by FDS.

_rule('hole-no-obst', (R, F) => {
    const obsts = R.filter(r => r.name === 'OBST' && Array.isArray(r.params.XB) && r.params.XB.length === 6).map(r => r.params.XB);
    if (!obsts.length) return;
    const overlaps = (a, b) =>
        a[0] < b[1]+1e-6 && a[1] > b[0]-1e-6 &&
        a[2] < b[3]+1e-6 && a[3] > b[2]-1e-6 &&
        a[4] < b[5]+1e-6 && a[5] > b[4]-1e-6;
    for (const h of R.filter(r => r.name === 'HOLE')) {
        const xb = h.params.XB;
        if (!Array.isArray(xb) || xb.length !== 6) continue;
        if (!obsts.some(o => overlaps(xb, o)))
            F.push({ severity:'WARNING', message:`&HOLE at line ${h.line} XB=(${xb.join(',')}) does not overlap any &OBST — it will have no effect.`, hint:`A HOLE only carves openings in existing OBSTructions. If no OBST intersects it, FDS silently ignores it. Check the coordinates.`, line:h.line, rule:'hole-no-obst' });
    }
});

// ── VENT/OBST/HOLE cannot have both CTRL_ID and DEVC_ID ─────────────────────
// ERROR(393): only one activation mechanism is allowed per element.

_rule('ctrl-devc-conflict', (R, F) => {
    for (const r of R) {
        if (!['VENT','OBST','HOLE'].includes(r.name)) continue;
        if (r.params.CTRL_ID != null && r.params.DEVC_ID != null)
            F.push({ severity:'ERROR', message:`&${r.name} at line ${r.line} has both CTRL_ID='${r.params.CTRL_ID}' and DEVC_ID='${r.params.DEVC_ID}' — FDS raises ERROR(393).`, hint:`Use only one activation mechanism: CTRL_ID (logic controller) or DEVC_ID (device sensor), not both.`, line:r.line, rule:'ctrl-devc-conflict' });
    }
});

// ── INIT MASS_FRACTION and VOLUME_FRACTION are mutually exclusive ─────────────
// ERROR(842): FDS cannot accept both simultaneously on the same INIT record.

_rule('init-fraction-conflict', (R, F) => {
    for (const r of R.filter(r => r.name === 'INIT')) {
        if (r.params.MASS_FRACTION != null && r.params.VOLUME_FRACTION != null)
            F.push({ severity:'ERROR', message:`&INIT at line ${r.line} has both MASS_FRACTION and VOLUME_FRACTION — FDS raises ERROR(842).`, hint:`Use MASS_FRACTION for mass-based or VOLUME_FRACTION for volume-based species initialisation. They are mutually exclusive.`, line:r.line, rule:'init-fraction-conflict' });
    }
});

// ── Cylindrical coordinate mesh constraints ───────────────────────────────────
// ERROR(120): XB(1) < 0 in cylindrical mode (radial axis cannot be negative).
// ERROR(121): IJK(2) ≠ 1 in cylindrical mode (azimuthal dimension must be 1).

_rule('mesh-cylindrical', (R, F) => {
    const isCyl = R.some(r => r.name === 'MISC' && r.params.CYLINDRICAL === true);
    if (!isCyl) return;
    for (const m of R.filter(r => r.name === 'MESH')) {
        const xb = m.params.XB;
        if (Array.isArray(xb) && xb.length === 6 && xb[0] < -1e-6)
            F.push({ severity:'ERROR', message:`&MESH at line ${m.line} XB(1)=${xb[0]} < 0 in cylindrical coordinates — FDS raises ERROR(120).`, hint:`The first XB coordinate is the radial axis and cannot be negative in cylindrical mode.`, line:m.line, rule:'mesh-cylindrical' });
        const ijk = m.params.IJK;
        if (Array.isArray(ijk) && ijk.length === 3 && ijk[1] !== 1)
            F.push({ severity:'ERROR', message:`&MESH at line ${m.line} IJK(2)=${ijk[1]} ≠ 1 in cylindrical coordinates — FDS raises ERROR(121).`, hint:`In cylindrical mode the azimuthal dimension (J) must be 1. Set IJK=I,1,K.`, line:m.line, rule:'mesh-cylindrical' });
    }
});

// ── DEVC QUANTITY_RANGE: upper bound must exceed lower bound ──────────────────
// ERROR(881): QUANTITY_RANGE(2) ≤ QUANTITY_RANGE(1) is logically invalid.

_rule('devc-quantity-range', (R, F) => {
    for (const d of R.filter(r => r.name === 'DEVC')) {
        const qr = d.params.QUANTITY_RANGE;
        if (!Array.isArray(qr) || qr.length < 2) continue;
        if (typeof qr[0] === 'number' && typeof qr[1] === 'number' && qr[1] <= qr[0])
            F.push({ severity:'ERROR', message:`&DEVC '${d.params.ID||'?'}' QUANTITY_RANGE=(${qr[0]},${qr[1]}): upper bound must be > lower bound — FDS raises ERROR(881).`, hint:`QUANTITY_RANGE(1) is the lower threshold and QUANTITY_RANGE(2) is the upper. The upper must be strictly greater than the lower.`, line:d.line, rule:'devc-quantity-range' });
    }
});

// ── Main entry ────────────────────────────────────────────────────────────────

function fdsLint(text) {
    const records = _lintParseRecords(text);
    const findings = [];
    for (const [name, fn] of _LINT_RULES) {
        try { fn(records, findings); }
        catch (e) {
            findings.push({ severity:'WARNING', message:`Internal: rule '${name}' failed — ${e.message}`, hint:'', line:0, rule:name });
        }
    }
    findings.sort((a, b) => (a.line || 999999) - (b.line || 999999) || a.severity.localeCompare(b.severity));

    return findings;
}
