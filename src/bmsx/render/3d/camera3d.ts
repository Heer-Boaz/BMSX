import { vec3 } from '../../rompack/rompack';
import { extractFrustumPlanes, M4, Mat4, Plane, Q, Quat, sphereInFrustum, V3 } from './math3d';

export class Camera {
    position: vec3 = V3.of(0, 0, 0);

    // Bewaar deze voor UI/serialisatie; intern sturen we met _q
    yaw = 0;
    pitch = 0;
    roll = 0;
    static readonly MAX_PITCH = Math.PI / 2 - 1e-3;

    fovDeg = 60; aspect = 1; near = 0.1; far = 1000; perspective = true;

    private _q: Quat = Q.ident();       // <-- bron van waarheid
    private _view: Mat4 = M4.identity();
    private _proj: Mat4 = M4.identity();
    private _vp: Mat4 = M4.identity();
    private _planes: Plane[] = [];
    private _dirty = true;

    constructor() {
        this.syncEulerToQuat(); // init _q vanuit yaw/pitch/roll = 0
    }

    // --- basis zonder direct Euler te gebruiken
    private basis(): { r: vec3; u: vec3; f: vec3 } {
        return Q.basis(this._q);
    }

    // ====== Besturing ======

    /** Flight-sim style: rotaties rond lokale assen (body axes). */
    mouseLook(dYaw: number, dPitch: number): void {
        const { r, u } = this.basis();
        // q' = R_u(dYaw) * R_r(dPitch) * q
        const qYaw = Q.fromAxisAngle(u, dYaw);
        const qPitch = Q.fromAxisAngle(r, dPitch);
        this._q = Q.norm(Q.mul(qYaw, Q.mul(qPitch, this._q)));
        this.updateEulerFromQuat(); // alleen voor UI/clamps
        this._dirty = true;
    }

    /** Screen-space: rond actuele scherm-assen, roll blijft exact behouden. */
    mouseLookScreen(dYaw: number, dPitch: number): void {
        const { r, u } = this.basis(); // asjes inclusief huidige roll
        const qYaw = Q.fromAxisAngle(u, dYaw);
        const qPitch = Q.fromAxisAngle(r, dPitch);
        this._q = Q.norm(Q.mul(qYaw, Q.mul(qPitch, this._q)));
        this.updateEulerFromQuat(); // werkt yaw/pitch bij zonder roll te herleiden
        this._dirty = true;
    }

    addRoll(angle: number): void {
        const { f } = this.basis();
        const qRoll = Q.fromAxisAngle(f, angle);
        this._q = Q.norm(Q.mul(qRoll, this._q));
        this.roll = wrapPi(this.roll + angle); // numeriek bijhouden voor UI, met grenzen
        this._dirty = true;
    }
    setRoll(angle: number): void {
        // zet absolute roll: verwijder eerst huidige roll, dan nieuwe toepassen
        const { f } = this.basis();
        const qUndo = Q.fromAxisAngle(f, -this.roll);
        this._q = Q.mul(qUndo, this._q);
        const qNew = Q.fromAxisAngle(f, angle);
        this._q = Q.norm(Q.mul(qNew, this._q));
        this.roll = wrapPi(angle);
        this._dirty = true;
    }

    moveForward(d: number): void { const { f } = this.basis(); this.position = V3.add(this.position, V3.scale(f, d)); this._dirty = true; }
    strafeRight(d: number): void { const { r } = this.basis(); this.position = V3.add(this.position, V3.scale(r, d)); this._dirty = true; }
    strafeUp(d: number): void { const { u } = this.basis(); this.position = V3.add(this.position, V3.scale(u, d)); this._dirty = true; }
    moveWorldUp(d: number): void { this.position.y += d; this._dirty = true; }

    setAspect(a: number) { this.aspect = a; this._dirty = true; }
    setFov(deg: number) { this.fovDeg = deg; this._dirty = true; }
    setClip(n: number, f: number) { this.near = n; this.far = f; this._dirty = true; }
    usePerspective(on = true) { this.perspective = on; this._dirty = true; }

    // ====== Matrices ======
    private rebuild(): void {
        const { r, u, f } = this.basis();
        const back = V3.scale(f, -1);
        this._view = M4.viewFromBasis(this.position, r, u, back);

        this._proj = this.perspective
            ? M4.perspective(this.fovDeg * Math.PI / 180, this.aspect, this.near, this.far)
            : (() => { const w = this.fovDeg, h = w / this.aspect; return M4.orthographic(-w / 2, w / 2, -h / 2, h / 2, this.near, this.far); })();

        this._vp = M4.mul(this._proj, this._view);
        this._planes = extractFrustumPlanes(this._vp);
        this._dirty = false;
    }

    get view(): Mat4 { if (this._dirty) this.rebuild(); return this._view; }
    get projection(): Mat4 { if (this._dirty) this.rebuild(); return this._proj; }
    get viewProjection(): Mat4 { if (this._dirty) this.rebuild(); return this._vp; }
    get frustumPlanes(): Plane[] { if (this._dirty) this.rebuild(); return this._planes; }
    skyboxView(): Mat4 { return M4.skyboxFromView(this.view); }

    sphereInFrustum(center: [number, number, number], radius: number): boolean {
        if (this._dirty) this.rebuild();
        return sphereInFrustum(this._planes, center, radius);
    }

    // ====== Euler <-> Quat sync (optioneel voor UI/serialisatie) ======

    /** Init _q vanuit huidige yaw/pitch/roll (gebruik bij constructie/reset). */
    private syncEulerToQuat(): void {
        // volgorde: yaw (world-ish), pitch (rond lokale X), roll (rond forward)
        // We bouwen hem via basis-assen:
        let q = Q.ident();
        // start met yaw om Y-wereld (redelijk voor init)
        q = Q.mul(Q.fromAxisAngle(V3.of(0, 1, 0), this.yaw), q);
        // pitch om lokale right
        const r1 = Q.basis(q).r;
        q = Q.mul(Q.fromAxisAngle(r1, this.pitch), q);
        // roll om forward
        const f1 = Q.basis(q).f;
        q = Q.mul(Q.fromAxisAngle(f1, this.roll), q);
        this._q = Q.norm(q);
        this._dirty = true;
    }

    /** Werk yaw/pitch bij uit _q zonder roll te ‘afleiden’; houd continuïteit. */
    private updateEulerFromQuat(): void {
        const { f } = this.basis();
        // Yaw = atan2(f.x, -f.z), Pitch = asin(f.y), met unwrap t.o.v. vorige waarden
        const newYaw = Math.atan2(f.x, -f.z);
        const newPitch = Math.asin(Math.max(-1, Math.min(1, f.y)));
        this.yaw = unwrapAngle(this.yaw, newYaw);
        this.pitch = clamp(newPitch, -Camera.MAX_PITCH, Camera.MAX_PITCH);
        // roll NIET wijzigen — die wordt uitsluitend via addRoll/setRoll aangepast.
    }
}

// Klein hulpspul onderaan camera.ts of in math3d.ts
function wrapPi(angle: number): number {
    while (angle > Math.PI) angle -= 2 * Math.PI;
    while (angle < -Math.PI) angle += 2 * Math.PI;
    return angle;
}
function unwrapAngle(prev: number, now: number): number {
    // voorkom sprong van ~±π → kies dichtstbijzijnde equivalent
    let d = now - prev;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return prev + d;
}
function clamp(x: number, a: number, b: number) { return Math.max(a, Math.min(b, x)); }
