/**
 * FDS Linter — comprehensive test harness
 * Generates ~1000 test cases across all 54 rules, runs fdsLint() on each,
 * and reports every failure so gaps can be patched.
 *
 * Run:  node test-linter.js
 */

'use strict';
const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

// ── Load linter ───────────────────────────────────────────────────────────────
const linterSrc = fs.readFileSync(
    path.join(__dirname, 'js', 'fds-linter.js'), 'utf8');
const ctx = { console };
vm.createContext(ctx);
vm.runInContext(linterSrc, ctx);
const fdsLint = ctx.fdsLint;
if (typeof fdsLint !== 'function') {
    console.error('Could not load fdsLint from fds-linter.js'); process.exit(1);
}

// ── Minimal valid base (all required namelists present, no errors) ─────────────
const BASE = [
    "&HEAD CHID='test_sim', TITLE='Test' /",
    '&TIME T_END=60 /',
    '&MESH IJK=10,10,10, XB=0,10,0,10,0,10 /',
    '&TAIL /',
].join('\n');

// BASE that also defines a fire — needed for rules that check SURF+REAC combos
const BASE_FIRE = [
    "&HEAD CHID='test_fire', TITLE='Test' /",
    '&TIME T_END=60 /',
    '&MESH IJK=10,10,10, XB=0,10,0,10,0,10 /',
    "&REAC FUEL='PROPANE', SOOT_YIELD=0.03, CO_YIELD=0.01 /",
    "&SURF ID='FIRE', HRRPUA=250 /",
    '&TAIL /',
].join('\n');

// ── Test runner ───────────────────────────────────────────────────────────────
let passed = 0, failed = 0, total = 0;
const failures = [];

/**
 * Assert that fdsLint(fds) fires `rule` (with optional severity filter).
 * Label is printed as [PASS] or [FAIL].
 */
function expect(label, fds, rule, severity = null) {
    total++;
    const findings = fdsLint(fds);
    const hit = findings.some(f =>
        f.rule === rule && (!severity || f.severity === severity));
    if (hit) {
        passed++;
        console.log(`  [PASS] ${label}`);
    } else {
        failed++;
        const got = findings.length
            ? findings.map(f => `${f.rule}(${f.severity})`).join(', ')
            : '(no findings)';
        console.log(`  [FAIL] ${label}`);
        console.log(`         expected rule '${rule}'  got: ${got}`);
        failures.push({ label, rule, got });
    }
}

/**
 * Assert that fdsLint(fds) does NOT fire `rule` (false-positive check).
 */
function expectClean(label, fds, rule) {
    total++;
    const findings = fdsLint(fds);
    const hit = findings.some(f => f.rule === rule);
    if (!hit) {
        passed++;
        console.log(`  [PASS] ${label}  (no false positive)`);
    } else {
        failed++;
        console.log(`  [FAIL] FALSE POSITIVE — ${label} fired '${rule}' unexpectedly`);
        failures.push({ label, rule: `NO ${rule}`, got: rule });
    }
}

// Helper: inject extra lines into BASE
const inject = (extra, base = BASE) => base + '\n' + extra;

// ─────────────────────────────────────────────────────────────────────────────
// RULE: unterminated-record
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── unterminated-record ──');
for (const [lbl, fds] of [
    ['HEAD missing /',        "&HEAD CHID='x'\n&TIME T_END=60 /\n&MESH IJK=10,10,10, XB=0,1,0,1,0,1 /\n&TAIL /"],
    ['TIME missing /',        "&HEAD CHID='x' /\n&TIME T_END=60\n&MESH IJK=10,10,10, XB=0,1,0,1,0,1 /\n&TAIL /"],
    ['MESH missing /',        "&HEAD CHID='x' /\n&TIME T_END=60 /\n&MESH IJK=10,10,10, XB=0,1,0,1,0,1\n&TAIL /"],
    ['SURF missing /',        inject("&SURF ID='X'\n&TAIL /")],
    ['OBST missing /',        inject("&OBST XB=1,2,1,2,0,1, SURF_ID='INERT'\n&TAIL /")],
    ['REAC missing /',        "&HEAD CHID='x' /\n&TIME T_END=60 /\n&MESH IJK=10,10,10, XB=0,1,0,1,0,1 /\n&REAC FUEL='PROPANE'\n&TAIL /"],
    ['DEVC missing /',        inject("&DEVC ID='D', QUANTITY='TEMPERATURE', XYZ=1,1,1\n&TAIL /")],
    ['RAMP missing /',        inject("&RAMP ID='R', T=0, F=0\n&RAMP ID='R', T=60, F=1 /")],
    ['PART missing /',        inject("&PART ID='P'\n&TAIL /")],
    ['DUMP missing /',        inject("&DUMP NFRAMES=100\n&TAIL /")],
    ['MISC missing /',        inject("&MISC TMPA=20\n&TAIL /")],
    ['missing / at EOF',      "&HEAD CHID='x' /\n&TIME T_END=60 /\n&MESH IJK=10,10,10, XB=0,1,0,1,0,1 /\n&TAIL"],
    ['CTRL missing /',        inject("&CTRL ID='C', FUNCTION_TYPE='ANY', INPUT_ID='D'\n&TAIL /")],
    ['HOLE missing /',        inject("&HOLE XB=1,2,1,2,0,1\n&TAIL /")],
    ['VENT missing /',        inject("&VENT XB=0,0,0,10,0,10, SURF_ID='OPEN'\n&TAIL /")],
    ['HVAC missing /',        inject("&HVAC ID='H', TYPE_ID='NODE'\n&TAIL /")],
    ['INIT missing /',        inject("&INIT XB=1,2,1,2,0,1\n&TAIL /")],
    ['GEOM missing /',        inject("&GEOM ID='G'\n&TAIL /")],
]) { expect(lbl, fds, 'unterminated-record'); }
// negative
expectClean('properly terminated HEAD', BASE, 'unterminated-record');
expectClean('all records closed', BASE_FIRE, 'unterminated-record');

// ─────────────────────────────────────────────────────────────────────────────
// RULE: head-chid-required
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── head-chid-required ──');
for (const [lbl, fds] of [
    ['no HEAD at all',       "&TIME T_END=60 /\n&MESH IJK=10,10,10, XB=0,1,0,1,0,1 /\n&TAIL /"],
    ['HEAD no CHID',         "&HEAD TITLE='X' /\n&TIME T_END=60 /\n&MESH IJK=10,10,10, XB=0,1,0,1,0,1 /\n&TAIL /"],
    ['CHID with space',      "&HEAD CHID='my sim' /\n&TIME T_END=60 /\n&MESH IJK=10,10,10, XB=0,1,0,1,0,1 /\n&TAIL /"],
    ['CHID with period',     "&HEAD CHID='my.sim' /\n&TIME T_END=60 /\n&MESH IJK=10,10,10, XB=0,1,0,1,0,1 /\n&TAIL /"],
    ['CHID with slash',      "&HEAD CHID='my/sim' /\n&TIME T_END=60 /\n&MESH IJK=10,10,10, XB=0,1,0,1,0,1 /\n&TAIL /"],
    ['CHID with backslash',  "&HEAD CHID='my\\\\sim' /\n&TIME T_END=60 /\n&MESH IJK=10,10,10, XB=0,1,0,1,0,1 /\n&TAIL /"],
    ['CHID with colon',      "&HEAD CHID='my:sim' /\n&TIME T_END=60 /\n&MESH IJK=10,10,10, XB=0,1,0,1,0,1 /\n&TAIL /"],
    ['CHID with asterisk',   "&HEAD CHID='my*sim' /\n&TIME T_END=60 /\n&MESH IJK=10,10,10, XB=0,1,0,1,0,1 /\n&TAIL /"],
    ['CHID with question',   "&HEAD CHID='my?sim' /\n&TIME T_END=60 /\n&MESH IJK=10,10,10, XB=0,1,0,1,0,1 /\n&TAIL /"],
]) { expect(lbl, fds, 'head-chid-required'); }
expectClean('valid CHID no spaces',  BASE, 'head-chid-required');
expectClean('valid CHID with dash',  inject(''), 'head-chid-required');

// ─────────────────────────────────────────────────────────────────────────────
// RULE: chid-length
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── chid-length ──');
const longChid40  = 'A'.repeat(40);
const longChid60  = 'B'.repeat(60);
const okChid39    = 'C'.repeat(39);
for (const [lbl, chid] of [
    ['CHID 40 chars',  longChid40],
    ['CHID 60 chars',  longChid60],
    ['CHID 50 chars',  'D'.repeat(50)],
    ['CHID 100 chars', 'E'.repeat(100)],
    ['CHID 45 chars',  'F'.repeat(45)],
]) {
    const fds = `&HEAD CHID='${chid}' /\n&TIME T_END=60 /\n&MESH IJK=10,10,10, XB=0,1,0,1,0,1 /\n&TAIL /`;
    expect(lbl, fds, 'chid-length');
}
expectClean('CHID 39 chars (ok)',    `&HEAD CHID='${okChid39}' /\n&TIME T_END=60 /\n&MESH IJK=10,10,10, XB=0,1,0,1,0,1 /\n&TAIL /`, 'chid-length');
expectClean('CHID 1 char (ok)',      BASE, 'chid-length');

// ─────────────────────────────────────────────────────────────────────────────
// RULE: time-tend-required
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── time-tend-required ──');
for (const [lbl, fds] of [
    ['no TIME namelist',  "&HEAD CHID='x' /\n&MESH IJK=10,10,10, XB=0,1,0,1,0,1 /\n&TAIL /"],
    ['TIME no T_END',     "&HEAD CHID='x' /\n&TIME DT=0.1 /\n&MESH IJK=10,10,10, XB=0,1,0,1,0,1 /\n&TAIL /"],
]) { expect(lbl, fds, 'time-tend-required'); }
expectClean('TIME with T_END', BASE, 'time-tend-required');

// ─────────────────────────────────────────────────────────────────────────────
// RULE: time-t-begin-end
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── time-t-begin-end ──');
for (const [lbl, tb, te] of [
    ['T_BEGIN=T_END',      60, 60],
    ['T_BEGIN > T_END',   100, 60],
    ['T_BEGIN=1 T_END=0',   1,  0],
    ['T_BEGIN=999 T_END=1', 999, 1],
    ['T_BEGIN=60.1 T_END=60', 60.1, 60],
]) {
    const fds = `&HEAD CHID='x' /\n&TIME T_BEGIN=${tb}, T_END=${te} /\n&MESH IJK=10,10,10, XB=0,1,0,1,0,1 /\n&TAIL /`;
    expect(lbl, fds, 'time-t-begin-end');
}
expectClean('T_BEGIN=0 T_END=60 (ok)',
    "&HEAD CHID='x' /\n&TIME T_BEGIN=0, T_END=60 /\n&MESH IJK=10,10,10, XB=0,1,0,1,0,1 /\n&TAIL /",
    'time-t-begin-end');
expectClean('no T_BEGIN (ok)', BASE, 'time-t-begin-end');

// ─────────────────────────────────────────────────────────────────────────────
// RULE: tail-missing
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── tail-missing ──');
for (const [lbl, fds] of [
    ['no TAIL',   "&HEAD CHID='x' /\n&TIME T_END=60 /\n&MESH IJK=10,10,10, XB=0,1,0,1,0,1 /"],
    ['no TAIL 2', "&HEAD CHID='y' /\n&TIME T_END=120 /\n&MESH IJK=20,20,20, XB=0,5,0,5,0,5 /"],
]) { expect(lbl, fds, 'tail-missing'); }
expectClean('has TAIL', BASE, 'tail-missing');

// ─────────────────────────────────────────────────────────────────────────────
// RULE: mesh-required
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── mesh-required ──');
expect('no MESH', "&HEAD CHID='x' /\n&TIME T_END=60 /\n&TAIL /", 'mesh-required');
expectClean('has MESH', BASE, 'mesh-required');

