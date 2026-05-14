/**
 * FDS Viewer — Fire & Combustion Panel
 * Renders the second page tab with fire, combustion, material and output data.
 */

// ─── Entry point ─────────────────────────────────────────────────────────────

function buildFirePanel(data) {
    const wrap = document.querySelector('#fire-panel .fp-scroll');
    if (!wrap) return;

    let html = '';
    html += buildOverview(data);

    // Reaction (wider) + Species (narrower) side by side when both exist;
    // otherwise each takes its natural full width.
    const hasReac     = data.reacs && data.reacs.length;
    const customSpecs = Object.values(data.specs || {});
    if (hasReac && customSpecs.length) {
        html += '<div class="fp-grid-uneven">';
        html += buildReacSection(data);
        html += buildSpeciesSection(data, customSpecs);
        html += '</div>';
    } else {
        if (hasReac) html += buildReacSection(data);
        if (customSpecs.length) html += buildSpeciesSection(data, customSpecs);
    }

    // Fire sources — full width (wide table)
    const fireSurfs = getFireSurfs(data);
    if (fireSurfs.length) html += buildFireSourcesSection(data, fireSurfs);

    const combustibleMatls = getCombustibleMatls(data);
    if (combustibleMatls.length) html += buildMaterialsSection(data, combustibleMatls);

    const combustibleSurfs = getCombustibleSurfs(data, combustibleMatls);
    if (combustibleSurfs.length) html += buildSurfacesSection(data, combustibleSurfs);

    html += buildOutputsSection(data);

    wrap.innerHTML = html;
}

// ─── Overview bar ─────────────────────────────────────────────────────────────

function buildOverview(data) {
    const chid  = data.head.CHID  || '—';
    const title = data.head.TITLE || '';
    const tEnd  = data.time.T_END != null ? data.time.T_END + ' s' : '—';
    const tmpa  = data.misc.TMPA  != null ? data.misc.TMPA  + ' °C' : '20 °C';
    const nMesh = data.meshes.length;
    const cells = data.meshes.reduce((s, m) => s + (m.ijk ? m.ijk[0]*m.ijk[1]*m.ijk[2] : 0), 0);
    // SURF_DEFAULT: if non-INERT, all unspecified surfaces change — flag it prominently
    const surfDef = data.misc.SURF_DEFAULT || null;

    return `
    <div class="fp-overview">
        <div class="fp-ov-item">
            <span class="fp-ov-lbl">CHID</span>
            <span class="fp-ov-val">${esc(chid)}</span>
        </div>
        ${title ? `<div class="fp-ov-item">
            <span class="fp-ov-lbl">Title</span>
            <span class="fp-ov-val" style="font-size:12px;color:var(--text-secondary);max-width:420px;white-space:normal">${esc(title)}</span>
        </div>` : ''}
        <div class="fp-ov-item">
            <span class="fp-ov-lbl">T_END</span>
            <span class="fp-ov-val">${tEnd}</span>
        </div>
        <div class="fp-ov-item">
            <span class="fp-ov-lbl">Ambient Temp</span>
            <span class="fp-ov-val">${tmpa}</span>
        </div>
        <div class="fp-ov-item">
            <span class="fp-ov-lbl">Meshes</span>
            <span class="fp-ov-val">${nMesh}</span>
        </div>
        ${cells > 0 ? `<div class="fp-ov-item">
            <span class="fp-ov-lbl">Total Cells</span>
            <span class="fp-ov-val">${(cells/1000).toFixed(0)} k</span>
        </div>` : ''}
        ${surfDef ? `<div class="fp-ov-item">
            <span class="fp-ov-lbl">SURF_DEFAULT</span>
            <span class="fp-ov-val" style="${surfDef !== 'INERT' ? 'color:var(--warning);font-weight:800' : ''}"
                  title="${surfDef !== 'INERT' ? 'Non-default SURF_DEFAULT: all unspecified surfaces use ' + surfDef : ''}">
                ${esc(surfDef)}${surfDef !== 'INERT' ? ' ⚠' : ''}
            </span>
        </div>` : ''}
    </div>`;
}

// ─── Combustion Reaction ──────────────────────────────────────────────────────

function buildReacSection(data) {
    if (!data.reacs || !data.reacs.length) return '';

    let html = '<div class="fp-card"><div class="fp-card-title">Combustion Reaction';
    if (data.reacs.length > 1)
        html += ` <span class="fp-badge fp-badge-fire">${data.reacs.length} reactions</span>`;
    html += '</div>';

    data.reacs.forEach(reac => {
        const p = reac._params;
        const fuelId  = reac.fuel || p.FUEL || '—';
        const spec    = data.specs && data.specs[fuelId];
        const formula = spec ? spec.formula : null;
        const fuelDisplay = esc(fuelId) + (formula ? ` <span style="color:var(--text-muted)">(${formatFormula(formula)})</span>` : '');

        const hoc      = p.HEAT_OF_COMBUSTION;
        const soot     = p.SOOT_YIELD;
        const co       = p.CO_YIELD;
        const co2      = p.CO2_YIELD;
        const radFrac  = p.RADIATIVE_FRACTION;
        const eatm     = p.EPUMO2;

        // Approximate combustion equation for simple fuels with FORMULA
        const eqn = formula ? buildCombustionEquation(formula) : null;

        if (eqn) {
            html += `<div style="background:rgba(233,69,96,.06);border:1px solid rgba(233,69,96,.2);border-radius:6px;padding:12px 16px;margin-bottom:14px;font-family:monospace;font-size:14px;color:var(--text-primary);text-align:center;letter-spacing:.5px">${eqn}</div>`;
        }

        html += `<table class="fp-prop-table">
            <tr><td>Fuel Species</td><td><strong style="color:var(--accent)">${fuelDisplay}</strong></td></tr>
            ${hoc   != null ? `<tr><td>Heat of Combustion</td><td>${hoc.toLocaleString()} kJ/kg &nbsp;<span style="color:var(--text-muted);font-size:11px">(${(hoc/1000).toFixed(0)} MJ/kg)</span></td></tr>` : ''}
            ${soot  != null ? `<tr><td>Soot Yield</td><td>${soot} kg/kg &nbsp;<span style="color:var(--text-muted);font-size:11px">(${(soot*100).toFixed(1)} %)</span></td></tr>` : ''}
            ${co    != null ? `<tr><td>CO Yield</td><td>${co} kg/kg &nbsp;<span style="color:var(--text-muted);font-size:11px">(${(co*100).toFixed(2)} %)</span></td></tr>` : ''}
            ${co2   != null ? `<tr><td>CO₂ Yield</td><td>${co2} kg/kg</td></tr>` : ''}
            ${radFrac != null ? `<tr><td>Radiative Fraction</td><td>${(radFrac*100).toFixed(0)} %</td></tr>` : ''}
            ${eatm  != null ? `<tr><td>Heat Release / O₂ (EPUMO2)</td><td>${eatm} kJ/kg</td></tr>` : ''}
        </table>`;
    });

    html += codeBlock('FDS &REAC code', data.reacs.map(rawOf));
    html += '</div>';
    return html;
}

