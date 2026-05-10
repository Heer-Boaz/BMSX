import type { vec3, vec3arr, vec4, vec4arr } from '../../rompack/format';
import { clamp } from '../../common/clamp';
import { new_vec3, norm_vec3 } from '../../common/vector';

export type Mat4Float32 = Float32Array;

// Matrix convention:
// - Column-major storage (WebGL/OpenGL style)
// - Right-multiply transforms (out = A * B applies B after A)
// - Right-handed coordinate system with -Z forward for views

// Reusable scratch matrices to reduce allocations in compound M4 builders
const _M4TMP_A = new Float32Array(16);
const _M4TMP_B = new Float32Array(16);
const _M3TMP_A = new Float32Array(9);

function invertUpperLeft3Into(out: Float32Array, m: Mat4Float32): boolean {
	const a00 = m[0], a01 = m[1], a02 = m[2];
	const a10 = m[4], a11 = m[5], a12 = m[6];
	const a20 = m[8], a21 = m[9], a22 = m[10];
	const b01 = a22 * a11 - a12 * a21;
	const b11 = -a22 * a10 + a12 * a20;
	const b21 = a21 * a10 - a11 * a20;
	let det = a00 * b01 + a01 * b11 + a02 * b21;
	if (!det) {
		out.fill(0);
		return false;
	}
	det = 1 / det;
	out[0] = b01 * det;
	out[1] = (-a22 * a01 + a02 * a21) * det;
	out[2] = (a12 * a01 - a02 * a11) * det;
	out[3] = b11 * det;
	out[4] = (a22 * a00 - a02 * a20) * det;
	out[5] = (-a12 * a00 + a02 * a10) * det;
	out[6] = b21 * det;
	out[7] = (-a21 * a00 + a01 * a20) * det;
	out[8] = (a11 * a00 - a01 * a10) * det;
	return true;
}