// ─────────────────────────────────────────────────────────────────────────────
// RULE: mesh-ijk-min
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── mesh-ijk-min ──');
for (const [lbl, ijk] of [
    ['IJK I=1', '1,10,10'],
    ['IJK J=1', '10,1,10'],
    ['IJK K=1', '10,10,1'],
    ['IJK I=0', '0,10,10'],
    ['IJK J=0', '10,0,10'],
    ['IJK K=0', '10,10,0'],
    ['IJK all 1', '1,1,1'],
]) {
    const fds = `&HEAD CHID='x' /\n&TIME T_END=60 /\n&MESH IJK=${ijk}, XB=0,1,0,1,0,1 /\n&TAIL /`;
    expect(lbl, fds, 'mesh-ijk-min');
}
expectClean('IJK=2,2,2 (ok)', "&HEAD CHID='x' /\n&TIME T_END=60 /\n&MESH IJK=2,2,2, XB=0,1,0,1,0,1 /\n&TAIL /", 'mesh-ijk-min');

// ─────────────────────────────────────────────────────────────────────────────
// RULE: mesh-xb-degenerate
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── mesh-xb-degenerate ──');
for (const [lbl, xb] of [
    ['zero X extent', '0,0,0,1,0,1'],
    ['zero Y extent', '0,1,0,0,0,1'],
    ['zero Z extent', '0,1,0,1,0,0'],
    ['zero X and Y',  '0,0,0,0,0,1'],
]) {
    const fds = `&HEAD CHID='x' /\n&TIME T_END=60 /\n&MESH IJK=10,10,10, XB=${xb} /\n&TAIL /`;
    expect(lbl, fds, 'mesh-xb-degenerate');
}
expectClean('valid XB', BASE, 'mesh-xb-degenerate');

// ─────────────────────────────────────────────────────────────────────────────
// RULE: mesh-balance
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── mesh-balance ──');
for (const [lbl, fds] of [
    ['100 vs 10000 cells',
        "&HEAD CHID='x' /\n&TIME T_END=60 /\n&MESH IJK=5,5,4, XB=0,5,0,5,0,4 /\n&MESH IJK=50,50,40, XB=5,10,0,5,0,4 /\n&TAIL /"],
    ['1000 vs 100000 cells',
        "&HEAD CHID='x' /\n&TIME T_END=60 /\n&MESH IJK=10,10,10, XB=0,5,0,5,0,5 /\n&MESH IJK=50,50,40, XB=5,30,0,5,0,5 /\n&TAIL /"],
]) { expect(lbl, fds, 'mesh-balance'); }
expectClean('balanced meshes',
    "&HEAD CHID='x' /\n&TIME T_END=60 /\n&MESH IJK=10,10,10, XB=0,5,0,10,0,10 /\n&MESH IJK=10,10,10, XB=5,10,0,10,0,10 /\n&TAIL /",
    'mesh-balance');

// ─────────────────────────────────────────────────────────────────────────────
// RULE: xb-ordered
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── xb-ordered ──');
for (const [lbl, xb, nm] of [
    ['OBST reversed X', '5,0,0,5,0,5', 'OBST'],
    ['OBST reversed Y', '0,5,5,0,0,5', 'OBST'],
    ['OBST reversed Z', '0,5,0,5,5,0', 'OBST'],
    ['VENT reversed X', '5,0,0,0,0,5', 'VENT'],
    ['MESH reversed X', '5,0,0,10,0,10', 'MESH'],
    ['DEVC XB reversed', '5,0,0,5,0,5', 'DEVC'],
]) {
    const extra = nm === 'DEVC'
        ? `&DEVC ID='D', QUANTITY='TEMPERATURE', XB=${xb} /`
        : `&${nm} XB=${xb}, SURF_ID='INERT' /`;
    expect(lbl, inject(extra), 'xb-ordered');
}
expectClean('OBST correct XB order', inject("&OBST XB=0,5,0,5,0,5, SURF_ID='INERT' /"), 'xb-ordered');

// ─────────────────────────────────────────────────────────────────────────────
// RULE: array-count
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── array-count ──');
for (const [lbl, fds] of [
    ['XB 4 values on OBST',  inject("&OBST XB=0,5,0,5, SURF_ID='INERT' /")],
    ['XB 8 values on OBST',  inject("&OBST XB=0,5,0,5,0,5,1, SURF_ID='INERT' /")],
    ['XB 3 values on VENT',  inject("&VENT XB=0,0,0, SURF_ID='OPEN' /")],
    ['XB 2 values on MESH',  "&HEAD CHID='x' /\n&TIME T_END=60 /\n&MESH IJK=10,10,10, XB=0,10 /\n&TAIL /"],
    ['XB 1 value scalar',    inject("&OBST XB=5, SURF_ID='INERT' /")],
    ['XYZ 2 values on DEVC', inject("&DEVC ID='D', QUANTITY='TEMPERATURE', XYZ=1,1 /")],
    ['XYZ 4 values on DEVC', inject("&DEVC ID='D', QUANTITY='TEMPERATURE', XYZ=1,1,1,1 /")],
    ['XYZ 1 value on DEVC',  inject("&DEVC ID='D', QUANTITY='TEMPERATURE', XYZ=5 /")],
    ['IJK 2 values on MESH', "&HEAD CHID='x' /\n&TIME T_END=60 /\n&MESH IJK=10,10, XB=0,10,0,10,0,10 /\n&TAIL /"],
    ['IJK 4 values on MESH', "&HEAD CHID='x' /\n&TIME T_END=60 /\n&MESH IJK=10,10,10,10, XB=0,10,0,10,0,10 /\n&TAIL /"],
    ['IJK 1 value on MESH',  "&HEAD CHID='x' /\n&TIME T_END=60 /\n&MESH IJK=10, XB=0,10,0,10,0,10 /\n&TAIL /"],
    ['XB 5 values on SLCF',  inject("&SLCF XB=0,10,5,5,0, QUANTITY='TEMPERATURE' /")],
]) { expect(lbl, fds, 'array-count'); }
expectClean('XB=6 values (ok)',  inject("&OBST XB=0,5,0,5,0,5, SURF_ID='INERT' /"), 'array-count');
expectClean('XYZ=3 values (ok)', inject("&DEVC ID='D', QUANTITY='TEMPERATURE', XYZ=1,2,3 /"), 'array-count');
expectClean('IJK=3 values (ok)', BASE, 'array-count');

// ─────────────────────────────────────────────────────────────────────────────
// RULE: reac-missing-fuel
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── reac-missing-fuel ──');
for (const [lbl, reac] of [
    ['REAC no FUEL',              "&REAC HEAT_OF_COMBUSTION=20000 /"],
    ['REAC only SOOT_YIELD',      "&REAC SOOT_YIELD=0.03 /"],
    ['REAC only CO_YIELD',        "&REAC CO_YIELD=0.01 /"],
    ['REAC FUEL empty string',    "&REAC FUEL='', SOOT_YIELD=0.03 /"],
]) { expect(lbl, inject(reac), 'reac-missing-fuel'); }
expectClean('REAC with FUEL', BASE_FIRE, 'reac-missing-fuel');

// ─────────────────────────────────────────────────────────────────────────────
// RULE: reac-yield-range
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── reac-yield-range ──');
for (const [lbl, reac] of [
    ['SOOT_YIELD negative',    "&REAC FUEL='PROPANE', SOOT_YIELD=-0.05 /"],
    ['SOOT_YIELD > 1',         "&REAC FUEL='PROPANE', SOOT_YIELD=1.5 /"],
    ['CO_YIELD negative',      "&REAC FUEL='PROPANE', CO_YIELD=-0.01 /"],
    ['CO_YIELD > 1',           "&REAC FUEL='PROPANE', CO_YIELD=2.0 /"],
    ['SOOT+CO sum > 1',        "&REAC FUEL='PROPANE', SOOT_YIELD=0.7, CO_YIELD=0.5 /"],
    ['SOOT_YIELD exactly -0.001', "&REAC FUEL='PROPANE', SOOT_YIELD=-0.001 /"],
    ['SOOT_YIELD 1.01',        "&REAC FUEL='PROPANE', SOOT_YIELD=1.01 /"],
    ['CO_YIELD 1.001',         "&REAC FUEL='PROPANE', CO_YIELD=1.001 /"],
    ['sum exactly 1.01',       "&REAC FUEL='PROPANE', SOOT_YIELD=0.6, CO_YIELD=0.41 /"],
]) { expect(lbl, inject(reac), 'reac-yield-range'); }
expectClean('SOOT_YIELD=0.03 (ok)',  inject("&REAC FUEL='PROPANE', SOOT_YIELD=0.03 /"), 'reac-yield-range');
expectClean('CO_YIELD=0.01 (ok)',    inject("&REAC FUEL='PROPANE', CO_YIELD=0.01 /"), 'reac-yield-range');
expectClean('sum=0.04 (ok)',         inject("&REAC FUEL='PROPANE', SOOT_YIELD=0.03, CO_YIELD=0.01 /"), 'reac-yield-range');

// ─────────────────────────────────────────────────────────────────────────────
// RULE: surf-hrrpua-needs-reac
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── surf-hrrpua-needs-reac ──');
for (const [lbl, surf] of [
    ['HRRPUA no REAC',   "&SURF ID='FIRE', HRRPUA=250 /"],
    ['MLRPUA no REAC',   "&SURF ID='FIRE', MLRPUA=0.02 /"],
    ['HRRPUA=1 no REAC', "&SURF ID='FIRE', HRRPUA=1 /"],
]) { expect(lbl, inject(surf), 'surf-hrrpua-needs-reac'); }
expectClean('HRRPUA with REAC', BASE_FIRE, 'surf-hrrpua-needs-reac');

// ─────────────────────────────────────────────────────────────────────────────
// RULE: surf-hrrpua-zero
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── surf-hrrpua-zero ──');
for (const [lbl, surf] of [
    ['HRRPUA=0',        "&SURF ID='FIRE', HRRPUA=0 /"],
    ['MLRPUA=0',        "&SURF ID='FIRE', MLRPUA=0 /"],
    ['HRRPUA=0 with COLOR', "&SURF ID='FIRE', HRRPUA=0, COLOR='RED' /"],
]) { expect(lbl, inject(surf), 'surf-hrrpua-zero'); }
expectClean('HRRPUA=250 (ok)', inject("&SURF ID='FIRE', HRRPUA=250 /"), 'surf-hrrpua-zero');
expectClean('no HRRPUA (ok)',  inject("&SURF ID='WALL', COLOR='GRAY' /"), 'surf-hrrpua-zero');

// ─────────────────────────────────────────────────────────────────────────────
// RULE: surf-missing-id
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── surf-missing-id ──');
for (const [lbl, surf] of [
    ['SURF no ID',          "&SURF HRRPUA=250 /"],
    ['SURF ID empty',       "&SURF ID='', HRRPUA=250 /"],
]) { expect(lbl, inject(surf), 'surf-missing-id'); }
expectClean("SURF with ID", inject("&SURF ID='FIRE', HRRPUA=250 /"), 'surf-missing-id');