// ─── Fire Sources ─────────────────────────────────────────────────────────────

function getFireSurfs(data) {
    return Object.values(data.surfs || {}).filter(s =>
        s._params.HRRPUA != null || s._params.MLRPUA != null
    );
}

function buildFireSourcesSection(data, fireSurfs) {
    let html = '<div class="fp-card"><div class="fp-card-title">Fire Sources';
    html += ` <span class="fp-badge fp-badge-fire">${fireSurfs.length}</span></div>`;

    html += `<table class="fp-source-table">
        <thead><tr>
            <th>SURF ID</th><th>HRRPUA</th><th>Growth</th><th>Peak HRR</th><th>Vents / Area</th>
        </tr></thead><tbody>`;

    fireSurfs.forEach(surf => {
        const p = surf._params;
        const hrrpua = p.HRRPUA;
        const mlrpua = p.MLRPUA;
        const tauQ   = p.TAU_Q;
        const tauT   = p.TAU_T;
        const rampQ  = p.RAMP_Q;
        const rampMf = p.RAMP_MF;
        const ramp   = (rampQ || rampMf) && data.ramps ? data.ramps[rampQ || rampMf] : null;

        const linkedVents = (data.vents || []).filter(v => {
            const sid = Array.isArray(v.surf_id) ? v.surf_id : [v.surf_id];
            return sid.includes(surf.id);
        });

        let totalArea = linkedVents.reduce((sum, v) => sum + ventFaceArea(v), 0);

        // Peak HRR: HRRPUA × area × max(F) when a ramp scales it
        let peakF = 1;
        if (ramp && ramp.points.length) {
            peakF = Math.max(...ramp.points.map(pt => pt.F));
        }
        const peakHRR = hrrpua && totalArea > 0 ? hrrpua * totalArea * peakF : null;

        let growthHtml = '—';
        if (ramp && ramp.points.length) {
            // Sort points by T
            const pts   = ramp.points.slice().sort((a,b) => a.T - b.T);
            const tEnd  = pts[pts.length - 1].T;
            const tPeak = pts.reduce((acc, pt) => pt.F >= acc.F ? pt : acc, pts[0]).T;
            const rampType = rampQ ? 'RAMP_Q' : 'RAMP_MF';
            growthHtml = fireSourceValue(
                `${rampType} = '${ramp.id}'`,
                `${pts.length} points; peak factor ${peakF.toFixed(2)} at ${tPeak}s; ends at ${tEnd}s`
            );
        } else if (tauQ != null) {
            // FDS: negative TAU_Q is t² ramp-up (same physics, different sign convention).
            // Show absolute value and the curve type rather than the raw parameter name.
            growthHtml = fireSourceValue(`t² τ = ${Math.abs(tauQ)} s`);
        } else if (tauT != null) {
            growthHtml = fireSourceValue(`Exponential τ = ${Math.abs(tauT)} s`);
        } else if (rampQ || rampMf) {
            // RAMP referenced but not parsed (e.g. defined as F=array on a single line)
            const rampType = rampQ ? 'RAMP_Q' : 'RAMP_MF';
            growthHtml = fireSourceValue(`${rampType} = '${rampQ || rampMf}'`);
        } else if (hrrpua != null) {
            growthHtml = fireSourceValue('Steady');
        }

        const hrrStr  = hrrpua != null ? fireSourceValue(`${hrrpua} kW/m²`) : (mlrpua != null ? fireSourceValue(`${mlrpua} kg/m²/s`) : '—');
        const peakStr = peakHRR != null ? (peakHRR >= 1000 ? `${(peakHRR/1000).toFixed(2)} MW` : `${peakHRR.toFixed(0)} kW`) : '—';
        const ventStr = fireSourceValue(
            `${linkedVents.length} vent${linkedVents.length!==1?'s':''}` +
            (totalArea > 0 ? ` / ${totalArea.toFixed(2)} m²` : '')
        );

        html += `<tr>
            <td><strong style="color:var(--vent-color)">${esc(surf.id)}</strong>${fyiNote(p.FYI)}</td>
            <td>${hrrStr}</td>
            <td>${growthHtml}</td>
            <td>${fireSourceValue(peakStr)}</td>
            <td>${ventStr}</td>
        </tr>`;
    });

    html += '</tbody></table>';
    html += buildHrrPreviewSection(data, fireSurfs);
    html += `<p class="fp-note" style="margin:12px 0 0">Switch to the <strong>Mesh</strong> tab for D*/dx resolution analysis — peak HRR from these fire sources is used automatically.</p>`;
    html += codeBlock('FDS &SURF code (fire sources)', fireSurfs.map(rawOf));

    // Collect any &RAMP records referenced by fire SURFs and include them too
    const rampIds = new Set();
    fireSurfs.forEach(s => {
        const rid = s._params.RAMP_Q || s._params.RAMP_MF;
        if (rid) rampIds.add(rid);
    });
    if (rampIds.size && data.ramps) {
        const rampLines = [];
        rampIds.forEach(id => {
            const r = data.ramps[id];
            if (r && r._raws) rampLines.push(...r._raws);
        });
        if (rampLines.length) html += codeBlock('FDS &RAMP code (referenced)', rampLines);
    }

    html += '</div>';
    return html;
}

