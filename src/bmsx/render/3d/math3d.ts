import type { vec3 } from '../../rompack/rompack';

export type Mat4 = Float32Array;

export const bmat = {
    identity(): Mat4 {
        const out = new Float32Array(16);
        out[0] = 1; out[5] = 1; out[10] = 1; out[15] = 1;
        return out;
    },

    perspective(fov: number, aspect: number, near: number, far: number): Mat4 {
        const f = 1.0 / Math.tan(fov / 2);
        const nf = 1 / (near - far);
        const out = new Float32Array(16);
        out[0] = f / aspect;
        out[5] = f;
        out[10] = (far + near) * nf;
        out[11] = -1;
        out[14] = 2 * far * near * nf;
        return out;
    },

    lookAt(eye: [number, number, number], target: [number, number, number], up: [number, number, number]): Mat4 {
        const [ex, ey, ez] = eye;
        const [tx, ty, tz] = target;
        let [ux, uy, uz] = up;

        // Forward vector (z axis)
        let zx = ex - tx, zy = ey - ty, zz = ez - tz;
        let len = Math.hypot(zx, zy, zz) || 1;
        zx /= len; zy /= len; zz /= len;

        // Right vector (x axis)
        let xx = uy * zz - uz * zy;
        let xy = uz * zx - ux * zz;
        let xz = ux * zy - uy * zx;
        len = Math.hypot(xx, xy, xz) || 1;
        xx /= len; xy /= len; xz /= len;

        // Recompute orthogonal up vector (y axis)
        ux = zy * xz - zz * xy;
        uy = zz * xx - zx * xz;
        uz = zx * xy - zy * xx;

        const out = new Float32Array(16);
        out[0] = xx; out[1] = xy; out[2] = xz; out[3] = 0;
        out[4] = ux; out[5] = uy; out[6] = uz; out[7] = 0;
        out[8] = zx; out[9] = zy; out[10] = zz; out[11] = 0;
        out[12] = -(xx * ex + xy * ey + xz * ez);
        out[13] = -(ux * ex + uy * ey + uz * ez);
        out[14] = -(zx * ex + zy * ey + zz * ez);
        out[15] = 1;
        return out;
    },

    multiply(a: Mat4, b: Mat4): Mat4 {
        const out = new Float32Array(16);
        for (let i = 0; i < 4; ++i) {
            const ai0 = a[i], ai1 = a[i + 4], ai2 = a[i + 8], ai3 = a[i + 12];
            out[i] = ai0 * b[0] + ai1 * b[1] + ai2 * b[2] + ai3 * b[3];
            out[i + 4] = ai0 * b[4] + ai1 * b[5] + ai2 * b[6] + ai3 * b[7];
            out[i + 8] = ai0 * b[8] + ai1 * b[9] + ai2 * b[10] + ai3 * b[11];
            out[i + 12] = ai0 * b[12] + ai1 * b[13] + ai2 * b[14] + ai3 * b[15];
        }
        return out;
    },

    translate(m: Mat4, x: number, y: number, z: number): Mat4 {
        const out = this.identity();
        out[12] = x; out[13] = y; out[14] = z;
        return this.multiply(m, out);
    },

    scale(m: Mat4, x: number, y: number, z: number): Mat4 {
        const out = this.identity();
        out[0] = x; out[5] = y; out[10] = z;
        return this.multiply(m, out);
    },

    rotateX(m: Mat4, rad: number): Mat4 {
        const c = Math.cos(rad), s = Math.sin(rad);
        const out = this.identity();
        out[5] = c; out[6] = s;
        out[9] = -s; out[10] = c;
        return this.multiply(m, out);
    },

    rotateY(m: Mat4, rad: number): Mat4 {
        const c = Math.cos(rad), s = Math.sin(rad);
        const out = this.identity();
        out[0] = c; out[2] = -s;
        out[8] = s; out[10] = c;
        return this.multiply(m, out);
    },

    rotateZ(m: Mat4, rad: number): Mat4 {
        const c = Math.cos(rad), s = Math.sin(rad);
        const out = this.identity();
        out[0] = c; out[1] = s;
        out[4] = -s; out[5] = c;
        return this.multiply(m, out);
    },

    orthographic(left: number, right: number, bottom: number, top: number, near: number, far: number): Mat4 {
        const lr = 1 / (left - right);
        const bt = 1 / (bottom - top);
        const nf = 1 / (near - far);
        const out = new Float32Array(16);
        out[0] = -2 * lr;
        out[5] = -2 * bt;
        out[10] = 2 * nf;
        out[12] = (left + right) * lr;
        out[13] = (top + bottom) * bt;
        out[14] = (far + near) * nf;
        out[15] = 1;
        return out;
    },

    transpose(m: Mat4): Mat4 {
        const out = new Float32Array(16);
        out[0] = m[0]; out[1] = m[4]; out[2] = m[8]; out[3] = m[12];
        out[4] = m[1]; out[5] = m[5]; out[6] = m[9]; out[7] = m[13];
        out[8] = m[2]; out[9] = m[6]; out[10] = m[10]; out[11] = m[14];
        out[12] = m[3]; out[13] = m[7]; out[14] = m[11]; out[15] = m[15];
        return out;
    },

    invert(m: Mat4): Mat4 {
        const out = new Float32Array(16);
        const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3];
        const a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
        const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11];
        const a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];

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
        if (!det) return out.fill(0);
        det = 1.0 / det;

        out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
        out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
        out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
        out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
        out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
        out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
        out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
        out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
        out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
        out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
        out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
        out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
        out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
        out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
        out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
        out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
        return out;
    },

    normalMatrix(m: Mat4): Float32Array {
        const inv = this.invert(m);
        const trans = this.transpose(inv);
        return new Float32Array([
            trans[0], trans[1], trans[2],
            trans[4], trans[5], trans[6],
            trans[8], trans[9], trans[10],
        ]);
    }
};