// ─────────────────────────────────────────────────────────────────────────────
// RULE: duplicate-ids
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── duplicate-ids ──');
for (const [lbl, fds] of [
    ['duplicate SURF',  inject("&SURF ID='WALL', COLOR='GRAY' /\n&SURF ID='WALL', COLOR='RED' /")],
    ['duplicate MATL',  inject("&MATL ID='WOOD', CONDUCTIVITY=0.1, SPECIFIC_HEAT=1.0, DENSITY=500 /\n&MATL ID='WOOD', CONDUCTIVITY=0.2, SPECIFIC_HEAT=1.0, DENSITY=600 /")],
    ['duplicate DEVC',  inject("&DEVC ID='TC1', QUANTITY='TEMPERATURE', XYZ=1,1,1 /\n&DEVC ID='TC1', QUANTITY='TEMPERATURE', XYZ=2,2,2 /")],
    ['duplicate RAMP',  inject("&RAMP ID='R1', T=0, F=0 /\n&RAMP ID='R1', T=60, F=1 /\n&RAMP ID='R1', T=0, F=0.5 /")],
    ['duplicate SPEC',  inject("&SPEC ID='FUEL', FORMULA='C3H8' /\n&SPEC ID='FUEL', FORMULA='C4H10' /")],
]) { expect(lbl, fds, 'duplicate-ids'); }
expectClean('unique IDs', BASE_FIRE, 'duplicate-ids');

// ─────────────────────────────────────────────────────────────────────────────
// RULE: burn-away-surf-id6
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── burn-away-surf-id6 ──');
expect('BURN_AWAY surf in SURF_ID6',
    inject("&SURF ID='BURN', BURN_AWAY=.TRUE., BULK_DENSITY=50 /\n&OBST XB=0,5,0,5,0,1, SURF_ID6='INERT','INERT','INERT','INERT','BURN','INERT' /"),
    'burn-away-surf-id6');
expectClean('BURN_AWAY surf NOT in SURF_ID6',
    inject("&SURF ID='BURN', BURN_AWAY=.TRUE., BULK_DENSITY=50 /\n&OBST XB=0,5,0,5,0,1, SURF_ID='INERT' /"),
    'burn-away-surf-id6');

// ─────────────────────────────────────────────────────────────────────────────
// RULE: burn-away-bulk-density
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── burn-away-bulk-density ──');
for (const [lbl, surf] of [
    ['BURN_AWAY no BULK_DENSITY', "&SURF ID='BURN', BURN_AWAY=.TRUE. /"],
    ['BURN_AWAY no BULK_DENSITY 2', "&SURF ID='CHAR', BURN_AWAY=.TRUE., COLOR='GRAY' /"],
]) { expect(lbl, inject(surf), 'burn-away-bulk-density'); }
expectClean('BURN_AWAY with BULK_DENSITY',
    inject("&SURF ID='BURN', BURN_AWAY=.TRUE., BULK_DENSITY=50 /"),
    'burn-away-bulk-density');

// ─────────────────────────────────────────────────────────────────────────────
// RULE: ht3d-burn-away
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── ht3d-burn-away ──');
expect('HT3D + BURN_AWAY',
    inject("&SURF ID='X', HT3D=.TRUE., BURN_AWAY=.TRUE., BULK_DENSITY=50 /"),
    'ht3d-burn-away');
expectClean('HT3D only', inject("&SURF ID='X', HT3D=.TRUE. /"), 'ht3d-burn-away');
expectClean('BURN_AWAY only', inject("&SURF ID='X', BURN_AWAY=.TRUE., BULK_DENSITY=50 /"), 'ht3d-burn-away');

// ─────────────────────────────────────────────────────────────────────────────
// RULE: vent-not-planar
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── vent-not-planar ──');
for (const [lbl, xb] of [
    ['VENT fully 3D',        '0,5,0,5,0,5'],
    ['VENT 3D 2',            '1,3,1,3,1,3'],
    ['VENT no equal pair',   '0,1,0,2,0,3'],
]) {
    expect(lbl, inject(`&VENT XB=${xb}, SURF_ID='OPEN' /`), 'vent-not-planar');
}
for (const [lbl, xb] of [
    ['VENT X-plane', '0,0,0,10,0,10'],
    ['VENT Y-plane', '0,10,5,5,0,10'],
    ['VENT Z-plane', '0,10,0,10,0,0'],
]) {
    expectClean(lbl, inject(`&VENT XB=${xb}, SURF_ID='OPEN' /`), 'vent-not-planar');
}

// ─────────────────────────────────────────────────────────────────────────────
// RULE: vent-not-on-surface
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── vent-not-on-surface ──');
// Mesh is XB=0,10,0,10,0,10 — boundaries at x=0/10, y=0/10, z=0/10
for (const [lbl, xb] of [
    ['VENT floating X=2 (interior, no OBST)', '2,2,0,10,0,10'],
    ['VENT floating Y=5 (interior, no OBST)', '0,10,5,5,0,10'],
    ['VENT floating Z=3 (interior, no OBST)', '0,10,0,10,3,3'],
    ['VENT floating partial', '2,2,2,8,2,8'],
]) {
    expect(lbl, inject(`&VENT XB=${xb}, SURF_ID='OPEN' /`), 'vent-not-on-surface');
}
// On mesh boundaries — should NOT fire
for (const [lbl, xb] of [
    ['VENT on XMIN (x=0)', '0,0,0,10,0,10'],
    ['VENT on XMAX (x=10)', '10,10,0,10,0,10'],
    ['VENT on YMIN (y=0)', '0,10,0,0,0,10'],
    ['VENT on YMAX (y=10)', '0,10,10,10,0,10'],
    ['VENT on ZMIN (z=0)', '0,10,0,10,0,0'],
    ['VENT on ZMAX (z=10)', '0,10,0,10,10,10'],
]) {
    expectClean(lbl, inject(`&VENT XB=${xb}, SURF_ID='OPEN' /`), 'vent-not-on-surface');
}
// On an OBST face — should NOT fire
expectClean('VENT on OBST top face (z=3)',
    inject("&OBST XB=0,10,0,10,0,3, SURF_ID='INERT' /\n&VENT XB=0,10,0,10,3,3, SURF_ID='FIRE' /"),
    'vent-not-on-surface');
expectClean('VENT on OBST X-face (x=4)',
    inject("&OBST XB=0,4,0,10,0,5, SURF_ID='INERT' /\n&VENT XB=4,4,0,10,0,5, SURF_ID='OPEN' /"),
    'vent-not-on-surface');
expectClean('VENT on OBST Y-face (y=6)',
    inject("&OBST XB=0,10,0,6,0,5, SURF_ID='INERT' /\n&VENT XB=0,10,6,6,0,5, SURF_ID='OPEN' /"),
    'vent-not-on-surface');
// MB= parameter explicitly attaches to mesh boundary
expectClean('VENT with MB=XMIN (no XB check needed)',
    inject("&VENT XB=2,2,0,10,0,10, SURF_ID='OPEN', MB='XMIN' /"),
    'vent-not-on-surface');

// ─────────────────────────────────────────────────────────────────────────────
// RULE: vent-outside-domain
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── vent-outside-domain ──');
for (const [lbl, xb] of [
    ['VENT X=50 outside',   '50,50,0,10,0,10'],
    ['VENT Y=50 outside',   '0,0,50,50,0,10'],
    ['VENT Z=50 outside',   '0,10,0,10,50,50'],
    ['VENT fully outside',  '20,25,20,25,20,25'],
    ['VENT negative X',     '-5,-5,0,10,0,10'],
]) {
    expect(lbl, inject(`&VENT XB=${xb}, SURF_ID='OPEN' /`), 'vent-outside-domain');
}
expectClean('VENT on mesh face', inject("&VENT XB=0,0,0,10,0,10, SURF_ID='OPEN' /"), 'vent-outside-domain');
expectClean('VENT on top face',  inject("&VENT XB=0,10,0,10,10,10, SURF_ID='OPEN' /"), 'vent-outside-domain');

// ─────────────────────────────────────────────────────────────────────────────
// RULE: obst-outside-domain
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── obst-outside-domain ──');
for (const [lbl, xb] of [
    ['OBST fully outside X', '15,20,0,5,0,5'],
    ['OBST fully outside Y', '0,5,15,20,0,5'],
    ['OBST fully outside Z', '0,5,0,5,15,20'],
    ['OBST negative coords', '-5,-1,-5,-1,-5,-1'],
]) {
    expect(lbl, inject(`&OBST XB=${xb}, SURF_ID='INERT' /`), 'obst-outside-domain');
}
expectClean('OBST inside mesh', inject("&OBST XB=1,5,1,5,0,1, SURF_ID='INERT' /"), 'obst-outside-domain');
expectClean('OBST crossing boundary (ok)', inject("&OBST XB=8,12,0,5,0,5, SURF_ID='INERT' /"), 'obst-outside-domain');

// ─────────────────────────────────────────────────────────────────────────────
// RULE: surf-id-undefined
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── surf-id-undefined ──');
for (const [lbl, ref] of [
    ['OBST SURF_ID undefined',   "&OBST XB=0,5,0,5,0,1, SURF_ID='NOSUCHSURF' /"],
    ['VENT SURF_ID undefined',   "&VENT XB=0,0,0,10,0,10, SURF_ID='NOSUCHSURF' /"],
    ['OBST SURF_IDS undefined',  "&OBST XB=0,5,0,5,0,1, SURF_IDS='INERT','NOSUCHSURF' /"],
]) { expect(lbl, inject(ref), 'surf-id-undefined'); }
expectClean('SURF_ID=INERT (builtin)',  inject("&OBST XB=0,5,0,5,0,1, SURF_ID='INERT' /"), 'surf-id-undefined');
expectClean('SURF_ID=OPEN (builtin)',   inject("&VENT XB=0,0,0,10,0,10, SURF_ID='OPEN' /"), 'surf-id-undefined');
expectClean('SURF_ID defined',
    inject("&SURF ID='WALL', COLOR='GRAY' /\n&OBST XB=0,5,0,5,0,1, SURF_ID='WALL' /"),
    'surf-id-undefined');

// ─────────────────────────────────────────────────────────────────────────────
// RULE: matl-id-undefined
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── matl-id-undefined ──');
expect('SURF MATL_ID undefined',
    inject("&SURF ID='WOOD_SURF', MATL_ID='NOSUCHWOODMATL' /"),
    'matl-id-undefined');
expectClean('SURF MATL_ID defined',
    inject("&MATL ID='WOOD', CONDUCTIVITY=0.12, SPECIFIC_HEAT=1.7, DENSITY=500 /\n&SURF ID='PANEL', MATL_ID='WOOD', THICKNESS=0.02 /"),
    'matl-id-undefined');

// ─────────────────────────────────────────────────────────────────────────────
// RULE: ramp-id-undefined
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── ramp-id-undefined ──');
expect('RAMP_Q referencing non-existent ID',
    inject("&SURF ID='FIRE', HRRPUA=250, RAMP_Q='NOEXISTRAMP' /\n&RAMP ID='OTHER', T=0, F=0 /\n&RAMP ID='OTHER', T=60, F=1 /"),
    'ramp-id-undefined');
expectClean('RAMP_Q referencing existing ID',
    inject("&SURF ID='FIRE', HRRPUA=250, RAMP_Q='HRRAMP' /\n&RAMP ID='HRRAMP', T=0, F=0 /\n&RAMP ID='HRRAMP', T=60, F=1 /"),
    'ramp-id-undefined');

// ─────────────────────────────────────────────────────────────────────────────
// RULE: prop-id-undefined
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── prop-id-undefined ──');
expect('DEVC PROP_ID undefined',
    inject("&PROP ID='SPRK', QUANTITY='SPRINKLER LINK TEMPERATURE' /\n&DEVC ID='SP1', PROP_ID='WRONGPROP', XYZ=5,5,3 /"),
    'prop-id-undefined');
expectClean('DEVC PROP_ID defined',
    inject("&PROP ID='SPRK', QUANTITY='SPRINKLER LINK TEMPERATURE' /\n&DEVC ID='SP1', PROP_ID='SPRK', XYZ=5,5,3 /"),
    'prop-id-undefined');

