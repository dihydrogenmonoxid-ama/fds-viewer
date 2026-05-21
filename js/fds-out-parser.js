/**
 * FDS .out file parser.
 *
 * Reads the diagnostic log written by FDS during a run and extracts
 * ERROR / WARNING / STOP messages plus a summary (CHID, version, runtime).
 *
 *   parseFdsOut(outText, fdsText) → { findings, summary }
 *
 * findings: [{ severity, message, hint, line, lineEnd, rule, code, entity }]
 *   - severity:   'ERROR' | 'WARNING' | 'INFO'
 *   - message:    the FDS message body (may span multiple lines)
 *   - hint:       optional follow-up advice for known codes
 *   - line:       1-based line in the .fds source (best-effort entity match)
 *   - lineEnd:    end line for multi-line namelists
 *   - rule:       short label (e.g. "FDS ERROR(101)")
 *   - code:       numeric code if present (e.g. 101)
 *   - entity:     { kind: 'OBST'|'MESH'|'SURF'|'MATL'|..., name?: string, index?: number }
 *
 * summary: { chid, jobTitle, version, mpiProcs, status, totalTimeSec, completedOk }
 *
 * The parser intentionally ignores iteration-by-iteration metrics that contain the
 * word "Error" ("Maximum Velocity Error", "Maximum Pressure Error", ...).
 */

