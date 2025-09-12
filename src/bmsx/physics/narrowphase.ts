import { new_vec3 } from '../utils/utils';
import type { vec3 } from '../rompack/rompack';
import { insavegame, type RevivableObjectArgs } from 'bmsx/serializer/serializationhooks';
import { PhysicsBody } from './physicsbody';

export interface Contact {
    a: PhysicsBody; b: PhysicsBody;
    normal: vec3; // from a to b
    penetration: number;
    point: vec3; // contact midpoint (single point approximation)
    // triggers flagged externally if a/b.isTrigger
}

function dot(a: vec3, b: vec3) { return a.x * b.x + a.y * b.y + a.z * b.z; }
function sub(out: vec3, a: vec3, b: vec3) { out.x = a.x - b.x; out.y = a.y - b.y; out.z = a.z - b.z; return out; }
function len(a: vec3) { return Math.hypot(a.x, a.y, a.z); }
function normalize(out: vec3, a: vec3) { const l = len(a) || 1; out.x = a.x / l; out.y = a.y / l; out.z = a.z / l; return out; }

@insavegame
export class Narrowphase {
    private vtmp = new_vec3(0, 0, 0);
    // Contact & vec3 pooling to avoid per-frame allocations on low-end devices
    private pool: Contact[] = [];
    private poolIndex = 0;

    constructor(_opts?: RevivableObjectArgs) {
    }

    resetPool() { this.poolIndex = 0; }

    private getPooledContact(a: PhysicsBody, b: PhysicsBody): Contact {
        let c = this.pool[this.poolIndex];
        if (!c) {
            c = { a, b, normal: new_vec3(0, 0, 0), penetration: 0, point: new_vec3(0, 0, 0) };
            this.pool[this.poolIndex] = c;
        } else {
            c.a = a; c.b = b; c.penetration = 0; // will be set
        }
        this.poolIndex++;
        return c;
    }

    collide(a: PhysicsBody, b: PhysicsBody, out: Contact[]) {
        const sa = a.shape, sb = b.shape;
        if (sa.kind === 'sphere' && sb.kind === 'sphere') { this.sphereSphere(a, b, out); return; }
        if (sa.kind === 'aabb' && sb.kind === 'aabb') { this.aabbAabb(a, b, out); return; }
        // mixed
        if (sa.kind === 'sphere' && sb.kind === 'aabb') { this.sphereAabb(a, b, out); return; }
        if (sa.kind === 'aabb' && sb.kind === 'sphere') { this.sphereAabb(b, a, out, true); return; }
    }

    private sphereSphere(a: PhysicsBody, b: PhysicsBody, out: Contact[]) {
        if (a.shape.kind !== 'sphere' || b.shape.kind !== 'sphere') return; // guard for TS
        sub(this.vtmp, b.position, a.position);
        const r = a.shape.radius + b.shape.radius;
        const dist2 = dot(this.vtmp, this.vtmp);
        if (dist2 > r * r) return;
        const d = Math.sqrt(dist2) || 1;
        const pen = r - d;
        const c = this.getPooledContact(a, b);
        const normal = c.normal;
        normalize(normal, this.vtmp);
        const point = c.point;
        point.x = a.position.x + normal.x * (a.shape.radius - pen * 0.5);
        point.y = a.position.y + normal.y * (a.shape.radius - pen * 0.5);
        point.z = a.position.z + normal.z * (a.shape.radius - pen * 0.5);
        c.penetration = pen;
        out.push(c);
    }

    private aabbAabb(a: PhysicsBody, b: PhysicsBody, out: Contact[]) {
        if (a.shape.kind !== 'aabb' || b.shape.kind !== 'aabb') return;
        const ha = a.shape.halfExtents; const hb = b.shape.halfExtents;
        const dx = b.position.x - a.position.x;
        const px = (ha.x + hb.x) - Math.abs(dx);
        if (px <= 0) return;
        const dy = b.position.y - a.position.y;
        const py = (ha.y + hb.y) - Math.abs(dy);
        if (py <= 0) return;
        const dz = b.position.z - a.position.z;
        const pz = (ha.z + hb.z) - Math.abs(dz);
        if (pz <= 0) return;
        // choose smallest penetration axis
        if (px < py && px < pz) {
            const sx = Math.sign(dx) || 1;
            const c = this.getPooledContact(a, b);
            c.normal.x = sx; c.normal.y = 0; c.normal.z = 0; // points from a to b
            c.penetration = px;
            c.point.x = a.position.x + ha.x * sx;
            c.point.y = (a.position.y + b.position.y) / 2;
            c.point.z = (a.position.z + b.position.z) / 2;
            out.push(c);
        } else if (py < pz) {
            const sy = Math.sign(dy) || 1;
            const c = this.getPooledContact(a, b);
            c.normal.x = 0; c.normal.y = sy; c.normal.z = 0; // from a to b
            c.penetration = py;
            c.point.x = (a.position.x + b.position.x) / 2;
            c.point.y = a.position.y + ha.y * sy;
            c.point.z = (a.position.z + b.position.z) / 2;
            out.push(c);
        } else {
            const sz = Math.sign(dz) || 1;
            const c = this.getPooledContact(a, b);
            c.normal.x = 0; c.normal.y = 0; c.normal.z = sz; // from a to b
            c.penetration = pz;
            c.point.x = (a.position.x + b.position.x) / 2;
            c.point.y = (a.position.y + b.position.y) / 2;
            c.point.z = a.position.z + ha.z * sz;
            out.push(c);
        }
    }

    private sphereAabb(sphere: PhysicsBody, box: PhysicsBody, out: Contact[], flip = false) {
        if (sphere.shape.kind !== 'sphere' || box.shape.kind !== 'aabb') return;
        const c = sphere.position; const h = box.shape.halfExtents; const bp = box.position;
        const closest = new_vec3(
            Math.max(bp.x - h.x, Math.min(c.x, bp.x + h.x)),
            Math.max(bp.y - h.y, Math.min(c.y, bp.y + h.y)),
            Math.max(bp.z - h.z, Math.min(c.z, bp.z + h.z))
        );
        sub(this.vtmp, c, closest);
        const dist2 = dot(this.vtmp, this.vtmp);
        const r = sphere.shape.radius;
        if (dist2 > r * r) return;
        const d = Math.sqrt(dist2) || 1;
        const pen = r - d;
        const contact = this.getPooledContact(flip ? box : sphere, flip ? sphere : box);
        const normal = contact.normal;
        if (d === 0) { normal.x = 0; normal.y = 1; normal.z = 0; }
        else normalize(normal, this.vtmp);
        if (flip) { normal.x = -normal.x; normal.y = -normal.y; normal.z = -normal.z; }
        contact.point.x = closest.x; contact.point.y = closest.y; contact.point.z = closest.z;
        contact.penetration = pen;
        out.push(contact);
    }
}