export const M4 = {
	// ----- creation -----
	identity(): Mat4Float32 {
		const m = new Float32Array(16);
		m[0] = 1; m[5] = 1; m[10] = 1; m[15] = 1;
		return m;
	},
	setIdentity(out: Mat4Float32): Mat4Float32 {
		out[0] = 1; out[1] = 0; out[2] = 0; out[3] = 0;
		out[4] = 0; out[5] = 1; out[6] = 0; out[7] = 0;
		out[8] = 0; out[9] = 0; out[10] = 1; out[11] = 0;
		out[12] = 0; out[13] = 0; out[14] = 0; out[15] = 1;
		return out;
	},

	// ----- multiply -----
	// out = a * b   (alias-safe; avoids allocations)
	mulInto(out: Mat4Float32, a: Mat4Float32, b: Mat4Float32): Mat4Float32 {
		// Snapshot b to avoid aliasing when out === b
		const b0 = b[0],  b1 = b[1],  b2 = b[2],  b3 = b[3];
		const b4 = b[4],  b5 = b[5],  b6 = b[6],  b7 = b[7];
		const b8 = b[8],  b9 = b[9],  b10 = b[10], b11 = b[11];
		const b12 = b[12], b13 = b[13], b14 = b[14], b15 = b[15];
		for (let i = 0; i < 4; ++i) {
			const ai0 = a[i], ai1 = a[i + 4], ai2 = a[i + 8], ai3 = a[i + 12];
			out[i]      = ai0 * b0  + ai1 * b1  + ai2 * b2  + ai3 * b3;
			out[i + 4]  = ai0 * b4  + ai1 * b5  + ai2 * b6  + ai3 * b7;
			out[i + 8]  = ai0 * b8  + ai1 * b9  + ai2 * b10 + ai3 * b11;
			out[i + 12] = ai0 * b12 + ai1 * b13 + ai2 * b14 + ai3 * b15;
		}
		return out;
	},

	// Specialized affine multiply (assumes last row [0,0,0,1] for both)
	mulAffineInto(out: Mat4Float32, a: Mat4Float32, b: Mat4Float32): Mat4Float32 {
		const a00 = a[0], a01 = a[4], a02 = a[8],  a03 = a[12];
		const a10 = a[1], a11 = a[5], a12 = a[9],  a13 = a[13];
		const a20 = a[2], a21 = a[6], a22 = a[10], a23 = a[14];

		const b0 = b[0], b1 = b[1], b2 = b[2];
		const b4 = b[4], b5 = b[5], b6 = b[6];
		const b8 = b[8], b9 = b[9], b10 = b[10];
		const b12 = b[12], b13 = b[13], b14 = b[14];

		// 3x3 rotation-scale
		out[0]  = a00 * b0  + a01 * b1  + a02 * b2;
		out[4]  = a00 * b4  + a01 * b5  + a02 * b6;
		out[8]  = a00 * b8  + a01 * b9  + a02 * b10;

		out[1]  = a10 * b0  + a11 * b1  + a12 * b2;
		out[5]  = a10 * b4  + a11 * b5  + a12 * b6;
		out[9]  = a10 * b8  + a11 * b9  + a12 * b10;

		out[2]  = a20 * b0  + a21 * b1  + a22 * b2;
		out[6]  = a20 * b4  + a21 * b5  + a22 * b6;
		out[10] = a20 * b8  + a21 * b9  + a22 * b10;

		// translation
		out[12] = a00 * b12 + a01 * b13 + a02 * b14 + a03;
		out[13] = a10 * b12 + a11 * b13 + a12 * b14 + a13;
		out[14] = a20 * b12 + a21 * b13 + a22 * b14 + a23;

		out[3] = 0; out[7] = 0; out[11] = 0; out[15] = 1;
		return out;
	},
	copyInto(out: Mat4Float32, src: Mat4Float32): Mat4Float32 { out.set(src); return out; },
	transposeInto(out: Mat4Float32, a: Mat4Float32): Mat4Float32 {
		if (out === a) {
			// in-place swap upper triangle with lower triangle
			let t;
			t = a[1]; a[1] = a[4]; a[4] = t;
			t = a[2]; a[2] = a[8]; a[8] = t;
			t = a[3]; a[3] = a[12]; a[12] = t;
			t = a[6]; a[6] = a[9]; a[9] = t;
			t = a[7]; a[7] = a[13]; a[13] = t;
			t = a[11]; a[11] = a[14]; a[14] = t;
			return out;
		}
		out[0] = a[0]; out[1] = a[4]; out[2] = a[8]; out[3] = a[12];
		out[4] = a[1]; out[5] = a[5]; out[6] = a[9]; out[7] = a[13];
		out[8] = a[2]; out[9] = a[6]; out[10] = a[10]; out[11] = a[14];
		out[12] = a[3]; out[13] = a[7]; out[14] = a[11]; out[15] = a[15];
		return out;
	},

	// ----- in-place post-multiply by transforms (m = m * T/R/S) -----
	translateSelf(m: Mat4Float32, x: number, y: number, z: number): Mat4Float32 {
		m[12] += m[0] * x + m[4] * y + m[8] * z;
		m[13] += m[1] * x + m[5] * y + m[9] * z;
		m[14] += m[2] * x + m[6] * y + m[10] * z;
		m[15] += m[3] * x + m[7] * y + m[11] * z;
		return m;
	},
	scaleSelf(m: Mat4Float32, x: number, y: number, z: number): Mat4Float32 {
		m[0] *= x; m[1] *= x; m[2] *= x; m[3] *= x;
		m[4] *= y; m[5] *= y; m[6] *= y; m[7] *= y;
		m[8] *= z; m[9] *= z; m[10] *= z; m[11] *= z;
		return m;
	},
	rotateXSelf(m: Mat4Float32, r: number): Mat4Float32 {
		const c = Math.cos(r), s = Math.sin(r);
		const m4 = m[4], m5 = m[5], m6 = m[6], m7 = m[7],
			m8 = m[8], m9 = m[9], m10 = m[10], m11 = m[11];
		m[4] = m4 * c + m8 * s; m[5] = m5 * c + m9 * s; m[6] = m6 * c + m10 * s; m[7] = m7 * c + m11 * s;
		m[8] = m8 * c - m4 * s; m[9] = m9 * c - m5 * s; m[10] = m10 * c - m6 * s; m[11] = m11 * c - m7 * s;
		return m;
	},
	rotateYSelf(m: Mat4Float32, r: number): Mat4Float32 {
		const c = Math.cos(r), s = Math.sin(r);
		const m0 = m[0], m1 = m[1], m2 = m[2], m3 = m[3],
			m8 = m[8], m9 = m[9], m10 = m[10], m11 = m[11];
		m[0] = m0 * c - m8 * s; m[1] = m1 * c - m9 * s; m[2] = m2 * c - m10 * s; m[3] = m3 * c - m11 * s;
		m[8] = m0 * s + m8 * c; m[9] = m1 * s + m9 * c; m[10] = m2 * s + m10 * c; m[11] = m3 * s + m11 * c;
		return m;
	},
	rotateZSelf(m: Mat4Float32, r: number): Mat4Float32 {
		const c = Math.cos(r), s = Math.sin(r);
		const m0 = m[0], m1 = m[1], m2 = m[2], m3 = m[3],
			m4 = m[4], m5 = m[5], m6 = m[6], m7 = m[7];
		m[0] = m0 * c + m4 * s; m[1] = m1 * c + m5 * s; m[2] = m2 * c + m6 * s; m[3] = m3 * c + m7 * s;
		m[4] = m4 * c - m0 * s; m[5] = m5 * c - m1 * s; m[6] = m6 * c - m2 * s; m[7] = m7 * c - m3 * s;
		return m;
	},
	// ----- TRS helpers -----
	// Write quaternion rotation matrix into provided out (avoids alloc per call)
	quatToMat4Into(out: Mat4Float32, q: vec4arr): Mat4Float32 {
		let [x, y, z, w] = q;
		const l = Math.hypot(x, y, z, w) || 1; x /= l; y /= l; z /= l; w /= l;
		const xx = x * x, yy = y * y, zz = z * z, xy = x * y, xz = x * z, yz = y * z, wx = w * x, wy = w * y, wz = w * z;
		out[0] = 1 - 2 * (yy + zz); out[1] = 2 * (xy + wz); out[2] = 2 * (xz - wy); out[3] = 0;
		out[4] = 2 * (xy - wz); out[5] = 1 - 2 * (xx + zz); out[6] = 2 * (yz + wx); out[7] = 0;
		out[8] = 2 * (xz + wy); out[9] = 2 * (yz - wx); out[10] = 1 - 2 * (xx + yy); out[11] = 0;
		out[12] = 0; out[13] = 0; out[14] = 0; out[15] = 1;
		return out;
	},
	fromTRSInto(out: Mat4Float32, t?: [number, number, number], q?: vec4arr, s?: [number, number, number]): Mat4Float32 {
		M4.setIdentity(out);
		if (t) M4.translateSelf(out, t[0], t[1], t[2]);
		if (q) { M4.quatToMat4Into(_M4TMP_A, q); M4.mulAffineInto(out, out, _M4TMP_A); }
		if (s) M4.scaleSelf(out, s[0], s[1], s[2]);
		return out;
	},
	// ====== Mat4 helpers (column-major, right-multiply) ======
	// In-place perspective
	perspectiveInto(out: Mat4Float32, fovRad: number, aspect: number, near: number, far: number): Mat4Float32 {
		const f = 1 / Math.tan(fovRad / 2), nf = 1 / (near - far);
		out[0] = f / aspect; out[1] = 0; out[2] = 0; out[3] = 0;
		out[4] = 0; out[5] = f; out[6] = 0; out[7] = 0;
		out[8] = 0; out[9] = 0; out[10] = (far + near) * nf; out[11] = -1;
		out[12] = 0; out[13] = 0; out[14] = 2 * far * near * nf; out[15] = 0;
		return out;
	},

	orthographicInto(out: Mat4Float32, l: number, r: number, b: number, t: number, n: number, f: number): Mat4Float32 {
		const lr = 1 / (l - r), bt = 1 / (b - t), nf = 1 / (n - f);
		out[0] = -2 * lr; out[1] = 0; out[2] = 0; out[3] = 0;
		out[4] = 0; out[5] = -2 * bt; out[6] = 0; out[7] = 0;
		out[8] = 0; out[9] = 0; out[10] = 2 * nf; out[11] = 0;
		out[12] = (l + r) * lr; out[13] = (t + b) * bt; out[14] = (f + n) * nf; out[15] = 1;
		return out;
	},

	fisheyeInto(out: Mat4Float32, fovRad: number, _aspect: number, near: number, far: number): Mat4Float32 {
		const f = 1 / Math.tan(fovRad / 2);
		const nf = 1 / (near - far);
		out[0] = f; out[1] = 0; out[2] = 0; out[3] = 0;
		out[4] = 0; out[5] = f; out[6] = 0; out[7] = 0;
		out[8] = 0; out[9] = 0; out[10] = (far + near) * nf; out[11] = -1;
		out[12] = 0; out[13] = 0; out[14] = 2 * far * near * nf; out[15] = 0;
		return out;
	},

	panoramaInto(out: Mat4Float32, hfov: number, aspect: number, near: number, far: number): Mat4Float32 {
		const t = Math.tan(hfov * 0.5);
		const vfov = (Math.abs(aspect) > 1e-6) ? (2 * Math.atan(t / aspect)) : hfov;
		const sx = 1 / t;
		const sy = 1 / Math.tan(vfov * 0.5);
		const nf = 1 / (near - far);
		out[0] = sx; out[1] = 0; out[2] = 0; out[3] = 0;
		out[4] = 0; out[5] = sy; out[6] = 0; out[7] = 0;
		out[8] = 0; out[9] = 0; out[10] = (far + near) * nf; out[11] = -1;
		out[12] = 0; out[13] = 0; out[14] = 2 * far * near * nf; out[15] = 0;
		return out;
	},
	obliqueInto(out: Mat4Float32, l: number, r: number, b: number, t: number, n: number, f: number, alphaRad: number, betaRad: number): Mat4Float32 {
		// Build ortho into tmp A and shear into tmp B, then out = shear * ortho
		const lr = 1 / (l - r), bt = 1 / (b - t), nf = 1 / (n - f);
		const a = _M4TMP_A;
		a[0] = -2 * lr; a[1] = 0; a[2] = 0; a[3] = 0;
		a[4] = 0; a[5] = -2 * bt; a[6] = 0; a[7] = 0;
		a[8] = 0; a[9] = 0; a[10] = 2 * nf; a[11] = 0;
		a[12] = (l + r) * lr; a[13] = (t + b) * bt; a[14] = (f + n) * nf; a[15] = 1;
		const s = _M4TMP_B;
		s[0] = 1; s[1] = 0; s[2] = 0; s[3] = 0;
		s[4] = 0; s[5] = 1; s[6] = 0; s[7] = 0;
		s[8] = 1 / Math.tan(alphaRad); s[9] = 1 / Math.tan(betaRad); s[10] = 1; s[11] = 0;
		s[12] = 0; s[13] = 0; s[14] = 0; s[15] = 1;
		return M4.mulAffineInto(out, s as Mat4Float32, a as Mat4Float32);
	},
	asymmetricFrustumInto(out: Mat4Float32, l: number, r: number, b: number, t: number, n: number, f: number): Mat4Float32 {
		const rl = r - l, bt = t - b, fn = f - n;
		out[0] = 2 * n / rl; out[1] = 0; out[2] = 0; out[3] = 0;
		out[4] = 0; out[5] = 2 * n / bt; out[6] = 0; out[7] = 0;
		out[8] = (r + l) / rl; out[9] = (t + b) / bt; out[10] = -(f + n) / fn; out[11] = -1;
		out[12] = 0; out[13] = 0; out[14] = -2 * f * n / fn; out[15] = 0;
		return out;
	},
	isometricInto(out: Mat4Float32, scale: number = 1): Mat4Float32 {
		const sqrt2 = Math.sqrt(2), sqrt6 = Math.sqrt(6);
		out[0] = scale * sqrt2 / 2; out[1] = -scale * sqrt2 / 2; out[2] = 0; out[3] = 0;
		out[4] = scale * sqrt2 / sqrt6; out[5] = scale * sqrt2 / sqrt6; out[6] = -scale * 2 / sqrt6; out[7] = 0;
		out[8] = 0; out[9] = 0; out[10] = 0; out[11] = 0;
		out[12] = 0; out[13] = 0; out[14] = 0; out[15] = 1;
		return out;
	},
	infinitePerspectiveInto(out: Mat4Float32, fovRad: number, aspect: number, near: number): Mat4Float32 {
		const f = 1 / Math.tan(fovRad / 2);
		out[0] = f / aspect; out[1] = 0; out[2] = 0; out[3] = 0;
		out[4] = 0; out[5] = f; out[6] = 0; out[7] = 0;
		out[8] = 0; out[9] = 0; out[10] = -1; out[11] = -1;
		out[12] = 0; out[13] = 0; out[14] = -2 * near; out[15] = 0;
		return out;
	},

	// Extract per-axis scales from a TRS matrix (column-major)
	extractScale(m: Mat4Float32): [number, number, number] {
		const sx = Math.hypot(m[0], m[1], m[2]);
		const sy = Math.hypot(m[4], m[5], m[6]);
		const sz = Math.hypot(m[8], m[9], m[10]);
		return [sx, sy, sz];
	},
	maxScale(m: Mat4Float32): number { const [sx, sy, sz] = M4.extractScale(m); return Math.max(sx, sy, sz) || 1; },

		// Inverse for general affine transform (upper-left 3x3 invertible)
		invertAffineInto(out: Mat4Float32, m: Mat4Float32): Mat4Float32 {
			if (!invertUpperLeft3Into(_M3TMP_A, m)) { out.fill(0); return out; }
			const m00 = _M3TMP_A[0], m01 = _M3TMP_A[1], m02 = _M3TMP_A[2];
			const m10 = _M3TMP_A[3], m11 = _M3TMP_A[4], m12 = _M3TMP_A[5];
			const m20 = _M3TMP_A[6], m21 = _M3TMP_A[7], m22 = _M3TMP_A[8];
		out[0] = m00; out[1] = m01; out[2] = m02; out[3] = 0;
		out[4] = m10; out[5] = m11; out[6] = m12; out[7] = 0;
		out[8] = m20; out[9] = m21; out[10] = m22; out[11] = 0;
		// translation
		const tx = m[12], ty = m[13], tz = m[14];
		out[12] = -(m00 * tx + m10 * ty + m20 * tz);
		out[13] = -(m01 * tx + m11 * ty + m21 * tz);
		out[14] = -(m02 * tx + m12 * ty + m22 * tz);
		out[15] = 1;
		return out;
	},

	// General 4x4 inverse (projective safe). Returns zeroed out if singular.
	invertInto(out: Mat4Float32, a: Mat4Float32): Mat4Float32 {
		const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
		const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
		const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
		const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];

		const b00 = a00 * a11 - a01 * a10;
		const b01 = a00 * a12 - a02 * a10;
		const b02 = a00 * a13 - a03 * a10;
		const b03 = a01 * a12 - a02 * a11;
		const b04 = a01 * a13 - a03 * a11;
		const b05 = a02 * a13 - a03 * a12;
		const b06 = a20 * a31 - a21 * a30;
		const b07 = a20 * a32 - a22 * a30;
		const b08 = a20 * a33 - a23 * a30;
		const b09 = a21 * a32 - a22 * a31;
		const b10 = a21 * a33 - a23 * a31;
		const b11 = a22 * a33 - a23 * a32;

		let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
		if (!det) { out.fill(0); return out; }
		det = 1.0 / det;

		out[0]  = ( a11 * b11 - a12 * b10 + a13 * b09) * det;
		out[1]  = (-a01 * b11 + a02 * b10 - a03 * b09) * det;
		out[2]  = ( a31 * b05 - a32 * b04 + a33 * b03) * det;
		out[3]  = (-a21 * b05 + a22 * b04 - a23 * b03) * det;
		out[4]  = (-a10 * b11 + a12 * b08 - a13 * b07) * det;
		out[5]  = ( a00 * b11 - a02 * b08 + a03 * b07) * det;
		out[6]  = (-a30 * b05 + a32 * b02 - a33 * b01) * det;
		out[7]  = ( a20 * b05 - a22 * b02 + a23 * b01) * det;
		out[8]  = ( a10 * b10 - a11 * b08 + a13 * b06) * det;
		out[9]  = (-a00 * b10 + a01 * b08 - a03 * b06) * det;
		out[10] = ( a30 * b04 - a31 * b02 + a33 * b00) * det;
		out[11] = (-a20 * b04 + a21 * b02 - a23 * b00) * det;
		out[12] = (-a10 * b09 + a11 * b07 - a12 * b06) * det;
		out[13] = ( a00 * b09 - a01 * b07 + a02 * b06) * det;
		out[14] = (-a30 * b03 + a31 * b01 - a32 * b00) * det;
		out[15] = ( a20 * b03 - a21 * b01 + a22 * b00) * det;
		return out;
	},

	// LookAt view matrix (right-handed, -Z forward)
	lookAtInto(out: Mat4Float32, eye: vec3, target: vec3, up: vec3): Mat4Float32 {
		// f = normalize(target - eye)
		let fx = target.x - eye.x, fy = target.y - eye.y, fz = target.z - eye.z; {
			const l = Math.hypot(fx, fy, fz) || 1; fx /= l; fy /= l; fz /= l;
		}
		// r = normalize(cross(f, up)), with degeneracy fallback
		let rx = fy * up.z - fz * up.y;
		let ry = fz * up.x - fx * up.z;
		let rz = fx * up.y - fy * up.x;
		let rl = Math.hypot(rx, ry, rz);
		if (rl < 1e-8) {
			const alt = Math.abs(fx) < 0.99 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
			rx = fy * alt.z - fz * alt.y;
			ry = fz * alt.x - fx * alt.z;
			rz = fx * alt.y - fy * alt.x;
			rl = Math.hypot(rx, ry, rz) || 1;
		}
		rx /= rl; ry /= rl; rz /= rl;
		// u' = cross(r, f)
		const ux = ry * fz - rz * fy; const uy = rz * fx - rx * fz; const uz = rx * fy - ry * fx;
		// back = -f
		const bx = -fx, by = -fy, bz = -fz;
		return M4.viewFromBasisInto(out, eye, { x: rx, y: ry, z: rz }, { x: ux, y: uy, z: uz }, { x: bx, y: by, z: bz });
	},

	// Fast inverse for rigid transforms (orthonormal rotation + translation)
	invertRigidInto(out: Mat4Float32, m: Mat4Float32): Mat4Float32 {
		// R_inv = R^T (upper-left 3x3); t_inv = -R^T * t
		const r00 = m[0], r01 = m[1], r02 = m[2];
		const r10 = m[4], r11 = m[5], r12 = m[6];
		const r20 = m[8], r21 = m[9], r22 = m[10];
		const tx = m[12], ty = m[13], tz = m[14];
		// transpose rotation into out
		out[0] = r00; out[1] = r10; out[2] = r20; out[3] = 0;
		out[4] = r01; out[5] = r11; out[6] = r21; out[7] = 0;
		out[8] = r02; out[9] = r12; out[10] = r22; out[11] = 0;
		// translation
		out[12] = -(out[0] * tx + out[4] * ty + out[8] * tz);
		out[13] = -(out[1] * tx + out[5] * ty + out[9] * tz);
		out[14] = -(out[2] * tx + out[6] * ty + out[10] * tz);
		out[15] = 1;
		return out;
	},

	// View matrix uit volledige, orthonormale basis en positie
	viewFromBasisInto(out: Mat4Float32, pos: vec3, right: vec3, up: vec3, back: vec3): Mat4Float32 {
		out[0] = right.x; out[4] = right.y; out[8] = right.z; out[12] = -(right.x * pos.x + right.y * pos.y + right.z * pos.z);
		out[1] = up.x; out[5] = up.y; out[9] = up.z; out[13] = -(up.x * pos.x + up.y * pos.y + up.z * pos.z);
		out[2] = back.x; out[6] = back.y; out[10] = back.z; out[14] = -(back.x * pos.x + back.y * pos.y + back.z * pos.z);
		out[3] = 0; out[7] = 0; out[11] = 0; out[15] = 1; return out;
	},

	skyboxFromViewInto(out: Mat4Float32, view: Mat4Float32): Mat4Float32 {
		const a00 = view[0], a01 = view[4], a02 = view[8];
		const a10 = view[1], a11 = view[5], a12 = view[9];
		const a20 = view[2], a21 = view[6], a22 = view[10];
		const b01 = a22 * a11 - a12 * a21;
		const b11 = -a22 * a10 + a12 * a20;
		const b21 = a21 * a10 - a11 * a20;
		const invDet = 1 / (a00 * b01 + a01 * b11 + a02 * b21);
		out[0] = b01 * invDet;
		out[1] = b11 * invDet;
		out[2] = b21 * invDet;
		out[3] = 0;
		out[4] = (-a22 * a01 + a02 * a21) * invDet;
		out[5] = (a22 * a00 - a02 * a20) * invDet;
		out[6] = (-a21 * a00 + a01 * a20) * invDet;
		out[7] = 0;
		out[8] = (a12 * a01 - a02 * a11) * invDet;
		out[9] = (-a12 * a00 + a02 * a10) * invDet;
		out[10] = (a11 * a00 - a01 * a10) * invDet;
		out[11] = 0;
		out[12] = 0;
		out[13] = 0;
		out[14] = 0;
		out[15] = 1;
		return out;
	},

	// Convenience setters
	setTranslationSelf(m: Mat4Float32, x: number, y: number, z: number): Mat4Float32 { m[12] = x; m[13] = y; m[14] = z; return m; },
	getTranslation(m: Mat4Float32): [number, number, number] { return [m[12], m[13], m[14]]; },
	setRotationSelfFromQuat(m: Mat4Float32, q: vec4arr): Mat4Float32 {
		let [x, y, z, w] = q; const l = Math.hypot(x, y, z, w) || 1; x /= l; y /= l; z /= l; w /= l;
		const xx = x * x, yy = y * y, zz = z * z, xy = x * y, xz = x * z, yz = y * z, wx = w * x, wy = w * y, wz = w * z;
		m[0] = 1 - 2 * (yy + zz); m[1] = 2 * (xy + wz); m[2] = 2 * (xz - wy); m[3] = 0;
		m[4] = 2 * (xy - wz); m[5] = 1 - 2 * (xx + zz); m[6] = 2 * (yz + wx); m[7] = 0;
		m[8] = 2 * (xz + wy); m[9] = 2 * (yz - wx); m[10] = 1 - 2 * (xx + yy); m[11] = 0;
		return m;
	},

	// Extract right and up vectors from a view matrix without allocations
	viewRightUpInto(view: Mat4Float32, outRight: Float32Array, outUp: Float32Array): void {
		outRight[0] = view[0]; outRight[1] = view[4]; outRight[2] = view[8];
		outUp[0] = view[1]; outUp[1] = view[5]; outUp[2] = view[9];
	},

	affineViewEyeInto(out: Float32Array, view: Mat4Float32, inverseLinear: Mat4Float32): Float32Array {
		const tx = view[12];
		const ty = view[13];
		const tz = view[14];
		out[0] = -(inverseLinear[0] * tx + inverseLinear[4] * ty + inverseLinear[8] * tz);
		out[1] = -(inverseLinear[1] * tx + inverseLinear[5] * ty + inverseLinear[9] * tz);
		out[2] = -(inverseLinear[2] * tx + inverseLinear[6] * ty + inverseLinear[10] * tz);
		return out;
	},

		// 3x3 normal matrix (inverse-transpose)
		normal3Into(out: Float32Array, model: Mat4Float32): Float32Array {
			if (!invertUpperLeft3Into(_M3TMP_A, model)) { out.fill(0); return out; }
			out[0] = _M3TMP_A[0]; out[1] = _M3TMP_A[3]; out[2] = _M3TMP_A[6];
			out[3] = _M3TMP_A[1]; out[4] = _M3TMP_A[4]; out[5] = _M3TMP_A[7];
			out[6] = _M3TMP_A[2]; out[7] = _M3TMP_A[5]; out[8] = _M3TMP_A[8];
			return out;
		},

	// Transform helpers
	transformPoint3(out: Float32Array, m: Mat4Float32, x: number, y: number, z: number): Float32Array {
		const w = m[3] * x + m[7] * y + m[11] * z + m[15];
		const iw = w ? 1 / w : 1;
		out[0] = (m[0] * x + m[4] * y + m[8] * z + m[12]) * iw;
		out[1] = (m[1] * x + m[5] * y + m[9] * z + m[13]) * iw;
		out[2] = (m[2] * x + m[6] * y + m[10] * z + m[14]) * iw;
		return out;
	},
	transformDir3(out: Float32Array, m: Mat4Float32, x: number, y: number, z: number): Float32Array {
		out[0] = m[0] * x + m[4] * y + m[8] * z;
		out[1] = m[1] * x + m[5] * y + m[9] * z;
		out[2] = m[2] * x + m[6] * y + m[10] * z;
		return out;
	},
};

