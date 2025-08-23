import type { vec3 } from '../../rompack/rompack';

// math.ts — compacte, consistente math voor column-major mat4 (OpenGL-style)

// render/3d/m4.ts
// Minimal, consistent mat4 utils (column-major, right-multiply)

export type Mat4 = Float32Array;

export const M4 = {
    // ----- creation -----
    identity(): Mat4 {
        const m = new Float32Array(16);
        m[0] = 1; m[5] = 1; m[10] = 1; m[15] = 1;
        return m;
    },
    setIdentity(out: Mat4): Mat4 {
        out[0] = 1; out[1] = 0; out[2] = 0; out[3] = 0;
        out[4] = 0; out[5] = 1; out[6] = 0; out[7] = 0;
        out[8] = 0; out[9] = 0; out[10] = 1; out[11] = 0;
        out[12] = 0; out[13] = 0; out[14] = 0; out[15] = 1;
        return out;
    },

    // ----- multiply -----
    // out = a * b   (safe when out===a; not safe when out===b → copy b)
    mulInto(out: Mat4, a: Mat4, b: Mat4): Mat4 {
        let bb: Float32Array | undefined;
        if (out === b) { bb = new Float32Array(16); bb.set(b); b = bb as Mat4; }
        for (let i = 0; i < 4; ++i) {
            const ai0 = a[i], ai1 = a[i + 4], ai2 = a[i + 8], ai3 = a[i + 12];
            out[i] = ai0 * b[0] + ai1 * b[1] + ai2 * b[2] + ai3 * b[3];
            out[i + 4] = ai0 * b[4] + ai1 * b[5] + ai2 * b[6] + ai3 * b[7];
            out[i + 8] = ai0 * b[8] + ai1 * b[9] + ai2 * b[10] + ai3 * b[11];
            out[i + 12] = ai0 * b[12] + ai1 * b[13] + ai2 * b[14] + ai3 * b[15];
        }
        return out;
    },
    mul(a: Mat4, b: Mat4): Mat4 { const out = new Float32Array(16); return M4.mulInto(out, a, b); },

    // ----- in-place post-multiply by transforms (m = m * T/R/S) -----
    translateSelf(m: Mat4, x: number, y: number, z: number): Mat4 {
        m[12] += m[0] * x + m[4] * y + m[8] * z;
        m[13] += m[1] * x + m[5] * y + m[9] * z;
        m[14] += m[2] * x + m[6] * y + m[10] * z;
        m[15] += m[3] * x + m[7] * y + m[11] * z;
        return m;
    },
    scaleSelf(m: Mat4, x: number, y: number, z: number): Mat4 {
        m[0] *= x; m[1] *= x; m[2] *= x; m[3] *= x;
        m[4] *= y; m[5] *= y; m[6] *= y; m[7] *= y;
        m[8] *= z; m[9] *= z; m[10] *= z; m[11] *= z;
        return m;
    },
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
    // ----- TRS helpers -----
    quatToMat4(q: [number, number, number, number]): Mat4 {
        let [x, y, z, w] = q;
        const l = Math.hypot(x, y, z, w) || 1; x /= l; y /= l; z /= l; w /= l;
        const xx = x * x, yy = y * y, zz = z * z, xy = x * y, xz = x * z, yz = y * z, wx = w * x, wy = w * y, wz = w * z;
        const m = new Float32Array(16);
        m[0] = 1 - 2 * (yy + zz); m[1] = 2 * (xy + wz); m[2] = 2 * (xz - wy); m[3] = 0;
        m[4] = 2 * (xy - wz); m[5] = 1 - 2 * (xx + zz); m[6] = 2 * (yz + wx); m[7] = 0;
        m[8] = 2 * (xz + wy); m[9] = 2 * (yz - wx); m[10] = 1 - 2 * (xx + yy); m[11] = 0;
        m[12] = 0; m[13] = 0; m[14] = 0; m[15] = 1;
        return m;
    },
    // Write quaternion rotation matrix into provided out (avoids alloc per call)
    quatToMat4Into(out: Mat4, q: [number, number, number, number]): Mat4 {
        let [x, y, z, w] = q;
        const l = Math.hypot(x, y, z, w) || 1; x /= l; y /= l; z /= l; w /= l;
        const xx = x * x, yy = y * y, zz = z * z, xy = x * y, xz = x * z, yz = y * z, wx = w * x, wy = w * y, wz = w * z;
        out[0] = 1 - 2 * (yy + zz); out[1] = 2 * (xy + wz); out[2] = 2 * (xz - wy); out[3] = 0;
        out[4] = 2 * (xy - wz); out[5] = 1 - 2 * (xx + zz); out[6] = 2 * (yz + wx); out[7] = 0;
        out[8] = 2 * (xz + wy); out[9] = 2 * (yz - wx); out[10] = 1 - 2 * (xx + yy); out[11] = 0;
        out[12] = 0; out[13] = 0; out[14] = 0; out[15] = 1;
        return out;
    },
    fromTRS(t: [number, number, number], q?: [number, number, number, number], s?: [number, number, number]): Mat4 {
        const out = M4.identity();
        if (t) M4.translateSelf(out, t[0], t[1], t[2]);
        if (q) M4.mulInto(out, out, M4.quatToMat4(q));
        if (s) M4.scaleSelf(out, s[0], s[1], s[2]);
        return out;
    },
    // ====== Mat4 helpers (column-major, right-multiply) ======
    perspective(fovRad: number, aspect: number, near: number, far: number): Mat4 {
        const f = 1 / Math.tan(fovRad / 2), nf = 1 / (near - far);
        const m = new Float32Array(16);
        m[0] = f / aspect; m[5] = f; m[10] = (far + near) * nf; m[11] = -1; m[14] = 2 * far * near * nf; return m;
    },

    orthographic(l: number, r: number, b: number, t: number, n: number, f: number): Mat4 {
        const lr = 1 / (l - r), bt = 1 / (b - t), nf = 1 / (n - f);
        const m = new Float32Array(16);
        m[0] = -2 * lr; m[5] = -2 * bt; m[10] = 2 * nf; m[12] = (l + r) * lr; m[13] = (t + b) * bt; m[14] = (f + n) * nf; m[15] = 1; return m;
    },

    fisheye(fovRad: number, aspect: number, near: number, far: number): Mat4 {
        // NOTE: True fisheye is a non-linear projection (can't be represented
        // exactly with a single 4x4 matrix). Provide an approximation that
        // preserves a circular look by using equal X/Y scale. This will
        // visually appear more "fisheyish" than a normal perspective when
        // rendered to a rectangular viewport, but it's still a linear
        // transform (good enough for many use-cases and keeps frustum culling).
        const m = new Float32Array(16);
        const f = 1 / Math.tan(fovRad / 2);
        // Use same scale on X and Y so the projected frustum is circular
        m[0] = f;      // X scale (ignore aspect here to favour circular distortion)
        m[5] = f;      // Y scale
        // depth mapping (same convention as perspective)
        const nf = 1 / (near - far);
        m[10] = (far + near) * nf;
        m[11] = -1;
        m[14] = 2 * far * near * nf;
        // other elements are zero by default
        return m;
    },

    panorama(fovRad: number, aspect: number, near: number, far: number): Mat4 {
        // Approximate a cylindrical / equirectangular-style panorama by treating
        // the supplied fovRad as the horizontal field-of-view and deriving a
        // matching vertical fov from the aspect. This is still a linear
        // projection (not a true spherical/equirectangular mapping) but it
        // provides a wide-panorama feel while remaining compatible with the
        // existing raster pipeline and frustum tools.
        const m = new Float32Array(16);
        // horizontal fov is fovRad; compute vertical fov from aspect
        const hfov = fovRad;
        const vfov = (Math.abs(aspect) > 1e-6) ? (hfov / aspect) : hfov;
        const sx = 1 / Math.tan(hfov / 2); // X scale
        const sy = 1 / Math.tan(vfov / 2); // Y scale
        m[0] = sx;
        m[5] = sy;
        const nf = 1 / (near - far);
        m[10] = (far + near) * nf;
        m[11] = -1;
        m[14] = 2 * far * near * nf;
        return m;
    },
    oblique(l: number, r: number, b: number, t: number, n: number, f: number, alphaRad: number, betaRad: number): Mat4 {
        const ortho = this.orthographic(l, r, b, t, n, f);  // Basis orthographic
        const cotAlpha = 1 / Math.tan(alphaRad), cotBeta = 1 / Math.tan(betaRad);
        const shear = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, cotAlpha, cotBeta, 1, 0, 0, 0, 0, 1]);
        // Mul shear met ortho (je hebt een Mat4 mul-functie nodig)
        return M4.mul(shear, ortho);  // Assumptie: je hebt een mul-helper
    },
    asymmetricFrustum(l: number, r: number, b: number, t: number, n: number, f: number): Mat4 {
        const rl = r - l, bt = t - b, fn = f - n;
        const m = new Float32Array(16);
        m[0] = 2 * n / rl; m[8] = (r + l) / rl;
        m[5] = 2 * n / bt; m[9] = (t + b) / bt;
        m[10] = -(f + n) / fn; m[11] = -1;
        m[14] = -2 * f * n / fn;
        return m;
    },
    isometric(scale: number = 1): Mat4 {  // Oneindig, geen near/far
        const sqrt2 = Math.sqrt(2), sqrt6 = Math.sqrt(6), sqrt3 = Math.sqrt(3);
        const m = new Float32Array(16);
        m[0] = scale * sqrt2 / 2; m[1] = -scale * sqrt2 / 2; m[2] = 0; m[3] = 0;
        m[4] = scale * sqrt2 / sqrt6; m[5] = scale * sqrt2 / sqrt6; m[6] = -scale * 2 / sqrt6; m[7] = 0;
        m[8] = 0; m[9] = 0; m[10] = 0; m[11] = 0;
        m[12] = 0; m[13] = 0; m[14] = 0; m[15] = 1;
        return m;
    },
    infinitePerspective(fovRad: number, aspect: number, near: number): Mat4 {
        const f = 1 / Math.tan(fovRad / 2);
        const m = new Float32Array(16);
        m[0] = f / aspect; m[5] = f; m[10] = -1; m[11] = -1; m[14] = -2 * near; return m;
    },

    // View matrix uit volledige, orthonormale basis en positie
    viewFromBasis(pos: vec3, right: vec3, up: vec3, back: vec3): Mat4 {
        const m = new Float32Array(16);
        m[0] = right.x; m[4] = right.y; m[8] = right.z; m[12] = -(right.x * pos.x + right.y * pos.y + right.z * pos.z);
        m[1] = up.x; m[5] = up.y; m[9] = up.z; m[13] = -(up.x * pos.x + up.y * pos.y + up.z * pos.z);
        m[2] = back.x; m[6] = back.y; m[10] = back.z; m[14] = -(back.x * pos.x + back.y * pos.y + back.z * pos.z);
        m[3] = 0; m[7] = 0; m[11] = 0; m[15] = 1;
        return m;
    },

    skyboxFromView(view: Mat4): Mat4 {
        const m = view.slice() as Mat4;
        m[12] = m[13] = m[14] = 0;
        // transpose rotation so that the matrix represents camera orientation
        let t = m[1]; m[1] = m[4]; m[4] = t;
        t = m[2]; m[2] = m[8]; m[8] = t;
        t = m[6]; m[6] = m[9]; m[9] = t;
        return m;
    },

    // Extract right and up vectors from a view matrix without allocations
    viewRightUpInto(view: Mat4, outRight: Float32Array, outUp: Float32Array): void {
        outRight[0] = view[0]; outRight[1] = view[4]; outRight[2] = view[8];
        outUp[0] = view[1]; outUp[1] = view[5]; outUp[2] = view[9];
    },

    // 3x3 normal matrix (inverse-transpose)
    normal3(model: Mat4): Float32Array {
        // snellere exacte 3x3 inverse-transpose (geen alloc binnenin)
        const a00 = model[0], a01 = model[1], a02 = model[2];
        const a10 = model[4], a11 = model[5], a12 = model[6];
        const a20 = model[8], a21 = model[9], a22 = model[10];
        const b01 = a22 * a11 - a12 * a21;
        const b11 = -a22 * a10 + a12 * a20;
        const b21 = a21 * a10 - a11 * a20;
        let det = a00 * b01 + a01 * b11 + a02 * b21;
        if (!det) { return new Float32Array(9); }
        det = 1 / det;
        const m00 = b01 * det, m01 = (-a22 * a01 + a02 * a21) * det, m02 = (a12 * a01 - a02 * a11) * det;
        const m10 = b11 * det, m11 = (a22 * a00 - a02 * a20) * det, m12 = (-a12 * a00 + a02 * a10) * det;
        const m20 = b21 * det, m21 = (-a21 * a00 + a01 * a20) * det, m22 = (a11 * a00 - a01 * a10) * det;
        return new Float32Array([m00, m10, m20, m01, m11, m21, m02, m12, m22]);
    },

    normal3Into(out: Float32Array, model: Mat4): Float32Array {
        const a00 = model[0], a01 = model[1], a02 = model[2];
        const a10 = model[4], a11 = model[5], a12 = model[6];
        const a20 = model[8], a21 = model[9], a22 = model[10];
        const b01 = a22 * a11 - a12 * a21;
        const b11 = -a22 * a10 + a12 * a20;
        const b21 = a21 * a10 - a11 * a20;
        let det = a00 * b01 + a01 * b11 + a02 * b21;
        if (!det) { out.fill(0); return out; }
        det = 1 / det;
        const m00 = b01 * det, m01 = (-a22 * a01 + a02 * a21) * det, m02 = (a12 * a01 - a02 * a11) * det;
        const m10 = b11 * det, m11 = (a22 * a00 - a02 * a20) * det, m12 = (-a12 * a00 + a02 * a10) * det;
        const m20 = b21 * det, m21 = (-a21 * a00 + a01 * a20) * det, m22 = (a11 * a00 - a01 * a10) * det;
        out[0] = m00; out[1] = m10; out[2] = m20;
        out[3] = m01; out[4] = m11; out[5] = m21;
        out[6] = m02; out[7] = m12; out[8] = m22;
        return out;
    },
};


