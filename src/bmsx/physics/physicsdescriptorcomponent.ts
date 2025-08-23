import { Component, componenttags_postprocessing, componenttags_preprocessing } from '../component/basecomponent';
import type { Identifier } from '../rompack/rompack';
import { insavegame, onload } from '../serializer/gameserializer';
import type { PhysicsBodyDesc } from './physicsbody';
import { PhysicsComponent, PhysicsComponentOptions } from './physicscomponent';

/**
 * PhysicsDescriptorComponent
 * Serializes a lightweight immutable descriptor of a physics body. On load it re-attaches a runtime-only PhysicsComponent.
 * Keeps save data deterministic (no transient velocities/forces stored) while allowing runtime body recreation.
 */
@insavegame
@componenttags_preprocessing('physics_pre')
@componenttags_postprocessing('physics_post')
export class PhysicsDescriptorComponent extends Component {
    shape: PhysicsBodyDesc['shape'];
    mass: number; restitution: number; friction: number; isTrigger: boolean; layer: number; mask: number;
    syncAxis?: { x?: boolean; y?: boolean; z?: boolean };
    writeBack: boolean = true;
    constructor(parent: Identifier, desc?: { shape: PhysicsBodyDesc['shape']; mass?: number; restitution?: number; friction?: number; isTrigger?: boolean; layer?: number; mask?: number; syncAxis?: { x?: boolean; y?: boolean; z?: boolean }; writeBack?: boolean /* future: bodyType?: PhysicsBodyDesc['type'] */ }) {
        super(parent);
        // Reviver may call ctor with undefined; defer full init till @onload if so.
        if (desc && desc.shape) {
            this.shape = desc.shape; this.mass = desc.mass ?? 0; this.restitution = desc.restitution ?? 0; this.friction = desc.friction ?? 0.2; this.isTrigger = !!desc.isTrigger; this.layer = desc.layer ?? 1; this.mask = desc.mask ?? 0xFFFFFFFF; this.syncAxis = desc.syncAxis; this.writeBack = desc.writeBack ?? true;
            this.attachRuntime();
        } else {
            // Safe defaults; will be overwritten by deserialized fields before @onload
            this.shape = { kind: 'aabb', halfExtents: [0, 0, 0] } as any;
            this.mass = 0; this.restitution = 0; this.friction = 0.2; this.isTrigger = false; this.layer = 1; this.mask = 0xFFFFFFFF;
        }
    }
    private attachRuntime() {
        const parent = $.model.getGameObject(this.parentid); if (!parent) return;
        if (parent.getComponent(PhysicsComponent)) return;
        console.log('[PhysicsDescriptorComponent] Attaching runtime physics to', parent.id);
        // NOTE: Do NOT force 'kinematic' here. Kinematic bodies were never integrated in PhysicsWorld.step,
        // causing everything spawned via descriptor to freeze. Default behavior should remain
        // dynamic (mass>0) or static (mass==0). If explicit kinematic support is added later,
        // pass a 'type' through the desc and ensure PhysicsWorld integrates it.
        const opts: PhysicsComponentOptions = {
            shape: this.shape,
            mass: this.mass,
            restitution: this.restitution,
            friction: this.friction,
            isTrigger: this.isTrigger,
            layer: this.layer,
            mask: this.mask,
            syncAxis: this.syncAxis,
            writeBack: this.writeBack,
            // type: desc?.bodyType // future extension
        };
        parent.addComponent(new PhysicsComponent(this.parentid, opts));
    }
    @onload restore() { this.attachRuntime(); }
    // No-op update hooks (tags present so descriptor participates consistently if needed)
    override preprocessingUpdate(): void { }
    override postprocessingUpdate(): void { }
}
