/**
 * FDS Input File Parser
 * Parses .fds files and extracts geometry records:
 * &MESH, &OBST, &VENT, &HOLE, &SURF, &MULT, &HEAD, &DEVC
 */

class FDSParser {
    constructor() {
        this.reset();
    }

    reset() {
        this.head = {};
        this.meshes = [];
        this.obsts = [];
        this.vents = [];
        this.holes = [];
        this.surfs = {};
        this.mults = {};
        this.devcs = [];
        this.inits = [];
        this.parts = {};
        this.props = {};
        this.reacs = [];
        this.matls = {};
        this.specs = {};
        this.slcfs = [];
        this.bndfs = [];
        this.geoms = [];
        this.hvacs = [];
        this.zones = [];
        this.ramps = {};
        this.time = {};
        this.misc = {};
    }

    /**
     * Parse an FDS input file string
     */
    parse(text) {
        this.reset();

        // Normalize line endings and join continuation lines
        text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

        // Extract all namelist groups: &NAME ... /
        // FDS uses Fortran namelist format. A record starts with & and ends with /
        // Records can span multiple lines
        const records = this._extractRecords(text);

        for (const record of records) {
            this._processRecord(record);
        }

        // Apply MULT expansions
        this._applyMultipliers();

        return {
            head: this.head,
            meshes: this.meshes,
            obsts: this.obsts,
            vents: this.vents,
            holes: this.holes,
            surfs: this.surfs,
            mults: this.mults,
            devcs: this.devcs,
            inits: this.inits,
            parts: this.parts,
            props: this.props,
            reacs: this.reacs,
            matls: this.matls,
            specs: this.specs,
            geoms: this.geoms,
            hvacs: this.hvacs,
            zones: this.zones,
            slcfs: this.slcfs,
            bndfs: this.bndfs,
            ramps: this.ramps,
            misc: this.misc,
            time: this.time,
        };
    }

    /**
     * Extract all &NAME ... / records from the text
     */
    _extractRecords(text) {
        const records = [];
        // Remove comment lines (lines starting with ! or lines where ! appears)
        const lines = text.split('\n');
        let cleanedText = '';
        for (const line of lines) {
            // Remove inline comments (everything after ! that's not inside quotes)
            const cleaned = this._removeComments(line);
            cleanedText += cleaned + '\n';
        }

        // Parse records manually to handle '/' inside quoted strings (e.g. UNITS='mg/m3')
        let i = 0;
        while (i < cleanedText.length) {
            // Find next '&'
            const ampIdx = cleanedText.indexOf('&', i);
            if (ampIdx === -1) break;

            // Extract group name
            let nameEnd = ampIdx + 1;
            while (nameEnd < cleanedText.length && /\w/.test(cleanedText[nameEnd])) nameEnd++;
            const groupName = cleanedText.substring(ampIdx + 1, nameEnd).toUpperCase();
            if (!groupName) { i = nameEnd; continue; }

            // Find the terminating '/' that is NOT inside quotes
            let inSQ = false, inDQ = false;
            let j = nameEnd;
            let found = false;
            while (j < cleanedText.length) {
                const ch = cleanedText[j];
                if (ch === "'" && !inDQ) { inSQ = !inSQ; }
                else if (ch === '"' && !inSQ) { inDQ = !inDQ; }
                else if (ch === '/' && !inSQ && !inDQ) { found = true; break; }
                j++;
            }

            if (found) {
                const body = cleanedText.substring(nameEnd, j).trim();
                if (groupName !== 'TAIL') {
                    records.push({ group: groupName, body: body });
                }
                i = j + 1;
            } else {
                i = nameEnd;
            }
        }

        return records;
    }

    /**
     * Remove comments from a line (text after ! outside of quotes)
     */
    _removeComments(line) {
        let inSingleQuote = false;
        let inDoubleQuote = false;
        let result = '';

        for (let i = 0; i < line.length; i++) {
            const ch = line[i];

            if (ch === "'" && !inDoubleQuote) {
                inSingleQuote = !inSingleQuote;
            } else if (ch === '"' && !inSingleQuote) {
                inDoubleQuote = !inDoubleQuote;
            } else if (ch === '!' && !inSingleQuote && !inDoubleQuote) {
                break;
            }
            result += ch;
        }

        return result;
    }