export function float32ToFloat16(val: number): number {
	const floatView = new Float32Array(1);
	const int32View = new Int32Array(floatView.buffer);
	floatView[0] = val;
	const x = int32View[0];
	const sign = (x >> 16) & 0x8000;
	const mant = x & 0x007fffff;
	let exp = (x >> 23) & 0xff;
	if (exp === 0xff) {
		if (mant !== 0) return sign | 0x7e00; // NaN
		return sign | 0x7c00; // Inf
	}
	exp = exp - 127 + 15;
	if (exp <= 0) {
		if (exp < -10) return sign; // underflow
		const m = (mant | 0x00800000) >> (1 - exp);
		return sign | (m + 0x00000fff + ((m >> 13) & 1)) >> 13;
	} else if (exp >= 0x1f) {
		return sign | 0x7c00; // overflow -> Inf
	}
	const half = sign | (exp << 10) | ((mant + 0x00000fff + ((mant >> 13) & 1)) >> 13);
	return half;
}

export function isMatrixMirrored(mat: Float32Array): boolean {
	const m00 = mat[0], m01 = mat[1], m02 = mat[2];
	const m10 = mat[4], m11 = mat[5], m12 = mat[6];
	const m20 = mat[8], m21 = mat[9], m22 = mat[10];
	const det = m00 * (m11 * m22 - m12 * m21)
		- m01 * (m10 * m22 - m12 * m20)
		+ m02 * (m10 * m21 - m11 * m20);
	return det < 0;
}