function buildHrrPreviewSection(data, fireSurfs) {
    const previews = fireSurfs
        .map(surf => buildHrrPreview(data, surf))
        .filter(Boolean);

    if (!previews.length) return '';

    return `<div class="fp-hrr-preview">
        <div class="fp-section-label">Estimated HRR Preview</div>
        <div class="fp-note">
            These curves are estimated from input fire definitions on linked VENTs or OBSTs. They are not FDS output.
        </div>
        <div class="fp-hrr-grid">${previews.join('')}</div>
    </div>`;
}

function buildHrrPreview(data, surf) {
    const p = surf._params || {};
    const fireArea = fireSurfaceArea(data, surf.id);
    const totalArea = fireArea.area;
    if (totalArea <= 0) return null;

    const base = estimateBaseHrr(data, p, totalArea);
    if (!base.value || base.value <= 0) return null;

    const rampId = p.RAMP_Q || p.RAMP_MF;
    const ramp = rampId && data.ramps ? data.ramps[rampId] : null;
    const curve = hrrCurvePoints(data, p, ramp, base.value);
    if (!curve.points.length) return null;

    const peak = curve.points.reduce((max, pt) => Math.max(max, pt.hrr), 0);
    const details = [curve.label, fireArea.label];

    return `<div class="fp-hrr-card">
        <div class="fp-hrr-head">
            <strong>${esc(surf.id)}</strong>
            <span>${esc(base.label)}</span>
        </div>
        ${renderHrrSvg(curve.points, curve.flatAt)}
        <div class="fp-hrr-meta">
            <span>Peak ${formatHrr(peak)}</span>
            <span>${esc(details.join('; '))}</span>
        </div>
    </div>`;
}

function fireSurfaceArea(data, surfId) {
    const ventArea = (data.vents || [])
        .filter(v => surfaceListIncludes(v.surf_id, surfId))
        .reduce((sum, v) => sum + ventFaceArea(v), 0);
    const obstArea = (data.obsts || [])
        .filter(o => surfaceListIncludes(o.surf_id, surfId) ||
                     surfaceListIncludes(o.surf_id6, surfId) ||
                     surfaceListIncludes(o.surf_ids, surfId))
        .reduce((sum, o) => sum + boxSurfaceArea(o.xb), 0);

    const parts = [];
    if (ventArea > 0) parts.push(`VENT ${ventArea.toFixed(2)} m²`);
    if (obstArea > 0) parts.push(`OBST ${obstArea.toFixed(2)} m²`);

    return {
        area: ventArea + obstArea,
        label: parts.join(' + ') || 'No linked area',
    };
}

function estimateBaseHrr(data, p, totalArea) {
    if (p.HRRPUA != null) {
        return {
            value: Number(p.HRRPUA) * totalArea,
            label: `${p.HRRPUA} kW/m² × ${totalArea.toFixed(2)} m²`,
        };
    }

    if (p.MLRPUA != null) {
        const hoc = firstHeatOfCombustion(data);
        if (hoc != null) {
            return {
                value: Number(p.MLRPUA) * totalArea * Number(hoc),
                label: `${p.MLRPUA} kg/m²/s × ${totalArea.toFixed(2)} m² × HOC`,
            };
        }
    }

    return { value: null, label: 'No HRR estimate' };
}

function firstHeatOfCombustion(data) {
    const reac = data.reacs && data.reacs.find(r => r._params && r._params.HEAT_OF_COMBUSTION != null);
    return reac ? reac._params.HEAT_OF_COMBUSTION : null;
}

function hrrCurvePoints(data, p, ramp, baseHrr) {
    const tEnd = data.time && data.time.T_END != null ? Number(data.time.T_END) : null;

    if (ramp && ramp.points && ramp.points.length) {
        const pts = ramp.points
            .map(pt => ({ t: Number(pt.T), hrr: baseHrr * Number(pt.F) }))
            .filter(pt => isFinite(pt.t) && isFinite(pt.hrr))
            .sort((a, b) => a.t - b.t);
        const last = pts[pts.length - 1];
        if (last && tEnd && tEnd > last.t) {
            pts.push({ t: tEnd, hrr: last.hrr });
        }
        return {
            points: pts,
            label: `Ramp ${ramp.id}`,
            flatAt: flatStartTime(pts),
        };
    }

    if (p.TAU_Q != null) {
        const tau = Math.abs(Number(p.TAU_Q));
        if (isFinite(tau) && tau > 0) {
            const end = tEnd && tEnd > 0 ? Math.min(tEnd, tau * 1.5) : tau * 1.5;
            const pts = [];
            for (let i = 0; i <= 24; i++) {
                const t = end * i / 24;
                const f = Math.min(1, Math.pow(t / tau, 2));
                pts.push({ t, hrr: baseHrr * f });
            }
            return {
                points: pts,
                label: `TAU_Q = ${p.TAU_Q} s`,
                flatAt: end >= tau ? tau : null,
            };
        }
    }

    const end = tEnd && tEnd > 0 ? tEnd : 60;
    return {
        points: [{ t: 0, hrr: baseHrr }, { t: end, hrr: baseHrr }],
        label: 'Steady',
        flatAt: 0,
    };
}