    /**
     * Parse the body of a namelist record into key-value pairs
     */
    _parseBody(body) {
        const params = {};
        // Quote-aware whitespace collapse + remove spaces around '='.
        // Plain replace(/\s+/g,' ') would corrupt quoted string contents.
        const s = this._normalizeBody(body);

        // Split by commas/spaces outside quotes
        const tokens = this._tokenize(s);

        let currentKey = null;
        let currentValues = [];
        const commit = () => {
            if (!currentKey) return;
            const value = currentValues.length === 1 ? currentValues[0] : currentValues;
            // Handle array-indexed keys like XB(1), IJK(2), RGB(3)
            const m = currentKey.match(/^([A-Z_][A-Z0-9_]*)\(\s*(\d+)\s*\)$/);
            if (m) {
                const base = m[1];
                const idx = parseInt(m[2], 10) - 1; // FDS is 1-indexed
                if (!Array.isArray(params[base])) {
                    const existing = params[base];
                    params[base] = [];
                    if (existing !== undefined) params[base][0] = existing;
                }
                params[base][idx] = value;
            } else {
                params[currentKey] = value;
            }
        };

        for (const token of tokens) {
            if (token.includes('=')) {
                commit();
                const eqIdx = token.indexOf('=');
                currentKey = token.substring(0, eqIdx).trim().toUpperCase();
                const valStr = token.substring(eqIdx + 1).trim();
                currentValues = valStr.length > 0 ? this._parseValues(valStr) : [];
            } else if (currentKey) {
                currentValues.push(...this._parseValues(token));
            }
        }
        commit();

        return params;
    }