export function transformBoundingSphereCenter(out: Float32Array, matrix: Float32Array, center: vec3arr): Float32Array {
	out[0] = matrix[12] + center[0] * matrix[0] + center[1] * matrix[4] + center[2] * matrix[8];
	out[1] = matrix[13] + center[0] * matrix[1] + center[1] * matrix[5] + center[2] * matrix[9];
	out[2] = matrix[14] + center[0] * matrix[2] + center[1] * matrix[6] + center[2] * matrix[10];
	return out;
}

export function transformedBoundingSphereRadius(matrix: Float32Array, radius: number): number {
	return radius * M4.maxScale(matrix);
}

export function translationDistanceSquared(matrix: Float32Array, point: { x: number; y: number; z: number }): number {
	const dx = matrix[12] - point.x;
	const dy = matrix[13] - point.y;
	const dz = matrix[14] - point.z;
	return dx * dx + dy * dy + dz * dz;
}

export const V4 = {
	of(x = 0, y = 0, z = 0, w = 0): vec4 { return { x, y, z, w }; },
	ofArr(arr: vec4arr): vec4 { return { x: arr[0], y: arr[1], z: arr[2], w: arr[3] }; },
	// Convert union to vec4 object (no allocation if already object)
	toArr(v: vec4 | vec4arr): vec4arr { return Array.isArray(v) ? v : [v.x, v.y, v.z, v.w]; },
	toF32Arr(v: vec4 | vec4arr): Float32Array {
		const arr = this.toArr(v);
		return new Float32Array(arr);
	},
	fromF32Arr(arr: Float32Array): vec4 { return { x: arr[0], y: arr[1], z: arr[2], w: arr[3] }; },
	fromF32ArrInto(out: vec4, arr: Float32Array): vec4 { out.x = arr[0]; out.y = arr[1]; out.z = arr[2]; out.w = arr[3]; return out; },
	fromF32ArrIntoArr(out: vec4arr, arr: Float32Array): vec4arr { out[0] = arr[0]; out[1] = arr[1]; out[2] = arr[2]; out[3] = arr[3]; return out; },
	fromF32ArrToArr(arr: Float32Array): vec4arr { return (arr as unknown as vec4arr); },
};