export const bvec3 = {
    add(a: vec3, b: vec3): vec3 {
        return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
    },

    sub(a: vec3, b: vec3): vec3 {
        return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
    },

    scale(v: vec3, s: number): vec3 {
        return { x: v.x * s, y: v.y * s, z: v.z * s };
    },

    rotateX(v: vec3, rad: number, origin: vec3 = { x: 0, y: 0, z: 0 }): vec3 {
        const s = Math.sin(rad), c = Math.cos(rad);
        const y = v.y - origin.y;
        const z = v.z - origin.z;
        return {
            x: v.x,
            y: y * c - z * s + origin.y,
            z: y * s + z * c + origin.z
        };
    },

    rotateY(v: vec3, rad: number, origin: vec3 = { x: 0, y: 0, z: 0 }): vec3 {
        const s = Math.sin(rad), c = Math.cos(rad);
        const x = v.x - origin.x;
        const z = v.z - origin.z;
        return {
            x: x * c + z * s + origin.x,
            y: v.y,
            z: -x * s + z * c + origin.z
        };
    },

    rotateZ(v: vec3, rad: number, origin: vec3 = { x: 0, y: 0, z: 0 }): vec3 {
        const s = Math.sin(rad), c = Math.cos(rad);
        const x = v.x - origin.x;
        const y = v.y - origin.y;
        return {
            x: x * c - y * s + origin.x,
            y: x * s + y * c + origin.y,
            z: v.z
        };
    },

    length(v: vec3): number {
        return Math.hypot(v.x, v.y, v.z);
    },

    normalize(v: vec3): vec3 {
        const len = this.length(v) || 1;
        return { x: v.x / len, y: v.y / len, z: v.z / len };
    },

    cross(a: vec3, b: vec3): vec3 {
        return {
            x: a.y * b.z - a.z * b.y,
            y: a.z * b.x - a.x * b.z,
            z: a.x * b.y - a.y * b.x
        };
    }
};

export interface quat { x: number; y: number; z: number; w: number; }