    /**
     * Quote-aware normalisation: collapse whitespace runs (outside quotes) to
     * a single space, and drop spaces flanking '='. Quoted strings are
     * preserved byte-for-byte so values containing spaces or '=' survive.
     */
    _normalizeBody(body) {
        let out = '';
        let inSQ = false, inDQ = false;
        let prevSpace = false;
        for (let i = 0; i < body.length; i++) {
            const ch = body[i];
            if (ch === "'" && !inDQ) {
                inSQ = !inSQ;
                out += ch;
                prevSpace = false;
            } else if (ch === '"' && !inSQ) {
                inDQ = !inDQ;
                out += ch;
                prevSpace = false;
            } else if (inSQ || inDQ) {
                out += ch;
                prevSpace = false;
            } else if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
                if (!prevSpace) out += ' ';
                prevSpace = true;
            } else {
                out += ch;
                prevSpace = false;
            }
        }
        // Strip spaces around '=' outside quotes
        let s = '';
        inSQ = false; inDQ = false;
        for (let i = 0; i < out.length; i++) {
            const ch = out[i];
            if (ch === "'" && !inDQ) { inSQ = !inSQ; s += ch; }
            else if (ch === '"' && !inSQ) { inDQ = !inDQ; s += ch; }
            else if (!inSQ && !inDQ && ch === ' ') {
                const next = out[i + 1];
                const prev = s[s.length - 1];
                if (next === '=' || prev === '=') continue;
                s += ch;
            } else {
                s += ch;
            }
        }
        return s.trim();
    }

    /**
     * Tokenize a namelist body string, respecting quotes
     */
    _tokenize(s) {
        const tokens = [];
        let current = '';
        let inSingleQuote = false;
        let inDoubleQuote = false;

        for (let i = 0; i < s.length; i++) {
            const ch = s[i];

            if (ch === "'" && !inDoubleQuote) {
                inSingleQuote = !inSingleQuote;
                current += ch;
            } else if (ch === '"' && !inSingleQuote) {
                inDoubleQuote = !inDoubleQuote;
                current += ch;
            } else if ((ch === ',' || ch === ' ') && !inSingleQuote && !inDoubleQuote) {
                if (current.trim().length > 0) {
                    tokens.push(current.trim());
                }
                current = '';
            } else {
                current += ch;
            }
        }

        if (current.trim().length > 0) {
            tokens.push(current.trim());
        }

        return tokens;
    }

    /**
     * Parse value string(s) into typed values. Quote-aware comma split so a
     * value like 'a,b' stays intact instead of being shredded.
     */
    _parseValues(valStr) {
        const parts = [];
        let cur = '';
        let inSQ = false, inDQ = false;
        for (let i = 0; i < valStr.length; i++) {
            const ch = valStr[i];
            if (ch === "'" && !inDQ) { inSQ = !inSQ; cur += ch; }
            else if (ch === '"' && !inSQ) { inDQ = !inDQ; cur += ch; }
            else if (ch === ',' && !inSQ && !inDQ) {
                if (cur.trim().length > 0) parts.push(cur.trim());
                cur = '';
            } else {
                cur += ch;
            }
        }
        if (cur.trim().length > 0) parts.push(cur.trim());
        return parts.map(p => this._parseValue(p));
    }

    /**
     * Parse a single value. Fortran namelist booleans accept .TRUE./.FALSE.,
     * .T./.F., TRUE/FALSE, and bare T/F — all case-insensitive.
     */
    _parseValue(val) {
        val = val.trim();

        // Quoted string (check first so 'T' stays a string)
        if ((val.startsWith("'") && val.endsWith("'")) ||
            (val.startsWith('"') && val.endsWith('"'))) {
            return val.substring(1, val.length - 1);
        }

        const upper = val.toUpperCase();
        if (upper === '.TRUE.' || upper === '.T.' || upper === 'TRUE' || upper === 'T') return true;
        if (upper === '.FALSE.' || upper === '.F.' || upper === 'FALSE' || upper === 'F') return false;

        // Number — guard against Number('') = 0 and reject hex/octal coercion
        if (val.length > 0 && /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(val)) {
            const num = Number(val);
            if (!isNaN(num)) return num;
        }

        return val;
    }

    /**
     * Process a single parsed record
     */
    _processRecord(record) {
        const params = this._parseBody(record.body);
        // Preserve the original namelist text so the UI can display it on demand.
        params._raw = `&${record.group} ${record.body.trim()} /`;

        switch (record.group) {
            case 'HEAD':
                if (this.head && Object.keys(this.head).length > 0) {
                    console.warn('FDS parser: multiple &HEAD records encountered; keeping the first.');
                } else {
                    this.head = params;
                }
                break;

            case 'TIME':
                if (this.time && Object.keys(this.time).length > 0) {
                    console.warn('FDS parser: multiple &TIME records encountered; keeping the first.');
                } else {
                    this.time = params;
                }
                break;

            case 'MESH':
                this._processMesh(params);
                break;

            case 'OBST':
                this._processObst(params);
                break;

            case 'VENT':
                this._processVent(params);
                break;

            case 'HOLE':
                this._processHole(params);
                break;

            case 'SURF':
                this._processSurf(params);
                break;

            case 'MULT':
                this._processMult(params);
                break;

            case 'DEVC':
                this._processDevc(params);
                break;

            case 'INIT':
                this._processInit(params);
                break;

            case 'PART':
                this._processPart(params);
                break;

            case 'PROP':
                this._processProp(params);
                break;

            case 'MISC':
                if (this.misc && Object.keys(this.misc).length > 0) {
                    console.warn('FDS parser: multiple &MISC records encountered; keeping the first.');
                } else {
                    this.misc = params;
                }
                break;

            case 'GEOM':
                this._processGeom(params);
                break;

            case 'HVAC':
                this._processHvac(params);
                break;

            case 'ZONE':
                this._processZone(params);
                break;

            case 'SLCF':
                this._processSlcf(params);
                break;

            case 'REAC':
                this._processReac(params);
                break;

            case 'MATL':
                this._processMatl(params);
                break;

            case 'SPEC':
                this._processSpec(params);
                break;

            case 'BNDF':
                this._processBndf(params);
                break;

            case 'RAMP':
                this._processRamp(params);
                break;
        }
    }

    _processMesh(params) {
        const ijk = this._getIJK(params);
        const mesh = {
            id: params.ID || `Mesh_${this.meshes.length + 1}`,
            xb: this._getXB(params),
            ijk,
            // Track whether IJK was explicitly set so renderers can skip the
            // grid for synthesised defaults instead of drawing a misleading
            // 10×10×10 lattice that doesn't match any real cell count.
            ijk_explicit: !!params.IJK,
            color: params.COLOR || null,
            mult_id: params.MULT_ID || null,
            _params: params,
        };
        if (mesh.xb) this.meshes.push(mesh);
    }

    _processObst(params) {
        const obst = {
            id: params.ID || null,
            xb: this._getXB(params),
            surf_id: params.SURF_ID || null,
            surf_id6: params.SURF_ID6 || null,
            surf_ids: params.SURF_IDS || null,
            color: params.COLOR || null,
            rgb: params.RGB || null,
            transparency: params.TRANSPARENCY != null ? params.TRANSPARENCY : null,
            mult_id: params.MULT_ID || null,
            permit_hole: params.PERMIT_HOLE != null ? params.PERMIT_HOLE : true,
            _params: params,
        };
        if (obst.xb) this.obsts.push(obst);
    }

    _processVent(params) {
        const vent = {
            id: params.ID || null,
            xb: this._getXB(params),
            surf_id: params.SURF_ID || null,
            color: params.COLOR || null,
            rgb: params.RGB || null,
            mb: params.MB || null,
            transparency: params.TRANSPARENCY != null ? params.TRANSPARENCY : null,
            mult_id: params.MULT_ID || null,
            _params: params,
        };
        if (vent.xb || vent.mb) this.vents.push(vent);
    }

    _processHole(params) {
        const hole = {
            id: params.ID || null,
            xb: this._getXB(params),
            mult_id: params.MULT_ID || null,
            _params: params,
        };
        if (hole.xb) this.holes.push(hole);
    }

    _processSurf(params) {
        const surf = {
            id: params.ID || 'INERT',
            color: params.COLOR || null,
            rgb: params.RGB || null,
            transparency: params.TRANSPARENCY != null ? params.TRANSPARENCY : null,
            matl_id: params.MATL_ID || null,
            hrrpua: params.HRRPUA || null,
            _params: params,
        };
        this.surfs[surf.id] = surf;
    }

    _processMult(params) {
        const mult = {
            id: params.ID,
            dx: params.DX || 0,
            dy: params.DY || 0,
            dz: params.DZ || 0,
            dxb: this._ensureArray(params.DXB, 6),
            i_lower: params.I_LOWER || 0,
            i_upper: params.I_UPPER || 0,
            j_lower: params.J_LOWER || 0,
            j_upper: params.J_UPPER || 0,
            k_lower: params.K_LOWER || 0,
            k_upper: params.K_UPPER || 0,
            n_lower: params.N_LOWER != null ? params.N_LOWER : null,
            n_upper: params.N_UPPER != null ? params.N_UPPER : null,
        };
        if (mult.id) this.mults[mult.id] = mult;
    }

    _processDevc(params) {
        const devc = {
            id: params.ID || `DEVC_${this.devcs.length + 1}`,
            xyz: this._ensureArray(params.XYZ, 3),
            xb: this._getXB(params),
            quantity: params.QUANTITY || null,
            prop_id: params.PROP_ID || null,
            _params: params,
        };
        this.devcs.push(devc);
    }

    _processInit(params) {
        const init = {
            id: params.ID || `INIT_${this.inits.length + 1}`,
            xb: this._getXB(params),
            xyz: this._ensureArray(params.XYZ, 3),
            part_id: params.PART_ID || null,
            n_particles: params.N_PARTICLES || params.N_PARTICLES_PER_CELL || null,
            _params: params,
        };
        this.inits.push(init);
    }

    _processPart(params) {
        const part = {
            id: params.ID,
            surf_id: params.SURF_ID || null,
            isStatic: params.STATIC === true || params.STATIC === '.TRUE.',
            color: params.COLOR || null,
            rgb: params.RGB || null,
            _params: params,
        };
        if (part.id) this.parts[part.id] = part;
    }

    _processProp(params) {
        const prop = {
            id: params.ID,
            quantity: params.QUANTITY || null,
            part_id: params.PART_ID || null,
            offset: params.OFFSET || null,
            _params: params,
        };
        if (prop.id) this.props[prop.id] = prop;
    }

    _processGeom(params) {
        const geom = {
            id: params.ID || `GEOM_${this.geoms.length + 1}`,
            xb: this._getXB(params),
            surf_id: params.SURF_ID || null,
            color: params.COLOR || null,
            rgb: params.RGB || null,
            // Sphere parameters
            sphere_origin: this._ensureArray(params.SPHERE_ORIGIN, 3),
            sphere_radius: params.SPHERE_RADIUS || null,
            // Cylinder parameters (FDS UG Sec. 7.3.6)
            cylinder_origin: this._ensureArray(params.CYLINDER_ORIGIN, 3),
            cylinder_axis: this._ensureArray(params.CYLINDER_AXIS, 3),
            cylinder_radius: params.CYLINDER_RADIUS != null ? Number(params.CYLINDER_RADIUS) : null,
            cylinder_length: params.CYLINDER_LENGTH != null ? Number(params.CYLINDER_LENGTH) : null,
            cylinder_nseg_theta: params.CYLINDER_NSEG_THETA != null ? Math.max(3, parseInt(params.CYLINDER_NSEG_THETA, 10)) : 24,
            cylinder_nseg_axis: params.CYLINDER_NSEG_AXIS != null ? Math.max(1, parseInt(params.CYLINDER_NSEG_AXIS, 10)) : 1,
            // Terrain
            zvals: params.ZVALS || null,
            zmin: params.ZMIN != null ? Number(params.ZMIN) : null,
            // Triangle mesh data
            verts: params.VERTS || null,
            faces: params.FACES || null,
            // Extruded polygon
            poly: params.POLY || null,
            extrude: params.EXTRUDE || null,
            ijk: this._getIJKOptional(params),
            _params: params,
        };
        this.geoms.push(geom);
    }

    _processHvac(params) {
        const hvac = {
            id: params.ID || null,
            type_id: params.TYPE_ID || null,
            xyz: this._ensureArray(params.XYZ, 3),
            duct_id: params.DUCT_ID || null,
            node_id: params.NODE_ID || null,
            vent_id: params.VENT_ID || null,
            area: params.AREA || null,
            diameter: params.DIAMETER || null,
            length: params.LENGTH || null,
            volume_flow: params.VOLUME_FLOW || null,
            ambient: params.AMBIENT || false,
            waypoints: params.WAYPOINTS || null,
            network_id: params.NETWORK_ID || null,
            _params: params,
        };
        this.hvacs.push(hvac);
    }

    _processZone(params) {
        const zone = {
            id: params.ID || `ZONE_${this.zones.length + 1}`,
            xb: this._getXB(params),
            _params: params,
        };
        if (zone.xb) this.zones.push(zone);
    }

    _processSlcf(params) {
        const slcf = {
            id: params.ID || null,
            xb: this._getXB(params),
            pbx: params.PBX != null ? params.PBX : null,
            pby: params.PBY != null ? params.PBY : null,
            pbz: params.PBZ != null ? params.PBZ : null,
            quantity: params.QUANTITY || null,
            spec_id: params.SPEC_ID || null,
            vector: params.VECTOR || false,
            _params: params,
        };
        this.slcfs.push(slcf);
    }

    _processReac(params) {
        const reac = {
            id: params.ID || null,
            fuel: params.FUEL || params.ID || null,
            soot_yield: params.SOOT_YIELD || null,
            co_yield: params.CO_YIELD || null,
            heat_of_combustion: params.HEAT_OF_COMBUSTION || null,
            _params: params,
        };
        this.reacs.push(reac);
    }

    _processMatl(params) {
        const matl = {
            id: params.ID,
            density: params.DENSITY || null,
            conductivity: params.CONDUCTIVITY || null,
            specific_heat: params.SPECIFIC_HEAT || null,
            reference_temperature: params.REFERENCE_TEMPERATURE || null,
            heat_of_reaction: params.HEAT_OF_REACTION || null,
            _params: params,
        };
        if (matl.id) this.matls[matl.id] = matl;
    }

    _processSpec(params) {
        const spec = {
            id: params.ID,
            formula: params.FORMULA || null,
            mw: params.MW || null,
            lumped_component_only: params.LUMPED_COMPONENT_ONLY || false,
            primitive: params.PRIMITIVE || false,
            _params: params,
        };
        if (spec.id) this.specs[spec.id] = spec;
    }

    _processBndf(params) {
        const bndf = {
            quantity: params.QUANTITY || null,
            spec_id: params.SPEC_ID || null,
            cell_centered: params.CELL_CENTERED || false,
            _params: params,
        };
        this.bndfs.push(bndf);
    }

    /**
     * RAMP records share an ID and each contributes one (T, F) point.
     * Accumulate them so a single ramp curve can be reconstructed.
     * Also handle the rarer case where T and F are given as parallel arrays
     * inside a single &RAMP record.
     */
    _processRamp(params) {
        const id = params.ID;
        if (!id) return;
        if (!this.ramps[id]) {
            this.ramps[id] = { id: id, points: [], _raws: [] };
        }
        const Ts = Array.isArray(params.T) ? params.T : (params.T != null ? [params.T] : []);
        const Fs = Array.isArray(params.F) ? params.F : (params.F != null ? [params.F] : []);
        const nPts = Math.min(Ts.length, Fs.length);
        for (let i = 0; i < nPts; i++) {
            const T = parseFloat(Ts[i]);
            const F = parseFloat(Fs[i]);
            if (!isNaN(T) && !isNaN(F)) {
                this.ramps[id].points.push({ T: T, F: F });
            }
        }
        if (params._raw) this.ramps[id]._raws.push(params._raw);
    }

    _getIJKOptional(params) {
        if (!params.IJK) return null;
        const ijk = Array.isArray(params.IJK) ? params.IJK : [params.IJK];
        if (ijk.length >= 3) return ijk.slice(0, 3).map(Number);
        if (ijk.length >= 2) return ijk.slice(0, 2).map(Number); // terrain IJK has only 2 values (NI, NJ)
        return null;
    }

    /**
     * Get XB array [x1,x2,y1,y2,z1,z2] from params
     */
    _getXB(params) {
        if (!params.XB) return null;
        const xb = Array.isArray(params.XB) ? params.XB : [params.XB];
        if (xb.length >= 6) {
            return xb.slice(0, 6).map(Number);
        }
        // Terrain GEOM may have only 4 values (x1,x2,y1,y2)
        if (xb.length >= 4) {
            return xb.slice(0, 4).map(Number);
        }
        return null;
    }

    /**
     * Get IJK array [I,J,K] from params
     */
    _getIJK(params) {
        if (!params.IJK) return [10, 10, 10];
        const ijk = Array.isArray(params.IJK) ? params.IJK : [params.IJK];
        if (ijk.length >= 3) {
            return ijk.slice(0, 3).map(Number);
        }
        return [10, 10, 10];
    }

    _ensureArray(val, len) {
        if (!val) return null;
        const arr = Array.isArray(val) ? val : [val];
        return arr.slice(0, len).map(Number);
    }

    /**
     * Apply MULT expansion to MESH, OBST, VENT, HOLE
     */
    _applyMultipliers() {
        this.meshes = this._expandWithMult(this.meshes);
        this.obsts = this._expandWithMult(this.obsts);
        this.vents = this._expandWithMult(this.vents);
        this.holes = this._expandWithMult(this.holes);
    }

    _expandWithMult(items) {
        const expanded = [];

        for (const item of items) {
            if (!item.mult_id || !this.mults[item.mult_id]) {
                expanded.push(item);
                continue;
            }

            const mult = this.mults[item.mult_id];
            const xb = item.xb;
            if (!xb) {
                expanded.push(item);
                continue;
            }

            // Check if using N_LOWER/N_UPPER (1D multiplier with DXB)
            if (mult.n_lower !== null && mult.n_upper !== null && mult.dxb) {
                for (let n = mult.n_lower; n <= mult.n_upper; n++) {
                    const newXB = [
                        xb[0] + mult.dxb[0] * n,
                        xb[1] + mult.dxb[1] * n,
                        xb[2] + mult.dxb[2] * n,
                        xb[3] + mult.dxb[3] * n,
                        xb[4] + mult.dxb[4] * n,
                        xb[5] + mult.dxb[5] * n,
                    ];
                    expanded.push({ ...item, xb: newXB, mult_id: null });
                }
            } else {
                // 3D multiplier with DX, DY, DZ
                for (let i = mult.i_lower; i <= mult.i_upper; i++) {
                    for (let j = mult.j_lower; j <= mult.j_upper; j++) {
                        for (let k = mult.k_lower; k <= mult.k_upper; k++) {
                            const dx = mult.dx * i;
                            const dy = mult.dy * j;
                            const dz = mult.dz * k;
                            const newXB = [
                                xb[0] + dx, xb[1] + dx,
                                xb[2] + dy, xb[3] + dy,
                                xb[4] + dz, xb[5] + dz,
                            ];
                            expanded.push({ ...item, xb: newXB, mult_id: null });
                        }
                    }
                }
            }
        }

        return expanded;
    }
}