// ====== Frustum helpers ======
export type Plane = vec4arr;
export function extractFrustumPlanes(vp: Mat4Float32): Plane[] {
	const m = vp;
	const P: Plane[] = [
		[m[3] + m[0], m[7] + m[4], m[11] + m[8], m[15] + m[12]], // left
		[m[3] - m[0], m[7] - m[4], m[11] - m[8], m[15] - m[12]], // right
		[m[3] + m[1], m[7] + m[5], m[11] + m[9], m[15] + m[13]], // bottom
		[m[3] - m[1], m[7] - m[5], m[11] - m[9], m[15] - m[13]], // top
		[m[3] + m[2], m[7] + m[6], m[11] + m[10], m[15] + m[14]], // near
		[m[3] - m[2], m[7] - m[6], m[11] - m[10], m[15] - m[14]], // far
	];
	for (const p of P) {
		const inv = 1 / Math.hypot(p[0], p[1], p[2]) || 1;
		p[0] *= inv; p[1] *= inv; p[2] *= inv; p[3] *= inv;
	}
	return P;
}
export function sphereInFrustum(planes: Plane[], center: [number, number, number], radius: number): boolean {
	const [x, y, z] = center;
	const bias = radius * 0.01;
	for (const p of planes) if (p[0] * x + p[1] * y + p[2] * z + p[3] < -(radius + bias)) return false;
	return true;
}

