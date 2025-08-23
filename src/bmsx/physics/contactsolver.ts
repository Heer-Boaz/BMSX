import { new_vec3 } from '../core/utils';
import type { vec3 } from '../rompack/rompack';
import { insavegame } from '../serializer/gameserializer';
import type { Contact } from './narrowphase';
import { PhysicsBody } from './physicsbody';

function applyImpulseLinear(b: PhysicsBody, impulse: vec3, scale: number) {
    if (b.invMass === 0) return;
    b.velocity.x += impulse.x * b.invMass * scale;
    b.velocity.y += impulse.y * b.invMass * scale;
    b.velocity.z += impulse.z * b.invMass * scale;
}

function cross(out: vec3, a: vec3, b: vec3) { out.x = a.y * b.z - a.z * b.y; out.y = a.z * b.x - a.x * b.z; out.z = a.x * b.y - a.y * b.x; return out; }
function add(out: vec3, a: vec3, b: vec3) { out.x = a.x + b.x; out.y = a.y + b.y; out.z = a.z + b.z; return out; }
function sub(out: vec3, a: vec3, b: vec3) { out.x = a.x - b.x; out.y = a.y - b.y; out.z = a.z - b.z; return out; }
function scale(out: vec3, a: vec3, s: number) { out.x = a.x * s; out.y = a.y * s; out.z = a.z * s; return out; }
function dot(a: vec3, b: vec3) { return a.x * b.x + a.y * b.y + a.z * b.z; }

// Rotate world vector v into local space by q*: q^-1 * v * q (optimized for quaternion stored on body)
function rotateWorldToLocal(b: PhysicsBody, v: vec3, out: vec3) {
    const q = b.rotationQ; // assuming normalized
    const ix = q.w * v.x + q.y * v.z - q.z * v.y;
    const iy = q.w * v.y + q.z * v.x - q.x * v.z;
    const iz = q.w * v.z + q.x * v.y - q.y * v.x;
    const iw = -q.x * v.x - q.y * v.y - q.z * v.z;
    out.x = ix * q.w - iw * q.x - iy * q.z + iz * q.y;
    out.y = iy * q.w - iw * q.y - iz * q.x + ix * q.z;
    out.z = iz * q.w - iw * q.z - ix * q.y + iy * q.x;
    return out;
}
// Rotate local vector to world: q * v * q^-1
function rotateLocalToWorld(b: PhysicsBody, v: vec3, out: vec3) {
    const q = b.rotationQ;
    const ix = q.w * v.x + q.y * v.z - q.z * v.y;
    const iy = q.w * v.y + q.z * v.x - q.x * v.z;
    const iz = q.w * v.z + q.x * v.y - q.y * v.x;
    const iw = -q.x * v.x - q.y * v.y - q.z * v.z;
    out.x = ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y;
    out.y = iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z;
    out.z = iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x;
    return out;
}

// Apply angular impulse using full (diagonal local) inertia tensor transformed by orientation
function applyAngularImpulseFull(b: PhysicsBody, r: vec3, impulse: vec3, scaleSign: number, tmpA: vec3, tmpB: vec3) {
    if (b.invMass === 0) return;
    cross(tmpA, r, impulse); // torque = r x J
    // world torque -> local
    rotateWorldToLocal(b, tmpA, tmpB);
    // multiply by inverse inertia diag
    tmpB.x *= b.invInertia.x; tmpB.y *= b.invInertia.y; tmpB.z *= b.invInertia.z;
    // back to world: this is angular velocity delta
    rotateLocalToWorld(b, tmpB, tmpA);
    b.angularVelocity.x += tmpA.x * scaleSign;
    b.angularVelocity.y += tmpA.y * scaleSign;
    b.angularVelocity.z += tmpA.z * scaleSign;
}

@insavegame
export class ContactSolver {
    iterations = 4; // more iterations for stability
    slop = 0.0005;
    percent = 1.0; // fully correct positional penetration (prevents sinking)
    lastSolvedContacts = 0;
    frictionEpsilon = 1e-4; // below this, treat friction as zero
    tangentialSpeedEpsilon = 1e-3; // skip friction calc when tangential speed tiny