// ====== Vec helpers ======
export const V3 = {
    of(x = 0, y = 0, z = 0): vec3 { return { x, y, z }; },
    add(a: vec3, b: vec3): vec3 { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; },
    sub(a: vec3, b: vec3): vec3 { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; },
    scale(a: vec3, s: number): vec3 { return { x: a.x * s, y: a.y * s, z: a.z * s }; },
    dot(a: vec3, b: vec3): number { return a.x * b.x + a.y * b.y + a.z * b.z; },
    cross(a: vec3, b: vec3): vec3 {
        return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
    },
    len(a: vec3): number { return Math.hypot(a.x, a.y, a.z); },
    norm(a: vec3): vec3 {
        const L = V3.len(a) || 1; return { x: a.x / L, y: a.y / L, z: a.z / L };
    },
    rotateAroundAxis(v: vec3, axis: vec3, angle: number): vec3 {
        // as = genormaliseerde as
        const L = Math.hypot(axis.x, axis.y, axis.z) || 1;
        const ax = axis.x / L, ay = axis.y / L, az = axis.z / L;
        const c = Math.cos(angle), s = Math.sin(angle);
        // v' = v*c + (a×v)*s + a*(a·v)*(1-c)
        const crossX = ay * v.z - az * v.y;
        const crossY = az * v.x - ax * v.z;
        const crossZ = ax * v.y - ay * v.x;
        const dot = ax * v.x + ay * v.y + az * v.z;
        return {
            x: v.x * c + crossX * s + ax * dot * (1 - c),
            y: v.y * c + crossY * s + ay * dot * (1 - c),
            z: v.z * c + crossZ * s + az * dot * (1 - c),
        };
    }

};