// Packed, allocation-free version: writes 6 planes (24 floats) into `out`
export function extractFrustumPlanesInto(out: Float32Array, vp: Mat4Float32): Float32Array {
	// out length should be >= 24
	const m = vp;
	// left
	out[0] = m[3] + m[0]; out[1] = m[7] + m[4]; out[2] = m[11] + m[8]; out[3] = m[15] + m[12];
	// right
	out[4] = m[3] - m[0]; out[5] = m[7] - m[4]; out[6] = m[11] - m[8]; out[7] = m[15] - m[12];
	// bottom
	out[8] = m[3] + m[1]; out[9] = m[7] + m[5]; out[10] = m[11] + m[9]; out[11] = m[15] + m[13];
	// top
	out[12] = m[3] - m[1]; out[13] = m[7] - m[5]; out[14] = m[11] - m[9]; out[15] = m[15] - m[13];
	// near
	out[16] = m[3] + m[2]; out[17] = m[7] + m[6]; out[18] = m[11] + m[10]; out[19] = m[15] + m[14];
	// far
	out[20] = m[3] - m[2]; out[21] = m[7] - m[6]; out[22] = m[11] - m[10]; out[23] = m[15] - m[14];

	for (let i = 0; i < 24; i += 4) {
		const nx = out[i], ny = out[i + 1], nz = out[i + 2];
		const inv = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
		out[i] *= inv; out[i + 1] *= inv; out[i + 2] *= inv; out[i + 3] *= inv;
	}
	return out;
}