// Named color map (subset of FDS/SMV named colors)
const FDS_COLORS = {
    'RED':           [255, 0, 0],
    'GREEN':         [0, 128, 0],
    'BLUE':          [0, 0, 255],
    'YELLOW':        [255, 255, 0],
    'CYAN':          [0, 255, 255],
    'MAGENTA':       [255, 0, 255],
    'WHITE':         [255, 255, 255],
    'BLACK':         [0, 0, 0],
    'GRAY':          [128, 128, 128],
    'GREY':          [128, 128, 128],
    'ORANGE':        [255, 165, 0],
    'BROWN':         [139, 69, 19],
    'PINK':          [255, 192, 203],
    'PURPLE':        [128, 0, 128],
    'VIOLET':        [148, 0, 211],
    'LIME':          [0, 255, 0],
    'OLIVE':         [128, 128, 0],
    'NAVY':          [0, 0, 128],
    'TEAL':          [0, 128, 128],
    'MAROON':        [128, 0, 0],
    'SILVER':        [192, 192, 192],
    'AQUAMARINE':    [127, 255, 212],
    'BEIGE':         [245, 245, 220],
    'CORAL':         [255, 127, 80],
    'CRIMSON':       [220, 20, 60],
    'DARK GREEN':    [0, 100, 0],
    'DARK RED':      [139, 0, 0],
    'DARK BLUE':     [0, 0, 139],
    'DARK CYAN':     [0, 139, 139],
    'DARK MAGENTA':  [139, 0, 139],
    'DARK ORANGE':   [255, 140, 0],
    'FOREST GREEN':  [34, 139, 34],
    'GOLD':          [255, 215, 0],
    'IVORY':         [255, 255, 240],
    'KHAKI':         [240, 230, 140],
    'LIGHT BLUE':    [173, 216, 230],
    'LIGHT GREEN':   [144, 238, 144],
    'SANDY BROWN':   [244, 164, 96],
    'SKY BLUE':      [135, 206, 235],
    'TAN':           [210, 180, 140],
    'TOMATO':        [255, 99, 71],
    'WHEAT':         [245, 222, 179],
    'INVISIBLE':     [255, 255, 255],
};