// ====== Frustum helpers ======
export type Plane = [number, number, number, number];
export function extractFrustumPlanes(vp: Mat4): Plane[] {
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

export const bmat = {
    // === CONSISTENTE VIEW HELPERS (column-major, right-multiply) ===
    viewFromPosFwdUp(pos: [number, number, number],
        fwd: [number, number, number],
        upHint: [number, number, number]): Mat4 {
        // Zorg voor orthonormale basis
        let fx = fwd[0], fy = fwd[1], fz = fwd[2];
        const fLen = Math.hypot(fx, fy, fz) || 1; fx /= fLen; fy /= fLen; fz /= fLen;
        // z-as van cameramatrix wijst "naar achteren"
        let zx = -fx, zy = -fy, zz = -fz;

        // right = normalize(cross(upHint, z))
        let rx = upHint[1] * zz - upHint[2] * zy;
        let ry = upHint[2] * zx - upHint[0] * zz;
        let rz = upHint[0] * zy - upHint[1] * zx;
        const rLen = Math.hypot(rx, ry, rz) || 1; rx /= rLen; ry /= rLen; rz /= rLen;

        // up   = cross(z, right)
        let ux = zy * rz - zz * ry;
        let uy = zz * rx - zx * rz;
        let uz = zx * ry - zy * rx;

        const [px, py, pz] = pos;
        const out = new Float32Array(16);
        out[0] = rx; out[1] = ry; out[2] = rz; out[3] = 0;
        out[4] = ux; out[5] = uy; out[6] = uz; out[7] = 0;
        out[8] = zx; out[9] = zy; out[10] = zz; out[11] = 0;
        out[12] = -(rx * px + ry * py + rz * pz);
        out[13] = -(ux * px + uy * py + uz * pz);
        out[14] = -(zx * px + zy * py + zz * pz);
        out[15] = 1;
        return out;
    },

    /** FPS-stijl yaw/pitch naar view; yaw=0 kijkt -Z op wereld, right is horizontaal. */
    // bmat.ts
    viewFromYawPitch(pos: [number, number, number], yaw: number, pitch: number): Mat4 {
        const cp = Math.cos(pitch), sp = Math.sin(pitch);
        const cy = Math.cos(yaw), sy = Math.sin(yaw);

        // Forward: yaw=0 kijkt langs -Z (OpenGL conventie)
        const fx = sy * cp, fy = sp, fz = -cy * cp;

        // Robuust: gebruik vaste wereld-up als referentie
        let rx = 0 * fz - 1 * fy;   // cross(worldUp,[fx,fy,fz]) = [1,0,0]×? nee: worldUp=[0,1,0]
        let ry = 1 * fx - 0 * fz;   // => [fz, 0, -fx] maar met juiste tekenen:
        let rz = 0 * fy - 0 * fx;   // we schrijven het expliciet:
        // Correct: right = normalize(cross(worldUp, forward))
        rx = (1 * fz - 0 * fy);     // =  fz
        ry = (0 * fx - 0 * fz);     // =  0
        rz = (0 * fy - 1 * fx);     // = -fx
        let rlen = Math.hypot(rx, ry, rz) || 1; rx /= rlen; ry /= rlen; rz /= rlen;

        // Up = cross(forward, right)  (rechts-handig)
        const ux = fy * rz - fz * ry;
        const uy = fz * rx - fx * rz;
        const uz = fx * ry - fy * rx;

        // Z-as van cam wijst "naar achteren"
        const zx = -fx, zy = -fy, zz = -fz;

        const [px, py, pz] = pos;
        const out = new Float32Array(16);
        out[0] = rx; out[1] = ry; out[2] = rz; out[3] = 0;
        out[4] = ux; out[5] = uy; out[6] = uz; out[7] = 0;
        out[8] = zx; out[9] = zy; out[10] = zz; out[11] = 0;
        out[12] = -(rx * px + ry * py + rz * pz);
        out[13] = -(ux * px + uy * py + uz * pz);
        out[14] = -(zx * px + zy * py + zz * pz);
        out[15] = 1;
        return out;
    },

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
    rotatevec3(q: quat, v: vec3): vec3 {
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

// ====== Quat helpers ======
export type quat = { x: number; y: number; z: number; w: number };

export const Q = {
    ident(): quat { return { x: 0, y: 0, z: 0, w: 1 }; },
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
        const a = V3.norm(axis); const h = ang * 0.5, s = Math.sin(h);
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
        const L = Math.hypot(q.x, q.y, q.z, q.w) || 1;
        return { x: q.x / L, y: q.y / L, z: q.z / L, w: q.w / L };
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
        const r = Q.rotateVec(q, V3.of(1, 0, 0));
        const u = Q.rotateVec(q, V3.of(0, 1, 0));
        const f = Q.rotateVec(q, V3.of(0, 0, -1)); // -Z kijkrichting
        return { r: V3.norm(r), u: V3.norm(u), f: V3.norm(f) };
    }
};

// ====== Veilige as-rotatie voor vec3 (Rodrigues) ======
export function rotateAroundAxis(v: vec3, axis: vec3, ang: number): vec3 {
    const a = V3.norm(axis);
    const c = Math.cos(ang), s = Math.sin(ang);
    const dot = V3.dot(a, v);
    const cross = V3.cross(a, v);
    return {
        x: v.x * c + cross.x * s + a.x * dot * (1 - c),
        y: v.y * c + cross.y * s + a.y * dot * (1 - c),
        z: v.z * c + cross.z * s + a.z * dot * (1 - c),
    };
}


export const bmatNA = {
    // === NON-ALLOC VARIANTEN VAN VIEW ===
    viewFromPosFwdUpInto(out: Mat4,
        pos: [number, number, number],
        fwd: [number, number, number],
        upHint: [number, number, number]): Mat4 {
        // normalize fwd
        let fx = fwd[0], fy = fwd[1], fz = fwd[2];
        const fLen = Math.hypot(fx, fy, fz) || 1; fx /= fLen; fy /= fLen; fz /= fLen;
        let zx = -fx, zy = -fy, zz = -fz;

        // right = normalize(cross(upHint, z))
        let rx = upHint[1] * zz - upHint[2] * zy;
        let ry = upHint[2] * zx - upHint[0] * zz;
        let rz = upHint[0] * zy - upHint[1] * zx;
        const rLen = Math.hypot(rx, ry, rz) || 1; rx /= rLen; ry /= rLen; rz /= rLen;

        // up = cross(z, right)
        let ux = zy * rz - zz * ry;
        let uy = zz * rx - zx * rz;
        let uz = zx * ry - zy * rx;

        const px = pos[0], py = pos[1], pz = pos[2];
        out[0] = rx; out[1] = ry; out[2] = rz; out[3] = 0;
        out[4] = ux; out[5] = uy; out[6] = uz; out[7] = 0;
        out[8] = zx; out[9] = zy; out[10] = zz; out[11] = 0;
        out[12] = -(rx * px + ry * py + rz * pz);
        out[13] = -(ux * px + uy * py + uz * pz);
        out[14] = -(zx * px + zy * py + zz * pz);
        out[15] = 1;
        return out;
    },

    viewFromYawPitchInto(out: Mat4, pos: [number, number, number], yaw: number, pitch: number): Mat4 {
        const cp = Math.cos(pitch), sp = Math.sin(pitch);
        const cy = Math.cos(yaw), sy = Math.sin(yaw);

        // Forward volgens OpenGL conventie: yaw=0 kijkt langs -Z
        const fwd: [number, number, number] = [sy * cp, sp, -cy * cp];

        // Gebruik vaste wereld-up voor robuustheid
        const worldUp: [number, number, number] = [0, 1, 0];

        // Orthonormale basis bouwen
        let rx = worldUp[1] * fwd[2] - worldUp[2] * fwd[1];
        let ry = worldUp[2] * fwd[0] - worldUp[0] * fwd[2];
        let rz = worldUp[0] * fwd[1] - worldUp[1] * fwd[0];
        const rLen = Math.hypot(rx, ry, rz) || 1; rx /= rLen; ry /= rLen; rz /= rLen;

        const ux = fwd[1] * rx - fwd[2] * ry;
        const uy = fwd[2] * rz - fwd[0] * rz; // let op: check hieronder
        const uz = fwd[0] * ry - fwd[1] * rx;

        return this.viewFromPosFwdUpInto(out, pos, fwd, [ux, uy, uz]);
    },

    // viewFromYawPitch(pos: [number, number, number], yaw: number, pitch: number): Mat4 {

    //     return this.viewFromPosFwdUp(pos, fwd, [ux, uy, uz]);
    // },

    skyboxViewFromViewInto(out: Mat4, view: Mat4): Mat4 {
        out[0] = view[0]; out[1] = view[4]; out[2] = view[8]; out[3] = 0;
        out[4] = view[1]; out[5] = view[5]; out[6] = view[9]; out[7] = 0;
        out[8] = view[2]; out[9] = view[6]; out[10] = view[10]; out[11] = 0;
        out[12] = 0; out[13] = 0; out[14] = 0; out[15] = 1;
        return out;
    },

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