// Packed frustum test against Float32Array planes (24 floats)
export function sphereInFrustumPacked(planes: Float32Array, center: ArrayLike<number>, radius: number): boolean {
	const x = center[0], y = center[1], z = center[2];
	const bias = radius * 0.01;
	for (let i = 0; i < 24; i += 4) {
		const d = planes[i] * x + planes[i + 1] * y + planes[i + 2] * z + planes[i + 3];
		if (d < -(radius + bias)) return false;
	}
	return true;
}

// ====== Quat helpers ======
export type quat = vec4;

export const Q = {
	ident(): quat {
		return { x: 0, y: 0, z: 0, w: 1 };
	},
	fromEuler(rx: number, ry: number, rz: number): quat { // XYZ order (same as rotateX, then Y, then Z in paint legacy path)
		const cx = Math.cos(rx * 0.5), sx = Math.sin(rx * 0.5);
		const cy = Math.cos(ry * 0.5), sy = Math.sin(ry * 0.5);
		const cz = Math.cos(rz * 0.5), sz = Math.sin(rz * 0.5);
		// q = qz * qy * qx (Z then Y then X intrinsic) to match rotate order; derive combined
		const qw = cz * cy * cx + sz * sy * sx;
		const qx = cz * cy * sx - sz * sy * cx;
		const qy = cz * sy * cx + sz * cy * sx;
		const qz = sz * cy * cx - cz * sy * sx;
		return { x: qx, y: qy, z: qz, w: qw };
	},
	toEuler(q: quat): [number, number, number] { // inverse of fromEuler above
		// Normalize
		const l = Math.hypot(q.x, q.y, q.z, q.w) || 1;
		const x = q.x / l, y = q.y / l, z = q.z / l, w = q.w / l;
		// Extract (XYZ intrinsic)
		// Reference derivation for ZYX; adapted to match composition used.
		const sinr = 2 * (w * x + y * z);
		const cosr = 1 - 2 * (x * x + y * y);
		const rx = Math.atan2(sinr, cosr);
		const sinp = 2 * (w * y - z * x);
		let ry: number;
		if (Math.abs(sinp) >= 1) ry = Math.sign(sinp) * (Math.PI / 2); else ry = Math.asin(sinp);
		const siny = 2 * (w * z + x * y);
		const cosy = 1 - 2 * (y * y + z * z);
		const rz = Math.atan2(siny, cosy);
		return [rx, ry, rz];
	},

	fromAxisAngle(axis: vec3, ang: number): quat {
		const a = norm_vec3(axis); const h = ang * 0.5, s = Math.sin(h);
		return { x: a.x * s, y: a.y * s, z: a.z * s, w: Math.cos(h) };
	},

	mul(a: quat, b: quat): quat {
		return {
			w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
			x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
			y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
			z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
		};
	},

	norm(q: quat): quat {
		const s = q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w;
		if (Math.abs(s - 1) < 1e-6) return { x: q.x, y: q.y, z: q.z, w: q.w };
		const inv = 1 / Math.sqrt(s || 1);
		return { x: q.x * inv, y: q.y * inv, z: q.z * inv, w: q.w * inv };
	},

	// roteer vector met quaternion
	rotateVec(q: quat, v: vec3): vec3 {
		// v' = q * (v,0) * q*
		const x = v.x, y = v.y, z = v.z;
		const qx = q.x, qy = q.y, qz = q.z, qw = q.w;
		// uv = 2 * cross(q.xyz, v)
		const uvx = 2 * (qy * z - qz * y);
		const uvy = 2 * (qz * x - qx * z);
		const uvz = 2 * (qx * y - qy * x);
		// uuv = cross(q.xyz, uv)
		const uuvx = qy * uvz - qz * uvy;
		const uuvy = qz * uvx - qx * uvz;
		const uuvz = qx * uvy - qy * uvx;
		// v' = v + uv*qw + uuv
		return { x: x + uvx * qw + uuvx, y: y + uvy * qw + uuvy, z: z + uvz * qw + uuvz };
	},

	// basisvectoren uit q (rechts-handig, -Z is forward)
	basis(q: quat): { r: vec3; u: vec3; f: vec3 } {
		const r = Q.rotateVec(q, new_vec3(1, 0, 0));
		const u = Q.rotateVec(q, new_vec3(0, 1, 0));
		const f = Q.rotateVec(q, new_vec3(0, 0, -1)); // -Z kijkrichting
		return { r: norm_vec3(r), u: norm_vec3(u), f: norm_vec3(f) };
	},

	fromBasis(fwd: vec3, up: vec3): quat { // replicate previous QuatUtil.fromBasis
		let rx = up.y * fwd.z - up.z * fwd.y;
		let ry = up.z * fwd.x - up.x * fwd.z;
		let rz = up.x * fwd.y - up.y * fwd.x;
		const rLen = Math.hypot(rx, ry, rz) || 1; rx /= rLen; ry /= rLen; rz /= rLen;
		const ux = fwd.y * rz - fwd.z * ry;
		const uy = fwd.z * rx - fwd.x * rz;
		const uz = fwd.x * ry - fwd.y * rx;
		const m00 = rx, m01 = ry, m02 = rz;
		const m10 = ux, m11 = uy, m12 = uz;
		const m20 = fwd.x, m21 = fwd.y, m22 = fwd.z;
		const tr = m00 + m11 + m22;
		let q: quat;
		if (tr > 0) { const S = Math.sqrt(tr + 1.0) * 2; q = { w: 0.25 * S, x: (m21 - m12) / S, y: (m02 - m20) / S, z: (m10 - m01) / S }; }
		else if ((m00 > m11) && (m00 > m22)) { const S = Math.sqrt(1.0 + m00 - m11 - m22) * 2; q = { w: (m21 - m12) / S, x: 0.25 * S, y: (m01 + m10) / S, z: (m02 + m20) / S }; }
		else if (m11 > m22) { const S = Math.sqrt(1.0 + m11 - m00 - m22) * 2; q = { w: (m02 - m20) / S, x: (m01 + m10) / S, y: 0.25 * S, z: (m12 + m21) / S }; }
		else { const S = Math.sqrt(1.0 + m22 - m00 - m11) * 2; q = { w: (m10 - m01) / S, x: (m02 + m20) / S, y: (m12 + m21) / S, z: 0.25 * S }; }
		return Q.norm(q);
	},

	slerp(a: quat, b: quat, t: number): quat {
		let cos = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
		let bx = b.x, by = b.y, bz = b.z, bw = b.w;
		if (cos < 0) { cos = -cos; bx = -bx; by = -by; bz = -bz; bw = -bw; }
		if (cos > 0.9995) { // near linear
			const x = a.x + (bx - a.x) * t; const y = a.y + (by - a.y) * t; const z = a.z + (bz - a.z) * t; const w = a.w + (bw - a.w) * t; return Q.norm({ x, y, z, w });
		}
			const theta = Math.acos(clamp(cos, -1, 1));
		const s = Math.sin(theta);
		const w1 = Math.sin((1 - t) * theta) / s;
		const w2 = Math.sin(t * theta) / s;
		return { x: a.x * w1 + bx * w2, y: a.y * w1 + by * w2, z: a.z * w1 + bz * w2, w: a.w * w1 + bw * w2 };
	}
};
