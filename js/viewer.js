/**
 * FDS 3D Viewer using Three.js
 * Renders FDS geometry: meshes, obstructions, vents, holes
 */

/**
 * Ear-clipping triangulation for a simple (possibly concave) polygon.
 * Takes 3D vertices and a normal vector, projects to 2D, triangulates,
 * and returns an array of triangle index triplets.
 */
function triangulatePolygon(polyVerts3D, normal) {
    // Build a 2D coordinate system on the polygon plane
    // Pick the axis most aligned with normal to drop
    const ax = Math.abs(normal.x), ay = Math.abs(normal.y), az = Math.abs(normal.z);
    let project;
    if (az >= ax && az >= ay) {
        project = v => [v.x, v.y]; // drop Z
    } else if (ay >= ax) {
        project = v => [v.x, v.z]; // drop Y
    } else {
        project = v => [v.y, v.z]; // drop X
    }

    const pts2D = polyVerts3D.map(project);
    const n = pts2D.length;
    if (n < 3) return [];

    // Ensure CCW winding in 2D
    let area = 0;
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        area += pts2D[i][0] * pts2D[j][1];
        area -= pts2D[j][0] * pts2D[i][1];
    }
    const ccw = area > 0;

    // Build index list
    const idx = [];
    for (let i = 0; i < n; i++) idx.push(i);

    function cross2D(o, a, b) {
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    }

    function pointInTriangle(p, a, b, c) {
        const d1 = cross2D(p, a, b);
        const d2 = cross2D(p, b, c);
        const d3 = cross2D(p, c, a);
        const hasNeg = (d1 < 0) || (d2 < 0) || (d3 < 0);
        const hasPos = (d1 > 0) || (d2 > 0) || (d3 > 0);
        return !(hasNeg && hasPos);
    }

    function isEar(prev, cur, next) {
        const a = pts2D[idx[prev]], b = pts2D[idx[cur]], c = pts2D[idx[next]];
        const cp = cross2D(a, b, c);
        if (ccw ? cp <= 0 : cp >= 0) return false; // reflex vertex
        for (let k = 0; k < idx.length; k++) {
            if (k === prev || k === cur || k === next) continue;
            if (pointInTriangle(pts2D[idx[k]], a, b, c)) return false;
        }
        return true;
    }

    const triangles = [];
    let safety = n * n;
    while (idx.length > 3 && safety-- > 0) {
        let earFound = false;
        for (let i = 0; i < idx.length; i++) {
            const prev = (i + idx.length - 1) % idx.length;
            const next = (i + 1) % idx.length;
            if (isEar(prev, i, next)) {
                triangles.push(idx[prev], idx[i], idx[next]);
                idx.splice(i, 1);
                earFound = true;
                break;
            }
        }
        if (!earFound) break; // degenerate
    }
    if (idx.length === 3) {
        triangles.push(idx[0], idx[1], idx[2]);
    }
    return triangles;
}