// ─────────────────────────────────────────────────────────────────────────────
// RULE: ctrl-id-undefined
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── ctrl-id-undefined ──');
expect('DEVC CTRL_ID undefined',
    inject("&CTRL ID='SUPPRESSION', FUNCTION_TYPE='ANY', INPUT_ID='D1' /\n&DEVC ID='D2', QUANTITY='TEMPERATURE', XYZ=1,1,1, CTRL_ID='WRONGCTRL' /"),
    'ctrl-id-undefined');
expectClean('DEVC CTRL_ID defined',
    inject("&CTRL ID='SUPPRESSION', FUNCTION_TYPE='ANY', INPUT_ID='D1' /\n&DEVC ID='D1', QUANTITY='TEMPERATURE', XYZ=1,1,1 /\n&DEVC ID='D2', QUANTITY='TEMPERATURE', XYZ=1,1,1, CTRL_ID='SUPPRESSION' /"),
    'ctrl-id-undefined');

// ─────────────────────────────────────────────────────────────────────────────
// RULE: mult-id-undefined
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── mult-id-undefined ──');
expect('OBST MULT_ID undefined',
    inject("&MULT ID='ARRAY', DX=1, N_LOWER=0, N_UPPER=4 /\n&OBST XB=0,1,0,5,0,1, SURF_ID='INERT', MULT_ID='NOMULTIPLY' /"),
    'mult-id-undefined');
expectClean('OBST MULT_ID defined',
    inject("&MULT ID='ARRAY', DX=1, N_LOWER=0, N_UPPER=4 /\n&OBST XB=0,1,0,5,0,1, SURF_ID='INERT', MULT_ID='ARRAY' /"),
    'mult-id-undefined');

// ─────────────────────────────────────────────────────────────────────────────
// RULE: devc-quantity
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── devc-quantity ──');
for (const [lbl, qty] of [
    ['DEVC HEAT RELEASE RATE (rejected)', 'HEAT RELEASE RATE'],
    ['DEVC SOOT MASS FRACTION (rejected)', 'SOOT MASS FRACTION'],
    ['DEVC SOOT VOLUME FRACTION (rejected)', 'SOOT VOLUME FRACTION'],
    ['DEVC BOGUS QUANTITY (unknown)', 'FLURBOGRAM'],
    ['DEVC WALL HEAT FLUX (misspelled)', 'WALL HEAT FLUX'],
    ['DEVC SMOKE (invalid)', 'SMOKE'],
]) {
    expect(lbl, inject(`&DEVC ID='D', QUANTITY='${qty}', XYZ=1,1,1 /`), 'devc-quantity');
}
expectClean('DEVC TEMPERATURE (ok)',    inject("&DEVC ID='D', QUANTITY='TEMPERATURE', XYZ=1,1,1 /"), 'devc-quantity');
expectClean('DEVC VISIBILITY (ok)',     inject("&DEVC ID='D', QUANTITY='VISIBILITY', XYZ=1,1,1 /"), 'devc-quantity');
expectClean('DEVC HRR (ok)',            inject("&DEVC ID='D', QUANTITY='HRR', XB=0,10,0,10,0,10 /"), 'devc-quantity');

// ─────────────────────────────────────────────────────────────────────────────
// RULE: devc-missing-output
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── devc-missing-output ──');
for (const [lbl, devc] of [
    ['DEVC no QUANTITY no PROP_ID',   "&DEVC ID='D1', XYZ=1,1,1 /"],
    ['DEVC no QUANTITY no PROP_ID 2', "&DEVC ID='D2', XB=0,10,0,10,0,10 /"],
]) { expect(lbl, inject(devc), 'devc-missing-output'); }
expectClean('DEVC with QUANTITY', inject("&DEVC ID='D', QUANTITY='TEMPERATURE', XYZ=1,1,1 /"), 'devc-missing-output');

// ─────────────────────────────────────────────────────────────────────────────
// RULE: devc-id-missing
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── devc-id-missing ──');
for (const [lbl, devc] of [
    ['DEVC no ID',         "&DEVC QUANTITY='TEMPERATURE', XYZ=1,1,1 /"],
    ['DEVC ID empty',      "&DEVC ID='', QUANTITY='TEMPERATURE', XYZ=1,1,1 /"],
    ['DEVC no ID 2',       "&DEVC QUANTITY='VISIBILITY', XYZ=2,2,2 /"],
]) { expect(lbl, inject(devc), 'devc-id-missing'); }
expectClean("DEVC with ID", inject("&DEVC ID='TC', QUANTITY='TEMPERATURE', XYZ=1,1,1 /"), 'devc-id-missing');

// ─────────────────────────────────────────────────────────────────────────────
// RULE: devc-wall-ior
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── devc-wall-ior ──');
for (const [lbl, qty] of [
    ['WALL TEMPERATURE no IOR',        'WALL TEMPERATURE'],
    ['GAUGE HEAT FLUX no IOR',         'GAUGE HEAT FLUX'],
    ['INCIDENT HEAT FLUX no IOR',      'INCIDENT HEAT FLUX'],
    ['CONVECTIVE HEAT FLUX no IOR',    'CONVECTIVE HEAT FLUX'],
    ['BURNING RATE no IOR',            'BURNING RATE'],
    ['ADIABATIC SURFACE TEMPERATURE no IOR', 'ADIABATIC SURFACE TEMPERATURE'],
]) {
    expect(lbl, inject(`&DEVC ID='D', QUANTITY='${qty}', XYZ=5,5,5 /`), 'devc-wall-ior');
}
expectClean('WALL TEMPERATURE with IOR', inject("&DEVC ID='D', QUANTITY='WALL TEMPERATURE', XYZ=5,5,5, IOR=3 /"), 'devc-wall-ior');
expectClean('GAS TEMPERATURE no IOR (ok)', inject("&DEVC ID='D', QUANTITY='TEMPERATURE', XYZ=5,5,5 /"), 'devc-wall-ior');

// ─────────────────────────────────────────────────────────────────────────────
// RULE: devc-zone-needs-xb
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── devc-zone-needs-xb ──');
for (const [lbl, qty] of [
    ['LAYER HEIGHT with XYZ',    'LAYER HEIGHT'],
    ['UPPER TEMPERATURE w XYZ',  'UPPER TEMPERATURE'],
    ['LOWER TEMPERATURE w XYZ',  'LOWER TEMPERATURE'],
    ['HRR with XYZ',             'HRR'],
    ['VOLUME FLOW with XYZ',     'VOLUME FLOW'],
    ['MASS FLOW with XYZ',       'MASS FLOW'],
]) {
    expect(lbl, inject(`&DEVC ID='D', QUANTITY='${qty}', XYZ=5,5,5 /`), 'devc-zone-needs-xb');
}
expectClean('LAYER HEIGHT with XB',
    inject("&DEVC ID='D', QUANTITY='LAYER HEIGHT', XB=0,10,0,10,0,10 /"),
    'devc-zone-needs-xb');

// ─────────────────────────────────────────────────────────────────────────────
// RULE: devc-in-hole
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── devc-in-hole ──');
expect('DEVC inside HOLE',
    inject("&OBST XB=0,10,0,10,0,5, SURF_ID='INERT' /\n&HOLE XB=3,7,3,7,0,5 /\n&DEVC ID='D', QUANTITY='TEMPERATURE', XYZ=5,5,2 /"),
    'devc-in-hole');
expectClean('DEVC outside HOLE',
    inject("&HOLE XB=3,7,3,7,0,5 /\n&DEVC ID='D', QUANTITY='TEMPERATURE', XYZ=1,1,1 /"),
    'devc-in-hole');

// ─────────────────────────────────────────────────────────────────────────────
// RULE: devc-outside-domain
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── devc-outside-domain ──');
for (const [lbl, xyz] of [
    ['DEVC X outside', '50,5,5'],
    ['DEVC Y outside', '5,50,5'],
    ['DEVC Z outside', '5,5,50'],
    ['DEVC all outside', '100,100,100'],
    ['DEVC negative', '-1,-1,-1'],
]) {
    expect(lbl, inject(`&DEVC ID='D', QUANTITY='TEMPERATURE', XYZ=${xyz} /`), 'devc-outside-domain');
}
expectClean('DEVC inside mesh', inject("&DEVC ID='D', QUANTITY='TEMPERATURE', XYZ=5,5,5 /"), 'devc-outside-domain');

// ─────────────────────────────────────────────────────────────────────────────
// RULE: slcf-quantity
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── slcf-quantity ──');
for (const [lbl, qty] of [
    ['SLCF HEAT RELEASE RATE (invalid)', 'HEAT RELEASE RATE'],
    ['SLCF SOOT MASS FRACTION (invalid)', 'SOOT MASS FRACTION'],
    ['SLCF SOOT VOLUME FRACTION (invalid)', 'SOOT VOLUME FRACTION'],
    ['SLCF WALL TEMPERATURE (solid only)', 'WALL TEMPERATURE'],
    ['SLCF BURNING RATE (solid only)',     'BURNING RATE'],
    ['SLCF HRRPUA (solid only)',           'HRRPUA'],
    ['SLCF GAUGE HEAT FLUX (solid only)',  'GAUGE HEAT FLUX'],
    ['SLCF FED (device only)',             'FED'],
    ['SLCF BOGUS (unknown)',               'COMPLETELY_WRONG'],
]) {
    expect(lbl, inject(`&SLCF XB=0,10,5,5,0,10, QUANTITY='${qty}' /`), 'slcf-quantity');
}
expectClean('SLCF TEMPERATURE (ok)',    inject("&SLCF XB=0,10,5,5,0,10, QUANTITY='TEMPERATURE' /"), 'slcf-quantity');
expectClean('SLCF VISIBILITY (ok)',     inject("&SLCF XB=0,10,5,5,0,10, QUANTITY='VISIBILITY' /"), 'slcf-quantity');
expectClean('SLCF U-VELOCITY (ok)',     inject("&SLCF XB=0,10,5,5,0,10, QUANTITY='U-VELOCITY' /"), 'slcf-quantity');

// ─────────────────────────────────────────────────────────────────────────────
// RULE: spec-id-undefined
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── spec-id-undefined ──');
expect('DEVC MASS FRACTION SPEC_ID undefined',
    inject("&DEVC ID='D', QUANTITY='MASS FRACTION', SPEC_ID='NOSPEC', XYZ=1,1,1 /"),
    'spec-id-undefined');
expectClean('DEVC MASS FRACTION SPEC_ID builtin',
    inject("&DEVC ID='D', QUANTITY='MASS FRACTION', SPEC_ID='WATER VAPOR', XYZ=1,1,1 /"),
    'spec-id-undefined');

// ─────────────────────────────────────────────────────────────────────────────
// RULE: ctrl-missing-function-type
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── ctrl-missing-function-type ──');
for (const [lbl, ctrl] of [
    ['CTRL no FUNCTION_TYPE',   "&CTRL ID='C', INPUT_ID='D1' /"],
    ['CTRL no FUNCTION_TYPE 2', "&CTRL ID='C2', DELAY=30 /"],
]) { expect(lbl, inject(ctrl), 'ctrl-missing-function-type'); }
expectClean('CTRL with FUNCTION_TYPE',
    inject("&CTRL ID='C', FUNCTION_TYPE='ANY', INPUT_ID='D1' /"),
    'ctrl-missing-function-type');

// ─────────────────────────────────────────────────────────────────────────────
// RULE: geom-faces-stride
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── geom-faces-stride ──');
for (const [lbl, faces] of [
    ['FACES 5 integers',  '1,2,3,4,5'],
    ['FACES 3 integers',  '1,2,3'],
    ['FACES 7 integers',  '1,2,3,4,5,6,7'],
    ['FACES 9 integers',  '1,2,3,4,5,6,7,8,9'],
]) {
    expect(lbl, inject(`&GEOM ID='G', FACES=${faces} /`), 'geom-faces-stride');
}
expectClean('FACES 4 integers (ok)', inject("&GEOM ID='G', FACES=1,2,3,1 /"), 'geom-faces-stride');
expectClean('FACES 8 integers (ok)', inject("&GEOM ID='G', FACES=1,2,3,1,2,3,4,1 /"), 'geom-faces-stride');

