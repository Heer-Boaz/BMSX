import { Oriented, vec3 } from '../../rompack/rompack';
import { clamp } from '../../common/clamp';
import { extractFrustumPlanesInto, M4, Mat4Float32, Q, quat, sphereInFrustumPacked, V3 } from './math3d';

// +-------------------------------------------------------------------------------------------------------------------------------------------------------------+
// | Projectie                   | Type                    | Dieptevervorming      | Gebruikscase                 | Matrixelementen                              |
// +-------------------------------------------------------------------------------------------------------------------------------------------------------------+
// | Perspective (bestaand)      | Perspectivisch          | Ja (foreshortening)   | Realistische 3D rendering    | m[10]=(far+near)/(near-far)                  |
// | Orthographic (bestaand)     | Parallel                | Nee                   | Technische tekeningen        | m[10]=-2/(far-near), m[15]=1                 |
// | Fisheye (bestaand)          | Perspectivisch (approx) | Ja (circulair)        | Wide-angle simulatie         | m[0]=m[5]=f (ignore aspect)                  |
// | Panorama (bestaand)         | Perspectivisch (approx) | Ja (cylindrisch)      | Wide-HFOV views              | m[5]=1/tan(vfov/2) met vfov=hfov/aspect      |
// | Oblique (nieuw)             | Parallel                | Nee (shear)           | Pseudo-3D tekeningen         | Extra shear: m[8]=cotα, m[9]=cotβ            |
// | Asymmetric Perspective      | Perspectivisch          | Ja                    | VR/off-center                | m[8]=(r+l)/(r-l), asymmetrisch               |
// | Isometric (nieuw)           | Parallel (axonometrisch)| Nee                   | Games (isometrisch)          | Rotatie-scaling: m[0]=√2/2 * scale           |
// | Infinite Perspective (nieuw)| Perspectivisch          | Ja                    | Outdoor scenes               | m[10]=-1, m[14]=-2n                          |
// +-------------------------------------------------------------------------------------------------------------------------------------------------------------+
export type CameraProjectionType = 'perspective' | 'orthographic' | 'fisheye' | 'panorama' | 'oblique' | 'asymmetricFrustum' | 'isometric' | 'infinitePerspective' | 'viewFromBasis';

export class Camera implements Oriented {
	position: vec3 = V3.of(0, 0, 0);

	// Bewaar deze voor UI/serialisatie; intern sturen we met _q
	yaw = 0;
	pitch = 0;
	roll = 0;
	static readonly MAX_PITCH = Math.PI / 2 - 1e-3;

	fovDeg = 60; aspect = 1; near = 0.1; far = 1000;
	_projectionType: CameraProjectionType = 'perspective';

	private _q: quat = Q.ident();       // <-- bron van waarheid
	private _view: Mat4Float32 = new Float32Array(16);
	private _proj: Mat4Float32 = new Float32Array(16);
	private _vp: Mat4Float32 = new Float32Array(16);
	private _planesPacked: Float32Array = new Float32Array(24);
	private _skyboxView: Mat4Float32 = new Float32Array(16);
	private _tmpLookAt: Mat4Float32 = new Float32Array(16);
	private _invView: Mat4Float32 = new Float32Array(16);
	private _invProj: Mat4Float32 = new Float32Array(16);
	private _invVP: Mat4Float32 = new Float32Array(16);
	private _dirty = true;

	constructor() {
		// Initialize matrices to identity
		M4.setIdentity(this._view);
		M4.setIdentity(this._proj);
		M4.setIdentity(this._vp);
		M4.setIdentity(this._skyboxView);
		M4.setIdentity(this._tmpLookAt);
		M4.setIdentity(this._invView);
		M4.setIdentity(this._invProj);
		M4.setIdentity(this._invVP);
	}

	public get rotationQ(): quat {
		return this._q;
	}

	/** Set camera orientation quaternion directly. Optionally sync Euler for UI (default true). */
	public setRotationQ(q: quat, syncEuler: boolean = true): void {
		this._q = Q.norm(q);
		if (syncEuler) this.updateEulerFromQuat();
		this._dirty = true;
	}

	public markDirty(): void {
		this._dirty = true;
	}

	public setExternalMatrices(view: Mat4Float32, proj: Mat4Float32, eyeX: number, eyeY: number, eyeZ: number): void {
		this.position = V3.of(eyeX, eyeY, eyeZ);
		this._view.set(view);
		this._proj.set(proj);
		M4.mulInto(this._vp, this._proj, this._view);
		M4.invertRigidInto(this._invView, this._view);
		M4.invertInto(this._invProj, this._proj);
		M4.mulInto(this._invVP, this._invProj, this._invView);
		extractFrustumPlanesInto(this._planesPacked, this._vp);
		this._dirty = false;
	}

	// --- basis zonder direct Euler te gebruiken (exposed for read-only access)
	public basis(): { r: vec3; u: vec3; f: vec3 } {
		return Q.basis(this._q);
	}

	public set projectionType(type: CameraProjectionType) {
		this._projectionType = type;
		this._dirty = true;
	}