    solve(contacts: Contact[]) {
        let solved = 0;
        const ra = new_vec3(0, 0, 0), rb = new_vec3(0, 0, 0);
        const tmp1 = new_vec3(0, 0, 0), tmp2 = new_vec3(0, 0, 0), tmp3 = new_vec3(0, 0, 0), tmp4 = new_vec3(0, 0, 0);
        for (const c of contacts) {
            const a = c.a, b = c.b;
            // triggers: skip impulses, still allow event dispatch outside
            if (a.isTrigger || b.isTrigger) continue;
            sub(ra, c.point, a.position); sub(rb, c.point, b.position);
            // Relative velocity at contact including angular parts
            cross(tmp1, a.angularVelocity, ra); // wa x ra
            cross(tmp2, b.angularVelocity, rb); // wb x rb
            const rvx = (b.velocity.x + tmp2.x) - (a.velocity.x + tmp1.x);
            const rvy = (b.velocity.y + tmp2.y) - (a.velocity.y + tmp1.y);
            const rvz = (b.velocity.z + tmp2.z) - (a.velocity.z + tmp1.z);
            const velAlongNormal = rvx * c.normal.x + rvy * c.normal.y + rvz * c.normal.z;
            if (velAlongNormal > 0) continue; // separating
            const e = Math.min(a.restitution, b.restitution);
            // Effective mass denominator including angular inertia
            // term = invMass + n·((Ia^-1 (ra x n)) x ra) + same for b
            cross(tmp1, ra, c.normal); // ra x n
            rotateWorldToLocal(a, tmp1, tmp2); // to local
            tmp2.x *= a.invInertia.x; tmp2.y *= a.invInertia.y; tmp2.z *= a.invInertia.z; // Ia^-1 * (ra x n) local
            rotateLocalToWorld(a, tmp2, tmp3); // back to world
            cross(tmp3, tmp3, ra); // (Ia^-1 (ra x n)) x ra
            let denom = a.invMass + dot(tmp3, c.normal);
            cross(tmp1, rb, c.normal);
            rotateWorldToLocal(b, tmp1, tmp2);
            tmp2.x *= b.invInertia.x; tmp2.y *= b.invInertia.y; tmp2.z *= b.invInertia.z;
            rotateLocalToWorld(b, tmp2, tmp3);
            cross(tmp3, tmp3, rb);
            denom += b.invMass + dot(tmp3, c.normal);
            if (denom === 0) continue;
            const j = -(1 + e) * velAlongNormal / denom;
            const impulse = new_vec3(c.normal.x * j, c.normal.y * j, c.normal.z * j);
            applyImpulseLinear(a, impulse, -1);
            applyImpulseLinear(b, impulse, 1);
            applyAngularImpulseFull(a, ra, impulse, -1, tmp1, tmp2);
            applyAngularImpulseFull(b, rb, impulse, 1, tmp1, tmp2);

            // --- Simplified friction ---
            const tvx = rvx - velAlongNormal * c.normal.x;
            const tvy = rvy - velAlongNormal * c.normal.y;
            const tvz = rvz - velAlongNormal * c.normal.z;
            const tLen = Math.hypot(tvx, tvy, tvz);
            const mu = Math.min(a.friction, b.friction);
            if (mu > this.frictionEpsilon && tLen > this.tangentialSpeedEpsilon) {
                const nx = tvx / tLen, ny = tvy / tLen, nz = tvz / tLen;
                // Effective mass for tangent
                cross(tmp1, ra, { x: nx, y: ny, z: nz });
                rotateWorldToLocal(a, tmp1, tmp2); tmp2.x *= a.invInertia.x; tmp2.y *= a.invInertia.y; tmp2.z *= a.invInertia.z; rotateLocalToWorld(a, tmp2, tmp3); cross(tmp3, tmp3, ra);
                let denomT = a.invMass + dot(tmp3, { x: nx, y: ny, z: nz });
                cross(tmp1, rb, { x: nx, y: ny, z: nz }); rotateWorldToLocal(b, tmp1, tmp2); tmp2.x *= b.invInertia.x; tmp2.y *= b.invInertia.y; tmp2.z *= b.invInertia.z; rotateLocalToWorld(b, tmp2, tmp3); cross(tmp3, tmp3, rb); denomT += b.invMass + dot(tmp3, { x: nx, y: ny, z: nz });
                const jt = denomT === 0 ? 0 : -tLen / denomT;
                const maxFriction = Math.abs(j) * mu;
                const jtClamped = Math.abs(jt) > maxFriction ? (jt < 0 ? -maxFriction : maxFriction) : jt;
                const fImpulse = new_vec3(nx * jtClamped, ny * jtClamped, nz * jtClamped);
                applyImpulseLinear(a, fImpulse, -1);
                applyImpulseLinear(b, fImpulse, 1);
                applyAngularImpulseFull(a, ra, fImpulse, -1, tmp1, tmp2);
                applyAngularImpulseFull(b, rb, fImpulse, 1, tmp1, tmp2);
            }

            // Positional correction (still linear only)
            const pen = Math.max(c.penetration - this.slop, 0);
            if (pen > 0) {
                const invMassSumLinear = a.invMass + b.invMass;
                if (invMassSumLinear > 0) {
                    const correctionScale = pen / invMassSumLinear * this.percent;
                    const cx = c.normal.x * correctionScale;
                    const cy = c.normal.y * correctionScale;
                    const cz = c.normal.z * correctionScale;
                    if (a.invMass) { a.position.x -= cx * a.invMass; a.position.y -= cy * a.invMass; a.position.z -= cz * a.invMass; }
                    if (b.invMass) { b.position.x += cx * b.invMass; b.position.y += cy * b.invMass; b.position.z += cz * b.invMass; }
                }
            }
            solved++;
        }
        this.lastSolvedContacts = solved;
    }
}