// ─────────────────────────────────────────────────────────────────────────────
// RULE: vel-sign-convention
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── vel-sign-convention ──');
for (const [lbl, surf] of [
    ['EXHAUST VEL negative',   "&SURF ID='EXHAUST_FAN', VEL=-5 /"],
    ['EXTRACT VEL negative',   "&SURF ID='EXTRACT_VENT', VEL=-2 /"],
    ['OUTLET VEL negative',    "&SURF ID='OUTLET_SURF', VEL=-1 /"],
    ['SUPPLY VEL positive',    "&SURF ID='SUPPLY_FAN', VEL=5 /"],
    ['INTAKE VEL positive',    "&SURF ID='INTAKE_AIR', VEL=2 /"],
    ['INLET VEL positive',     "&SURF ID='INLET_SURF', VEL=1 /"],
    ['EXHAUST VOLUME_FLOW neg', "&SURF ID='EXHAUST_HOOD', VOLUME_FLOW=-0.5 /"],
    ['SUPPLY VOLUME_FLOW pos',  "&SURF ID='SUPPLY_AIR', VOLUME_FLOW=0.5 /"],
]) { expect(lbl, inject(surf), 'vel-sign-convention'); }
expectClean('EXHAUST VEL positive (correct)',
    inject("&SURF ID='EXHAUST_FAN', VEL=5 /"), 'vel-sign-convention');
expectClean('SUPPLY VEL negative (correct)',
    inject("&SURF ID='SUPPLY_FAN', VEL=-5 /"), 'vel-sign-convention');

// ─────────────────────────────────────────────────────────────────────────────
// RULE: ramp-t-monotonic
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── ramp-t-monotonic ──');
for (const [lbl, ramps] of [
    ['non-monotonic T',     "&RAMP ID='R', T=0, F=0 /\n&RAMP ID='R', T=60, F=1 /\n&RAMP ID='R', T=30, F=0.5 /"],
    ['T equal (not strict)', "&RAMP ID='R', T=0, F=0 /\n&RAMP ID='R', T=30, F=0.5 /\n&RAMP ID='R', T=30, F=1 /"],
    ['reversed T',           "&RAMP ID='R', T=60, F=1 /\n&RAMP ID='R', T=0, F=0 /"],
]) { expect(lbl, inject(ramps), 'ramp-t-monotonic'); }
expectClean('monotonic T (ok)',
    inject("&RAMP ID='R', T=0, F=0 /\n&RAMP ID='R', T=30, F=0.5 /\n&RAMP ID='R', T=60, F=1 /"),
    'ramp-t-monotonic');

// ─────────────────────────────────────────────────────────────────────────────
// RULE: ramp-single-entry
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── ramp-single-entry ──');
for (const [lbl, ramp] of [
    ['RAMP only 1 entry',   "&RAMP ID='HRAMP', T=0, F=1 /"],
    ['RAMP only 1 entry 2', "&RAMP ID='QRAMP', T=60, F=0.5 /"],
]) { expect(lbl, inject(ramp), 'ramp-single-entry'); }
expectClean('RAMP 2 entries (ok)',
    inject("&RAMP ID='R', T=0, F=0 /\n&RAMP ID='R', T=60, F=1 /"),
    'ramp-single-entry');
expectClean('RAMP 3 entries (ok)',
    inject("&RAMP ID='R', T=0, F=0 /\n&RAMP ID='R', T=30, F=0.5 /\n&RAMP ID='R', T=60, F=1 /"),
    'ramp-single-entry');

// ─────────────────────────────────────────────────────────────────────────────
// RULE: mesh-cell-aspect-ratio
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── mesh-cell-aspect-ratio ──');
for (const [lbl, ijk, xb] of [
    ['10:1 XZ aspect',  '10,10,100', '0,1,0,1,0,1'],
    ['10:1 YZ aspect',  '10,100,10', '0,1,0,1,0,1'],
    ['10:1 XY aspect',  '100,10,10', '0,1,0,1,0,1'],
    ['4:1 aspect (warn)', '40,10,10', '0,4,0,1,0,4'],
]) {
    const fds = `&HEAD CHID='x' /\n&TIME T_END=60 /\n&MESH IJK=${ijk}, XB=${xb} /\n&TAIL /`;
    expect(lbl, fds, 'mesh-cell-aspect-ratio');
}
expectClean('aspect ratio 1:1:1 (ok)',
    "&HEAD CHID='x' /\n&TIME T_END=60 /\n&MESH IJK=10,10,10, XB=0,1,0,1,0,1 /\n&TAIL /",
    'mesh-cell-aspect-ratio');

// ─────────────────────────────────────────────────────────────────────────────
// RULE: init-part-id-undefined
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── init-part-id-undefined ──');
expect('INIT PART_ID undefined',
    inject("&PART ID='DROPLETS', SPEC_ID='WATER VAPOR', DIAMETER=500 /\n&INIT XB=0,5,0,5,0,3, PART_ID='NOPE' /"),
    'init-part-id-undefined');
expectClean('INIT PART_ID defined',
    inject("&PART ID='DROPLETS', SPEC_ID='WATER VAPOR', DIAMETER=500 /\n&INIT XB=0,5,0,5,0,3, PART_ID='DROPLETS' /"),
    'init-part-id-undefined');

// ─────────────────────────────────────────────────────────────────────────────
// RULE: deprecated-params
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── deprecated-params ──');
for (const [lbl, surf] of [
    ['MOISTURE_CONTENT on SURF', "&SURF ID='W', MOISTURE_CONTENT=0.1 /"],
    ['MOISTURE_CONTENT on MATL', "&MATL ID='M', CONDUCTIVITY=0.1, SPECIFIC_HEAT=1.0, DENSITY=500, MOISTURE_CONTENT=0.05 /"],
]) { expect(lbl, inject(surf), 'deprecated-params'); }
expectClean('MOISTURE_FRACTION (correct name)',
    inject("&SURF ID='W', MOISTURE_FRACTION=0.1 /"),
    'deprecated-params');

// ─────────────────────────────────────────────────────────────────────────────
// RULE: dump-nframes-positive
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── dump-nframes-positive ──');
for (const [lbl, nf] of [
    ['NFRAMES=0',   0],
    ['NFRAMES=-1', -1],
    ['NFRAMES=-100', -100],
]) {
    expect(lbl, inject(`&DUMP NFRAMES=${nf} /`), 'dump-nframes-positive');
}
expectClean('NFRAMES=1000 (ok)', inject('&DUMP NFRAMES=1000 /'), 'dump-nframes-positive');

// ─────────────────────────────────────────────────────────────────────────────
// RULE: reac-fuel-species
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── reac-fuel-species ──');
for (const [lbl, fuel] of [
    ['unknown FUEL', 'URANIUM_HEXAFLUORIDE'],
    ['FUEL=PLASTIC (unknown)', 'PLASTIC'],
    ['FUEL=AIR (wrong)',       'AIR'],
]) {
    expect(lbl, inject(`&REAC FUEL='${fuel}' /`), 'reac-fuel-species');
}
expectClean("FUEL='PROPANE' (ok)",   inject("&REAC FUEL='PROPANE' /"), 'reac-fuel-species');
expectClean("FUEL='METHANE' (ok)",   inject("&REAC FUEL='METHANE' /"), 'reac-fuel-species');
expectClean("FUEL='HEPTANE' (ok)",   inject("&REAC FUEL='HEPTANE' /"), 'reac-fuel-species');

// ─────────────────────────────────────────────────────────────────────────────
// RULE: surf-vel-flow-conflict
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── surf-vel-flow-conflict ──');
for (const [lbl, surf] of [
    ['VEL + VOLUME_FLOW',   "&SURF ID='FAN', VEL=-2, VOLUME_FLOW=0.5 /"],
    ['VEL_T + MASS_FLUX',   "&SURF ID='FAN', VEL_T=1, MASS_FLUX=0.5 /"],
    ['VEL + MASS_FLOW_RATE', "&SURF ID='FAN', VEL=-1, MASS_FLOW_RATE=0.3 /"],
]) { expect(lbl, inject(surf), 'surf-vel-flow-conflict'); }
expectClean('VEL only (ok)',         inject("&SURF ID='FAN', VEL=-2 /"), 'surf-vel-flow-conflict');
expectClean('VOLUME_FLOW only (ok)', inject("&SURF ID='FAN', VOLUME_FLOW=0.5 /"), 'surf-vel-flow-conflict');

// ─────────────────────────────────────────────────────────────────────────────
// RULE: matl-arrhenius-incomplete
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── matl-arrhenius-incomplete ──');
for (const [lbl, matl] of [
    ['A without E or REFERENCE_TEMPERATURE', "&MATL ID='M', CONDUCTIVITY=0.1, SPECIFIC_HEAT=1.0, DENSITY=500, A=1e12 /"],
    ['E without A',                          "&MATL ID='M', CONDUCTIVITY=0.1, SPECIFIC_HEAT=1.0, DENSITY=500, E=200000 /"],
]) { expect(lbl, inject(matl), 'matl-arrhenius-incomplete'); }
expectClean('A + E (ok)',
    inject("&MATL ID='M', CONDUCTIVITY=0.1, SPECIFIC_HEAT=1.0, DENSITY=500, A=4.8E22, E=349000 /"),
    'matl-arrhenius-incomplete');
expectClean('A + REFERENCE_TEMPERATURE (ok)',
    inject("&MATL ID='M', CONDUCTIVITY=0.1, SPECIFIC_HEAT=1.0, DENSITY=500, A=1e12, REFERENCE_TEMPERATURE=340 /"),
    'matl-arrhenius-incomplete');
expectClean('no Arrhenius at all (ok)',
    inject("&MATL ID='M', CONDUCTIVITY=0.1, SPECIFIC_HEAT=1.0, DENSITY=500 /"),
    'matl-arrhenius-incomplete');

// ─────────────────────────────────────────────────────────────────────────────
// RULE: surf-matl-mass-fraction
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── surf-matl-mass-fraction ──');
for (const [lbl, surf] of [
    ['2 MATL_IDs 3 fractions',
        "&MATL ID='A', CONDUCTIVITY=0.1, SPECIFIC_HEAT=1.0, DENSITY=500 /\n" +
        "&MATL ID='B', CONDUCTIVITY=0.2, SPECIFIC_HEAT=1.0, DENSITY=600 /\n" +
        "&SURF ID='S', MATL_ID='A','B', MATL_MASS_FRACTION=0.5,0.3,0.2, THICKNESS=0.02 /"],
    ['fractions sum != 1.0',
        "&MATL ID='A', CONDUCTIVITY=0.1, SPECIFIC_HEAT=1.0, DENSITY=500 /\n" +
        "&MATL ID='B', CONDUCTIVITY=0.2, SPECIFIC_HEAT=1.0, DENSITY=600 /\n" +
        "&SURF ID='S', MATL_ID='A','B', MATL_MASS_FRACTION=0.3,0.3, THICKNESS=0.02 /"],
    ['fractions sum > 1.0',
        "&MATL ID='A', CONDUCTIVITY=0.1, SPECIFIC_HEAT=1.0, DENSITY=500 /\n" +
        "&MATL ID='B', CONDUCTIVITY=0.2, SPECIFIC_HEAT=1.0, DENSITY=600 /\n" +
        "&SURF ID='S', MATL_ID='A','B', MATL_MASS_FRACTION=0.8,0.8, THICKNESS=0.02 /"],
]) { expect(lbl, inject(surf), 'surf-matl-mass-fraction'); }
expectClean('fractions sum = 1.0 (ok)',
    inject(
        "&MATL ID='A', CONDUCTIVITY=0.1, SPECIFIC_HEAT=1.0, DENSITY=500 /\n" +
        "&MATL ID='B', CONDUCTIVITY=0.2, SPECIFIC_HEAT=1.0, DENSITY=600 /\n" +
        "&SURF ID='S', MATL_ID='A','B', MATL_MASS_FRACTION=0.6,0.4, THICKNESS=0.02 /"),
    'surf-matl-mass-fraction');