export const bquat = {
    identity(): quat {
        return { x: 0, y: 0, z: 0, w: 1 };
    },
    fromAxisAngle(axis: vec3, rad: number): quat {
        const half = rad / 2;
        const s = Math.sin(half);
        return { x: axis.x * s, y: axis.y * s, z: axis.z * s, w: Math.cos(half) };
    },
    fromEuler(x: number, y: number, z: number): quat {
        const hx = x * 0.5, hy = y * 0.5, hz = z * 0.5;
        const sx = Math.sin(hx), cx = Math.cos(hx);
        const sy = Math.sin(hy), cy = Math.cos(hy);
        const sz = Math.sin(hz), cz = Math.cos(hz);
        return {
            w: cx * cy * cz + sx * sy * sz,
            x: sx * cy * cz - cx * sy * sz,
            y: cx * sy * cz + sx * cy * sz,
            z: cx * cy * sz - sx * sy * cz,
        };
    },
    multiply(a: quat, b: quat): quat {
        return {
            w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
            x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
            y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
            z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
        };
    },
    normalize(q: quat): quat {
        const len = Math.hypot(q.x, q.y, q.z, q.w) || 1;
        return { x: q.x / len, y: q.y / len, z: q.z / len, w: q.w / len };
    },
    conjugate(q: quat): quat {
        return { x: -q.x, y: -q.y, z: -q.z, w: q.w };
    },
    rotateVec3(q: quat, v: vec3): vec3 {
        const qv: quat = { x: v.x, y: v.y, z: v.z, w: 0 };
        const res = bquat.multiply(bquat.multiply(q, qv), bquat.conjugate(q));
        return { x: res.x, y: res.y, z: res.z };
    },
    toMat4(q: quat): Mat4 {
        const { x, y, z, w } = bquat.normalize(q);
        const xx = x * x, yy = y * y, zz = z * z;
        const xy = x * y, xz = x * z, yz = y * z;
        const wx = w * x, wy = w * y, wz = w * z;
        const out = new Float32Array(16);
        out[0] = 1 - 2 * (yy + zz);
        out[1] = 2 * (xy + wz);
        out[2] = 2 * (xz - wy);
        out[3] = 0;
        out[4] = 2 * (xy - wz);
        out[5] = 1 - 2 * (xx + zz);
        out[6] = 2 * (yz + wx);
        out[7] = 0;
        out[8] = 2 * (xz + wy);
        out[9] = 2 * (yz - wx);
        out[10] = 1 - 2 * (xx + yy);
        out[11] = 0;
        out[12] = 0;
        out[13] = 0;
        out[14] = 0;
        out[15] = 1;
        return out;
    }
};
export function quatToMat4(q: [number, number, number, number]): Float32Array {
    const [x, y, z, w] = q;
    const x2 = x + x, y2 = y + y, z2 = z + z;
    const xx = x * x2, xy = x * y2, xz = x * z2;
    const yy = y * y2, yz = y * z2, zz = z * z2;
    const wx = w * x2, wy = w * y2, wz = w * z2;
    const out = new Float32Array(16);
    out[0] = 1 - (yy + zz);
    out[1] = xy + wz;
    out[2] = xz - wy;
    out[3] = 0;
    out[4] = xy - wz;
    out[5] = 1 - (xx + zz);
    out[6] = yz + wx;
    out[7] = 0;
    out[8] = xz + wy;
    out[9] = yz - wx;
    out[10] = 1 - (xx + yy);
    out[11] = 0;
    out[12] = 0; out[13] = 0; out[14] = 0; out[15] = 1;
    return out;
}