	public get projectionType(): CameraProjectionType {
		return this._projectionType;
	}

	// ====== Besturing ======

	/** Flight-sim style: rotaties rond body-assen, in volgorde: roll → pitch → yaw. */
	flightLook(dYaw: number, dPitch: number, dRoll: number = 0): void {
		let qNext = this._q;

		// 1) ROLL over huidige forward-as
		if (dRoll !== 0) {
			const f = Q.basis(qNext).f;
			const qRoll = Q.fromAxisAngle(f, dRoll);
			qNext = Q.norm(Q.mul(qRoll, qNext));
		}

		// 2) PITCH over NIEUWE right-as
		if (dPitch !== 0) {
			const r = Q.basis(qNext).r;
			const qPitch = Q.fromAxisAngle(r, dPitch);
			qNext = Q.norm(Q.mul(qPitch, qNext));
		}

		// 3) YAW over NIEUWE up-as (rudder)
		if (dYaw !== 0) {
			const u = Q.basis(qNext).u;
			const qYaw = Q.fromAxisAngle(u, dYaw);
			qNext = Q.norm(Q.mul(qYaw, qNext));
		}

		this._q = qNext;
		this.updateEulerFromQuat();   // herleid yaw/pitch/roll (pitch blijft geclamped)
		this._dirty = true;
	}

	/** Screen-space: rond actuele scherm-assen; roll delta optioneel. */
	screenLook(dYaw: number, dPitch: number, dRoll: number = 0): void {
		// Zelfde strategie: eerst yaw/pitch over huidige body-assen
		const { r, u } = this.basis();
		const qYaw = Q.fromAxisAngle(u, dYaw);
		const qPitch = Q.fromAxisAngle(r, dPitch);

		let qNext = Q.norm(Q.mul(qYaw, Q.mul(qPitch, this._q)));

		// Roll over de nieuwe forward-as (na yaw+pitch)
		if (dRoll !== 0) {
			const fNext = Q.basis(qNext).f;
			const qRoll = Q.fromAxisAngle(fNext, dRoll);
			qNext = Q.norm(Q.mul(qRoll, qNext));
		}

		this._q = qNext;
		this.updateEulerFromQuat();  // herleid en clamp
		this._dirty = true;
	}

	moveForward(d: number): void { const { f } = this.basis(); this.position = V3.add(this.position, V3.scale(f, d)); this._dirty = true; }
	strafeRight(d: number): void { const { r } = this.basis(); this.position = V3.add(this.position, V3.scale(r, d)); this._dirty = true; }
	strafeUp(d: number): void { const { u } = this.basis(); this.position = V3.add(this.position, V3.scale(u, d)); this._dirty = true; }

	setAspect(a: number) { this.aspect = a; this._dirty = true; }
	setFov(deg: number) { this.fovDeg = deg; this._dirty = true; }
	setClip(n: number, f: number) { this.near = n; this.far = f; this._dirty = true; }

	/** Orient the camera to look at a world-space target using an up vector. */
	public lookAt(target: vec3, up: vec3 = V3.of(0, 1, 0)): void {
		// Build temporary view matrix and extract basis to compute quaternion
		M4.lookAtInto(this._tmpLookAt, this.position, target, up);
		// Columns are [right, up, back]; forward = -back
		const fx = -this._tmpLookAt[8], fy = -this._tmpLookAt[9], fz = -this._tmpLookAt[10];
		const ux = this._tmpLookAt[4], uy = this._tmpLookAt[5], uz = this._tmpLookAt[6];
		const q = Q.fromBasis({ x: fx, y: fy, z: fz }, { x: ux, y: uy, z: uz });
		this.setRotationQ(q, true);
	}

	// ====== Matrices ======
	private rebuild(): void {
		const { r, u, f } = this.basis();
		const back = V3.scale(f, -1);
		M4.viewFromBasisInto(this._view, this.position, r, u, back);

		switch (this._projectionType) {
			case 'perspective':
				M4.perspectiveInto(this._proj, this.fovDeg * Math.PI / 180, this.aspect, this.near, this.far);
				break;
			case 'orthographic':
				const w = this.fovDeg, h = w / this.aspect;
				M4.orthographicInto(this._proj, -w / 2, w / 2, -h / 2, h / 2, this.near, this.far);
				break;
			case 'fisheye':
				M4.fisheyeInto(this._proj, this.fovDeg * Math.PI / 180, this.aspect, this.near, this.far);
				break;
			case 'panorama':
				M4.panoramaInto(this._proj, this.fovDeg * Math.PI / 180, this.aspect, this.near, this.far);
				break;
			case 'asymmetricFrustum':
				// Voorbeeld: M4.asymmetricFrustum(-1, 1, -0.5, 0.5, this.near, this.far);
				M4.asymmetricFrustumInto(this._proj, -this.aspect, this.aspect, -1, 1, this.near, this.far);
				break;
			case 'oblique':
				// oblique(l: number, r: number, b: number, t: number, n: number, f: number, alphaRad: number, betaRad: number):
				M4.obliqueInto(this._proj, -this.aspect, this.aspect, -1, 1, this.near, this.far, 0, 0);
				break;
			case 'isometric':
				M4.isometricInto(this._proj, .1);
				break;
			case 'infinitePerspective':
				M4.infinitePerspectiveInto(this._proj, this.fovDeg * Math.PI / 180, this.aspect, this.near);
				break;
			case 'viewFromBasis':
				M4.viewFromBasisInto(this._proj, this.position, r, u, back);
				break;
			default:
				console.error(`Unknown projection type: ${this._projectionType ?? '<undefined>'}`);
				break;
		}

		M4.mulInto(this._vp, this._proj, this._view);
		// Update inverse caches for reprojection
		M4.invertRigidInto(this._invView, this._view);
		M4.invertInto(this._invProj, this._proj);
		M4.mulInto(this._invVP, this._invProj, this._invView);
		extractFrustumPlanesInto(this._planesPacked, this._vp);
		this._dirty = false;
	}

