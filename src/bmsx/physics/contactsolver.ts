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

@insavegame
export class ContactSolver {
    iterations = 1; // Single pass MVP
    slop = 0.001;
    percent = 0.6; // positional correction fraction
    lastSolvedContacts = 0;
    frictionEpsilon = 1e-4; // below this, treat friction as zero
    tangentialSpeedEpsilon = 1e-3; // skip friction calc when tangential speed tiny

    solve(contacts: Contact[]) {
        let solved = 0;
        for (const c of contacts) {
            const a = c.a, b = c.b;
            // triggers: skip impulses, still allow event dispatch outside
            if (a.isTrigger || b.isTrigger) continue;
            const rvx = b.velocity.x - a.velocity.x;
            const rvy = b.velocity.y - a.velocity.y;
            const rvz = b.velocity.z - a.velocity.z;
            const velAlongNormal = rvx * c.normal.x + rvy * c.normal.y + rvz * c.normal.z;
            if (velAlongNormal > 0) continue; // separating
            const e = Math.min(a.restitution, b.restitution);
            const invMassSum = a.invMass + b.invMass;
            if (invMassSum === 0) continue;
            const j = -(1 + e) * velAlongNormal / invMassSum;
            const impulse = new_vec3(c.normal.x * j, c.normal.y * j, c.normal.z * j);
            applyImpulseLinear(a, impulse, -1);
            applyImpulseLinear(b, impulse, 1);

            // --- Simplified friction ---
            const tvx = rvx - velAlongNormal * c.normal.x;
            const tvy = rvy - velAlongNormal * c.normal.y;
            const tvz = rvz - velAlongNormal * c.normal.z;
            const tLen = Math.hypot(tvx, tvy, tvz);
            const mu = Math.min(a.friction, b.friction);
            if (mu > this.frictionEpsilon && tLen > this.tangentialSpeedEpsilon) {
                const nx = tvx / tLen, ny = tvy / tLen, nz = tvz / tLen;
                const jt = -tLen / invMassSum;
                const maxFriction = j * mu;
                const jtClamped = Math.abs(jt) > maxFriction ? (jt < 0 ? -maxFriction : maxFriction) : jt;
                const fImpulse = new_vec3(nx * jtClamped, ny * jtClamped, nz * jtClamped);
                applyImpulseLinear(a, fImpulse, -1);
                applyImpulseLinear(b, fImpulse, 1);
            }

            // Positional correction
            const pen = Math.max(c.penetration - this.slop, 0);
            if (pen > 0) {
                const correctionScale = pen / invMassSum * this.percent;
                const cx = c.normal.x * correctionScale;
                const cy = c.normal.y * correctionScale;
                const cz = c.normal.z * correctionScale;
                if (a.invMass) { a.position.x -= cx * a.invMass; a.position.y -= cy * a.invMass; a.position.z -= cz * a.invMass; }
                if (b.invMass) { b.position.x += cx * b.invMass; b.position.y += cy * b.invMass; b.position.z += cz * b.invMass; }
            }
            solved++;
        }
        this.lastSolvedContacts = solved;
    }
}