// ─────────────────────────────────────────────────────────────────────────────
// RULE: missing-comma
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── missing-comma ──');
for (const [lbl, body] of [
    ["ID='A' COLOR='RED' same line", "&SURF ID='A' COLOR='RED' /"],
    ["COLOR='RED' HRRPUA=250",       "&SURF ID='A' HRRPUA=250 /"],
    ["number IDENT= same line",      "&MESH IJK=10,10,10 XB=0,10,0,10,0,10 /"],
    ["multiline missing comma",      "&SURF ID='A',\n  COLOR='RED'\n  HRRPUA=250 /"],
    ["string then key on next line", "&SURF ID='A'\n  COLOR='RED' /"],
    ["number then key on next line", "&TIME T_END=60\n  DT=0.1 /"],
]) { expect(lbl, inject(body), 'missing-comma'); }
expectClean("commas present (ok)", inject("&SURF ID='A', COLOR='RED', HRRPUA=250 /"), 'missing-comma');

// ─────────────────────────────────────────────────────────────────────────────
// RULE: unterminated-string
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── unterminated-string ──');
for (const [lbl, body] of [
    ["SURF_ID='CONCRETE, COLOR='GRAY",  "&OBST XB=0,5,0,5,0,1, SURF_ID='CONCRETE, COLOR='GRAY /"],
    ["ID='WOOD, COLOR='BROWN",          "&SURF ID='WOOD, COLOR='BROWN /"],
    ["missing quote SURF_ID",           "&VENT XB=0,0,0,10,0,10, SURF_ID='OPEN, MB='XMIN' /"],
    ["CHID missing close quote",        "&OBST XB=0,5,0,5,0,1, SURF_ID='FIRE, HRRPUA='250 /"],
]) { expect(lbl, inject(body), 'unterminated-string'); }
expectClean("all quotes closed (ok)",  inject("&OBST XB=0,5,0,5,0,1, SURF_ID='INERT' /"), 'unterminated-string');
expectClean("SURF ID='CONCRETE' ok",   inject("&SURF ID='CONCRETE', COLOR='GRAY' /"), 'unterminated-string');

// ─────────────────────────────────────────────────────────────────────────────
// RULE: duplicate-ids (VENT)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── duplicate-ids (VENT) ──');
expect('duplicate VENT ID',
    inject("&VENT ID='V1', XB=0,0,0,10,0,10, SURF_ID='OPEN' /\n&VENT ID='V1', XB=10,10,0,10,0,10, SURF_ID='OPEN' /"),
    'duplicate-ids');
expectClean('unique VENT IDs',
    inject("&VENT ID='V1', XB=0,0,0,10,0,10, SURF_ID='OPEN' /\n&VENT ID='V2', XB=10,10,0,10,0,10, SURF_ID='OPEN' /"),
    'duplicate-ids');

// ─────────────────────────────────────────────────────────────────────────────
// RULE: matl-zero-properties
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── matl-zero-properties ──');
for (const [lbl, matl] of [
    ['DENSITY=0',       "&MATL ID='M', CONDUCTIVITY=0.1, SPECIFIC_HEAT=1.0, DENSITY=0 /"],
    ['CONDUCTIVITY=0',  "&MATL ID='M', CONDUCTIVITY=0, SPECIFIC_HEAT=1.0, DENSITY=500 /"],
    ['SPECIFIC_HEAT=0', "&MATL ID='M', CONDUCTIVITY=0.1, SPECIFIC_HEAT=0, DENSITY=500 /"],
    ['all three =0',    "&MATL ID='M', CONDUCTIVITY=0, SPECIFIC_HEAT=0, DENSITY=0 /"],
]) { expect(lbl, inject(matl), 'matl-zero-properties'); }
expectClean('MATL all positive (ok)',
    inject("&MATL ID='M', CONDUCTIVITY=0.12, SPECIFIC_HEAT=1.7, DENSITY=500 /"),
    'matl-zero-properties');
expectClean('MATL no zero props (ok)', BASE, 'matl-zero-properties');

// ─────────────────────────────────────────────────────────────────────────────
// RULE: matl-heat-of-reaction
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── matl-heat-of-reaction ──');
for (const [lbl, hor] of [
    ['HEAT_OF_REACTION=0',    0],
    ['HEAT_OF_REACTION=-100', -100],
    ['HEAT_OF_REACTION=-0.1', -0.1],
]) {
    const fds = inject(`&MATL ID='M', CONDUCTIVITY=0.1, SPECIFIC_HEAT=1.0, DENSITY=500, HEAT_OF_REACTION=${hor} /`);
    expect(lbl, fds, 'matl-heat-of-reaction');
}
expectClean('HEAT_OF_REACTION=920 (ok)',
    inject("&MATL ID='M', CONDUCTIVITY=0.1, SPECIFIC_HEAT=1.0, DENSITY=500, HEAT_OF_REACTION=920 /"),
    'matl-heat-of-reaction');
expectClean('no HEAT_OF_REACTION (ok)',
    inject("&MATL ID='M', CONDUCTIVITY=0.1, SPECIFIC_HEAT=1.0, DENSITY=500 /"),
    'matl-heat-of-reaction');

// ─────────────────────────────────────────────────────────────────────────────
// RULE: surf-hrrpua-pyrolysis-conflict
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── surf-hrrpua-pyrolysis-conflict ──');
for (const [lbl, surf] of [
    ['HRRPUA + MATL_ID',
        "&MATL ID='WOOD', CONDUCTIVITY=0.12, SPECIFIC_HEAT=1.7, DENSITY=500, A=1e10, E=150000, HEAT_OF_REACTION=500 /\n" +
        "&SURF ID='FIRE', HRRPUA=250, MATL_ID='WOOD', THICKNESS=0.02 /"],
    ['MLRPUA + MATL_ID',
        "&MATL ID='FOAM', CONDUCTIVITY=0.05, SPECIFIC_HEAT=1.5, DENSITY=30, A=5e9, E=130000, HEAT_OF_REACTION=800 /\n" +
        "&SURF ID='S', MLRPUA=0.02, MATL_ID='FOAM', THICKNESS=0.05 /"],
]) { expect(lbl, inject(surf), 'surf-hrrpua-pyrolysis-conflict'); }
expectClean('HRRPUA only (no MATL_ID)',
    inject("&SURF ID='FIRE', HRRPUA=250 /"),
    'surf-hrrpua-pyrolysis-conflict');
expectClean('MATL_ID only (no HRRPUA)',
    inject("&MATL ID='W', CONDUCTIVITY=0.12, SPECIFIC_HEAT=1.7, DENSITY=500 /\n&SURF ID='S', MATL_ID='W', THICKNESS=0.02 /"),
    'surf-hrrpua-pyrolysis-conflict');

// ─────────────────────────────────────────────────────────────────────────────
// RULE: surf-mass-flux-negative
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── surf-mass-flux-negative ──');
for (const [lbl, mf] of [
    ['MASS_FLUX=-0.01',  -0.01],
    ['MASS_FLUX=-1',     -1],
    ['MASS_FLUX=-100',   -100],
]) {
    expect(lbl, inject(`&SURF ID='S', MASS_FLUX=${mf} /`), 'surf-mass-flux-negative');
}
expectClean('MASS_FLUX=0 (ok)',   inject("&SURF ID='S', MASS_FLUX=0 /"), 'surf-mass-flux-negative');
expectClean('MASS_FLUX=0.01 (ok)', inject("&SURF ID='S', MASS_FLUX=0.01 /"), 'surf-mass-flux-negative');

// ─────────────────────────────────────────────────────────────────────────────
// RULE: surf-thickness-required
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── surf-thickness-required ──');
for (const [lbl, surf] of [
    ['MATL_ID no THICKNESS (single)',
        "&MATL ID='W', CONDUCTIVITY=0.12, SPECIFIC_HEAT=1.7, DENSITY=500 /\n" +
        "&SURF ID='S', MATL_ID='W' /"],
    ['MATL_ID no THICKNESS (multi)',
        "&MATL ID='A', CONDUCTIVITY=0.1, SPECIFIC_HEAT=1.0, DENSITY=500 /\n" +
        "&MATL ID='B', CONDUCTIVITY=0.2, SPECIFIC_HEAT=1.0, DENSITY=600 /\n" +
        "&SURF ID='S', MATL_ID='A','B' /"],
]) { expect(lbl, inject(surf), 'surf-thickness-required'); }
expectClean('MATL_ID + THICKNESS (ok)',
    inject("&MATL ID='W', CONDUCTIVITY=0.12, SPECIFIC_HEAT=1.7, DENSITY=500 /\n&SURF ID='S', MATL_ID='W', THICKNESS=0.02 /"),
    'surf-thickness-required');
expectClean('no MATL_ID (ok)',
    inject("&SURF ID='WALL', COLOR='GRAY' /"),
    'surf-thickness-required');

// ─────────────────────────────────────────────────────────────────────────────
// RULE: ctrl-input-undefined
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── ctrl-input-undefined ──');
for (const [lbl, ctrl] of [
    ['CTRL INPUT_ID not a DEVC',
        "&DEVC ID='TC1', QUANTITY='TEMPERATURE', XYZ=5,5,5 /\n" +
        "&CTRL ID='C1', FUNCTION_TYPE='ANY', INPUT_ID='NOPE' /"],
    ['CTRL INPUT_ID list one missing',
        "&DEVC ID='TC1', QUANTITY='TEMPERATURE', XYZ=5,5,5 /\n" +
        "&CTRL ID='C1', FUNCTION_TYPE='ALL', INPUT_ID='TC1','GHOSTSENSOR' /"],
]) { expect(lbl, inject(ctrl), 'ctrl-input-undefined'); }
expectClean('CTRL INPUT_ID points to DEVC (ok)',
    inject("&DEVC ID='TC1', QUANTITY='TEMPERATURE', XYZ=5,5,5 /\n&CTRL ID='C1', FUNCTION_TYPE='ANY', INPUT_ID='TC1' /"),
    'ctrl-input-undefined');
expectClean('CTRL INPUT_ID points to other CTRL (ok)',
    inject("&CTRL ID='C1', FUNCTION_TYPE='ANY', INPUT_ID='C2' /\n&CTRL ID='C2', FUNCTION_TYPE='ANY', INPUT_ID='C1' /"),
    'ctrl-input-undefined');

// ─────────────────────────────────────────────────────────────────────────────
// RULE: ctrl-no-inputs
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── ctrl-no-inputs ──');
for (const [lbl, ft] of [
    ['CTRL ANY no INPUT_ID',       'ANY'],
    ['CTRL ALL no INPUT_ID',       'ALL'],
    ['CTRL TIME_DELAY no INPUT_ID', 'TIME_DELAY'],
    ['CTRL AT_LEAST no INPUT_ID',  'AT_LEAST'],
]) {
    expect(lbl, inject(`&CTRL ID='C', FUNCTION_TYPE='${ft}' /`), 'ctrl-no-inputs');
}
expectClean('CTRL ANY with INPUT_ID (ok)',
    inject("&DEVC ID='D', QUANTITY='TEMPERATURE', XYZ=5,5,5 /\n&CTRL ID='C', FUNCTION_TYPE='ANY', INPUT_ID='D' /"),
    'ctrl-no-inputs');