(function (global) {
    'use strict';

    // Lines starting with these tokens are real diagnostic messages.
    // We anchor at start (after optional leading whitespace) to skip metric lines
    // like "Maximum Velocity Error" or "Maximum Pressure Error".
    const RE_ERROR    = /^\s*ERROR(?:\((\d+)\))?:\s*(.*)$/;
    const RE_WARNING  = /^\s*WARNING(?:\((\d+)\))?:\s*(.*)$/;
    const RE_FATAL    = /^\s*FATAL(?:\((\d+)\))?:\s*(.*)$/;
    const RE_STOP     = /^\s*STOP:\s*(.*)$/;

    // Header lines we extract for the summary
    const RE_REVISION = /^\s*Revision\s*:\s*(\S+)/;
    const RE_CHID     = /^\s*Job ID string\s*:\s*(\S+)/;
    const RE_TITLE    = /^\s*Job TITLE\s*:\s*(.+)$/;
    const RE_MPI      = /^\s*Number of MPI Processes:\s*(\d+)/;
    const RE_RUNTIME  = /^\s*Total Elapsed Wall Clock Time \(s\):\s*([\d.]+)/;
    const RE_TIMESTEP = /^\s*Time Stepping Wall Clock Time \(s\):\s*([\d.]+)/;

    // Entity references inside error messages — used to map back to the .fds source
    // Examples FDS emits:
    //   "OBST   3"
    //   "MESH    1"
    //   "SURF_ID 'WALL'"
    //   "MATL_ID 'Cellulose'"
    //   "namelist group MATL ID Cellulose"
    const RE_ENT_INDEX = /\b(OBST|MESH|VENT|HOLE|SURF|MATL|DEVC|SPEC|REAC|INIT|HVAC|RAMP)[\s,]+#?(\d+)\b/;
    const RE_ENT_NAME  = /\b(OBST|MESH|VENT|HOLE|SURF|MATL|DEVC|SPEC|REAC|INIT|HVAC|RAMP)\s*(?:ID|_ID)?\s*['"]([^'"]+)['"]/;

    // Hints for selected error codes (extend over time as we learn more)
    const CODE_HINTS = {
        101: "MATL or SURF reference not found — check the ID spelling and that the &MATL/&SURF block is present before any &OBST/&SURF that uses it.",
        102: "BURN_AWAY only works on layered &OBST. Either remove BURN_AWAY or add SURF_IDS / SURF_ID6 with consistent thicknesses.",
        103: "The named REAC/SPEC reaction is missing or misnamed. Verify &REAC ID and FUEL.",
        201: "Mesh extents or IJK invalid. Check &MESH XB and IJK have non-zero positive values and the mesh fits inside the domain.",
        206: "SURF_ID for an OBST/VENT was not found. Add the named &SURF block, or remove the reference.",
    };

    function parseFdsOut(outText, fdsText) {
        const text = String(outText || '');
        const lines = text.split(/\r?\n/);
        const findings = [];
        const summary = {
            chid: null,
            jobTitle: null,
            version: null,
            mpiProcs: null,
            status: 'unknown',          // 'success' | 'failure' | 'incomplete' | 'unknown'
            statusMessage: null,
            totalTimeSec: null,
            timeStepSec: null,
            completedOk: false,
            errorCount: 0,
            warningCount: 0,
        };

        // First pass — extract summary fields
        for (const ln of lines) {
            let m;
            if (!summary.version  && (m = RE_REVISION.exec(ln))) summary.version = m[1];
            if (!summary.chid     && (m = RE_CHID.exec(ln)))     summary.chid     = m[1];
            if (!summary.jobTitle && (m = RE_TITLE.exec(ln)))    summary.jobTitle = m[1].trim();
            if (!summary.mpiProcs && (m = RE_MPI.exec(ln)))      summary.mpiProcs = parseInt(m[1], 10);
            if ((m = RE_RUNTIME.exec(ln)))                       summary.totalTimeSec = parseFloat(m[1]);
            if ((m = RE_TIMESTEP.exec(ln)))                      summary.timeStepSec = parseFloat(m[1]);
        }

        // Second pass — collect diagnostics. FDS sometimes wraps long messages over
        // multiple lines so we glue continuation lines (those that don't start with
        // a token like ERROR/WARNING/STOP and are indented) onto the previous one.
        let pending = null;          // { severity, code, message, startLine }
        const flushPending = () => {
            if (!pending) return;
            const text = pending.message.trim();
            // Sometimes FDS emits a pseudo-warning that's actually just an iteration
            // metric (e.g. "Maximum Velocity Error"). The regex anchor at start of
            // line already filters most of it, but double-check.
            if (/Maximum (Velocity|Pressure) Error/.test(text)) { pending = null; return; }
            findings.push(buildFinding(pending, fdsText));
            if (pending.severity === 'ERROR' || pending.severity === 'FATAL') summary.errorCount++;
            if (pending.severity === 'WARNING')                                summary.warningCount++;
            pending = null;
        };

        for (let i = 0; i < lines.length; i++) {
            const raw = lines[i];
            let m;
            if ((m = RE_ERROR.exec(raw))) {
                flushPending();
                pending = { severity: 'ERROR', code: m[1] ? parseInt(m[1], 10) : null, message: m[2] || '', startLine: i + 1 };
                continue;
            }
            if ((m = RE_FATAL.exec(raw))) {
                flushPending();
                pending = { severity: 'ERROR', code: m[1] ? parseInt(m[1], 10) : null, message: 'FATAL: ' + (m[2] || ''), startLine: i + 1 };
                continue;
            }
            if ((m = RE_WARNING.exec(raw))) {
                flushPending();
                pending = { severity: 'WARNING', code: m[1] ? parseInt(m[1], 10) : null, message: m[2] || '', startLine: i + 1 };
                continue;
            }
            if ((m = RE_STOP.exec(raw))) {
                flushPending();
                const msg = (m[1] || '').trim();
                summary.statusMessage = msg;
                if (/completed successfully/i.test(msg)) {
                    summary.status = 'success';
                    summary.completedOk = true;
                } else {
                    summary.status = 'failure';
                    findings.push({
                        severity: 'ERROR',
                        message: 'FDS stopped: ' + msg,
                        hint: null,
                        line: 0, lineEnd: 0,
                        rule: 'FDS STOP',
                        code: null,
                        entity: null,
                    });
                    summary.errorCount++;
                }
                pending = null;
                continue;
            }
            // Continuation line?  Glue onto a pending message if the line is non-empty
            // and indented (typical FDS multi-line error wrap).
            if (pending && /^\s+\S/.test(raw)) {
                pending.message += ' ' + raw.trim();
                continue;
            }
            // A blank line or an unrelated content line ends a pending message
            if (pending && (raw.trim() === '' || /^\s*\w/.test(raw))) flushPending();
        }
        flushPending();

        // If we never saw a STOP, the run is incomplete (still running or killed).
        if (summary.status === 'unknown') summary.status = summary.errorCount ? 'failure' : 'incomplete';

        return { findings, summary };
    }

    function buildFinding(p, fdsText) {
        const entity = extractEntity(p.message);
        const fdsLines = (typeof fdsText === 'string' && fdsText) ? fdsText.split(/\r?\n/) : null;
        const mapped = entity && fdsLines ? mapEntityToFdsLine(entity, fdsLines) : null;
        const codeHint = p.code && CODE_HINTS[p.code] ? CODE_HINTS[p.code] : null;
        const rule = p.code ? ('FDS ' + p.severity + '(' + p.code + ')') : ('FDS ' + p.severity);
        return {
            severity: p.severity,
            message: p.message.trim(),
            hint: codeHint,
            line: mapped ? mapped.line : 0,
            lineEnd: mapped ? mapped.lineEnd : 0,
            rule,
            code: p.code || null,
            entity,
        };
    }

    function extractEntity(message) {
        let m = RE_ENT_NAME.exec(message);
        if (m) return { kind: m[1].toUpperCase(), name: m[2] };
        m = RE_ENT_INDEX.exec(message);
        if (m) return { kind: m[1].toUpperCase(), index: parseInt(m[2], 10) };
        return null;
    }

    // Locate the entity in the .fds source. Best-effort: matches by ID name or
    // by ordinal index within the namelist's appearance order.
    function mapEntityToFdsLine(entity, fdsLines) {
        if (!entity || !fdsLines || !fdsLines.length) return null;
        const tag = '&' + entity.kind + '\\b';
        const re  = new RegExp(tag, 'i');
        const matches = [];
        let inside = null;             // { startLine } when scanning a multi-line namelist
        for (let i = 0; i < fdsLines.length; i++) {
            const line = fdsLines[i];
            if (!inside) {
                if (re.test(line)) inside = { startLine: i + 1, buffer: line };
            } else {
                inside.buffer += '\n' + line;
            }
            if (inside && line.indexOf('/') !== -1) {
                matches.push({ startLine: inside.startLine, endLine: i + 1, body: inside.buffer });
                inside = null;
            }
        }
        if (!matches.length) return null;

        // Match by name (ID='...')
        if (entity.name) {
            const idRe = new RegExp("\\bID\\s*=\\s*['\"]" + escapeRegExp(entity.name) + "['\"]", 'i');
            const hit = matches.find(m => idRe.test(m.body));
            if (hit) return { line: hit.startLine, lineEnd: hit.endLine };
            // Some kinds use a special ID parameter (SURF_ID, MATL_ID inside parents)
            const altRe = new RegExp("\\b(?:SURF_ID|MATL_ID|RAMP_ID|SPEC_ID|REAC_ID)\\s*=\\s*['\"]" + escapeRegExp(entity.name) + "['\"]", 'i');
            const alt = matches.find(m => altRe.test(m.body));
            if (alt) return { line: alt.startLine, lineEnd: alt.endLine };
            return null;
        }
        // Match by ordinal index (1-based)
        if (entity.index && entity.index <= matches.length) {
            const hit = matches[entity.index - 1];
            return { line: hit.startLine, lineEnd: hit.endLine };
        }
        return null;
    }

    function escapeRegExp(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

    global.parseFdsOut = parseFdsOut;
})(window);