class FDSViewer {
    constructor(container) {
        this.container = container;
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();

        // Keyboard state for continuous movement.
        this._keysPressed = {};
        this._onKeyDown = (e) => {
            // Ignore keystrokes that originate from a text-entry element so
            // panel search boxes don't drive the camera. Recording the key
            // would be harmless on its own, but the per-frame keyboard handler
            // also reads modifier-less letters here -- safest to drop them.
            const t = e.target;
            if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA'
                      || t.tagName === 'SELECT' || t.isContentEditable)) return;
            this._keysPressed[e.key] = true;
        };
        // keyup is NOT gated -- always release the key state, otherwise a key
        // pressed in the viewport then released after focusing an input would
        // stick "pressed" forever and the camera would drift.
        this._onKeyUp = (e) => {
            this._keysPressed[e.key] = false;
        };
        // Also drop all pressed keys when focus moves to an input (covers
        // mouse-click focus changes that bypass keydown entirely).
        this._onFocusIn = (e) => {
            const t = e.target;
            if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA'
                      || t.tagName === 'SELECT' || t.isContentEditable)) {
                this._keysPressed = {};
            }
        };
        document.addEventListener('keydown', this._onKeyDown);
        document.addEventListener('keyup', this._onKeyUp);
        document.addEventListener('focusin', this._onFocusIn);

        // Group containers
        this.meshGroup = new THREE.Group();
        this.obstGroup = new THREE.Group();
        this.ventGroup = new THREE.Group();
        this.holeGroup = new THREE.Group();
        this.devcGroup = new THREE.Group();
        this.initGroup = new THREE.Group();
        this.gridGroup = new THREE.Group();
        this.geomGroup = new THREE.Group();
        this.hvacGroup = new THREE.Group();
        this.zoneGroup = new THREE.Group();
        this.slcfGroup = new THREE.Group();
        this.fireGroup = new THREE.Group();

        // Visibility state
        this.visibility = {
            meshes: true,
            obsts: true,
            vents: true,
            holes: true,
            devcs: true,
            inits: true,
            grid: true,
            geoms: true,
            hvacs: true,
            zones: true,
            slcfs: true,
            fires: true,
        };

        // Data
        this.fdsData = null;
        this.boundingBox = null;

        // Selection
        this.selectedObject = null;
        this.highlightMaterial = new THREE.MeshPhongMaterial({
            color: 0xffff00,
            transparent: true,
            opacity: 0.8,
            emissive: 0x444400,
        });

        this._init();
    }

    _init() {
        // Scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x1a1a2e);

        // Renderer
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.container.appendChild(this.renderer.domElement);

        // Camera
        this.camera = new THREE.PerspectiveCamera(
            50,
            this.container.clientWidth / this.container.clientHeight,
            0.01,
            1000
        );
        this.camera.position.set(5, 5, 5);

        // Controls (OrbitControls)
        this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.1;
        this.controls.screenSpacePanning = true;

        // Lighting
        this._setupLights();

        // Add groups to scene
        this.meshGroup.name = 'meshes';
        this.obstGroup.name = 'obsts';
        this.ventGroup.name = 'vents';
        this.holeGroup.name = 'holes';
        this.devcGroup.name = 'devcs';
        this.initGroup.name = 'inits';
        this.gridGroup.name = 'grid';
        this.geomGroup.name = 'geoms';
        this.hvacGroup.name = 'hvacs';
        this.zoneGroup.name = 'zones';
        this.slcfGroup.name = 'slcfs';
        this.fireGroup.name = 'fires';

        this.scene.add(this.meshGroup);
        this.scene.add(this.obstGroup);
        this.scene.add(this.ventGroup);
        this.scene.add(this.holeGroup);
        this.scene.add(this.devcGroup);
        this.scene.add(this.initGroup);
        this.scene.add(this.gridGroup);
        this.scene.add(this.geomGroup);
        this.scene.add(this.hvacGroup);
        this.scene.add(this.zoneGroup);
        this.scene.add(this.slcfGroup);
        this.scene.add(this.fireGroup);

        // Axes helper
        this.axesHelper = new THREE.AxesHelper(1);
        this.scene.add(this.axesHelper);

        // Events
        window.addEventListener('resize', () => this._onResize());
        this.renderer.domElement.addEventListener('click', (e) => this._onClick(e));

        // Animation loop
        this._animate();
    }

    _setupLights() {
        // Ambient
        const ambient = new THREE.AmbientLight(0xffffff, 0.4);
        this.scene.add(ambient);

        // Directional light 1
        const dir1 = new THREE.DirectionalLight(0xffffff, 0.6);
        dir1.position.set(10, 20, 10);
        dir1.castShadow = true;
        this.scene.add(dir1);

        // Directional light 2
        const dir2 = new THREE.DirectionalLight(0xffffff, 0.3);
        dir2.position.set(-10, 10, -10);
        this.scene.add(dir2);

        // Hemisphere
        const hemi = new THREE.HemisphereLight(0x87ceeb, 0x362d1b, 0.3);
        this.scene.add(hemi);
    }

    _animate() {
        requestAnimationFrame(() => this._animate());
        this._handleKeyboardMovement();
        this.controls.update();
        this.renderer.render(this.scene, this.camera);
    }

    _handleKeyboardMovement() {
        const keys = this._keysPressed;
        const panSpeed = 0.05;
        const rotSpeed = 0.02;

        // WASD: pan camera + target together
        const forward = new THREE.Vector3();
        this.camera.getWorldDirection(forward);
        forward.y = 0;
        forward.normalize();
        const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

        const delta = new THREE.Vector3();
        if (keys['w'] || keys['W']) delta.add(forward.clone().multiplyScalar(panSpeed));
        if (keys['s'] || keys['S']) delta.add(forward.clone().multiplyScalar(-panSpeed));
        if (keys['a'] || keys['A']) delta.add(right.clone().multiplyScalar(-panSpeed));
        if (keys['d'] || keys['D']) delta.add(right.clone().multiplyScalar(panSpeed));
        if (keys['q'] || keys['Q']) delta.y += panSpeed;
        if (keys['e'] || keys['E']) delta.y -= panSpeed;

        if (delta.lengthSq() > 0) {
            this.camera.position.add(delta);
            this.controls.target.add(delta);
        }

        // Arrow keys: orbit rotation by moving camera around target
        let hasRotation = false;
        const target = this.controls.target;
        const offset = this.camera.position.clone().sub(target);
        const spherical = new THREE.Spherical().setFromVector3(offset);

        if (keys['ArrowLeft'])  { spherical.theta -= rotSpeed; hasRotation = true; }
        if (keys['ArrowRight']) { spherical.theta += rotSpeed; hasRotation = true; }
        if (keys['ArrowUp'])    { spherical.phi = Math.max(0.01, spherical.phi - rotSpeed); hasRotation = true; }
        if (keys['ArrowDown'])  { spherical.phi = Math.min(Math.PI - 0.01, spherical.phi + rotSpeed); hasRotation = true; }

        if (hasRotation) {
            offset.setFromSpherical(spherical);
            this.camera.position.copy(target).add(offset);
            this.camera.lookAt(target);
        }
    }

    _onResize() {
        const w = this.container.clientWidth;
        const h = this.container.clientHeight;
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(w, h);
    }

    _onClick(event) {
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        this.raycaster.setFromCamera(this.mouse, this.camera);

        const intersectObjects = [];
        this.obstGroup.traverse(c => { if (c.isMesh) intersectObjects.push(c); });
        this.ventGroup.traverse(c => { if (c.isMesh) intersectObjects.push(c); });
        this.initGroup.traverse(c => { if (c.isMesh) intersectObjects.push(c); });
        this.devcGroup.traverse(c => { if (c.isMesh) intersectObjects.push(c); });
        this.geomGroup.traverse(c => { if (c.isMesh) intersectObjects.push(c); });
        this.hvacGroup.traverse(c => { if (c.isMesh) intersectObjects.push(c); });
        this.zoneGroup.traverse(c => { if (c.isMesh) intersectObjects.push(c); });
        this.fireGroup.traverse(c => { if (c.isMesh) intersectObjects.push(c); });

        const intersects = this.raycaster.intersectObjects(intersectObjects);

        // Restore previous selection
        if (this.selectedObject && this.selectedObject._originalMaterial) {
            this.selectedObject.material = this.selectedObject._originalMaterial;
        }
        this.selectedObject = null;

        if (intersects.length > 0) {
            const obj = intersects[0].object;
            obj._originalMaterial = obj.material;
            obj.material = this.highlightMaterial;
            this.selectedObject = obj;

            // Fire event for info panel
            const detail = obj.userData;
            this.container.dispatchEvent(new CustomEvent('objectSelected', { detail }));
        } else {
            this.container.dispatchEvent(new CustomEvent('objectSelected', { detail: null }));
        }
    }

    /**
     * Load and render FDS parsed data
     */
    loadData(fdsData) {
        this.clearScene();
        this.fdsData = fdsData;
        this._computeBoundingBox();
        this._renderMeshes();
        this._renderObsts();
        this._renderVents();
        this._renderHoles();
        this._renderDevcs();
        this._renderInits();
        this._renderGeoms();
        this._renderHvacs();
        this._renderZones();
        this._renderSlcfs();
        this._renderFires();
        this._renderGrid();
        this._fitCamera();
        this._updateAxes();
    }

    clearScene() {
        this._clearGroup(this.meshGroup);
        this._clearGroup(this.obstGroup);
        this._clearGroup(this.ventGroup);
        this._clearGroup(this.holeGroup);
        this._clearGroup(this.devcGroup);
        this._clearGroup(this.initGroup);
        this._clearGroup(this.gridGroup);
        this._clearGroup(this.geomGroup);
        this._clearGroup(this.hvacGroup);
        this._clearGroup(this.zoneGroup);
        this._clearGroup(this.slcfGroup);
        this._clearGroup(this.fireGroup);
        // Drop the parsed data so getStats() reports zeros and downstream
        // panels don't render stale info after a failed/cancelled load.
        this.fdsData = null;
        this.boundingBox = null;
    }

    _clearGroup(group) {
        // Walk the whole subtree -- many renderers attach wireframes/sub-meshes
        // as children, and disposing only the top child leaks those.
        const disposeNode = (node) => {
            if (node.geometry) node.geometry.dispose();
            if (node.material) {
                if (Array.isArray(node.material)) node.material.forEach(m => m.dispose());
                else node.material.dispose();
            }
        };
        while (group.children.length > 0) {
            const child = group.children[0];
            child.traverse(disposeNode);
            group.remove(child);
        }
    }

    _computeBoundingBox() {
        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

        const allXBs = [
            ...this.fdsData.meshes.map(m => m.xb),
            ...this.fdsData.obsts.map(o => o.xb),
            ...this.fdsData.vents.filter(v => v.xb).map(v => v.xb),
        ].filter(xb => xb);

        for (const xb of allXBs) {
            minX = Math.min(minX, xb[0], xb[1]);
            maxX = Math.max(maxX, xb[0], xb[1]);
            minY = Math.min(minY, xb[2], xb[3]);
            maxY = Math.max(maxY, xb[2], xb[3]);
            minZ = Math.min(minZ, xb[4], xb[5]);
            maxZ = Math.max(maxZ, xb[4], xb[5]);
        }

        this.boundingBox = {
            min: new THREE.Vector3(minX, minZ, minY),
            max: new THREE.Vector3(maxX, maxZ, maxY),
            center: new THREE.Vector3(
                (minX + maxX) / 2,
                (minZ + maxZ) / 2,
                (minY + maxY) / 2
            ),
            size: new THREE.Vector3(
                maxX - minX,
                maxZ - minZ,
                maxY - minY
            ),
        };
    }

    /**
     * Convert FDS XB [x1,x2,y1,y2,z1,z2] to Three.js position/size
     * FDS: X=right, Y=forward, Z=up
     * Three.js: X=right, Y=up, Z=forward(towards camera)
     */
    _xbToBox(xb) {
        const x1 = xb[0], x2 = xb[1];
        const y1 = xb[2], y2 = xb[3];
        const z1 = xb[4], z2 = xb[5];

        const width = Math.abs(x2 - x1);
        const depth = Math.abs(y2 - y1);
        const height = Math.abs(z2 - z1);

        // Center position (FDS Y -> Three Z, FDS Z -> Three Y)
        const cx = (x1 + x2) / 2;
        const cy = (z1 + z2) / 2; // FDS Z -> Three.js Y
        const cz = (y1 + y2) / 2; // FDS Y -> Three.js Z

        return {
            position: new THREE.Vector3(cx, cy, cz),
            size: new THREE.Vector3(
                Math.max(width, 0.001),
                Math.max(height, 0.001),
                Math.max(depth, 0.001)
            ),
        };
    }

    /**
     * Resolve transparency for an element, checking its surface if needed
     */
    _resolveTransparency(item) {
        if (item.transparency != null) return item.transparency;
        const surfName = item.surf_id
            ? (Array.isArray(item.surf_id) ? item.surf_id[0] : item.surf_id)
            : (item.surf_ids
                ? (Array.isArray(item.surf_ids) ? item.surf_ids[0] : item.surf_ids)
                : null);
        if (surfName && this.fdsData.surfs) {
            const surf = this.fdsData.surfs[surfName];
            if (surf && surf.transparency != null) return surf.transparency;
        }
        return 1.0;
    }

    _renderMeshes() {
        for (const mesh of this.fdsData.meshes) {
            if (!mesh.xb) continue;
            const { position, size } = this._xbToBox(mesh.xb);

            // Wireframe box outline
            const boxGeo = new THREE.BoxGeometry(size.x, size.y, size.z);
            const edges = new THREE.EdgesGeometry(boxGeo);
            const line = new THREE.LineSegments(
                edges,
                new THREE.LineBasicMaterial({ color: 0x4488ff, linewidth: 2 })
            );
            line.position.copy(position);
            line.userData = { type: 'MESH', id: mesh.id, xb: mesh.xb, ijk: mesh.ijk };
            this.meshGroup.add(line);

            // Semi-transparent fill so mesh volumes are visible
            const fillMat = new THREE.MeshBasicMaterial({
                color: 0x4488ff,
                transparent: true,
                opacity: 0.03,
                side: THREE.DoubleSide,
                depthWrite: false,
            });
            const fillBox = new THREE.Mesh(boxGeo, fillMat);
            fillBox.position.copy(position);
            fillBox.userData = line.userData;
            this.meshGroup.add(fillBox);
        }
    }

    _renderObsts() {
        for (let i = 0; i < this.fdsData.obsts.length; i++) {
            const obst = this.fdsData.obsts[i];
            if (!obst.xb) continue;

            const { position, size } = this._xbToBox(obst.xb);
            const rgb = resolveFDSColor(obst, this.fdsData.surfs, [180, 180, 180]);
            const color = new THREE.Color(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255);

            // Detect thin (planar) obstructions and give them visible thickness
            const minThick = 0.02;
            const thinX = size.x < 0.001;
            const thinY = size.y < 0.001;
            const thinZ = size.z < 0.001;
            const sx = thinX ? minThick : size.x;
            const sy = thinY ? minThick : size.y;
            const sz = thinZ ? minThick : size.z;

            const opacity = this._resolveTransparency(obst);
            const isTransparent = opacity < 1;

            const geometry = new THREE.BoxGeometry(sx, sy, sz);
            const material = new THREE.MeshPhongMaterial({
                color: color,
                transparent: isTransparent,
                opacity: opacity,
                side: THREE.DoubleSide,
                depthWrite: !isTransparent,
                polygonOffset: true,
                polygonOffsetFactor: isTransparent ? -2 : 0,
                polygonOffsetUnits: isTransparent ? -2 : 0,
            });

            const box = new THREE.Mesh(geometry, material);

            // Offset transparent thin OBSTs slightly outward to avoid z-fighting
            // with opaque OBSTs on the same plane
            if (isTransparent && (thinX || thinY || thinZ)) {
                const off = 0.01;
                if (thinX) position.x += off;
                if (thinY) position.y += off;
                if (thinZ) position.z += off;
            }

            box.position.copy(position);
            box.renderOrder = isTransparent ? 1 : 0;
            box.castShadow = true;
            box.receiveShadow = true;
            box.userData = {
                type: 'OBST',
                index: i,
                id: obst.id,
                xb: obst.xb,
                surf_id: obst.surf_id,
                color: obst.color,
            };

            // Wireframe overlay
            const edgeMat = new THREE.LineBasicMaterial({ color: 0x000000, linewidth: 1 });
            const edgeGeo = new THREE.EdgesGeometry(geometry);
            const wireframe = new THREE.LineSegments(edgeGeo, edgeMat);
            box.add(wireframe);

            this.obstGroup.add(box);
        }
    }

    _renderVents() {
        // Derive overall domain extent from MESH list once for MB= vents below.
        let dx0=Infinity, dx1=-Infinity, dy0=Infinity, dy1=-Infinity, dz0=Infinity, dz1=-Infinity;
        for (const m of this.fdsData.meshes) {
            if (!m.xb) continue;
            dx0 = Math.min(dx0, m.xb[0]); dx1 = Math.max(dx1, m.xb[1]);
            dy0 = Math.min(dy0, m.xb[2]); dy1 = Math.max(dy1, m.xb[3]);
            dz0 = Math.min(dz0, m.xb[4]); dz1 = Math.max(dz1, m.xb[5]);
        }
        const haveDomain = isFinite(dx0);

        for (let i = 0; i < this.fdsData.vents.length; i++) {
            const vent = this.fdsData.vents[i];
            let xb = vent.xb;
            if (!xb && vent.mb && haveDomain) {
                // Convert MB face label to a degenerate XB on that domain face.
                switch (String(vent.mb).toUpperCase()) {
                    case 'XMIN': xb = [dx0, dx0, dy0, dy1, dz0, dz1]; break;
                    case 'XMAX': xb = [dx1, dx1, dy0, dy1, dz0, dz1]; break;
                    case 'YMIN': xb = [dx0, dx1, dy0, dy0, dz0, dz1]; break;
                    case 'YMAX': xb = [dx0, dx1, dy1, dy1, dz0, dz1]; break;
                    case 'ZMIN': xb = [dx0, dx1, dy0, dy1, dz0, dz0]; break;
                    case 'ZMAX': xb = [dx0, dx1, dy0, dy1, dz1, dz1]; break;
                }
            }
            if (!xb) continue;

            const { position, size } = this._xbToBox(xb);
            const rgb = resolveFDSColor(vent, this.fdsData.surfs, [255, 100, 50]);
            const color = new THREE.Color(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255);

            // Vents are often planar (one dimension is 0)
            const minDim = 0.015; // render thin vents as visible thin slabs
            const thinX = size.x < 0.001;
            const thinY = size.y < 0.001;
            const thinZ = size.z < 0.001;
            const sx = thinX ? minDim : size.x;
            const sy = thinY ? minDim : size.y;
            const sz = thinZ ? minDim : size.z;

            const geometry = new THREE.BoxGeometry(sx, sy, sz);
            const material = new THREE.MeshPhongMaterial({
                color: color,
                transparent: true,
                opacity: vent.transparency != null ? vent.transparency : 0.7,
                side: THREE.DoubleSide,
                polygonOffset: true,
                polygonOffsetFactor: -1,
                polygonOffsetUnits: -1,
            });

            const box = new THREE.Mesh(geometry, material);
            // Offset thin vents slightly so they don't z-fight with coplanar OBSTs
            // size: Three.js (X=FDS X, Y=FDS Z, Z=FDS Y)
            const offset = 0.008;
            if (thinX) position.x += offset;
            if (thinY) position.y += offset;
            if (thinZ) position.z += offset;
            box.position.copy(position);
            box.userData = {
                type: 'VENT',
                index: i,
                id: vent.id,
                xb: xb,
                mb: vent.mb || null,
                surf_id: vent.surf_id,
            };

            // Edge
            const edgeMat = new THREE.LineBasicMaterial({ color: 0xff4400 });
            const edgeGeo = new THREE.EdgesGeometry(geometry);
            const wireframe = new THREE.LineSegments(edgeGeo, edgeMat);
            box.add(wireframe);

            this.ventGroup.add(box);
        }
    }

    _renderHoles() {
        for (let i = 0; i < this.fdsData.holes.length; i++) {
            const hole = this.fdsData.holes[i];
            if (!hole.xb) continue;

            const { position, size } = this._xbToBox(hole.xb);

            const geometry = new THREE.BoxGeometry(size.x, size.y, size.z);
            const material = new THREE.MeshPhongMaterial({
                color: 0x00e5ff,
                transparent: true,
                opacity: 0.25,
                side: THREE.DoubleSide,
            });

            const box = new THREE.Mesh(geometry, material);
            box.position.copy(position);
            box.userData = {
                type: 'HOLE',
                index: i,
                id: hole.id,
                xb: hole.xb,
            };

            // Dashed edge
            const edgeMat = new THREE.LineDashedMaterial({
                color: 0x00b8d4,
                dashSize: 0.05,
                gapSize: 0.03,
            });
            const edgeGeo = new THREE.EdgesGeometry(geometry);
            const wireframe = new THREE.LineSegments(edgeGeo, edgeMat);
            wireframe.computeLineDistances();
            box.add(wireframe);

            this.holeGroup.add(box);
        }
    }

    _renderDevcs() {
        for (const devc of this.fdsData.devcs) {
            // XB-based DEVCs (line, plane, or volume integrals such as LAYER
            // HEIGHT, MASS FLOW) -- render as a magenta wireframe box. Thin
            // dimensions are inflated to a visible slab so planar devices
            // (e.g. flow through a duct cross-section) actually appear.
            if (!devc.xyz && devc.xb) {
                const { position, size } = this._xbToBox(devc.xb);
                const minDim = 0.02;
                const sx = Math.max(size.x, minDim);
                const sy = Math.max(size.y, minDim);
                const sz = Math.max(size.z, minDim);
                const boxGeo = new THREE.BoxGeometry(sx, sy, sz);
                const boxMat = new THREE.MeshBasicMaterial({
                    color: 0xe040fb, transparent: true, opacity: 0.15,
                    side: THREE.DoubleSide, depthWrite: false,
                });
                const box = new THREE.Mesh(boxGeo, boxMat);
                box.position.copy(position);
                const edgeMat = new THREE.LineBasicMaterial({ color: 0xe040fb });
                const edgeGeo = new THREE.EdgesGeometry(boxGeo);
                box.add(new THREE.LineSegments(edgeGeo, edgeMat));
                box.userData = {
                    type: 'DEVC',
                    subtype: 'XB',
                    id: devc.id,
                    xb: devc.xb,
                    quantity: devc.quantity,
                };
                this.devcGroup.add(box);
                continue;
            }
            if (!devc.xyz) continue;
            const x = devc.xyz[0];
            const y = devc.xyz[2]; // FDS Z -> Three Y
            const z = devc.xyz[1]; // FDS Y -> Three Z

            // Determine if this is a sprinkler (has PROP_ID referencing a sprinkler prop)
            const isSprinkler = this._isSprinklerDevc(devc);

            if (isSprinkler) {
                // Render sprinkler as a downward-pointing cone + sphere
                const group = new THREE.Group();
                group.position.set(x, y, z);

                // Deflector plate (small flat cylinder)
                const plateGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.01, 12);
                const plateMat = new THREE.MeshPhongMaterial({ color: 0xcc4444, emissive: 0x331111 });
                const plate = new THREE.Mesh(plateGeo, plateMat);
                group.add(plate);

                // Frame body (small cylinder going up)
                const frameGeo = new THREE.CylinderGeometry(0.01, 0.01, 0.08, 6);
                const frameMat = new THREE.MeshPhongMaterial({ color: 0x888888 });
                const frame = new THREE.Mesh(frameGeo, frameMat);
                frame.position.y = 0.04;
                group.add(frame);

                // Bulb (small sphere)
                const bulbGeo = new THREE.SphereGeometry(0.015, 8, 8);
                const bulbMat = new THREE.MeshPhongMaterial({ color: 0xff3333, emissive: 0x440000, transparent: true, opacity: 0.8 });
                const bulb = new THREE.Mesh(bulbGeo, bulbMat);
                bulb.position.y = -0.02;
                group.add(bulb);

                group.userData = {
                    type: 'DEVC',
                    subtype: 'SPRINKLER',
                    id: devc.id,
                    xyz: devc.xyz,
                    quantity: devc.quantity,
                    prop_id: devc.prop_id,
                };

                // Make children carry userData for raycasting
                group.traverse(child => {
                    if (child.isMesh) child.userData = group.userData;
                });

                this.devcGroup.add(group);
            } else {
                const geometry = new THREE.SphereGeometry(0.03, 8, 8);
                const material = new THREE.MeshPhongMaterial({ color: 0xe040fb, emissive: 0x3a0040 });
                const sphere = new THREE.Mesh(geometry, material);
                sphere.position.set(x, y, z);
                sphere.userData = {
                    type: 'DEVC',
                    id: devc.id,
                    xyz: devc.xyz,
                    quantity: devc.quantity,
                    prop_id: devc.prop_id,
                };

                this.devcGroup.add(sphere);
            }
        }
    }

    _isSprinklerDevc(devc) {
        // Check if the device references a sprinkler PROP
        if (devc.prop_id && this.fdsData.props) {
            const prop = this.fdsData.props[devc.prop_id];
            if (prop) {
                const q = (prop.quantity || '').toUpperCase();
                if (q.includes('SPRINKLER')) return true;
                // Check PROP ID name for sprinkler-ish keywords
                const pid = (prop.id || '').toUpperCase();
                if (pid.includes('SPRINKLER') || pid.includes('SPRK')) return true;
            }
        }
        // Check quantity directly
        const q = (devc.quantity || '').toUpperCase();
        if (q.includes('SPRINKLER')) return true;
        // Check ID
        const did = (devc.id || '').toUpperCase();
        if (did.includes('SPRINKLER') || did.includes('SPRK')) return true;
        return false;
    }

    _renderInits() {
        if (!this.fdsData.inits) return;

        for (let i = 0; i < this.fdsData.inits.length; i++) {
            const init = this.fdsData.inits[i];

            // Determine label based on PART_ID / SURF_ID
            const partId = init.part_id;
            let partInfo = null;
            let surfInfo = null;
            if (partId && this.fdsData.parts) {
                partInfo = this.fdsData.parts[partId];
                if (partInfo && partInfo.surf_id) {
                    surfInfo = this.fdsData.surfs[partInfo.surf_id];
                }
            }

            // Consistent orange for all INIT regions (matches UI icon/legend)
            const color = 0xff8800;

            if (init.xb) {
                // Volume region
                const { position, size } = this._xbToBox(init.xb);
                const geometry = new THREE.BoxGeometry(size.x, size.y, size.z);
                const material = new THREE.MeshPhongMaterial({
                    color: color,
                    transparent: true,
                    opacity: 0.4,
                    side: THREE.DoubleSide,
                });
                const box = new THREE.Mesh(geometry, material);
                box.position.copy(position);
                box.userData = {
                    type: 'INIT',
                    index: i,
                    id: init.id,
                    xb: init.xb,
                    part_id: init.part_id,
                };

                // Dashed wireframe
                const edgeMat = new THREE.LineDashedMaterial({
                    color: color,
                    dashSize: 0.04,
                    gapSize: 0.02,
                });
                const edgeGeo = new THREE.EdgesGeometry(geometry);
                const wireframe = new THREE.LineSegments(edgeGeo, edgeMat);
                wireframe.computeLineDistances();
                box.add(wireframe);

                this.initGroup.add(box);
            } else if (init.xyz) {
                // Point source
                const x = init.xyz[0];
                const y = init.xyz[2]; // FDS Z -> Three Y
                const z = init.xyz[1]; // FDS Y -> Three Z

                const geometry = new THREE.SphereGeometry(0.04, 8, 8);
                const material = new THREE.MeshPhongMaterial({ color: color, emissive: 0x221100 });
                const sphere = new THREE.Mesh(geometry, material);
                sphere.position.set(x, y, z);
                sphere.userData = {
                    type: 'INIT',
                    index: i,
                    id: init.id,
                    xyz: init.xyz,
                    part_id: init.part_id,
                };
                this.initGroup.add(sphere);
            }
        }
    }

    _renderGeoms() {
        if (!this.fdsData.geoms) return;

        for (let i = 0; i < this.fdsData.geoms.length; i++) {
            const geom = this.fdsData.geoms[i];
            const rgb = resolveFDSColor(geom, this.fdsData.surfs, [100, 200, 255]);
            const color = new THREE.Color(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255);

            if (geom.sphere_origin && geom.sphere_radius) {
                // Sphere geometry
                const o = geom.sphere_origin;
                const r = geom.sphere_radius;
                const geometry = new THREE.SphereGeometry(r, 24, 16);
                const material = new THREE.MeshPhongMaterial({
                    color: color,
                    transparent: true,
                    opacity: 0.6,
                    side: THREE.DoubleSide,
                });
                const sphere = new THREE.Mesh(geometry, material);
                sphere.position.set(o[0], o[2], o[1]); // FDS Y→Three Z, FDS Z→Three Y
                sphere.userData = {
                    type: 'GEOM',
                    subtype: 'SPHERE',
                    id: geom.id,
                    sphere_origin: geom.sphere_origin,
                    sphere_radius: geom.sphere_radius,
                    surf_id: geom.surf_id,
                };

                // Wireframe overlay
                const wireMat = new THREE.MeshBasicMaterial({ color: color, wireframe: true, transparent: true, opacity: 0.3 });
                const wireframe = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16), wireMat);
                sphere.add(wireframe);

                this.geomGroup.add(sphere);

            } else if (geom.cylinder_origin && geom.cylinder_radius && geom.cylinder_length) {
                // Cylinder primitive (FDS UG Sec. 7.3.6)
                // Three.js CylinderGeometry default axis is Y; we rotate it
                // to match CYLINDER_AXIS, which is given in FDS coords.
                const o = geom.cylinder_origin;
                const r = geom.cylinder_radius;
                const L = geom.cylinder_length;
                const axisFDS = (geom.cylinder_axis && geom.cylinder_axis.length === 3)
                    ? geom.cylinder_axis
                    : [0, 0, 1]; // safe default: axis along FDS Z
                const nTheta = geom.cylinder_nseg_theta || 24;
                const nAxis  = geom.cylinder_nseg_axis  || 1;

                const geometry = new THREE.CylinderGeometry(r, r, L, nTheta, nAxis, false);
                const material = new THREE.MeshPhongMaterial({
                    color: color,
                    transparent: true,
                    opacity: 0.6,
                    side: THREE.DoubleSide,
                });
                const cyl = new THREE.Mesh(geometry, material);

                // Map FDS axis (xf, yf, zf) -> Three axis (xf, zf, yf)
                const axisThree = new THREE.Vector3(axisFDS[0], axisFDS[2], axisFDS[1]).normalize();
                const defaultAxis = new THREE.Vector3(0, 1, 0);
                if (axisThree.lengthSq() > 0 && Math.abs(1 - axisThree.dot(defaultAxis)) > 1e-9) {
                    const quat = new THREE.Quaternion().setFromUnitVectors(defaultAxis, axisThree);
                    cyl.setRotationFromQuaternion(quat);
                }

                cyl.position.set(o[0], o[2], o[1]); // FDS Y->Three Z, FDS Z->Three Y
                cyl.userData = {
                    type: 'GEOM',
                    subtype: 'CYLINDER',
                    id: geom.id,
                    cylinder_origin: geom.cylinder_origin,
                    cylinder_axis: axisFDS,
                    cylinder_radius: r,
                    cylinder_length: L,
                    surf_id: geom.surf_id,
                };

                const wireMat = new THREE.LineBasicMaterial({ color: 0x64c8ff, transparent: true, opacity: 0.4 });
                const wireGeo = new THREE.WireframeGeometry(geometry);
                const wireframe = new THREE.LineSegments(wireGeo, wireMat);
                cyl.add(wireframe);

                this.geomGroup.add(cyl);

            } else if (geom.zvals && geom.ijk && geom.xb) {
                // Terrain heightmap: ZVALS with IJK=[NI,NJ] and XB=[x1,x2,y1,y2]
                const zvals = Array.isArray(geom.zvals) ? geom.zvals : [];
                const ni = geom.ijk[0]; // number of X points
                const nj = geom.ijk[1]; // number of Y points
                const xb = geom.xb;
                const x1 = xb[0], x2 = xb[1], y1 = xb[2], y2 = xb[3];

                if (zvals.length >= ni * nj && ni >= 2 && nj >= 2) {
                    const geometry = new THREE.BufferGeometry();
                    const positions = [];
                    const indices = [];

                    // Build vertex grid: ZVALS are stored row by row (j varies, then i)
                    // FDS convention: ZVALS(i,j) with j=1..NJ for each i=1..NI
                    for (let j = 0; j < nj; j++) {
                        for (let k = 0; k < ni; k++) {
                            const x = x1 + (x2 - x1) * k / (ni - 1);
                            const y = y1 + (y2 - y1) * j / (nj - 1);
                            const z = zvals[j * ni + k];
                            positions.push(x, z, y); // FDS Y→Three Z, FDS Z→Three Y
                        }
                    }

                    // Build triangle indices
                    for (let j = 0; j < nj - 1; j++) {
                        for (let k = 0; k < ni - 1; k++) {
                            const a = j * ni + k;
                            const b = a + 1;
                            const c = a + ni;
                            const d = c + 1;
                            indices.push(a, c, b);
                            indices.push(b, c, d);
                        }
                    }

                    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
                    geometry.setIndex(indices);
                    geometry.computeVertexNormals();

                    const material = new THREE.MeshPhongMaterial({
                        color: color,
                        transparent: true,
                        opacity: 0.7,
                        side: THREE.DoubleSide,
                    });
                    const mesh = new THREE.Mesh(geometry, material);
                    mesh.userData = {
                        type: 'GEOM',
                        subtype: 'TERRAIN',
                        id: geom.id,
                        surf_id: geom.surf_id,
                        ijk: geom.ijk,
                    };

                    const wireMat = new THREE.LineBasicMaterial({ color: 0x64c8ff, transparent: true, opacity: 0.3 });
                    const wireGeo = new THREE.WireframeGeometry(geometry);
                    const wireframe = new THREE.LineSegments(wireGeo, wireMat);
                    mesh.add(wireframe);

                    this.geomGroup.add(mesh);
                }

            } else if (geom.xb && geom.xb.length >= 6) {
                // Block geometry (same as OBST but for GEOM)
                const { position, size } = this._xbToBox(geom.xb);
                const geometry = new THREE.BoxGeometry(size.x, size.y, size.z);
                const material = new THREE.MeshPhongMaterial({
                    color: color,
                    transparent: true,
                    opacity: 0.6,
                    side: THREE.DoubleSide,
                });
                const box = new THREE.Mesh(geometry, material);
                box.position.copy(position);
                box.userData = {
                    type: 'GEOM',
                    subtype: 'BLOCK',
                    id: geom.id,
                    xb: geom.xb,
                    surf_id: geom.surf_id,
                };

                const edgeMat = new THREE.LineBasicMaterial({ color: 0x64c8ff });
                const edgeGeo = new THREE.EdgesGeometry(geometry);
                const wireframe = new THREE.LineSegments(edgeGeo, edgeMat);
                box.add(wireframe);

                this.geomGroup.add(box);

            } else if (geom.verts && geom.faces) {
                // Triangulated mesh
                const verts = Array.isArray(geom.verts) ? geom.verts : [];
                const faces = Array.isArray(geom.faces) ? geom.faces : [];

                // FDS User Guide Sec. 7.3.2 mandates 4 ints per face
                // (v1, v2, v3, surf_id_index), so default to stride 4 whenever
                // the integer count divides evenly. Only fall back to stride 3
                // if the length is divisible by 3 but not by 4 (a stride-3
                // file is technically invalid FDS, but we still render it on
                // a best-effort basis).
                let stride = 4;
                if (faces.length % 4 !== 0) {
                    stride = (faces.length % 3 === 0) ? 3 : 4;
                }

                if (verts.length >= 9 && faces.length >= stride) {
                    const geometry = new THREE.BufferGeometry();
                    const vertices = [];
                    const indices = [];

                    for (let v = 0; v < verts.length; v += 3) {
                        vertices.push(verts[v], verts[v + 2], verts[v + 1]);
                    }

                    for (let f = 0; f < faces.length; f += stride) {
                        indices.push(faces[f] - 1, faces[f + 1] - 1, faces[f + 2] - 1);
                    }

                    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
                    geometry.setIndex(indices);
                    geometry.computeVertexNormals();

                    const material = new THREE.MeshPhongMaterial({
                        color: color,
                        transparent: true,
                        opacity: 0.7,
                        side: THREE.DoubleSide,
                    });
                    const mesh = new THREE.Mesh(geometry, material);
                    mesh.userData = {
                        type: 'GEOM',
                        subtype: 'TRIMESH',
                        id: geom.id,
                        surf_id: geom.surf_id,
                    };

                    const wireMat = new THREE.LineBasicMaterial({ color: 0x64c8ff, transparent: true, opacity: 0.4 });
                    const wireGeo = new THREE.WireframeGeometry(geometry);
                    const wireframe = new THREE.LineSegments(wireGeo, wireMat);
                    mesh.add(wireframe);

                    this.geomGroup.add(mesh);
                }

            } else if (geom.verts && geom.poly && geom.extrude) {
                // Extruded polygon: VERTS defines 2D outline points (x,y,z), POLY is vertex order, EXTRUDE is thickness
                const verts = Array.isArray(geom.verts) ? geom.verts : [];
                const poly = Array.isArray(geom.poly) ? geom.poly : [];
                const extrudeDist = geom.extrude;

                if (verts.length >= 9 && poly.length >= 3 && extrudeDist) {
                    // Get polygon vertices in order
                    const polyVerts = [];
                    for (const idx of poly) {
                        const vi = (idx - 1) * 3; // 1-based
                        if (vi + 2 < verts.length) {
                            polyVerts.push({ x: verts[vi], y: verts[vi + 1], z: verts[vi + 2] });
                        }
                    }

                    if (polyVerts.length >= 3) {
                        // Compute extrude direction: use polygon normal
                        // Cross product of first two edges
                        const e1 = { x: polyVerts[1].x - polyVerts[0].x, y: polyVerts[1].y - polyVerts[0].y, z: polyVerts[1].z - polyVerts[0].z };
                        const e2 = { x: polyVerts[2].x - polyVerts[0].x, y: polyVerts[2].y - polyVerts[0].y, z: polyVerts[2].z - polyVerts[0].z };
                        let nx = e1.y * e2.z - e1.z * e2.y;
                        let ny = e1.z * e2.x - e1.x * e2.z;
                        let nz = e1.x * e2.y - e1.y * e2.x;
                        const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
                        if (len > 0) { nx /= len; ny /= len; nz /= len; }

                        const dx = nx * extrudeDist;
                        const dy = ny * extrudeDist;
                        const dz = nz * extrudeDist;

                        const geometry = new THREE.BufferGeometry();
                        const positions = [];
                        const indices = [];
                        const n = polyVerts.length;

                        // Bottom face vertices (0..n-1)
                        for (const v of polyVerts) {
                            positions.push(v.x, v.z, v.y); // FDS Y→Three Z, FDS Z→Three Y
                        }
                        // Top face vertices (n..2n-1)
                        for (const v of polyVerts) {
                            positions.push(v.x + dx, v.z + dz, v.y + dy);
                        }

                        // Triangulate bottom face using ear-clipping (handles concave polygons)
                        const normal = { x: nx, y: ny, z: nz };
                        const triIdx = triangulatePolygon(polyVerts, normal);
                        for (let t = 0; t < triIdx.length; t += 3) {
                            indices.push(triIdx[t], triIdx[t + 1], triIdx[t + 2]);
                        }
                        // Triangulate top face (reverse winding)
                        for (let t = 0; t < triIdx.length; t += 3) {
                            indices.push(n + triIdx[t], n + triIdx[t + 2], n + triIdx[t + 1]);
                        }
                        // Side faces
                        for (let j = 0; j < n; j++) {
                            const j2 = (j + 1) % n;
                            indices.push(j, j2, n + j2);
                            indices.push(j, n + j2, n + j);
                        }

                        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
                        geometry.setIndex(indices);
                        geometry.computeVertexNormals();

                        const material = new THREE.MeshPhongMaterial({
                            color: color,
                            transparent: true,
                            opacity: 0.6,
                            side: THREE.DoubleSide,
                        });
                        const mesh = new THREE.Mesh(geometry, material);
                        mesh.userData = {
                            type: 'GEOM',
                            subtype: 'EXTRUDED_POLY',
                            id: geom.id,
                            surf_id: geom.surf_id,
                            extrude: geom.extrude,
                        };

                        const wireMat = new THREE.LineBasicMaterial({ color: 0x64c8ff, transparent: true, opacity: 0.4 });
                        const wireGeo = new THREE.WireframeGeometry(geometry);
                        const wireframe = new THREE.LineSegments(wireGeo, wireMat);
                        mesh.add(wireframe);

                        this.geomGroup.add(mesh);
                    }
                }
            }
        }
    }

    _renderHvacs() {
        if (!this.fdsData.hvacs) return;

        // Build a vent lookup by ID to resolve node positions from VENT_ID
        const ventLookup = {};
        for (const vent of this.fdsData.vents) {
            if (vent.id && vent.xb) {
                // Center of the vent
                ventLookup[vent.id] = [
                    (vent.xb[0] + vent.xb[1]) / 2,
                    (vent.xb[2] + vent.xb[3]) / 2,
                    (vent.xb[4] + vent.xb[5]) / 2,
                ];
            }
        }

        // Collect nodes and ducts
        const nodes = {};
        const ducts = [];

        for (const hvac of this.fdsData.hvacs) {
            const type = (hvac.type_id || '').toUpperCase();

            if (type === 'NODE') {
                // Resolve XYZ: explicit XYZ, or from VENT_ID center
                let xyz = hvac.xyz;
                if (!xyz && hvac.vent_id && ventLookup[hvac.vent_id]) {
                    xyz = ventLookup[hvac.vent_id];
                }

                const nodeEntry = { ...hvac, xyz };
                nodes[hvac.id] = nodeEntry;

                if (xyz) {
                    const x = xyz[0];
                    const y = xyz[2]; // FDS Z → Three Y
                    const z = xyz[1]; // FDS Y → Three Z

                    const nodeColor = 0xffaa00;
                    const geometry = new THREE.SphereGeometry(0.08, 12, 8);
                    const material = new THREE.MeshPhongMaterial({
                        color: nodeColor,
                        emissive: hvac.ambient ? 0x114422 : 0x442200,
                    });
                    const sphere = new THREE.Mesh(geometry, material);
                    sphere.position.set(x, y, z);
                    sphere.userData = {
                        type: 'HVAC',
                        subtype: 'NODE',
                        id: hvac.id,
                        xyz: xyz,
                        ambient: hvac.ambient,
                        vent_id: hvac.vent_id,
                    };
                    this.hvacGroup.add(sphere);
                }

            } else if (type === 'DUCT') {
                ducts.push(hvac);
            }
        }

        // Render duct connections
        for (const duct of ducts) {
            const nodeIds = duct.node_id;
            if (!nodeIds) continue;

            const nids = Array.isArray(nodeIds) ? nodeIds : [nodeIds];
            if (nids.length < 2) continue;

            const n1 = nodes[nids[0]];
            const n2 = nodes[nids[1]];
            if (!n1 || !n1.xyz || !n2 || !n2.xyz) continue;

            const points = [];
            points.push(new THREE.Vector3(n1.xyz[0], n1.xyz[2], n1.xyz[1]));

            // Add waypoints if present
            if (duct.waypoints) {
                const wp = Array.isArray(duct.waypoints) ? duct.waypoints : [];
                for (let w = 0; w < wp.length; w += 3) {
                    if (w + 2 < wp.length) {
                        points.push(new THREE.Vector3(wp[w], wp[w + 2], wp[w + 1]));
                    }
                }
            }

            points.push(new THREE.Vector3(n2.xyz[0], n2.xyz[2], n2.xyz[1]));

            // Draw duct as a thick line
            const linePath = new THREE.Line(
                new THREE.BufferGeometry().setFromPoints(points),
                new THREE.LineBasicMaterial({ color: 0xffaa00, linewidth: 2 })
            );
            linePath.userData = {
                type: 'HVAC',
                subtype: 'DUCT',
                id: duct.id,
                node_id: nids,
            };
            this.hvacGroup.add(linePath);

            // Render duct as tube for better visibility
            if (points.length >= 2) {
                const radius = duct.diameter ? duct.diameter / 2 : (duct.area ? Math.sqrt(duct.area / Math.PI) : 0.05);
                const tubeRadius = Math.min(radius, 0.3);
                const curve = new THREE.CatmullRomCurve3(points);
                const tubeGeo = new THREE.TubeGeometry(curve, Math.max(points.length * 4, 8), tubeRadius, 8, false);
                const tubeMat = new THREE.MeshPhongMaterial({
                    color: 0xffaa00,
                    transparent: true,
                    opacity: 0.35,
                    side: THREE.DoubleSide,
                });
                const tube = new THREE.Mesh(tubeGeo, tubeMat);
                tube.userData = linePath.userData;
                this.hvacGroup.add(tube);
            }
        }
    }

    _renderZones() {
        if (!this.fdsData.zones) return;

        const zoneColors = [0x8866ff, 0x66ff88, 0xff6688, 0x88ffff, 0xffff66];

        for (let i = 0; i < this.fdsData.zones.length; i++) {
            const zone = this.fdsData.zones[i];
            if (!zone.xb) continue;

            const { position, size } = this._xbToBox(zone.xb);
            const zoneColor = zoneColors[i % zoneColors.length];

            const geometry = new THREE.BoxGeometry(size.x, size.y, size.z);
            const material = new THREE.MeshPhongMaterial({
                color: zoneColor,
                transparent: true,
                opacity: 0.12,
                side: THREE.DoubleSide,
                depthWrite: false,
            });
            const box = new THREE.Mesh(geometry, material);
            box.position.copy(position);
            box.userData = {
                type: 'ZONE',
                id: zone.id,
                xb: zone.xb,
            };

            // Dashed edge
            const edgeMat = new THREE.LineDashedMaterial({
                color: zoneColor,
                dashSize: 0.1,
                gapSize: 0.05,
                linewidth: 2,
            });
            const edgeGeo = new THREE.EdgesGeometry(geometry);
            const wireframe = new THREE.LineSegments(edgeGeo, edgeMat);
            wireframe.computeLineDistances();
            box.add(wireframe);

            this.zoneGroup.add(box);
        }
    }

    _renderSlcfs() {
        if (!this.fdsData.slcfs) return;

        // We need mesh extents for PBX/PBY/PBZ planes
        let domainXB = null;
        if (this.fdsData.meshes.length > 0) {
            let x1 = Infinity, x2 = -Infinity, y1 = Infinity, y2 = -Infinity, z1 = Infinity, z2 = -Infinity;
            for (const m of this.fdsData.meshes) {
                if (!m.xb) continue;
                x1 = Math.min(x1, m.xb[0]); x2 = Math.max(x2, m.xb[1]);
                y1 = Math.min(y1, m.xb[2]); y2 = Math.max(y2, m.xb[3]);
                z1 = Math.min(z1, m.xb[4]); z2 = Math.max(z2, m.xb[5]);
            }
            domainXB = [x1, x2, y1, y2, z1, z2];
        }

        const slcfColor = 0x22dd88;

        for (let i = 0; i < this.fdsData.slcfs.length; i++) {
            const slcf = this.fdsData.slcfs[i];

            let planeXB = null;

            if (slcf.pbx != null && domainXB) {
                // YZ plane at x = pbx
                planeXB = [slcf.pbx, slcf.pbx, domainXB[2], domainXB[3], domainXB[4], domainXB[5]];
            } else if (slcf.pby != null && domainXB) {
                // XZ plane at y = pby
                planeXB = [domainXB[0], domainXB[1], slcf.pby, slcf.pby, domainXB[4], domainXB[5]];
            } else if (slcf.pbz != null && domainXB) {
                // XY plane at z = pbz
                planeXB = [domainXB[0], domainXB[1], domainXB[2], domainXB[3], slcf.pbz, slcf.pbz];
            } else if (slcf.xb) {
                planeXB = slcf.xb;
            }

            if (!planeXB) continue;

            const { position, size } = this._xbToBox(planeXB);

            // Give zero-thickness planes a small thickness for visibility
            const minDim = 0.008;
            const sx = size.x < 0.001 ? minDim : size.x;
            const sy = size.y < 0.001 ? minDim : size.y;
            const sz = size.z < 0.001 ? minDim : size.z;

            const geometry = new THREE.BoxGeometry(sx, sy, sz);
            const material = new THREE.MeshBasicMaterial({
                color: slcfColor,
                transparent: true,
                opacity: 0.1,
                side: THREE.DoubleSide,
                depthWrite: false,
            });
            const plane = new THREE.Mesh(geometry, material);
            plane.position.copy(position);
            plane.userData = {
                type: 'SLCF',
                id: slcf.id,
                quantity: slcf.quantity,
                pbx: slcf.pbx,
                pby: slcf.pby,
                pbz: slcf.pbz,
                xb: planeXB,
            };

            // Edge
            const edgeMat = new THREE.LineBasicMaterial({
                color: slcfColor,
                transparent: true,
                opacity: 0.4,
            });
            const edgeGeo = new THREE.EdgesGeometry(geometry);
            const wireframe = new THREE.LineSegments(edgeGeo, edgeMat);
            plane.add(wireframe);

            this.slcfGroup.add(plane);
        }
    }

    _renderFires() {
        // Identify and highlight all fire sources in the model
        // Fire types:
        // 1. VENTs with SURF_ID pointing to a SURF with HRRPUA > 0
        // 2. VENTs with SURF_ID pointing to a SURF with MLRPUA > 0
        // 3. OBSTs with SURF_ID that has HRRPUA > 0
        // 4. INITs with HRRPUV > 0 (volumetric fire)
        // 5. INITs with PART_ID → PART → SURF with TMP_FRONT > threshold (ignitor)
        // 6. SURFs with E_COEFFICIENT (exponential fire)

        const fireSurfs = new Set();
        const ignitorSurfs = new Set();

        // Identify fire surfaces
        if (this.fdsData.surfs) {
            for (const [surfId, surf] of Object.entries(this.fdsData.surfs)) {
                const p = surf._params || {};
                if (p.HRRPUA > 0 || p.MLRPUA > 0) {
                    fireSurfs.add(surfId);
                }
                if (p.TMP_FRONT > 100) {
                    ignitorSurfs.add(surfId);
                }
                if (p.E_COEFFICIENT > 0) {
                    fireSurfs.add(surfId);
                }
            }
        }

        // Fire VENTs
        for (const vent of this.fdsData.vents) {
            if (!vent.xb) continue;
            const surfName = Array.isArray(vent.surf_id) ? vent.surf_id[0] : vent.surf_id;
            if (!surfName || !fireSurfs.has(surfName)) continue;

            const { position, size } = this._xbToBox(vent.xb);
            this._addFireMarker(position, size, {
                type: 'FIRE',
                subtype: 'VENT_HRRPUA',
                id: vent.id,
                xb: vent.xb,
                surf_id: vent.surf_id,
            });
        }

        // Fire OBSTs
        for (const obst of this.fdsData.obsts) {
            if (!obst.xb) continue;
            const surfName = Array.isArray(obst.surf_id) ? obst.surf_id[0] : obst.surf_id;
            if (!surfName || !fireSurfs.has(surfName)) continue;

            const { position, size } = this._xbToBox(obst.xb);
            this._addFireMarker(position, size, {
                type: 'FIRE',
                subtype: 'OBST_BURNING',
                id: obst.id,
                xb: obst.xb,
                surf_id: obst.surf_id,
            });
        }

        // Volumetric fire (INIT with HRRPUV)
        if (this.fdsData.inits) {
            for (const init of this.fdsData.inits) {
                const p = init._params || {};
                if (p.HRRPUV > 0 && init.xb) {
                    const { position, size } = this._xbToBox(init.xb);
                    this._addFireMarker(position, size, {
                        type: 'FIRE',
                        subtype: 'INIT_HRRPUV',
                        id: init.id,
                        xb: init.xb,
                        hrrpuv: p.HRRPUV,
                    });
                }
            }
        }
    }

    _addFireMarker(position, size, userData) {
        // Add a pulsing fire-colored overlay
        const minDim = 0.02;
        const sx = Math.max(size.x, minDim);
        const sy = Math.max(size.y, minDim);
        const sz = Math.max(size.z, minDim);

        const geometry = new THREE.BoxGeometry(sx * 1.02, sy * 1.02, sz * 1.02);

        // Orange-red glow
        const material = new THREE.MeshPhongMaterial({
            color: 0xff4400,
            emissive: 0xff2200,
            emissiveIntensity: 0.5,
            transparent: true,
            opacity: 0.45,
            side: THREE.DoubleSide,
            depthWrite: false,
        });

        const box = new THREE.Mesh(geometry, material);
        box.position.copy(position);
        box.userData = userData;

        // Fire icon wireframe
        const edgeMat = new THREE.LineBasicMaterial({ color: 0xff6600 });
        const edgeGeo = new THREE.EdgesGeometry(geometry);
        const wireframe = new THREE.LineSegments(edgeGeo, edgeMat);
        box.add(wireframe);

        this.fireGroup.add(box);
    }

    _renderGrid() {
        // Render 3D grid lines on all faces for each mesh
        if (this.fdsData.meshes.length === 0) return;

        const gridColor = 0x444466;
        const material = new THREE.LineBasicMaterial({ color: gridColor });

        for (const mesh of this.fdsData.meshes) {
            const xb = mesh.xb;
            if (!xb) continue;

            const x1 = xb[0], x2 = xb[1];
            const y1 = xb[2], y2 = xb[3];
            const z1 = xb[4], z2 = xb[5];

            const ni = mesh.ijk[0], nj = mesh.ijk[1], nk = mesh.ijk[2];
            const stepX = (x2 - x1) / ni;
            const stepY = (y2 - y1) / nj;
            const stepZ = (z2 - z1) / nk;

            // Limit grid lines per mesh for performance
            const maxLines = 200;
            const skipI = Math.max(1, Math.ceil(ni / maxLines));
            const skipJ = Math.max(1, Math.ceil(nj / maxLines));
            const skipK = Math.max(1, Math.ceil(nk / maxLines));

            const points = [];

            // ── XY plane (floor at z1 and ceiling at z2) ──
            // FDS X→Three X, FDS Y→Three Z, FDS Z→Three Y
            for (const zVal of [z1, z2]) {
                // Lines along X direction
                for (let j = 0; j <= nj; j += skipJ) {
                    const yy = y1 + j * stepY;
                    points.push(new THREE.Vector3(x1, zVal, yy));
                    points.push(new THREE.Vector3(x2, zVal, yy));
                }
                // Lines along Y direction
                for (let i = 0; i <= ni; i += skipI) {
                    const xx = x1 + i * stepX;
                    points.push(new THREE.Vector3(xx, zVal, y1));
                    points.push(new THREE.Vector3(xx, zVal, y2));
                }
            }

            // ── XZ plane (front at y1 and back at y2) ──
            for (const yVal of [y1, y2]) {
                // Lines along X direction
                for (let k = 0; k <= nk; k += skipK) {
                    const zz = z1 + k * stepZ;
                    points.push(new THREE.Vector3(x1, zz, yVal));
                    points.push(new THREE.Vector3(x2, zz, yVal));
                }
                // Lines along Z direction
                for (let i = 0; i <= ni; i += skipI) {
                    const xx = x1 + i * stepX;
                    points.push(new THREE.Vector3(xx, z1, yVal));
                    points.push(new THREE.Vector3(xx, z2, yVal));
                }
            }

            // ── YZ plane (left at x1 and right at x2) ──
            for (const xVal of [x1, x2]) {
                // Lines along Y direction
                for (let k = 0; k <= nk; k += skipK) {
                    const zz = z1 + k * stepZ;
                    points.push(new THREE.Vector3(xVal, zz, y1));
                    points.push(new THREE.Vector3(xVal, zz, y2));
                }
                // Lines along Z direction
                for (let j = 0; j <= nj; j += skipJ) {
                    const yy = y1 + j * stepY;
                    points.push(new THREE.Vector3(xVal, z1, yy));
                    points.push(new THREE.Vector3(xVal, z2, yy));
                }
            }

            const geometry = new THREE.BufferGeometry().setFromPoints(points);
            const lines = new THREE.LineSegments(geometry, material);
            this.gridGroup.add(lines);
        }
    }

    _fitCamera() {
        if (!this.boundingBox) return;

        const center = this.boundingBox.center;
        const size = this.boundingBox.size;
        const maxDim = Math.max(size.x, size.y, size.z);

        this.controls.target.copy(center);

        const distance = maxDim * 1.8;
        this.camera.position.set(
            center.x + distance * 0.7,
            center.y + distance * 0.5,
            center.z + distance * 0.7
        );

        this.camera.near = maxDim * 0.001;
        this.camera.far = maxDim * 100;
        this.camera.updateProjectionMatrix();

        this.controls.update();
    }

    _updateAxes() {
        if (!this.boundingBox) return;
        const size = Math.max(this.boundingBox.size.x, this.boundingBox.size.y, this.boundingBox.size.z);
        this.axesHelper.scale.setScalar(size * 0.3);
    }

    /**
     * Toggle visibility of a layer
     */
    setVisibility(layer, visible) {
        this.visibility[layer] = visible;
        switch (layer) {
            case 'meshes': this.meshGroup.visible = visible; break;
            case 'obsts': this.obstGroup.visible = visible; break;
            case 'vents': this.ventGroup.visible = visible; break;
            case 'holes': this.holeGroup.visible = visible; break;
            case 'devcs': this.devcGroup.visible = visible; break;
            case 'inits': this.initGroup.visible = visible; break;
            case 'grid': this.gridGroup.visible = visible; break;
            case 'geoms': this.geomGroup.visible = visible; break;
            case 'hvacs': this.hvacGroup.visible = visible; break;
            case 'zones': this.zoneGroup.visible = visible; break;
            case 'slcfs': this.slcfGroup.visible = visible; break;
            case 'fires': this.fireGroup.visible = visible; break;
        }
    }

    /**
     * Set obstruction opacity
     */
    setObstOpacity(opacity) {
        this.obstGroup.traverse(child => {
            if (child.isMesh && child.material) {
                child.material.opacity = opacity;
                child.material.transparent = opacity < 1;
            }
        });
    }

    /**
     * Set background color
     */
    setBackground(color) {
        this.scene.background = new THREE.Color(color);
    }

    /**
     * Reset camera to fit all geometry
     */
    resetCamera() {
        this._fitCamera();
    }

    /**
     * Set view direction
     */
    setView(direction) {
        if (!this.boundingBox) return;
        const center = this.boundingBox.center;
        const maxDim = Math.max(this.boundingBox.size.x, this.boundingBox.size.y, this.boundingBox.size.z);
        const dist = maxDim * 2;

        this.controls.target.copy(center);

        switch (direction) {
            case 'front':
                this.camera.position.set(center.x, center.y, center.z + dist);
                break;
            case 'back':
                this.camera.position.set(center.x, center.y, center.z - dist);
                break;
            case 'left':
                this.camera.position.set(center.x - dist, center.y, center.z);
                break;
            case 'right':
                this.camera.position.set(center.x + dist, center.y, center.z);
                break;
            case 'top':
                this.camera.position.set(center.x, center.y + dist, center.z);
                break;
            case 'bottom':
                this.camera.position.set(center.x, center.y - dist, center.z);
                break;
            case 'iso':
                this.camera.position.set(
                    center.x + dist * 0.7,
                    center.y + dist * 0.5,
                    center.z + dist * 0.7
                );
                break;
        }

        this.camera.lookAt(center);
        this.controls.update();
    }

    /**
     * Get scene statistics
     */
    getStats() {
        return {
            meshes: this.fdsData ? this.fdsData.meshes.length : 0,
            obsts: this.fdsData ? this.fdsData.obsts.length : 0,
            vents: this.fdsData ? this.fdsData.vents.length : 0,
            holes: this.fdsData ? this.fdsData.holes.length : 0,
            devcs: this.fdsData ? this.fdsData.devcs.length : 0,
            inits: this.fdsData && this.fdsData.inits ? this.fdsData.inits.length : 0,
            geoms: this.fdsData && this.fdsData.geoms ? this.fdsData.geoms.length : 0,
            hvacs: this.fdsData && this.fdsData.hvacs ? this.fdsData.hvacs.length : 0,
            zones: this.fdsData && this.fdsData.zones ? this.fdsData.zones.length : 0,
            slcfs: this.fdsData && this.fdsData.slcfs ? this.fdsData.slcfs.length : 0,
            fires: this.fireGroup ? this.fireGroup.children.length : 0,
        };
    }
}