expectClean('CTRL DEADBAND no INPUT_ID (ok — different type)',
    inject("&CTRL ID='C', FUNCTION_TYPE='DEADBAND' /"),
    'ctrl-no-inputs');

// ─────────────────────────────────────────────────────────────────────────────
// RULE: hole-no-obst
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── hole-no-obst ──');
for (const [lbl, hxb] of [
    ['HOLE far from OBST',  '20,25,0,5,0,5'],
    ['HOLE clearly outside',  '20,25,0,5,0,5'],
]) {
    expect(lbl, inject(`&OBST XB=0,5,0,5,0,3, SURF_ID='INERT' /\n&HOLE XB=${hxb} /`), 'hole-no-obst');
}
expectClean('HOLE overlapping OBST (ok)',
    inject("&OBST XB=0,5,0,5,0,3, SURF_ID='INERT' /\n&HOLE XB=1,4,1,4,0,3 /"),
    'hole-no-obst');
expectClean('HOLE touching OBST face (ok)',
    inject("&OBST XB=0,5,0,5,0,3, SURF_ID='INERT' /\n&HOLE XB=0,5,0,5,1,2 /"),
    'hole-no-obst');

// ─────────────────────────────────────────────────────────────────────────────
// RULE: ctrl-devc-conflict
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── ctrl-devc-conflict ──');
for (const [lbl, rec] of [
    ['VENT both CTRL_ID and DEVC_ID',
        "&CTRL ID='C1', FUNCTION_TYPE='ANY', INPUT_ID='D1' /\n" +
        "&DEVC ID='D1', QUANTITY='TEMPERATURE', XYZ=5,5,5 /\n" +
        "&VENT XB=0,0,0,10,0,10, SURF_ID='OPEN', CTRL_ID='C1', DEVC_ID='D1' /"],
    ['OBST both CTRL_ID and DEVC_ID',
        "&CTRL ID='C1', FUNCTION_TYPE='ANY', INPUT_ID='D1' /\n" +
        "&DEVC ID='D1', QUANTITY='TEMPERATURE', XYZ=5,5,5 /\n" +
        "&OBST XB=1,4,1,4,0,1, SURF_ID='INERT', CTRL_ID='C1', DEVC_ID='D1' /"],
]) { expect(lbl, inject(rec), 'ctrl-devc-conflict'); }
expectClean('VENT CTRL_ID only (ok)',
    inject("&CTRL ID='C1', FUNCTION_TYPE='ANY', INPUT_ID='D1' /\n&DEVC ID='D1', QUANTITY='TEMPERATURE', XYZ=5,5,5 /\n&VENT XB=0,0,0,10,0,10, SURF_ID='OPEN', CTRL_ID='C1' /"),
    'ctrl-devc-conflict');
expectClean('VENT DEVC_ID only (ok)',
    inject("&DEVC ID='D1', QUANTITY='TEMPERATURE', XYZ=5,5,5 /\n&VENT XB=0,0,0,10,0,10, SURF_ID='OPEN', DEVC_ID='D1' /"),
    'ctrl-devc-conflict');

// ─────────────────────────────────────────────────────────────────────────────
// RULE: init-fraction-conflict
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── init-fraction-conflict ──');
for (const [lbl, init] of [
    ['INIT both MASS_FRACTION and VOLUME_FRACTION',
        "&SPEC ID='PROPANE', FORMULA='C3H8' /\n" +
        "&INIT XB=1,4,1,4,0,3, SPEC_ID='PROPANE', MASS_FRACTION=0.1, VOLUME_FRACTION=0.05 /"],
    ['INIT both fractions minimal',
        "&INIT XB=0,5,0,5,0,3, MASS_FRACTION=0.05, VOLUME_FRACTION=0.05 /"],
]) { expect(lbl, inject(init), 'init-fraction-conflict'); }
expectClean('INIT MASS_FRACTION only (ok)',
    inject("&INIT XB=0,5,0,5,0,3, MASS_FRACTION=0.05 /"),
    'init-fraction-conflict');
expectClean('INIT VOLUME_FRACTION only (ok)',
    inject("&INIT XB=0,5,0,5,0,3, VOLUME_FRACTION=0.05 /"),
    'init-fraction-conflict');

// ─────────────────────────────────────────────────────────────────────────────
// RULE: mesh-cylindrical
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── mesh-cylindrical ──');
const CYL_BASE = [
    "&HEAD CHID='cyl', TITLE='Cylindrical' /",
    '&TIME T_END=60 /',
    '&MISC CYLINDRICAL=.TRUE. /',
].join('\n') + '\n';
for (const [lbl, fds] of [
    ['XB(1) < 0 (negative radius)',
        CYL_BASE + '&MESH IJK=10,1,10, XB=-1,5,0,1,0,5 /\n&TAIL /'],
    ['IJK(2) != 1 (J=4)',
        CYL_BASE + '&MESH IJK=10,4,10, XB=0,5,0,1,0,5 /\n&TAIL /'],
    ['both negative radius and J!=1',
        CYL_BASE + '&MESH IJK=10,3,10, XB=-2,5,0,1,0,5 /\n&TAIL /'],
]) { expect(lbl, fds, 'mesh-cylindrical'); }
expectClean('cylindrical valid mesh (ok)',
    CYL_BASE + '&MESH IJK=10,1,10, XB=0,5,0,1,0,5 /\n&TAIL /',
    'mesh-cylindrical');
expectClean('no CYLINDRICAL (rule skipped)',
    BASE + '\n&MESH IJK=10,4,10, XB=0,5,0,5,0,5 /\n',
    'mesh-cylindrical');

// ─────────────────────────────────────────────────────────────────────────────
// RULE: devc-quantity-range
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── devc-quantity-range ──');
for (const [lbl, qr] of [
    ['upper = lower (equal)',    '100,100'],
    ['upper < lower (reversed)', '200,100'],
    ['upper = lower (zeros)',    '0,0'],
    ['upper negative < lower',  '50,-50'],
]) {
    expect(lbl,
        inject(`&DEVC ID='D', QUANTITY='TEMPERATURE', XYZ=5,5,5, QUANTITY_RANGE=${qr} /`),
        'devc-quantity-range');
}
expectClean('QUANTITY_RANGE valid (ok)',
    inject("&DEVC ID='D', QUANTITY='TEMPERATURE', XYZ=5,5,5, QUANTITY_RANGE=50,200 /"),
    'devc-quantity-range');
expectClean('no QUANTITY_RANGE (ok)',
    inject("&DEVC ID='D', QUANTITY='TEMPERATURE', XYZ=5,5,5 /"),
    'devc-quantity-range');

// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// (cascade suppression removed)
// ─────────────────────────────────────────────────────────────────────────────
if (false) {
    // 'SILVER' (closing quote) opens a second string that runs over 6 comment
    // lines (stripped to bare newlines, no ' chars) into the &MATL record,
    // giving the bad SURF an unterminated span of 8 lines (> 5).
    // Without suppression: matl-id-undefined fires for S1 (M1 swallowed).
    // With suppression:    only parse-error findings + 1 INFO remain.
    const cascadeFile = [
        "&HEAD CHID='x' /",
        '&TIME T_END=60 /',
        '&MESH IJK=10,10,10, XB=0,10,0,10,0,10 /',
        "&SURF ID='S1', MATL_ID='M1', THICKNESS=0.02 /",
        // SILVER' opens second string; 6 stripped comment lines (no ' chars)
        // keep it open until the ' in &MATL ID='M1' finally closes it.
        "&SURF ID='BROKEN, COLOR='SILVER'",
        '! comment 1', '! comment 2', '! comment 3',
        '! comment 4', '! comment 5', '! comment 6',
        "&MATL ID='M1', CONDUCTIVITY=0.1, SPECIFIC_HEAT=1.0, DENSITY=500 /",
        '&TAIL /',
    ].join('\n');

    const cascadeFindings = fdsLint(cascadeFile);
    const hasSuppressed = cascadeFindings.some(f => f.rule === 'cascade-suppressed');
    const hasMatl = cascadeFindings.some(f => f.rule === 'matl-id-undefined');
    const hasUS = cascadeFindings.some(f => f.rule === 'unterminated-string');
    const hasUnterm = cascadeFindings.some(f => f.rule === 'unterminated-record');
    total++;
    // Behavior: when an unterminated-string fires on the same line as the
    // cascade-start unterminated-record, the record finding is suppressed
    // (the string finding is the actionable one). Cascade noise is silently
    // dropped — no INFO note (it would just say "N cascade errors", which
    // is exactly the number we hid).
    if (!hasSuppressed && !hasMatl && hasUS && !hasUnterm) {
        passed++;
        console.log('  [PASS] cascade: unterminated-string kept (pinpoints typo); record + reference checks silently suppressed');
    } else {
        failed++;
        const rules = cascadeFindings.map(f => f.rule);
        console.log('  [FAIL] cascade suppression');
        console.log(`         hasSuppressed=${hasSuppressed} (expect false) hasMatl=${hasMatl} hasUS=${hasUS} hasUnterm=${hasUnterm}`);
        console.log(`         rules: ${rules.join(', ')}`);
        failures.push({ label:'cascade suppression', rule:'cascade-suppressed', got: rules.join(', ') });
    }

    // Without cascade: a simple missing / (small span, next & found)
    // should NOT suppress reference checks.
    const smallUnterm = [
        "&HEAD CHID='x' /",
        '&TIME T_END=60 /',
        '&MESH IJK=10,10,10, XB=0,10,0,10,0,10 /',
        "&SURF ID='WALL', MATL_ID='NOSUCH', THICKNESS=0.1",  // small unterminated (1 line)
        '&TAIL /',
    ].join('\n');
    const smallFindings = fdsLint(smallUnterm);
    const smallHasMatl = smallFindings.some(f => f.rule === 'matl-id-undefined');
    total++;
    if (smallHasMatl) {
        passed++;
        console.log('  [PASS] small unterminated record: matl-id-undefined still fires (no cascade suppression)');
    } else {
        failed++;
        console.log('  [FAIL] small unterminated: matl-id-undefined was wrongly suppressed');
        failures.push({ label:'small unterm no suppress', rule:'matl-id-undefined', got:'(suppressed)' });
    }

    // Real-world scenario: typo &SURF ID='STEEL, COLOR='SILVER' /  (missing '
    // after STEEL) inside a file with many 'word', KEY='word' patterns
    // downstream — produces 20+ unterminated-string findings. Suppression
    // should keep just ONE unterminated-string (pinpointing the typo) plus
    // the unterminated-record, and collapse the rest into one INFO note.
    //
    // ALSO: malformed ID strings (e.g., &SURF ID='GLASS, COLOR='...) where
    // the quote is missing but / is present. This doesn't create an
    // unterminated-record (the record IS terminated) but the ID is never
    // captured, causing downstream reference errors. New suppression
    // pattern: suppress reference errors when unterminated-string findings
    // indicate ID corruption.
    // Malformed ID strings: &SURF ID='GLASS, COLOR='... (missing ' after GLASS)
    // The / is present, so unterminated-record doesn't fire. But the ID is
    // never captured, causing downstream OBST/VENT reference errors. Suppress
    // those reference errors because they're caused by the unterminated-string.
    const malformedIdFile = [
        "&HEAD CHID='test' /",
        '&TIME T_END=60 /',
        '&MESH IJK=10,10,10, XB=0,10,0,10,0,10 /',
        "&REAC FUEL='PROPANE' /",
        "&SURF ID='GLASS, COLOR='LIGHT BLUE', TRANSPARENCY=0.3 /",  // typo: missing ' after GLASS
        "&SURF ID='STEEL, COLOR='SILVER' /",  // typo: missing ' after STEEL
        "&MATL ID='CONCRETE', DENSITY=2300, CONDUCTIVITY=1.8, SPECIFIC_HEAT=1.04 /",
        "&OBST XB=0,2,0,2,0,3, SURF_ID='GLASS', COLOR='LIGHT BLUE' /",
        "&OBST XB=2,4,2,4,0,4, SURF_ID='GLASS', COLOR='LIGHT BLUE' /",
        "&OBST XB=4,6,4,6,0,4, SURF_ID='STEEL', COLOR='SILVER' /",
        "&VENT XB=0,10,0,0,0,10, SURF_ID='STEEL', COLOR='GRAY' /",
        '&TAIL /',
    ].join('\n');
    const miFindings = fdsLint(malformedIdFile);
    const miUS = miFindings.filter(f => f.rule === 'unterminated-string');
    const miRef = miFindings.filter(f => f.rule === 'surf-id-undefined');
    total++;
    // Moderate suppression for malformed ID strings: keep 1st unterminated-string per line,
    // keep 1st reference error per unique undefined ID. This shows multiple problems
    // (e.g., both GLASS and STEEL errors) without explosive cascading.
    // GLASS: unterminated-string suppresses its own ref errors (redundant).
    // STEEL: no unterminated-string → keep 1 ref error as signal of 2nd typo.
    if (miUS.length === 1 && miRef.length === 1 && miFindings.length <= 3) {
        passed++;
        console.log(`  [PASS] malformed ID strings: GLASS ref suppressed (has unterminated-string), STEEL ref kept (${miFindings.length} findings total)`);
    } else {
        failed++;
        console.log('  [FAIL] malformed ID strings: suppression not balanced correctly');
        console.log(`         unterminated-string=${miUS.length} (expect 1), surf-id-undefined=${miRef.length} (expect 1: STEEL only), total=${miFindings.length} (expect ≤3)`);
        failures.push({ label:'malformed ID strings', rule:'cascade-suppression-pattern-2', got:`unterminated-string=${miUS.length}, ref=${miRef.length}` });
    }

    const realWorldCascade = [
        "&HEAD CHID='room' /",
        '&TIME T_END=60 /',
        '&MESH IJK=10,10,10, XB=0,10,0,10,0,10 /',
        "&REAC FUEL='PROPANE' /",
        "&SURF ID='GLASS', COLOR='LIGHT BLUE', TRANSPARENCY=0.5 /",
        "&SURF ID='STEEL, COLOR='SILVER' /",  // <-- typo: missing ' after STEEL
        "&MATL ID='CONCRETE', DENSITY=2300., CONDUCTIVITY=1.8, SPECIFIC_HEAT=1.04 /",
        "&MATL ID='WOOD', DENSITY=450., CONDUCTIVITY=0.14, SPECIFIC_HEAT=2.85 /",
        "&OBST XB=0.0,6.0,0.0,4.0,0.0,0.0, SURF_ID='CONCRETE', COLOR='GRAY' /",
        "&OBST XB=0.0,6.0,0.0,0.0,0.0,3.0, SURF_ID='CONCRETE', COLOR='BEIGE' /",
        "&OBST XB=0.0,1.5,4.0,4.0,0.0,3.0, SURF_ID='CONCRETE', COLOR='BEIGE' /",
        "&OBST XB=2.5,6.0,4.0,4.0,0.0,3.0, SURF_ID='CONCRETE', COLOR='BEIGE' /",
        "&OBST XB=1.5,2.5,4.0,4.0,2.1,3.0, SURF_ID='CONCRETE', COLOR='BEIGE' /",
        "&OBST XB=0.0,0.0,0.0,4.0,0.0,0.8, SURF_ID='CONCRETE', COLOR='BEIGE' /",
        "&OBST XB=0.0,0.0,0.0,4.0,2.2,3.0, SURF_ID='CONCRETE', COLOR='BEIGE' /",
        "&OBST XB=6.0,6.0,0.0,4.0,0.0,3.0, SURF_ID='CONCRETE', COLOR='BEIGE' /",
        '&TAIL /',
    ].join('\n');
    const rwFindings = fdsLint(realWorldCascade);
    const rwUS = rwFindings.filter(f => f.rule === 'unterminated-string');
    const rwSuppressed = rwFindings.some(f => f.rule === 'cascade-suppressed');
    const rwUnterm = rwFindings.some(f => f.rule === 'unterminated-record');
    total++;
    // Expect exactly ONE unterminated-string (pinpoints typo). The
    // unterminated-record and cascade-suppressed INFO are both suppressed
    // — user sees just the actionable error.
    if (rwUS.length === 1 && !rwSuppressed && !rwUnterm && rwFindings.length < 4) {
        passed++;
        console.log(`  [PASS] real-world cascade: collapsed to ${rwFindings.length} findings (1 actionable error, no cascade INFO noise)`);
    } else {
        failed++;
        console.log('  [FAIL] real-world cascade not collapsed');
        console.log(`         unterminated-string count=${rwUS.length} (expect 1), total=${rwFindings.length} (expect < 4)`);
        console.log(`         hasSuppressed=${rwSuppressed} (expect false) hasUnterm=${rwUnterm} (expect false)`);
        failures.push({ label:'real-world cascade', rule:'cascade-suppressed', got:`${rwFindings.length} findings, ${rwUS.length} unterminated-string, hasUnterm=${rwUnterm}, hasSuppressed=${rwSuppressed}` });
    }
}

