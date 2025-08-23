import { new_vec3 } from '../core/utils';
import type { vec3 } from '../rompack/rompack';
import { insavegame } from '../serializer/gameserializer';
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
    isTrigger?: boolean;
    type?: BodyType; // overrides mass semantics if provided
    userData?: any; // backlink to GameObject or component
    layer?: number; // collision layer bit (0..31)
    mask?: number;  // collision mask bits
}

@insavegame
export class PhysicsBody {
    readonly id: number;
    position: vec3;
    previousPosition: vec3;
    velocity: vec3;
    forceAccum: vec3;
    readonly shape: CollisionShape;
    readonly invMass: number; // 0 for static / kinematic
    restitution: number;
    friction: number;
    isTrigger: boolean;
    type: BodyType;
    userData: any;
    asleep: boolean = false;
    layer: number;
    mask: number;

    constructor(desc: PhysicsBodyDesc) {
        this.id = _nextBodyId++;
        this.position = desc.position;
        this.previousPosition = new_vec3(desc.position.x, desc.position.y, desc.position.z);
        this.velocity = desc.velocity ? desc.velocity : new_vec3(0, 0, 0);
        this.forceAccum = new_vec3(0, 0, 0);
        this.shape = desc.shape;
        const mass = desc.mass ?? 0;
        this.invMass = (desc.type === 'static' || mass === 0) ? 0 : 1 / mass;
        this.restitution = Math.min(Math.max(desc.restitution ?? 0, 0), 1);
        this.friction = Math.min(Math.max(desc.friction ?? 0.2, 0), 1);
        this.isTrigger = !!desc.isTrigger;
        this.type = desc.type ?? (mass === 0 ? 'static' : 'dynamic');
        this.userData = desc.userData;
        this.layer = desc.layer ?? 1;
        this.mask = desc.mask ?? 0xFFFFFFFF;
    }

    applyForce(f: vec3) {
        if (this.invMass === 0) return;
        this.forceAccum.x += f.x; this.forceAccum.y += f.y; this.forceAccum.z += f.z;
    }

    clearForces() {
        this.forceAccum.x = this.forceAccum.y = this.forceAccum.z = 0;
    }
}
