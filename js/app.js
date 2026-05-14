/**
 * FDS Visualization Tool - Main Application
 * Connects the parser and viewer, handles UI interactions
 */

document.addEventListener('DOMContentLoaded', () => {
    const container = document.getElementById('viewer-container');
    const viewer = new FDSViewer(container);
    const parser = new FDSParser();

    let currentData = null;
    let currentText = null;
    let currentFilename = null;

    // ── File Loading ──────────────────────────
    const fileInput = document.getElementById('file-input');
    const dropZone = document.getElementById('drop-zone');
    const loadSampleBtn = document.getElementById('load-sample');

    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) loadFile(file);
    });

    // Drag and drop -- listen on the document so a user can drop a second
    // file onto the 3D viewer after the drop-zone overlay is hidden.
    const onDocDragOver = (e) => {
        if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes('Files')) return;
        e.preventDefault();
        if (dropZone.style.display !== 'none') dropZone.classList.add('drag-over');
    };
    const onDocDragLeave = (e) => {
        // Only clear the highlight when leaving the window/document.
        if (e.relatedTarget == null) dropZone.classList.remove('drag-over');
    };
    const onDocDrop = (e) => {
        if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        loadFile(e.dataTransfer.files[0]);
    };
    document.addEventListener('dragover', onDocDragOver);
    document.addEventListener('dragleave', onDocDragLeave);
    document.addEventListener('drop', onDocDrop);

    // Also allow clicking the drop zone (but not its buttons)
    dropZone.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        fileInput.click();
    });

    function loadFile(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            const text = e.target.result;
            parseAndLoad(text, file.name);
        };
        reader.readAsText(file);
    }

    function parseAndLoad(text, filename) {
        try {
            currentText = text;
            currentFilename = filename || 'FDS Model';
            currentData = parser.parse(text);

            // Update filename display
            document.getElementById('filename-display').textContent = currentFilename;

            // Show the title from &HEAD
            const title = currentData.head.TITLE || currentData.head.CHID || '';
            document.getElementById('model-title').textContent = title;

            // Hide drop zone, show viewer
            dropZone.style.display = 'none';
            container.style.display = 'block';
            document.getElementById('sidebar').classList.add('active');
            activatePage('3d');

            viewer.loadData(currentData);
            updateStats();
            updateInfoPanel(null);

            // Trigger resize after the 3D layout is visible
            viewer._onResize();

            // Build fire & combustion panel
            if (typeof buildFirePanel === 'function') {
                buildFirePanel(currentData);
            }

            // Build mesh analysis panel
            if (typeof buildMeshPanel === 'function') {
                buildMeshPanel(currentData);
            }

            // Build full FDS code panel
            if (typeof buildCodePanel === 'function') {
                buildCodePanel(currentText, currentFilename);
            }

        } catch (err) {
            console.error('FDS parse failed for', filename, err);
            // Reset previously-shown content so the user isn't left looking
            // at stale stats from an earlier file.
            currentData = null;
            try { viewer.clearScene(); } catch (_) { /* viewer may not yet be ready */ }
            updateStats();
            // Re-show the drop zone so the user can drop another file.
            dropZone.style.display = '';
            container.style.display = '';
            alert('Could not parse "' + (filename || 'file') + '":\n' + err.message);
        }
    }

    // ── URL Parameter Loading (?file=<server-relative path>) ──
    // Only works when served via HTTP (e.g. via serve.bat or GitHub Pages),
    // because fetch() over file:// is blocked by the browser.
    const urlParams = new URLSearchParams(window.location.search);
    const urlFile = urlParams.get('file');
    if (urlFile) {
        fetch(urlFile + '?t=' + Date.now())
            .then(r => {
                if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + r.statusText);
                return r.text();
            })
            .then(text => parseAndLoad(text, urlFile.split('/').pop()))
            .catch(err => {
                console.error('URL-load failed for ' + urlFile, err);
                alert('Could not load ' + urlFile + '\n' + err.message +
                      '\n\nThis page must be served over HTTP for fetch() to work.\n' +
                      'Run a static server from the repo root, e.g.:\n' +
                      '    python -m http.server 8765\n' +
                      'then open http://localhost:8765/?file=' + urlFile);
            });
    }

    // ── Sample File ───────────────────────────
    // The sample is embedded as a JS string in js/sample-data.js (loaded
    // before this file), so the "Load Sample" button works offline — no
    // HTTP server required. The on-disk copy at examples/sample_room_fire.fds
    // is kept in sync for users who want to inspect or edit the .fds source.
    loadSampleBtn.addEventListener('click', () => {
        if (typeof SAMPLE_FDS_TEXT === 'string') {
            parseAndLoad(SAMPLE_FDS_TEXT, 'sample_room_fire.fds');
        } else {
            alert('Bundled sample is missing. Make sure js/sample-data.js is loaded.');
        }
    });

    // ── Visibility Toggles ─────────────────────
    document.querySelectorAll('.layer-toggle').forEach(toggle => {
        toggle.addEventListener('change', (e) => {
            const layer = e.target.dataset.layer;
            viewer.setVisibility(layer, e.target.checked);
        });
    });

    // ── Opacity Slider ─────────────────────────
    const opacitySlider = document.getElementById('obst-opacity');
    const opacityValue = document.getElementById('opacity-value');
    opacitySlider.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        opacityValue.textContent = Math.round(val * 100) + '%';
        viewer.setObstOpacity(val);
    });
    opacitySlider.addEventListener('keydown', (e) => {
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
            e.preventDefault();
            opacitySlider.blur();
        }
    });

    // ── View Buttons ───────────────────────────
    document.querySelectorAll('.view-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            viewer.setView(btn.dataset.view);
        });
    });

    document.getElementById('reset-camera').addEventListener('click', () => {
        viewer.resetCamera();
    });

    // ── Page Tab Switching ─────────────────────
    function activatePage(page) {
        document.querySelectorAll('.page-tab').forEach(t => {
            t.classList.toggle('active', t.dataset.page === page);
        });

        const appLayout  = document.getElementById('app-layout');
        const meshPanel  = document.getElementById('mesh-panel');
        const firePanel  = document.getElementById('fire-panel');
        const codePanel  = document.getElementById('fds-code-panel');
        const footerBar  = document.querySelector('.footer-bar');

        // Reset all
        appLayout.style.display = '';
        meshPanel.classList.remove('active');
        firePanel.classList.remove('active');
        codePanel.classList.remove('active');
        footerBar.style.display = '';

        if (page === 'mesh') {
            appLayout.style.display = 'none';
            meshPanel.classList.add('active');
            footerBar.style.display = 'none';
        } else if (page === 'fire') {
            appLayout.style.display = 'none';
            firePanel.classList.add('active');
            footerBar.style.display = 'none';
        } else if (page === 'code') {
            appLayout.style.display = 'none';
            codePanel.classList.add('active');
            footerBar.style.display = 'none';
        }
    }

    document.querySelectorAll('.page-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            activatePage(tab.dataset.page);
        });
    });

    // ── Background Toggle ──────────────────────
    const bgOptions = document.querySelectorAll('.bg-option');
    bgOptions.forEach(btn => {
        btn.addEventListener('click', () => {
            bgOptions.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            viewer.setBackground(btn.dataset.color);
        });
    });

    // ── Object Selection Info ──────────────────
    container.addEventListener('objectSelected', (e) => {
        updateInfoPanel(e.detail);
    });

    function updateInfoPanel(detail) {
        const panel = document.getElementById('info-content');

        if (!detail) {
            panel.innerHTML = '<p class="hint">Click an object in the 3D view to see its properties.</p>';
            return;
        }

        let html = `<div class="info-item"><span class="info-label">Type:</span> <span class="info-value type-${detail.type}">${detail.type}</span></div>`;

        if (detail.id) {
            html += `<div class="info-item"><span class="info-label">ID:</span> <span class="info-value">${detail.id}</span></div>`;
        }

        if (detail.xb) {
            html += `<div class="info-item"><span class="info-label">XB:</span> <span class="info-value xb">${detail.xb.map(v => v.toFixed(3)).join(', ')}</span></div>`;
            const dx = Math.abs(detail.xb[1] - detail.xb[0]);
            const dy = Math.abs(detail.xb[3] - detail.xb[2]);
            const dz = Math.abs(detail.xb[5] - detail.xb[4]);
            html += `<div class="info-item"><span class="info-label">Size:</span> <span class="info-value">${dx.toFixed(3)} x ${dy.toFixed(3)} x ${dz.toFixed(3)} m</span></div>`;
        }

        if (detail.ijk) {
            html += `<div class="info-item"><span class="info-label">IJK:</span> <span class="info-value">${detail.ijk.join(' x ')}</span></div>`;
            if (detail.xb) {
                const csX = (Math.abs(detail.xb[1] - detail.xb[0]) / detail.ijk[0]).toFixed(4);
                const csY = (Math.abs(detail.xb[3] - detail.xb[2]) / detail.ijk[1]).toFixed(4);
                const csZ = (Math.abs(detail.xb[5] - detail.xb[4]) / detail.ijk[2]).toFixed(4);
                html += `<div class="info-item"><span class="info-label">Cell Size:</span> <span class="info-value">${csX} x ${csY} x ${csZ} m</span></div>`;
            }
        }

        if (detail.surf_id) {
            const sid = Array.isArray(detail.surf_id) ? detail.surf_id.join(', ') : detail.surf_id;
            html += `<div class="info-item"><span class="info-label">SURF_ID:</span> <span class="info-value">${sid}</span></div>`;
        }

        if (detail.quantity) {
            html += `<div class="info-item"><span class="info-label">QUANTITY:</span> <span class="info-value">${detail.quantity}</span></div>`;
        }

        if (detail.prop_id) {
            html += `<div class="info-item"><span class="info-label">PROP_ID:</span> <span class="info-value">${detail.prop_id}</span></div>`;
        }

        if (detail.subtype) {
            html += `<div class="info-item"><span class="info-label">Subtype:</span> <span class="info-value">${detail.subtype}</span></div>`;
        }

        if (detail.part_id) {
            html += `<div class="info-item"><span class="info-label">PART_ID:</span> <span class="info-value">${detail.part_id}</span></div>`;
        }

        if (detail.xyz) {
            html += `<div class="info-item"><span class="info-label">XYZ:</span> <span class="info-value">${detail.xyz.map(v => v.toFixed(3)).join(', ')}</span></div>`;
        }

        if (detail.sphere_origin) {
            html += `<div class="info-item"><span class="info-label">Origin:</span> <span class="info-value">${detail.sphere_origin.map(v => v.toFixed(3)).join(', ')}</span></div>`;
        }
        if (detail.sphere_radius) {
            html += `<div class="info-item"><span class="info-label">Radius:</span> <span class="info-value">${detail.sphere_radius.toFixed(3)} m</span></div>`;
        }

        if (detail.hrrpuv) {
            html += `<div class="info-item"><span class="info-label">HRRPUV:</span> <span class="info-value">${detail.hrrpuv} kW/m³</span></div>`;
        }

        if (detail.ambient !== undefined) {
            html += `<div class="info-item"><span class="info-label">Ambient:</span> <span class="info-value">${detail.ambient ? 'Yes' : 'No'}</span></div>`;
        }

        if (detail.node_id) {
            const nid = Array.isArray(detail.node_id) ? detail.node_id.join(' → ') : detail.node_id;
            html += `<div class="info-item"><span class="info-label">Nodes:</span> <span class="info-value">${nid}</span></div>`;
        }

        if (detail.vent_id) {
            html += `<div class="info-item"><span class="info-label">VENT_ID:</span> <span class="info-value">${detail.vent_id}</span></div>`;
        }

        if (detail.pbx != null) html += `<div class="info-item"><span class="info-label">PBX:</span> <span class="info-value">${detail.pbx}</span></div>`;
        if (detail.pby != null) html += `<div class="info-item"><span class="info-label">PBY:</span> <span class="info-value">${detail.pby}</span></div>`;
        if (detail.pbz != null) html += `<div class="info-item"><span class="info-label">PBZ:</span> <span class="info-value">${detail.pbz}</span></div>`;

        panel.innerHTML = html;
    }

    // ── Stats ──────────────────────────────────
    function updateStats() {
        const stats = viewer.getStats();
        document.getElementById('stat-meshes').textContent = stats.meshes;
        document.getElementById('stat-obsts').textContent = stats.obsts;
        document.getElementById('stat-vents').textContent = stats.vents;
        document.getElementById('stat-holes').textContent = stats.holes;
        document.getElementById('stat-devcs').textContent = stats.devcs;
        document.getElementById('stat-inits').textContent = stats.inits;
        document.getElementById('stat-geoms').textContent = stats.geoms;
        document.getElementById('stat-hvacs').textContent = stats.hvacs;
        document.getElementById('stat-zones').textContent = stats.zones;
        document.getElementById('stat-slcfs').textContent = stats.slcfs;
        document.getElementById('stat-fires').textContent = stats.fires;
    }

    // ── Load new file button ───────────────────
    document.getElementById('load-new').addEventListener('click', () => {
        fileInput.value = '';
        fileInput.click();
    });

    // ── Theme toggle (light/dark) ──────────────
    const themeBtn  = document.getElementById('toggle-theme');
    const themeIcon = document.getElementById('theme-icon');

    // SVGs: moon shown while in DARK mode (clicking → light); sun shown while in LIGHT mode (clicking → dark)
    const MOON_SVG = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
    const SUN_SVG  = '<circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.05" y2="7.05"/><line x1="16.95" y1="16.95" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.05" y2="16.95"/><line x1="16.95" y1="7.05" x2="19.07" y2="4.93"/>';

    function applyTheme(theme) {
        if (theme === 'light') {
            document.documentElement.setAttribute('data-theme', 'light');
            themeIcon.innerHTML = SUN_SVG;
            themeBtn.title = 'Switch to dark theme';
        } else {
            document.documentElement.removeAttribute('data-theme');
            themeIcon.innerHTML = MOON_SVG;
            themeBtn.title = 'Switch to light theme';
        }
    }

    // Initial: read saved preference, fall back to system preference, fall back to dark
    let savedTheme = null;
    try { savedTheme = localStorage.getItem('fds-viewer-theme'); } catch (e) { /* private mode */ }
    if (!savedTheme) {
        savedTheme = (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark';
    }
    applyTheme(savedTheme);

    themeBtn.addEventListener('click', () => {
        const cur = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
        const next = cur === 'light' ? 'dark' : 'light';
        applyTheme(next);
        try { localStorage.setItem('fds-viewer-theme', next); } catch (e) { /* private mode */ }
    });

    // ── Keyboard shortcuts ─────────────────────
    document.addEventListener('keydown', (e) => {
        if (!currentData) return;

        switch (e.key) {
            case '1': viewer.setView('front'); break;
            case '2': viewer.setView('back'); break;
            case '3': viewer.setView('left'); break;
            case '4': viewer.setView('right'); break;
            case '5': viewer.setView('top'); break;
            case '6': viewer.setView('bottom'); break;
            case '0': viewer.setView('iso'); break;
            case 'r': viewer.resetCamera(); break;
        }
    });
});

// Sample FDS lives in examples/sample_room_fire.fds and is fetched on
// demand by the "Load Sample" button above.