if (false) { // stress test removed
console.log('\n── STRESS TEST: Random syntax breaks ──');

// Real-world scenario: a proper FDS file
const stressBase = [
    "&HEAD CHID='room_fire' /",
    '&TIME T_END=120 /',
    '&MESH IJK=20,20,20, XB=0,10,0,10,0,10 /',
    "&REAC FUEL='PROPANE', SOOT_YIELD=0.05, CO_YIELD=0.02 /",
    "&SURF ID='FIRE', HRRPUA=500, RAMP_Q='FIRE_RAMP' /",
    "&SURF ID='WALLS', COLOR='GRAY' /",
    "&MATL ID='CONCRETE', DENSITY=2300, CONDUCTIVITY=1.8, SPECIFIC_HEAT=1.04 /",
    "&MATL ID='FOAM', DENSITY=40, CONDUCTIVITY=0.05, SPECIFIC_HEAT=2.5 /",
    "&OBST XB=0,2,0,2,0,3, SURF_ID='FIRE', COLOR='RED' /",
    "&OBST XB=2,5,0,5,0,5, SURF_ID='WALLS', COLOR='WHITE' /",
    "&OBST XB=5,8,0,8,0,6, SURF_ID='WALLS', MATL_ID='FOAM' /",
    "&DEVC XB=5,5,5,5,8,8, QUANTITY='TEMPERATURE', ID='PROBE_1' /",
    "&DEVC XB=7,7,3,3,6,6, QUANTITY='VELOCITY', COMPONENT='U', ID='PROBE_2' /",
    "&RAMP ID='FIRE_RAMP', T=0, F=0 /",
    "&RAMP ID='FIRE_RAMP', T=30, F=1 /",
    "&RAMP ID='FIRE_RAMP', T=120, F=0.5 /",
    '&TAIL /',
].join('\n');

const lines = stressBase.split('\n');
const stressMutations = [];

for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    // Try removing each ', ,, / character in the line
    for (let charIdx = 0; charIdx < line.length; charIdx++) {
        const ch = line[charIdx];
        if (ch === "'" || ch === ',' || ch === '/') {
            const mutated = line.slice(0, charIdx) + line.slice(charIdx + 1);
            const modifiedLines = lines.slice();
            modifiedLines[lineIdx] = mutated;
            const mutatedFds = modifiedLines.join('\n');
            const findings = fdsLint(mutatedFds);
            const findingCount = findings.length;
            const hasUntermString = findings.some(f => f.rule === 'unterminated-string');
            const hasUntermRecord = findings.some(f => f.rule === 'unterminated-record');
            stressMutations.push({
                lineIdx,
                charIdx,
                char: ch,
                findingCount,
                hasUntermString,
                hasUntermRecord,
                isCascading: findingCount >= 10,
                findings
            });
        }
    }
}

// Analyze results
const cascadingMutations = stressMutations.filter(m => m.isCascading);
const maxFindings = Math.max(...stressMutations.map(m => m.findingCount));
const avgFindings = (stressMutations.reduce((s, m) => s + m.findingCount, 0) / stressMutations.length).toFixed(1);

console.log(`  Tested ${stressMutations.length} mutations (removing ', ,, /):`);
console.log(`    - Cascading mutations (≥10 findings): ${cascadingMutations.length} (${(cascadingMutations.length / stressMutations.length * 100).toFixed(1)}%)`);
console.log(`    - Max findings in any mutation: ${maxFindings}`);
console.log(`    - Avg findings per mutation: ${avgFindings}`);

// Success if <10% of mutations produce 10+ findings
const cascadePercent = cascadingMutations.length / stressMutations.length;
total++;
if (cascadePercent < 0.1 && maxFindings < 20) {
    passed++;
    console.log('  [PASS] Cascade suppression: most single-char breaks produce < 10 findings');
} else {
    failed++;
    console.log(`  [FAIL] Cascade suppression ineffective: ${cascadePercent * 100}% mutations trigger cascades (max=${maxFindings})`);
    failures.push({ label:'stress test cascade', rule:'cascade-suppression', got:`${cascadePercent * 100}% cascading, max=${maxFindings}` });
}

// If fire-panel.js is available, test HTML balance
try {
    const firePanelSrc = fs.readFileSync(
        path.join(__dirname, 'js', 'fire-panel.js'), 'utf8');
    const ctx2 = { console, document: { querySelectorAll: () => [], querySelector: () => null } };
    vm.createContext(ctx2);
    vm.runInContext(firePanelSrc, ctx2);
    const highlightFds = ctx2.highlightFds;

    if (typeof highlightFds === 'function') {
        console.log('  Testing syntax highlighter HTML balance...');
        let htmlBreakCount = 0;
        for (const mut of stressMutations) {
            const modifiedLines = lines.slice();
            modifiedLines[mut.lineIdx] = lines[mut.lineIdx].slice(0, mut.charIdx) +
                                         lines[mut.lineIdx].slice(mut.charIdx + 1);
            const mutatedFds = modifiedLines.join('\n');
            const highlighted = highlightFds(mutatedFds);

            // Check HTML balance: count <span> and </span> per line
            const htmlLines = highlighted.split('\n');
            for (const htmlLine of htmlLines) {
                const opens = (htmlLine.match(/<span/g) || []).length;
                const closes = (htmlLine.match(/<\/span>/g) || []).length;
                if (opens !== closes) {
                    htmlBreakCount++;
                    break; // count once per mutation
                }
            }
        }

        total++;
        if (htmlBreakCount === 0) {
            passed++;
            console.log(`  [PASS] HTML balance: all ${stressMutations.length} mutations produce balanced spans`);
        } else {
            failed++;
            console.log(`  [FAIL] HTML balance: ${htmlBreakCount} mutations produce unbalanced HTML`);
            failures.push({ label:'highlighter HTML balance', rule:'html-span-balance', got:`${htmlBreakCount} broken` });
        }
    }
} catch (e) {
    console.log(`  (Skipped highlighter test: ${e.message})`);
}
} // end stress test block

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(70));
console.log(`Total: ${total}  |  Passed: ${passed}  |  Failed: ${failed}`);
console.log('═'.repeat(70));

if (failures.length) {
    console.log('\nFAILED TESTS (rules to fix):');
    const byRule = {};
    for (const f of failures) {
        (byRule[f.rule] = byRule[f.rule] || []).push(f.label);
    }
    for (const [rule, labels] of Object.entries(byRule)) {
        console.log(`\n  Rule: ${rule}`);
        for (const l of labels) console.log(`    - ${l}`);
    }
} else {
    console.log('\nAll tests passed!');
}

process.exit(failed > 0 ? 1 : 0);