	get view(): Mat4Float32 { if (this._dirty) this.rebuild(); return this._view; }
	get projection(): Mat4Float32 { if (this._dirty) this.rebuild(); return this._proj; }
	get viewProjection(): Mat4Float32 { if (this._dirty) this.rebuild(); return this._vp; }
	// On-demand unpacked planes for debug/compat (allocates)
	get frustumPlanes(): [number, number, number, number][] {
		if (this._dirty) this.rebuild();
		const p = this._planesPacked;
		return [
			[p[0], p[1], p[2], p[3]],
			[p[4], p[5], p[6], p[7]],
			[p[8], p[9], p[10], p[11]],
			[p[12], p[13], p[14], p[15]],
			[p[16], p[17], p[18], p[19]],
			[p[20], p[21], p[22], p[23]],
		];
	}

	get frustumPlanesPacked(): Float32Array { if (this._dirty) this.rebuild(); return this._planesPacked; }
	get skyboxView(): Mat4Float32 { return M4.skyboxFromViewInto(this._skyboxView, this.view); }
	get inverseView(): Mat4Float32 { if (this._dirty) this.rebuild(); return this._invView; }
	get inverseProjection(): Mat4Float32 { if (this._dirty) this.rebuild(); return this._invProj; }
	get inverseViewProjection(): Mat4Float32 { if (this._dirty) this.rebuild(); return this._invVP; }

	/** Efficient bundle getter to reduce repeated property access in passes. */
	public getMatrices(): { view: Mat4Float32; proj: Mat4Float32; vp: Mat4Float32; invView: Mat4Float32; invProj: Mat4Float32; invVP: Mat4Float32 } {
		if (this._dirty) this.rebuild();
		return { view: this._view, proj: this._proj, vp: this._vp, invView: this._invView, invProj: this._invProj, invVP: this._invVP };
	}

	sphereInFrustum(center: [number, number, number], radius: number): boolean {
		if (this._dirty) this.rebuild();
		return sphereInFrustumPacked(this._planesPacked, center, radius);
	}

	// ====== Euler <-> Quat sync (optioneel voor UI/serialisatie) ======

	/** Werk yaw/pitch/roll bij uit _q, consistent met syncEulerToQuat orde. */
	private updateEulerFromQuat(): void {
		// Huidige basis uit _q
		const basis = Q.basis(this._q);
		const f = basis.f; // forward
		const u = basis.u; // up

		// 1) Yaw/Pitch uit forward vector
		const newYaw = Math.atan2(f.x, -f.z);
		const newPitch = Math.asin(Math.max(-1, Math.min(1, f.y)));

		const yawUnwrapped = unwrapAngle(this.yaw, newYaw);
		const pitchClamped = clamp(newPitch, -Camera.MAX_PITCH, Camera.MAX_PITCH);

		this.yaw = yawUnwrapped;
		this.pitch = pitchClamped;

		// 2) Roll: verschil tussen "roll‑loze up" en echte up, gemeten om de forward‑as
		// Bouw q_y en q_yp (yaw dan pitch) om een referentie‑up (u0) zonder roll te krijgen
		const worldUp = V3.of(0, 1, 0);
		const q_y = Q.fromAxisAngle(worldUp, yawUnwrapped);
		const r_y = Q.basis(q_y).r; // right na yaw
		const q_yp = Q.mul(Q.fromAxisAngle(r_y, pitchClamped), q_y);

		const u0 = Q.basis(q_yp).u;      // "up" zonder roll
		// Signed angle tussen u0 en u om de f‑as:
		const cross = V3.cross(u0, u);
		const dot = V3.dot(u0, u);
		const s = V3.dot(f, cross);  // teken volgens forward
		const newRoll = Math.atan2(s, dot);

		this.roll = unwrapAngle(this.roll, newRoll);
	}
}

function unwrapAngle(prev: number, now: number): number {
	// voorkom sprong van ~±π → kies dichtstbijzijnde equivalent
	let d = now - prev;
	while (d > Math.PI) d -= 2 * Math.PI;
	while (d < -Math.PI) d += 2 * Math.PI;
	return prev + d;
}
