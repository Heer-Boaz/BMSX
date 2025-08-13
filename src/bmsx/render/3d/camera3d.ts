import { vec3 } from '../../rompack/rompack';
import { extractFrustumPlanes, M4, Mat4, Plane, sphereInFrustum, V3 } from './math3d';

export class Camera {
    // --- parameters ---
    position: vec3 = V3.of(0, 0, 0);
    yaw = 0;                        // radians, yaw=0 kijkt langs -Z
    pitch = 0;                      // radians
    static readonly MAX_PITCH = Math.PI / 2 - 1e-3;

    fovDeg = 60;
    aspect = 1;
    near = 0.1;
    far = 1000;
    perspective = true;

    // --- cached matrices ---
    private _view: Mat4 = M4.identity();
    private _proj: Mat4 = M4.identity();
    private _vp: Mat4 = M4.identity();
    private _planes: Plane[] = [];
    private _dirty = true;

    // ====== Orientation vectors (orthonormaal, no roll) ======
    forward(): vec3 {
        const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
        const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
        // yaw=0 → kijk langs -Z
        return { x: sy * cp, y: sp, z: -cy * cp };
    }
    right(): vec3 {
        const f = this.forward();
        // Flip cross: cross(f, world_up) instead of cross(world_up, f)
        const r = V3.cross(f, { x: 0, y: 1, z: 0 });
        const L = V3.len(r);
        // Fallback with flipped sign for consistency (now positive cos/sin)
        return L > 1e-6 ? V3.scale(r, 1 / L) : { x: Math.cos(this.yaw), y: 0, z: Math.sin(this.yaw) };
    }

    up(): vec3 {
        const f = this.forward();
        const r = this.right();
        // Flip cross: cross(r, f) instead of cross(f, r)
        return V3.norm(V3.cross(r, f));
    }

    // ====== Controls ======
    mouseLook(dYaw: number, dPitch: number): void {
        this.yaw += dYaw;
        this.pitch = Math.max(-Camera.MAX_PITCH, Math.min(Camera.MAX_PITCH, this.pitch + dPitch));
        this._dirty = true;
    }
    moveForward(dist: number): void {
        const f = this.forward();
        this.position = V3.add(this.position, V3.scale(f, dist));
        this._dirty = true;
    }
    strafeRight(dist: number): void {
        const r = this.right();
        this.position = V3.add(this.position, V3.scale(r, dist));
        this._dirty = true;
    }
    flyUpDown(dist: number): void {
        const u = this.up();
        this.position = V3.add(this.position, V3.scale(u, dist));
        this._dirty = true;
    }
    moveWorldUp(dist: number): void { // optioneel: pure wereld-Y
        this.position.y += dist; this._dirty = true;
    }

    setAspect(a: number) { this.aspect = a; this._dirty = true; }
    setFov(deg: number) { this.fovDeg = deg; this._dirty = true; }
    setClip(near: number, far: number) { this.near = near; this.far = far; this._dirty = true; }
    usePerspective(on = true) { this.perspective = on; this._dirty = true; }

    // ====== Matrices ======
    private rebuild(): void {
        // Basis opbouwen
        const f = this.forward();
        const r = this.right();
        const u = this.up();
        const back = V3.scale(f, -1); // camera Z wijst naar achteren

        this._view = M4.viewFromBasis(this.position, r, u, back);

        if (this.perspective) {
            this._proj = M4.perspective(this.fovDeg * Math.PI / 180, this.aspect, this.near, this.far);
        } else {
            // Ortho: fovDeg = breedte; aspect = w/h
            const w = this.fovDeg, h = w / this.aspect;
            this._proj = M4.orthographic(-w / 2, w / 2, -h / 2, h / 2, this.near, this.far);
        }

        this._vp = M4.mul(this._proj, this._view);
        this._planes = extractFrustumPlanes(this._vp);
        this._dirty = false;
    }

    get view(): Mat4 { if (this._dirty) this.rebuild(); return this._view; }
    get projection(): Mat4 { if (this._dirty) this.rebuild(); return this._proj; }
    get viewProjection(): Mat4 { if (this._dirty) this.rebuild(); return this._vp; }
    get frustumPlanes(): Plane[] { if (this._dirty) this.rebuild(); return this._planes; }

    // Skybox = alleen rotatie (geen translatie)
    skyboxView(): Mat4 { return M4.skyboxFromView(this.view); }

    // Culling
    sphereInFrustum(center: [number, number, number], radius: number): boolean {
        if (this._dirty) this.rebuild();
        return sphereInFrustum(this._planes, center, radius);
    }
}
