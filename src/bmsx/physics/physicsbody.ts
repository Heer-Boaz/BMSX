import { new_vec3 } from '../utils/utils';
import { Q, quat } from '../render/3d/math3d';
import type { Oriented, vec3 } from '../rompack/rompack';
import { insavegame, type RevivableObjectArgs } from '../serializer/gameserializer';
import type { CollisionShape } from './collisionshape';

let _nextBodyId = 1;
export type BodyType = 'static' | 'dynamic' | 'kinematic';

export interface PhysicsBodyDesc {
    position: vec3;
    velocity?: vec3;
    shape: CollisionShape;
    mass?: number; // 0 or undefined -> static
    restitution?: number; // [0,1]
    friction?: number; // [0,1]
    linearDamping?: number; // [0,1] fraction of velocity lost per second (approx exponential)
    orientation?: quat; // initial orientation (identity default)
    angularVelocity?: vec3; // radians per second
    angularDamping?: number; // [0,1] fraction per second exponential
    isTrigger?: boolean;
    type?: BodyType; // overrides mass semantics if provided
    userData?: any; // backlink to WorldObject or component
    layer?: number; // collision layer bit (0..31)
    mask?: number;  // collision mask bits
}

@insavegame
export class PhysicsBody implements Oriented {
    readonly id: number;
    position: vec3;
    previousPosition: vec3;
    velocity: vec3;
    forceAccum: vec3;
    torqueAccum: vec3;
    readonly shape: CollisionShape;
    readonly invMass: number; // 0 for static / kinematic
    restitution: number;
    friction: number;
    linearDamping: number; // stored per body
    angularDamping: number;
    isTrigger: boolean;
    type: BodyType;
    userData: any;
    asleep: boolean = false;
    layer: number;
    mask: number;
    rotationQ: quat;
    angularVelocity: vec3;
    invInertia: vec3; // diagonal inertia inverse (approx for box/sphere) in local frame

    constructor(opts: RevivableObjectArgs & { desc: PhysicsBodyDesc }) {
        const { desc } = opts;
        this.id = _nextBodyId++;
        this.position = desc.position;
        this.previousPosition = new_vec3(desc.position.x, desc.position.y, desc.position.z);
        this.velocity = desc.velocity ? desc.velocity : new_vec3(0, 0, 0);
        this.forceAccum = new_vec3(0, 0, 0);
        this.torqueAccum = new_vec3(0, 0, 0);
        this.shape = desc.shape;
        const mass = desc.mass ?? 0;
        this.invMass = (desc.type === 'static' || mass === 0) ? 0 : 1 / mass;
        this.restitution = Math.min(Math.max(desc.restitution ?? 0, 0), 1);
        this.friction = Math.min(Math.max(desc.friction ?? 0.2, 0), 1);
        this.isTrigger = !!desc.isTrigger;
        this.linearDamping = Math.min(Math.max(desc.linearDamping ?? 0, 0), 1);
        this.angularDamping = Math.min(Math.max(desc.angularDamping ?? 0, 0), 1);
        this.type = desc.type ?? (mass === 0 ? 'static' : 'dynamic');
        this.userData = desc.userData;
        this.layer = desc.layer ?? 1;
        this.mask = desc.mask ?? 0xFFFFFFFF;
        this.rotationQ = desc.orientation ?? Q.ident();
        this.angularVelocity = desc.angularVelocity ? desc.angularVelocity : new_vec3(0, 0, 0);
        // Approximate inertia tensor diagonal for primitive shapes (box & sphere) in local space
        if (this.invMass === 0) {
            this.invInertia = new_vec3(0, 0, 0);
        } else if (this.shape.kind === 'aabb') {
            const hx = this.shape.halfExtents.x, hy = this.shape.halfExtents.y, hz = this.shape.halfExtents.z;
            const wx = hx * 2, wy = hy * 2, wz = hz * 2;
            const ix = (1 / 12) * (1 / this.invMass) * (wy * wy + wz * wz);
            const iy = (1 / 12) * (1 / this.invMass) * (wx * wx + wz * wz);
            const iz = (1 / 12) * (1 / this.invMass) * (wx * wx + wy * wy);
            this.invInertia = new_vec3(ix ? 1 / ix : 0, iy ? 1 / iy : 0, iz ? 1 / iz : 0);
        } else if (this.shape.kind === 'sphere') {
            const r = this.shape.radius;
            const i = (2 / 5) * (1 / this.invMass) * r * r; // mass = 1/invMass
            this.invInertia = new_vec3(i ? 1 / i : 0, i ? 1 / i : 0, i ? 1 / i : 0);
        } else {
            this.invInertia = new_vec3(0, 0, 0);
        }
    }

    applyForce(f: vec3) {
        if (this.invMass === 0) return;
        this.forceAccum.x += f.x; this.forceAccum.y += f.y; this.forceAccum.z += f.z;
    }

    clearForces() {
        this.forceAccum.x = this.forceAccum.y = this.forceAccum.z = 0;
        this.torqueAccum.x = this.torqueAccum.y = this.torqueAccum.z = 0;
    }

    applyTorque(tx: number, ty: number, tz: number) {
        if (this.invMass === 0) return;
        this.torqueAccum.x += tx; this.torqueAccum.y += ty; this.torqueAccum.z += tz;
    }
}
