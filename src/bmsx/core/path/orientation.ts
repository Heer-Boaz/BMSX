import type { vec3 } from '../../rompack/rompack';

export interface Quat { x: number; y: number; z: number; w: number; }

export const QuatUtil = {
    identity(): Quat { return { x: 0, y: 0, z: 0, w: 1 }; },
    normalize(q: Quat): Quat { const l = Math.hypot(q.x, q.y, q.z, q.w) || 1; return { x: q.x / l, y: q.y / l, z: q.z / l, w: q.w / l }; },
    fromBasis(fwd: vec3, up: vec3): Quat {
        // Build right = up x fwd (assuming right-handed)
        let rx = up.y * fwd.z - up.z * fwd.y;
        let ry = up.z * fwd.x - up.x * fwd.z;
        let rz = up.x * fwd.y - up.y * fwd.x;
        const rLen = Math.hypot(rx, ry, rz) || 1; rx /= rLen; ry /= rLen; rz /= rLen;
        // Recompute orthonormal up = fwd x right
        const ux = fwd.y * rz - fwd.z * ry;
        const uy = fwd.z * rx - fwd.x * rz;
        const uz = fwd.x * ry - fwd.y * rx;
        // Rotation matrix columns (right, up, fwd)
        const m00 = rx, m01 = ry, m02 = rz;
        const m10 = ux, m11 = uy, m12 = uz;
        const m20 = fwd.x, m21 = fwd.y, m22 = fwd.z;
        const tr = m00 + m11 + m22;
        let q: Quat;
        if (tr > 0) { const S = Math.sqrt(tr + 1.0) * 2; q = { w: 0.25 * S, x: (m21 - m12) / S, y: (m02 - m20) / S, z: (m10 - m01) / S }; }
        else if ((m00 > m11) && (m00 > m22)) { const S = Math.sqrt(1.0 + m00 - m11 - m22) * 2; q = { w: (m21 - m12) / S, x: 0.25 * S, y: (m01 + m10) / S, z: (m02 + m20) / S }; }
        else if (m11 > m22) { const S = Math.sqrt(1.0 + m11 - m00 - m22) * 2; q = { w: (m02 - m20) / S, x: (m01 + m10) / S, y: 0.25 * S, z: (m12 + m21) / S }; }
        else { const S = Math.sqrt(1.0 + m22 - m00 - m11) * 2; q = { w: (m10 - m01) / S, x: (m02 + m20) / S, y: (m12 + m21) / S, z: 0.25 * S }; }
        return QuatUtil.normalize(q);
    },
    slerp(a: Quat, b: Quat, t: number): Quat {
        let cos = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
        let bx = b.x, by = b.y, bz = b.z, bw = b.w;
        if (cos < 0) { cos = -cos; bx = -bx; by = -by; bz = -bz; bw = -bw; }
        if (cos > 0.9995) { // near linear
            const x = a.x + (bx - a.x) * t; const y = a.y + (by - a.y) * t; const z = a.z + (bz - a.z) * t; const w = a.w + (bw - a.w) * t; return QuatUtil.normalize({ x, y, z, w });
        }
        const theta = Math.acos(Math.min(Math.max(cos, -1), 1));
        const s = Math.sin(theta);
        const w1 = Math.sin((1 - t) * theta) / s;
        const w2 = Math.sin(t * theta) / s;
        return { x: a.x * w1 + bx * w2, y: a.y * w1 + by * w2, z: a.z * w1 + bz * w2, w: a.w * w1 + bw * w2 };
    }
};
