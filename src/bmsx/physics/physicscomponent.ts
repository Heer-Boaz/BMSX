import { Component, ComponentTag } from '../component/basecomponent';
import { new_vec3 } from '../core/utils';
import type { Identifier } from '../rompack/rompack';
import { insavegame } from '../serializer/gameserializer';
import { PhysicsBody, PhysicsBodyDesc } from './physicsbody';
import { PhysicsWorld } from './physicsworld';

// Tags
export const PHYSICS_PRE_TICK: ComponentTag = 'physics_pre';
export const PHYSICS_POST_TICK: ComponentTag = 'physics_post';

export interface PhysicsComponentOptions extends Omit<PhysicsBodyDesc, 'position'> {
    syncAxis?: { x?: boolean; y?: boolean; z?: boolean }; // selective axis sync
    writeBack?: boolean; // if true: body -> GameObject each frame (default true)
    readSource?: 'gameobject' | 'body'; // initial source for position
    layer?: number; // collision layer bit (0..31)
    mask?: number; // collision mask bits
}

@insavegame
export class PhysicsComponent extends Component {
    static override tagsPre = new Set<ComponentTag>([PHYSICS_PRE_TICK]);
    static override tagsPost = new Set<ComponentTag>([PHYSICS_POST_TICK]);

    body: PhysicsBody;
    world: PhysicsWorld;
    syncAxis = { x: true, y: true, z: true };
    writeBack = true;
    layer = 1; // default layer 0 -> bit 0
    mask = 0xFFFFFFFF; // collide with everything

    constructor(parentid: Identifier, opts: PhysicsComponentOptions) {
        super(parentid);
        this.world = $.registry.get<PhysicsWorld>('physics_world');
        const go = $.model.getGameObject(this.parentid);
        if (!this.world) throw new Error('PhysicsWorld not available');
        if (!go) throw new Error('PhysicsComponent parent GameObject not found');
        this.syncAxis = { ...this.syncAxis, ...(opts.syncAxis || {}) };
        this.writeBack = opts.writeBack ?? true;
        this.layer = opts.layer ?? 1;
        this.mask = opts.mask ?? 0xFFFFFFFF;
        const startPos = opts.readSource === 'body' ? new_vec3(go.x, go.y, go.z) : new_vec3(go.x, go.y, go.z);
        this.body = this.world.addBody({ ...opts, position: startPos, userData: go.id, layer: this.layer, mask: this.mask });
    }

    override preprocessingUpdate(): void {
        // read GameObject -> body before physics (if not sleeping and user wants authoritative GameObject)
        // For now we always treat body as authoritative; could add option later.
    }

    override postprocessingUpdate(): void {
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
        this.world.removeBody(this.body);
    }
}