/**
 * Resolve a color from FDS record parameters
 * Returns [r, g, b] in 0-255 range
 */
/**
 * Resolve a named color, including FDS percentage grays like 'GRAY 60'
 */
function resolveFDSNamedColor(name) {
    if (!name) return null;
    const upper = name.toUpperCase();
    const c = FDS_COLORS[upper];
    if (c) return c;
    // Handle 'GRAY XX' or 'GREY XX' percentage colors (0=black, 100=white)
    const grayMatch = upper.match(/^GR[AE]Y\s+(\d+)$/);
    if (grayMatch) {
        const pct = Math.min(100, Math.max(0, parseInt(grayMatch[1], 10)));
        const v = Math.round(pct * 255 / 100);
        return [v, v, v];
    }
    return null;
}

function resolveFDSColor(item, surfs, defaultColor) {
    // Direct RGB
    if (item.rgb) {
        const rgb = Array.isArray(item.rgb) ? item.rgb : [item.rgb];
        if (rgb.length >= 3) return rgb.slice(0, 3).map(Number);
    }

    // Named COLOR
    if (item.color) {
        const c = resolveFDSNamedColor(item.color);
        if (c) return c;
    }

    // Resolve surface name from SURF_ID or SURF_IDS
    const surfName = item.surf_id
        ? (Array.isArray(item.surf_id) ? item.surf_id[0] : item.surf_id)
        : (item.surf_ids
            ? (Array.isArray(item.surf_ids) ? item.surf_ids[0] : item.surf_ids)
            : null);

    if (surfName && surfs) {
        const surf = surfs[surfName];
        if (surf) {
            if (surf.rgb) {
                const rgb = Array.isArray(surf.rgb) ? surf.rgb : [surf.rgb];
                if (rgb.length >= 3) return rgb.slice(0, 3).map(Number);
            }
            if (surf.color) {
                const c = resolveFDSNamedColor(surf.color);
                if (c) return c;
            }
        }
    }

    return defaultColor || [200, 200, 200];
}