function renderHrrSvg(points, flatAt = null) {
    const width = 320;
    const height = 120;
    const padL = 38;
    const padR = 10;
    const padT = 12;
    const padB = 24;
    const maxT = Math.max(...points.map(p => p.t), 1);
    const maxHrr = Math.max(...points.map(p => p.hrr), 1);
    const plotW = width - padL - padR;
    const plotH = height - padT - padB;
    const xy = points.map(p => {
        const x = padL + (p.t / maxT) * plotW;
        const y = padT + plotH - (p.hrr / maxHrr) * plotH;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    const showFlatMarker = flatAt != null && isFinite(flatAt) && flatAt > 0 && flatAt < maxT;
    const flatX = showFlatMarker ? padL + (flatAt / maxT) * plotW : null;
    const flatAnchor = flatX && flatX > width - 70 ? 'end' : (flatX && flatX < padL + 45 ? 'start' : 'middle');
    const flatTextX = flatAnchor === 'end' ? flatX - 4 : (flatAnchor === 'start' ? flatX + 4 : flatX);
    const flatLabel = showFlatMarker ? formatAxisSeconds(flatAt) : '';

    return `<svg class="fp-hrr-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Estimated HRR curve">
        <line x1="${padL}" y1="${padT + plotH}" x2="${width - padR}" y2="${padT + plotH}" />
        <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + plotH}" />
        ${showFlatMarker ? `<line class="fp-hrr-marker" x1="${flatX.toFixed(1)}" y1="${padT}" x2="${flatX.toFixed(1)}" y2="${padT + plotH}" />
        <text class="fp-hrr-marker-label" x="${flatTextX.toFixed(1)}" y="${height - 5}" text-anchor="${flatAnchor}">${flatLabel}</text>` : ''}
        <polyline points="${xy}" />
        <text x="${padL}" y="${height - 5}">0s</text>
        <text x="${width - padR}" y="${height - 5}" text-anchor="end">${formatAxisSeconds(maxT)}</text>
        <text x="${padL - 5}" y="${padT + 4}" text-anchor="end">${formatHrr(maxHrr)}</text>
    </svg>`;
}

function flatStartTime(points) {
    if (!points || points.length < 2) return null;
    const eps = 1e-6;
    for (let i = 0; i < points.length - 1; i++) {
        const hrr = points[i].hrr;
        const remainsFlat = points.slice(i + 1).every(pt => Math.abs(pt.hrr - hrr) <= eps);
        if (remainsFlat) return points[i].t;
    }
    return null;
}

function formatHrr(value) {
    if (value >= 1000) return `${(value / 1000).toFixed(2)} MW`;
    return `${value.toFixed(0)} kW`;
}

function formatSeconds(value) {
    if (!isFinite(value)) return '—';
    const rounded = Math.abs(value) >= 10 ? value.toFixed(0) : value.toFixed(1);
    return `${Number(rounded)} s`;
}

function formatAxisSeconds(value) {
    if (!isFinite(value)) return '';
    const rounded = Math.abs(value) >= 10 ? value.toFixed(0) : value.toFixed(1);
    return `${Number(rounded)}s`;
}

function fireSourceValue(main, sub = null) {
    return `<span class="fp-source-main">${esc(main)}</span>` +
           (sub ? `<span class="fp-source-sub">${esc(sub)}</span>` : '');
}

function fyiNote(text) {
    if (!text) return '';
    return `<div class="fp-fyi"><span>FYI</span>${esc(text)}</div>`;
}

function surfaceListIncludes(value, surfId) {
    if (!value || !surfId) return false;
    const values = Array.isArray(value) ? value : [value];
    return values.includes(surfId);
}

function ventFaceArea(vent) {
    if (!vent.xb) return 0;
    const [x1,x2,y1,y2,z1,z2] = vent.xb;
    const dx = Math.abs(x2-x1), dy = Math.abs(y2-y1), dz = Math.abs(z2-z1);
    const dims = [dx, dy, dz].sort((a,b) => a-b);
    return dims[1] * dims[2]; // product of two larger dims = face area
}

function boxSurfaceArea(xb) {
    if (!xb) return 0;
    const dx = Math.abs(xb[1] - xb[0]);
    const dy = Math.abs(xb[3] - xb[2]);
    const dz = Math.abs(xb[5] - xb[4]);
    const positive = [dx, dy, dz].filter(v => v > 0);
    if (positive.length < 2) return 0;
    if (positive.length === 2) return positive[0] * positive[1];
    return 2 * (dx * dy + dx * dz + dy * dz);
}

// ─── Gas-Phase Species ────────────────────────────────────────────────────────

function buildSpeciesSection(data, specs) {
    let html = '<div class="fp-card"><div class="fp-card-title">Gas-Phase Species';
    html += ` <span class="fp-badge fp-badge-mat">${specs.length}</span></div>`;

    html += '<table class="fp-prop-table">';
    specs.forEach(spec => {
        const formula = spec.formula ? formatFormula(spec.formula) : '—';
        const mw      = spec.mw != null ? spec.mw.toFixed(2) + ' g/mol' : estimateMW(spec.formula);

        const usedBy = [];
        Object.values(data.matls || {}).forEach(m => {
            const sids = Array.isArray(m._params.SPEC_ID) ? m._params.SPEC_ID : [m._params.SPEC_ID];
            if (sids.includes(spec.id)) usedBy.push('MATL: ' + m.id);
        });
        (data.reacs || []).forEach(r => {
            if ((r.fuel || r._params.FUEL) === spec.id) usedBy.push('REAC fuel');
        });

        html += `<tr>
            <td><strong style="color:#4488ff">${esc(spec.id)}</strong></td>
            <td>
                <span style="font-family:monospace">${formula}</span>
                ${mw ? `<br><span style="font-size:10px;color:var(--text-muted)">MW ≈ ${mw}</span>` : ''}
                ${usedBy.length ? `<br><span style="font-size:10px;color:var(--text-muted)">${esc(usedBy.join(' · '))}</span>` : ''}
            </td>
        </tr>`;
    });
    html += '</table>';
    html += codeBlock('FDS &SPEC code', specs.map(rawOf));
    html += '</div>';
    return html;
}

// ─── Combustible Materials ────────────────────────────────────────────────────

function getCombustibleMatls(data) {
    return Object.values(data.matls || {}).filter(m =>
        m._params.REFERENCE_TEMPERATURE != null ||
        m._params.HEAT_OF_REACTION      != null ||
        m._params.N_REACTIONS           != null ||
        m._params.A                     != null
    );
}

function buildMaterialsSection(data, materials) {
    let html = '<div class="fp-card"><div class="fp-card-title">Combustible Materials — Pyrolysis';
    html += ` <span class="fp-badge fp-badge-mat">${materials.length}</span></div>`;
    html += '<div class="fp-mat-cards">';

    materials.forEach(matl => {
        const p = matl._params;
        const layerCls = guessLayerClass(matl.id);

        html += `<div class="fp-mat-card">
            <div class="fp-mat-name">
                <span class="fp-layer fp-layer-${layerCls}" style="padding:3px 10px;margin:0;display:inline-flex">${esc(matl.id)}</span>
            </div>
            <table class="fp-prop-table">
                ${p.DENSITY        != null ? row('Density',        p.DENSITY        + ' kg/m³')    : ''}
                ${p.CONDUCTIVITY   != null ? row('Conductivity',   p.CONDUCTIVITY   + ' W/m·K')    : ''}
                ${p.SPECIFIC_HEAT  != null ? row('Specific Heat',  p.SPECIFIC_HEAT  + ' kJ/kg·K')  : ''}
                ${p.EMISSIVITY     != null ? row('Emissivity',     p.EMISSIVITY)                   : ''}
            </table>`;

        // Pyrolysis box
        const hasPyro = p.REFERENCE_TEMPERATURE != null || p.HEAT_OF_REACTION != null || p.A != null;
        if (hasPyro) {
            html += `<div class="fp-pyro-box">
                <div class="fp-pyro-title">Pyrolysis Parameters</div>
                <table class="fp-prop-table">
                    ${p.REFERENCE_TEMPERATURE != null ? row('Ref. Temperature', `<strong style="color:var(--accent)">${p.REFERENCE_TEMPERATURE} °C</strong>`) : ''}
                    ${p.HEAT_OF_REACTION      != null ? row('Heat of Reaction',  p.HEAT_OF_REACTION + ' kJ/kg') : ''}
                    ${p.A   != null ? row('Pre-exp. Factor (A)', fmtExp(p.A) + ' 1/s') : ''}
                    ${p.E   != null ? row('Activation Energy (E)', fmtExp(p.E) + ' J/mol') : ''}
                    ${p.N_S != null ? row('Reaction Order (n)', p.N_S) : ''}
                    ${p.SPEC_ID   != null ? row('Gas Product', `<span style="color:#4488ff">${esc(arrStr(p.SPEC_ID))}</span>`) : ''}
                    ${p.NU_SPEC   != null ? row('Gas Yield (ν)', arrStr(p.NU_SPEC)) : ''}
                    ${p.MATL_ID  != null ? row('Solid Residue', esc(arrStr(p.MATL_ID))) : ''}
                    ${p.NU_MATL  != null ? row('Residue Fraction', arrStr(p.NU_MATL)) : ''}
                </table>
            </div>`;
        }

        html += fyiNote(p.FYI);
        html += '</div>'; // fp-mat-card
    });

    html += '</div>'; // fp-mat-cards
    html += codeBlock('FDS &MATL code', materials.map(rawOf));
    html += '</div>'; // fp-card
    return html;
}

// ─── Combustible Surfaces ─────────────────────────────────────────────────────

function getCombustibleSurfs(data, combustibleMatls) {
    const ids = new Set(combustibleMatls.map(m => m.id));
    return Object.values(data.surfs || {}).filter(s => {
        if (!s._params.MATL_ID) return false;
        const mids = Array.isArray(s._params.MATL_ID) ? s._params.MATL_ID : [s._params.MATL_ID];
        return mids.some(mid => ids.has(mid));
    });
}

function buildSurfacesSection(data, surfs) {
    let html = '<div class="fp-card"><div class="fp-card-title">Combustible Surface Constructions';
    html += ` <span class="fp-badge fp-badge-mat">${surfs.length}</span></div>`;
    html += '<div class="fp-mat-cards">';

    surfs.forEach(surf => {
        const p      = surf._params;
        const matlIds  = Array.isArray(p.MATL_ID)    ? p.MATL_ID    : (p.MATL_ID    ? [p.MATL_ID]    : []);
        const thicks   = Array.isArray(p.THICKNESS)  ? p.THICKNESS  : (p.THICKNESS  ? [p.THICKNESS]  : []);
        const backing  = p.BACKING   || 'EXPOSED';
        const burnAway = p.BURN_AWAY === true || p.BURN_AWAY === '.TRUE.';

        const usedByObst = (data.obsts || []).filter(o => {
            const all = [o.surf_id, ...(Array.isArray(o.surf_id6) ? o.surf_id6 : [])].filter(Boolean);
            return all.includes(surf.id);
        }).length;
        const usedByVent = (data.vents || []).filter(v => v.surf_id === surf.id).length;

        html += `<div class="fp-mat-card">
            <div class="fp-mat-name">${esc(surf.id)}</div>
            <div class="fp-layer-stack">`;

        matlIds.forEach((mid, i) => {
            const thick = thicks[i];
            const matlObj = data.matls[mid];
            // BURN badge: a material is "burnable" if it has any pyrolysis
            // kinetics. FDS supports two parametrisations -- a simplified
            // REFERENCE_TEMPERATURE / HEAT_OF_REACTION pair, and the full
            // Arrhenius form (A, E, N_S). Either qualifies.
            const mp = matlObj && matlObj._params;
            const hasPyro = !!mp && (
                mp.REFERENCE_TEMPERATURE != null
                || mp.HEAT_OF_REACTION    != null
                || mp.A != null
                || mp.E != null
                || mp.N_S != null
                || mp.SPEC_ID != null
                || mp.NU_SPEC != null
            );
            const cls = guessLayerClass(mid);
            html += `<div class="fp-layer fp-layer-${cls}">
                <span class="fp-layer-name">${esc(mid)}</span>
                ${hasPyro ? '<span style="background:rgba(233,69,96,.2);color:var(--accent);font-size:10px;font-weight:700;padding:2px 7px;border-radius:8px;border:1px solid rgba(233,69,96,.4);letter-spacing:.5px">BURN</span>' : ''}
                ${thick != null ? `<span class="fp-layer-thick">${(thick*1000).toFixed(1)} mm</span>` : ''}
            </div>`;
        });

        html += `</div>
            <table class="fp-prop-table" style="margin-top:6px">
                ${row('Backing', backing)}
                ${burnAway    ? row('Burn Away',     '<span style="color:var(--accent)">&#10003; Yes</span>') : ''}
                ${usedByObst > 0 ? row('On Obstructions', usedByObst) : ''}
                ${usedByVent > 0 ? row('On Vents',         usedByVent) : ''}
            </table>
            ${fyiNote(p.FYI)}
        </div>`;
    });

    html += '</div>'; // fp-mat-cards
    html += codeBlock('FDS &SURF code (combustible surfaces)', surfs.map(rawOf));
    html += '</div>'; // fp-card
    return html;
}

// ─── Outputs & Devices ────────────────────────────────────────────────────────

function buildOutputsSection(data) {
    const slcfs = data.slcfs || [];
    const bndfs = data.bndfs || [];
    const devcs = data.devcs || [];

    if (!slcfs.length && !bndfs.length && !devcs.length) return '';

    let html = '<div class="fp-card"><div class="fp-card-title">Outputs &amp; Devices</div>';

    // ── Slice Files: items then FDS code ──
    if (slcfs.length) {
        html += `<div class="fp-section-label">Slice Files (${slcfs.length})</div>`;
        html += '<table class="fp-prop-table">';
        slcfs.forEach(s => {
            const plane = s.pbx != null ? `PBX=${s.pbx}` : s.pby != null ? `PBY=${s.pby}` : s.pbz != null ? `PBZ=${s.pbz}` : 'XB';
            const spec  = s.spec_id ? ` [${esc(s.spec_id)}]` : '';
            const vec   = s.vector  ? ' <span style="color:var(--text-muted)">(vector)</span>' : '';
            html += `<tr>
                <td style="color:#22dd88;width:22%" class="fp-out-tag">${esc(plane)}</td>
                <td>${esc(s.quantity || '—')}${spec}${vec}</td>
            </tr>`;
        });
        html += '</table>';
        html += codeBlock('FDS &SLCF code', slcfs.map(rawOf));
    }

    // ── Boundary Files: items then FDS code ──
    if (bndfs.length) {
        html += `<div class="fp-section-label" style="margin-top:18px">Boundary Files (${bndfs.length})</div>`;
        html += '<table class="fp-prop-table">';
        bndfs.forEach(b => {
            html += `<tr>
                <td style="color:#ff8800;width:22%" class="fp-out-tag">BNDF</td>
                <td>${esc(b.quantity || '—')}</td>
            </tr>`;
        });
        html += '</table>';
        html += codeBlock('FDS &BNDF code', bndfs.map(rawOf));
    }

    // ── Devices: grouped by QUANTITY then FDS code ──
    if (devcs.length) {
        html += `<div class="fp-section-label" style="margin-top:18px">Devices (${devcs.length})</div>`;

        // Group by QUANTITY — sort alphabetically for a stable layout
        const devcGroups = {};
        devcs.forEach(d => {
            const q = d.quantity || '(no quantity)';
            if (!devcGroups[q]) devcGroups[q] = [];
            devcGroups[q].push(d);
        });

        Object.entries(devcGroups)
            .sort((a, b) => a[0].localeCompare(b[0]))
            .forEach(([qty, group]) => {
                html += `<div class="fp-devc-group-label">
                    ${esc(qty)}
                    <span class="fp-badge fp-badge-mat" style="font-size:10px">${group.length}</span>
                </div>`;
                html += '<div class="fp-devc-grid">';
                group.forEach(d => {
                    const loc = d.xyz
                        ? d.xyz.map(v => v.toFixed(1)).join(', ')
                        : (d.xb ? 'XB region' : '—');
                    html += `<div class="fp-devc-card" title="${esc(d.id)} at (${esc(loc)})">
                        <div class="fp-devc-id">${esc(d.id)}</div>
                        <div class="fp-devc-q">${esc(loc)}</div>
                    </div>`;
                });
                html += '</div>';
            });

        html += codeBlock('FDS &DEVC code', devcs.map(rawOf));
    }

    html += '</div>';
    return html;
}

// ─── Full-file code panel ────────────────────────────────────────────────────

function buildCodePanel(text, filename) {
    const wrap = document.querySelector('#fds-code-panel .fp-scroll');
    if (!wrap) return;

    if (!text) {
        wrap.innerHTML = '<p class="fp-empty">Load an .fds file to view the full source code.</p>';
        return;
    }

    const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    const totalLines = lines.length;
    // Records = number of '&' starting a namelist (skip TAIL since FDS treats it as end-of-file)
    const recCount = (text.match(/&[A-Z]+/g) || []).filter(m => m !== '&TAIL').length;
    // Comments
    const cmtCount = lines.filter(l => /^\s*!/.test(l)).length;

    const overview = `
        <div class="fp-overview">
            <div class="fp-ov-item">
                <span class="fp-ov-lbl">File</span>
                <span class="fp-ov-val">${esc(filename || 'untitled.fds')}</span>
            </div>
            <div class="fp-ov-item">
                <span class="fp-ov-lbl">Lines</span>
                <span class="fp-ov-val">${totalLines}</span>
            </div>
            <div class="fp-ov-item">
                <span class="fp-ov-lbl">Records</span>
                <span class="fp-ov-val">${recCount}</span>
            </div>
            <div class="fp-ov-item">
                <span class="fp-ov-lbl">Comment Lines</span>
                <span class="fp-ov-val">${cmtCount}</span>
            </div>
        </div>`;

    // Highlight the whole file in one pass (comments + namelists)
    const highlighted = highlightFds(text);
    // Wrap each line in a span so CSS counters render line numbers.
    // IMPORTANT: don't join with "\n" — the spans are display:block and
    // <pre> would render the newline as an extra blank line between them.
    const linesHtml = highlighted.split('\n')
        .map(l => `<span class="fp-fds-line">${l || ' '}</span>`)
        .join('');

    const card = `
        <div class="fp-card">
            <div class="fp-card-title">
                Source Code
                <button class="fp-copy-btn" id="fp-copy-fds">Copy all</button>
            </div>
            <div class="fp-code-search">
                <input type="text" id="fp-code-search"
                    placeholder="Search…  e.g. HRRPUA, SURF_ID, MESH"
                    autocomplete="off" spellcheck="false">
                <span class="fp-search-count" id="fp-search-count"></span>
            </div>
            <pre class="fp-fds-source"><code id="fp-fds-source-code">${linesHtml}</code></pre>
        </div>`;

    wrap.innerHTML = overview + card;

    // Wire up the copy button
    const btn = document.getElementById('fp-copy-fds');
    if (btn) {
        btn.addEventListener('click', () => {
            navigator.clipboard.writeText(text).then(() => {
                btn.textContent = 'Copied!';
                setTimeout(() => { btn.textContent = 'Copy all'; }, 1200);
            }).catch(() => {
                btn.textContent = 'Copy failed';
                setTimeout(() => { btn.textContent = 'Copy all'; }, 1200);
            });
        });
    }

    // Wire up the search bar — highlight matching lines, dim non-matching
    const searchInput = document.getElementById('fp-code-search');
    const searchCount = document.getElementById('fp-search-count');
    if (searchInput) {
        searchInput.addEventListener('input', () => {
            const term = searchInput.value.trim().toUpperCase();
            const lineEls = document.querySelectorAll('.fp-fds-line');
            let matchCount = 0;
            let firstMatch = null;
            lineEls.forEach(el => {
                const matches = !!(term && el.textContent.toUpperCase().includes(term));
                el.classList.toggle('fp-line-match',   matches);
                el.classList.toggle('fp-line-nomatch', !!(term && !matches));
                if (matches) { matchCount++; if (!firstMatch) firstMatch = el; }
            });
            if (searchCount) {
                searchCount.textContent = term
                    ? `${matchCount} line${matchCount !== 1 ? 's' : ''}`
                    : '';
            }
            if (firstMatch) firstMatch.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        });
    }
}

// ─── FDS source-code disclosure helpers ──────────────────────────────────────

// Pull the raw namelist text from a parsed object (parser sets params._raw).
function rawOf(obj) {
    return obj && obj._params && obj._params._raw ? obj._params._raw : null;
}

// Lightweight syntax highlighting for FDS namelist text.
//
// The tokenizer is state-aware so it works for both per-record snippets
// (e.g. &REAC ... /) and entire .fds files which can contain large blocks
// of free-form documentation text outside any namelist (FDS just ignores
// anything not enclosed in &...). Without state tracking that free text
// gets tokenized as if it were code: "10cm", "0-3m", "Z=", "X=4.8-6.5"
// would all light up wrongly. Inside a namelist we tokenize fully; outside
// we only recognize !-comments and the start of the next namelist.
function highlightFds(text) {
    const escChar = c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] || c;
    const escSeg  = s => s.replace(/[&<>"]/g, escChar);

    let out = '';
    let i = 0;
    const n = text.length;
    let inside = false; // true while between &NAME and the matching /

    while (i < n) {
        const ch = text[i];

        // !-comments work in any state, and run to end of line
        if (ch === '!') {
            let j = i;
            while (j < n && text[j] !== '\n') j++;
            out += `<span class="fp-cmt">${escSeg(text.slice(i, j))}</span>`;
            i = j;
            continue;
        }

        // Start of a namelist record:  &NAME
        if (ch === '&' && /[A-Za-z]/.test(text[i + 1] || '')) {
            let j = i + 1;
            while (j < n && /[A-Za-z0-9_]/.test(text[j])) j++;
            out += `<span class="fp-kw">&amp;${escSeg(text.slice(i + 1, j))}</span>`;
            i = j;
            inside = true;
            continue;
        }

        // Tokens that ONLY apply inside a namelist record
        if (inside) {
            // Single-quoted string literal
            if (ch === "'") {
                let j = i + 1;
                while (j < n && text[j] !== "'") j++;
                out += `<span class="fp-str">${escSeg(text.slice(i, j + 1))}</span>`;
                i = j + 1;
                continue;
            }

            // Terminator  /  — string literals are already handled above so
            // any other / inside a namelist is the end-of-record marker
            if (ch === '/') {
                out += '<span class="fp-kw">/</span>';
                i++;
                inside = false;
                continue;
            }

            // Parameter key  KEY=
            if (/[A-Z]/.test(ch) && (i === 0 || /[\s,]/.test(text[i - 1]))) {
                const m = text.slice(i).match(/^[A-Z][A-Z0-9_]*(?:\([0-9,:]+\))?(?=\s*=)/);
                if (m) {
                    out += `<span class="fp-key">${escSeg(m[0])}</span>`;
                    i += m[0].length;
                    continue;
                }
            }

            // Boolean literal  .TRUE. / .FALSE. / T / F
            if ((ch === '.' || ch === 'T' || ch === 'F') && (i === 0 || /[\s,=]/.test(text[i - 1]))) {
                const m = text.slice(i).match(/^(?:\.TRUE\.|\.FALSE\.|T|F)(?=[\s,/])/);
                if (m) {
                    out += `<span class="fp-num">${m[0]}</span>`;
                    i += m[0].length;
                    continue;
                }
            }

            // Number  (decimal, scientific; must follow whitespace, =, comma, or paren)
            if ((ch === '-' || ch === '+' || /[0-9.]/.test(ch)) && (i === 0 || /[\s,=(]/.test(text[i - 1]))) {
                const m = text.slice(i).match(/^[+-]?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?/);
                if (m) {
                    out += `<span class="fp-num">${m[0]}</span>`;
                    i += m[0].length;
                    continue;
                }
            }
        }

        // Default — escape and emit a single character
        out += escChar(ch);
        i++;
    }

    return out;
}

// Render a <details> code block. `rawTexts` is an array of raw namelist strings.
// `summary` is the toggle label. Skips rendering if no raw text is available.
function codeBlock(summary, rawTexts) {
    const lines = (rawTexts || []).filter(Boolean);
    if (!lines.length) return '';
    const count = lines.length;
    const body  = lines.map(highlightFds).join('\n');
    const label = esc(summary || 'Show FDS code');
    return `<details class="fp-code">
        <summary>${label} <span class="fp-code-count">${count} record${count !== 1 ? 's' : ''}</span></summary>
        <pre class="fp-code-block">${body}</pre>
    </details>`;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function esc(s) {
    if (s == null) return '';
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function row(label, value) {
    return `<tr><td>${label}</td><td>${value}</td></tr>`;
}

function arrStr(v) {
    return Array.isArray(v) ? v.join(', ') : String(v);
}

function fmtExp(v) {
    if (v == null) return '—';
    const n = Number(v);
    if (Math.abs(n) >= 1e6 || (Math.abs(n) < 0.001 && n !== 0)) return n.toExponential(3);
    return n.toString();
}

function guessLayerClass(id) {
    const u = (id || '').toUpperCase();
    if (u.includes('POLY') || u.includes('PE') || u.includes('HDPE') || u.includes('PMMA') || u.includes('PLAS')) return 'pe';
    if (u.includes('CONC') || u.includes('BRICK') || u.includes('STONE') || u.includes('MORTAR')) return 'conc';
    if (u.includes('WOOD') || u.includes('TIMBER') || u.includes('PLY') || u.includes('OSB'))  return 'wood';
    if (u.includes('FOAM') || u.includes('PUR') || u.includes('PIR') || u.includes('EPS') || u.includes('XPS')) return 'foam';
    return 'other';
}

// Convert chemical formula string like 'C2H4' to HTML subscripts
function formatFormula(f) {
    if (!f) return '—';
    const subs = '₀₁₂₃₄₅₆₇₈₉';
    return f.replace(/(\d+)/g, n => n.split('').map(d => subs[+d]).join(''));
}

// Estimate molecular weight from simple formula string (e.g. 'C2H4')
function estimateMW(formula) {
    if (!formula) return null;
    const w = { C:12.01, H:1.008, O:16.00, N:14.01, S:32.06, Cl:35.45, F:19.00, Br:79.90 };
    let mw = 0;
    const re = /([A-Z][a-z]?)(\d*)/g;
    let m;
    while ((m = re.exec(formula)) !== null) {
        if (w[m[1]]) mw += w[m[1]] * (parseInt(m[2] || '1', 10));
    }
    return mw > 0 ? mw.toFixed(2) + ' g/mol' : null;
}

// Build a simple approximate combustion equation for CₙHₘOₚ fuels
function buildCombustionEquation(formula) {
    if (!formula) return null;
    const re = /([A-Z][a-z]?)(\d*)/g;
    const atoms = {};
    let m;
    while ((m = re.exec(formula)) !== null) {
        atoms[m[1]] = (atoms[m[1]] || 0) + parseInt(m[2] || '1', 10);
    }
    const C = atoms['C'] || 0, H = atoms['H'] || 0, O = atoms['O'] || 0;
    if (!C && !H) return null;
    // CₙHₘOₚ + (n + m/4 - p/2) O₂ → n CO₂ + m/2 H₂O
    const o2 = C + H/4 - O/2;
    if (o2 <= 0) return null;

    const fmt = v => Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/\.?0+$/, '');
    const sub = s => formatFormula(s);

    const fuel = sub(formula);
    const o2s  = o2 === 1 ? '' : fmt(o2) + ' ';
    const co2s = C  > 0 ? (C === 1 ? '' : C + ' ') + sub('CO2')   : '';
    const h2os = H  > 0 ? (H/2 === 1 ? '' : fmt(H/2) + ' ') + sub('H2O') : '';
    const products = [co2s, h2os].filter(Boolean).join(' + ');

    return `${fuel} + ${o2s}${sub('O2')} → ${products}`;
}