export const bmatNA = {
    setIdentity(out: Mat4): Mat4 {
        out[0] = 1; out[1] = 0; out[2] = 0; out[3] = 0;
        out[4] = 0; out[5] = 1; out[6] = 0; out[7] = 0;
        out[8] = 0; out[9] = 0; out[10] = 1; out[11] = 0;
        out[12] = 0; out[13] = 0; out[14] = 0; out[15] = 1;
        return out;
    },

    // out = a * b  (out mag a of b zijn; we kopiëren a om overwrite te voorkomen)
    // multiplyInto(out: Mat4, a: Mat4, b: Mat4): Mat4 {
    //     const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3],
    //         a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7],
    //         a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11],
    //         a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];

    //     out[0] = a00 * b[0] + a01 * b[4] + a02 * b[8] + a03 * b[12];
    //     out[1] = a00 * b[1] + a01 * b[5] + a02 * b[9] + a03 * b[13];
    //     out[2] = a00 * b[2] + a01 * b[6] + a02 * b[10] + a03 * b[14];
    //     out[3] = a00 * b[3] + a01 * b[7] + a02 * b[11] + a03 * b[15];

    //     out[4] = a10 * b[0] + a11 * b[4] + a12 * b[8] + a13 * b[12];
    //     out[5] = a10 * b[1] + a11 * b[5] + a12 * b[9] + a13 * b[13];
    //     out[6] = a10 * b[2] + a11 * b[6] + a12 * b[10] + a13 * b[14];
    //     out[7] = a10 * b[3] + a11 * b[7] + a12 * b[11] + a13 * b[15];

    //     out[8] = a20 * b[0] + a21 * b[4] + a22 * b[8] + a23 * b[12];
    //     out[9] = a20 * b[1] + a21 * b[5] + a22 * b[9] + a23 * b[13];
    //     out[10] = a20 * b[2] + a21 * b[6] + a22 * b[10] + a23 * b[14];
    //     out[11] = a20 * b[3] + a21 * b[7] + a22 * b[11] + a23 * b[15];

    //     out[12] = a30 * b[0] + a31 * b[4] + a32 * b[8] + a33 * b[12];
    //     out[13] = a30 * b[1] + a31 * b[5] + a32 * b[9] + a33 * b[13];
    //     out[14] = a30 * b[2] + a31 * b[6] + a32 * b[10] + a33 * b[14];
    //     out[15] = a30 * b[3] + a31 * b[7] + a32 * b[11] + a33 * b[15];
    //     return out;
    // },

    multiplyInto(out: Mat4, a: Mat4, b: Mat4): Mat4 {
        // out==a is veilig met dit loop-patroon; out==b NIET → cache b.
        let bb: Float32Array | null = null;
        if (out === b) { bb = new Float32Array(16); bb.set(b); b = bb; }

        for (let i = 0; i < 4; ++i) {
            const ai0 = a[i], ai1 = a[i + 4], ai2 = a[i + 8], ai3 = a[i + 12];
            out[i] = ai0 * b[0] + ai1 * b[1] + ai2 * b[2] + ai3 * b[3];
            out[i + 4] = ai0 * b[4] + ai1 * b[5] + ai2 * b[6] + ai3 * b[7];
            out[i + 8] = ai0 * b[8] + ai1 * b[9] + ai2 * b[10] + ai3 * b[11];
            out[i + 12] = ai0 * b[12] + ai1 * b[13] + ai2 * b[14] + ai3 * b[15];
        }
        return out;
    },

    // m *= T(x,y,z)
    translateSelf(m: Mat4, x: number, y: number, z: number): Mat4 {
        m[12] += m[0] * x + m[4] * y + m[8] * z;
        m[13] += m[1] * x + m[5] * y + m[9] * z;
        m[14] += m[2] * x + m[6] * y + m[10] * z;
        m[15] += m[3] * x + m[7] * y + m[11] * z;
        return m;
    },

    // m *= S(x,y,z)
    scaleSelf(m: Mat4, x: number, y: number, z: number): Mat4 {
        m[0] *= x; m[1] *= x; m[2] *= x; m[3] *= x;
        m[4] *= y; m[5] *= y; m[6] *= y; m[7] *= y;
        m[8] *= z; m[9] *= z; m[10] *= z; m[11] *= z;
        return m;
    },

    // m *= Rx/Ry/Rz
    rotateXSelf(m: Mat4, r: number): Mat4 {
        const c = Math.cos(r), s = Math.sin(r);
        const m4 = m[4], m5 = m[5], m6 = m[6], m7 = m[7],
            m8 = m[8], m9 = m[9], m10 = m[10], m11 = m[11];
        m[4] = m4 * c + m8 * s; m[5] = m5 * c + m9 * s; m[6] = m6 * c + m10 * s; m[7] = m7 * c + m11 * s;
        m[8] = m8 * c - m4 * s; m[9] = m9 * c - m5 * s; m[10] = m10 * c - m6 * s; m[11] = m11 * c - m7 * s;
        return m;
    },
    rotateYSelf(m: Mat4, r: number): Mat4 {
        const c = Math.cos(r), s = Math.sin(r);
        const m0 = m[0], m1 = m[1], m2 = m[2], m3 = m[3],
            m8 = m[8], m9 = m[9], m10 = m[10], m11 = m[11];
        m[0] = m0 * c - m8 * s; m[1] = m1 * c - m9 * s; m[2] = m2 * c - m10 * s; m[3] = m3 * c - m11 * s;
        m[8] = m0 * s + m8 * c; m[9] = m1 * s + m9 * c; m[10] = m2 * s + m10 * c; m[11] = m3 * s + m11 * c;
        return m;
    },
    rotateZSelf(m: Mat4, r: number): Mat4 {
        const c = Math.cos(r), s = Math.sin(r);
        const m0 = m[0], m1 = m[1], m2 = m[2], m3 = m[3],
            m4 = m[4], m5 = m[5], m6 = m[6], m7 = m[7];
        m[0] = m0 * c + m4 * s; m[1] = m1 * c + m5 * s; m[2] = m2 * c + m6 * s; m[3] = m3 * c + m7 * s;
        m[4] = m4 * c - m0 * s; m[5] = m5 * c - m1 * s; m[6] = m6 * c - m2 * s; m[7] = m7 * c - m3 * s;
        return m;
    },

    // Inverse-transpose 3x3 into out (exact, geen alloc)
    normalMatrixInto(out: Float32Array, model: Float32Array): Float32Array {
        const a00 = model[0], a01 = model[1], a02 = model[2];
        const a10 = model[4], a11 = model[5], a12 = model[6];
        const a20 = model[8], a21 = model[9], a22 = model[10];
        const b01 = a22 * a11 - a12 * a21;
        const b11 = -a22 * a10 + a12 * a20;
        const b21 = a21 * a10 - a11 * a20;
        let det = a00 * b01 + a01 * b11 + a02 * b21;
        if (!det) { out.fill(0); return out; }
        det = 1.0 / det;
        const m00 = b01 * det, m01 = (-a22 * a01 + a02 * a21) * det, m02 = (a12 * a01 - a02 * a11) * det;
        const m10 = b11 * det, m11 = (a22 * a00 - a02 * a20) * det, m12 = (-a12 * a00 + a02 * a10) * det;
        const m20 = b21 * det, m21 = (-a21 * a00 + a01 * a20) * det, m22 = (a11 * a00 - a01 * a10) * det;
        out[0] = m00; out[1] = m10; out[2] = m20;
        out[3] = m01; out[4] = m11; out[5] = m21;
        out[6] = m02; out[7] = m12; out[8] = m22;
        return out;
    },

    // Inverse-transpose 3x3 into out (exact, geen alloc)
    normalMatrixIntoOffset(out: Float32Array, model: Float32Array, offset: number): Float32Array {
        const a00 = model[0], a01 = model[1], a02 = model[2];
        const a10 = model[4], a11 = model[5], a12 = model[6];
        const a20 = model[8], a21 = model[9], a22 = model[10];
        const b01 = a22 * a11 - a12 * a21;
        const b11 = -a22 * a10 + a12 * a20;
        const b21 = a21 * a10 - a11 * a20;
        let det = a00 * b01 + a01 * b11 + a02 * b21;
        if (!det) { out.fill(0); return out; }
        det = 1.0 / det;
        const m00 = b01 * det, m01 = (-a22 * a01 + a02 * a21) * det, m02 = (a12 * a01 - a02 * a11) * det;
        const m10 = b11 * det, m11 = (a22 * a00 - a02 * a20) * det, m12 = (-a12 * a00 + a02 * a10) * det;
        const m20 = b21 * det, m21 = (-a21 * a00 + a01 * a20) * det, m22 = (a11 * a00 - a01 * a10) * det;
        out[0 + offset] = m00; out[1 + offset] = m10; out[2 + offset] = m20;
        out[3 + offset] = m01; out[4 + offset] = m11; out[5 + offset] = m21;
        out[6 + offset] = m02; out[7 + offset] = m12; out[8 + offset] = m22;
        return out;
    }
};
