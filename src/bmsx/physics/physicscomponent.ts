import { Component, componenttags_postprocessing, componenttags_preprocessing } from '../component/basecomponent';
import { new_vec3 } from '../core/utils';
import type { Identifier } from '../rompack/rompack';
import { excludeclassfromsavegame } from '../serializer/gameserializer';
import { PhysicsBody, PhysicsBodyDesc } from './physicsbody';
import { PhysicsWorld } from './physicsworld';

export interface PhysicsComponentOptions extends Omit<PhysicsBodyDesc, 'position'> {
    syncAxis?: { x?: boolean; y?: boolean; z?: boolean }; // selective axis sync
    writeBack?: boolean; // if true: body -> GameObject each frame (default true)
    layer?: number; // collision layer bit (0..31)
    mask?: number; // collision mask bits
}

@excludeclassfromsavegame
@componenttags_preprocessing('physics_pre') // Preprocessing update to store the old position so that it can be used in the postprocessing update to place the object back to its old position if it collides with a wall or leaves the screen, etc.
@componenttags_postprocessing('run') // Postprocessing update to check for, and handle, collisions or leaving the screen, etc.
export class PhysicsComponent extends Component {
    body: PhysicsBody | null = null;
    syncAxis = { x: true, y: true, z: true };
    writeBack = true;
    layer = 1;
    mask = 0xFFFFFFFF;
    private shape!: PhysicsBodyDesc['shape'];
    private mass = 0;
    private restitution = 0;
    private friction = 0.2;
    private isTrigger = false;
    private isKinematic = false;
    private _bodyBuilt = false;

    constructor(parentid: Identifier, opts: PhysicsComponentOptions) {
        super(parentid);
        this.syncAxis = { ...this.syncAxis, ...(opts.syncAxis || {}) };
        this.writeBack = opts.writeBack ?? true;
        this.layer = opts.layer ?? 1;
        this.mask = opts.mask ?? 0xFFFFFFFF;
        this.shape = opts.shape;
        this.mass = opts.mass ?? 0;
        this.restitution = opts.restitution ?? 0;
        this.friction = opts.friction ?? 0.2;
        this.isTrigger = !!opts.isTrigger;
        this.isKinematic = opts.type === 'kinematic';
        this.tryBuildBody();
    }

    override preprocessingUpdate(): void {
        // read GameObject -> body before physics (if not sleeping and user wants authoritative GameObject)
        // For now we always treat body as authoritative; could add option later.
    }

    override postprocessingUpdate(): void {
        if (!this.body) return;
        if (!this.writeBack) return;
        const go = $.model.getGameObject(this.parentid);
        if (!go) return;
        const beforeX = go.x_nonotify, beforeY = go.y_nonotify, beforeZ = go.z_nonotify;
        if (this.syncAxis.x) go.x_nonotify = this.body.position.x;
        if (this.syncAxis.y) go.y_nonotify = this.body.position.y;
        if (this.syncAxis.z) go.z_nonotify = this.body.position.z;
        if (PhysicsComponent._debugFrames < 5) {
            console.log('[PhysSync]', this.parentid, 'body', this.body.position, 'goBefore', beforeX, beforeY, beforeZ, 'goAfter', go.x_nonotify, go.y_nonotify, go.z_nonotify);
            PhysicsComponent._debugFrames++;
        }
    }

    private static _debugFrames = 0;

    override dispose(): void {
        super.dispose();
        const world = $.get<PhysicsWorld>('physics_world');
        if (world && this.body) world.removeBody(this.body);
        this.body = null;
    }

    private tryBuildBody() {
        if (this._bodyBuilt) return;
        const world = PhysicsWorld.ensure();
        const go = $.model.getGameObject(this.parentid);
        if (!go) return; // parent not yet available
        const startPos = new_vec3(go.x, go.y, go.z);
        this.body = world.addBody({
            position: startPos,
            shape: this.shape,
            mass: this.mass,
            restitution: this.restitution,
            friction: this.friction,
            isTrigger: this.isTrigger,
            type: this.isKinematic ? 'kinematic' : undefined,
            userData: go.id,
            layer: this.layer,
            mask: this.mask
        });
        this._bodyBuilt = true;
    }
}