import { Oriented, vec3 } from '../../rompack/rompack';
import { excludepropfromsavegame, insavegame, onload, onsave } from '../../serializer/gameserializer';
import { extractFrustumPlanes, M4, Mat4, Plane, Q, quat, sphereInFrustum, V3 } from './math3d';

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

@insavegame
export class Camera implements Oriented {
	position: vec3 = V3.of(0, 0, 0);

	// Bewaar deze voor UI/serialisatie; intern sturen we met _q
	@excludepropfromsavegame
	yaw = 0;
	@excludepropfromsavegame
	pitch = 0;
	@excludepropfromsavegame
	roll = 0;
	static readonly MAX_PITCH = Math.PI / 2 - 1e-3;

	fovDeg = 60; aspect = 1; near = 0.1; far = 1000;
	_projectionType: CameraProjectionType = 'perspective';

	private _q: quat = Q.ident();       // <-- bron van waarheid
	@excludepropfromsavegame
	private _view: Mat4 = M4.identity();
	@excludepropfromsavegame
	private _proj: Mat4 = M4.identity();
	@excludepropfromsavegame
	private _vp: Mat4 = M4.identity();
	@excludepropfromsavegame
	private _planes: Plane[] = [];
	@excludepropfromsavegame
	private _dirty = true;

	constructor() {
	}

	public get rotationQ(): quat {
		return this._q;
	}

	public markDirty(): void {
		this._dirty = true;
	}

	@onload
	private onLoad(): void {
		// yaw/pitch/roll consistent afleiden uit _q voor UI
		this.updateEulerFromQuat();

		this._dirty = true;
		this.rebuild();
	}

	@onsave
	private onSave(): void {
		this.updateEulerFromQuat();
	}

	// --- basis zonder direct Euler te gebruiken
	private basis(): { r: vec3; u: vec3; f: vec3 } {
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

	// ====== Matrices ======
	private rebuild(): void {
		const { r, u, f } = this.basis();
		const back = V3.scale(f, -1);
		this._view = M4.viewFromBasis(this.position, r, u, back);

		switch (this._projectionType) {
			case 'perspective':
				this._proj = M4.perspective(this.fovDeg * Math.PI / 180, this.aspect, this.near, this.far);
				break;
			case 'orthographic':
				const w = this.fovDeg, h = w / this.aspect;
				this._proj = M4.orthographic(-w / 2, w / 2, -h / 2, h / 2, this.near, this.far);
				break;
			case 'fisheye':
				this._proj = M4.fisheye(this.fovDeg * Math.PI / 180, this.aspect, this.near, this.far);
				break;
			case 'panorama':
				this._proj = M4.panorama(this.fovDeg * Math.PI / 180, this.aspect, this.near, this.far);
				break;
			case 'asymmetricFrustum':
				// Voorbeeld: M4.asymmetricFrustum(-1, 1, -0.5, 0.5, this.near, this.far);
				this._proj = M4.asymmetricFrustum(-this.aspect, this.aspect, -1, 1, this.near, this.far);
				break;
			case 'oblique':
				// oblique(l: number, r: number, b: number, t: number, n: number, f: number, alphaRad: number, betaRad: number):
				this._proj = M4.oblique(-this.aspect, this.aspect, -1, 1, this.near, this.far, 0, 0);
				break;
			case 'isometric':
				this._proj = M4.isometric(.1);
				break;
			case 'infinitePerspective':
				this._proj = M4.infinitePerspective(this.fovDeg * Math.PI / 180, this.aspect, this.near);
				break;
			case 'viewFromBasis':
				this._proj = M4.viewFromBasis(this.position, r, u, back);
				break;
			default:
				console.error(`Unknown projection type: ${this._projectionType ?? '<undefined>'}`);
				break;
		}

		this._vp = M4.mul(this._proj, this._view);
		this._planes = extractFrustumPlanes(this._vp);
		this._dirty = false;
	}

	get view(): Mat4 { if (this._dirty) this.rebuild(); return this._view; }
	get projection(): Mat4 { if (this._dirty) this.rebuild(); return this._proj; }
	get viewProjection(): Mat4 { if (this._dirty) this.rebuild(); return this._vp; }
	get frustumPlanes(): Plane[] { if (this._dirty) this.rebuild(); return this._planes; }
	get skyboxView(): Mat4 { return M4.skyboxFromView(this.view); }

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
function clamp(x: number, a: number, b: number) { return Math.max(a, Math.min(b, x)); }
