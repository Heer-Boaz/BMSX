import { Component, type ComponentAttachOptions } from '../component/basecomponent';
import { $ } from '../core/game';
import { new_vec3 } from '../utils/vector_operations';
import { insavegame, onload } from '../serializer/serializationhooks';
import type { PhysicsBodyDesc } from './physicsbody';
import { PhysicsComponent, PhysicsComponentOptions } from './physicscomponent';

/**
 * PhysicsDescriptorComponent
 * Serializes a lightweight immutable descriptor of a physics body. On load it re-attaches a runtime-only PhysicsComponent.
 * Keeps save data deterministic (no transient velocities/forces stored) while allowing runtime body recreation.
 */
@insavegame
export class PhysicsDescriptorComponent extends Component {
	static override get unique() { return true; }
	shape: PhysicsBodyDesc['shape'];
	mass: number; restitution: number; friction: number; isTrigger: boolean; layer: number; mask: number;
	syncAxis?: { x?: boolean; y?: boolean; z?: boolean };
	writeBack: boolean = true;
	constructor(opts: ComponentAttachOptions & { shape: PhysicsBodyDesc['shape']; mass?: number; restitution?: number; friction?: number; isTrigger?: boolean; layer?: number; mask?: number; syncAxis?: { x?: boolean; y?: boolean; z?: boolean }; writeBack?: boolean /* future: bodyType?: PhysicsBodyDesc['type'] */ }) {
		super(opts);
		// Reviver may call ctor with undefined; defer full init till @onload if so.
		if (opts.shape) {
			this.shape = opts.shape; this.mass = opts.mass ?? 0; this.restitution = opts.restitution ?? 0; this.friction = opts.friction ?? 0.2; this.isTrigger = !!opts.isTrigger; this.layer = opts.layer ?? 1; this.mask = opts.mask ?? 0xFFFFFFFF; this.syncAxis = opts.syncAxis; this.writeBack = opts.writeBack ?? true;
			this.attachRuntime();
		} else {
			// Safe defaults; will be overwritten by deserialized fields before @onload
			this.shape = { kind: 'aabb', halfExtents: new_vec3(0, 0, 0) };
			this.mass = 0; this.restitution = 0; this.friction = 0.2; this.isTrigger = false; this.layer = 1; this.mask = 0xFFFFFFFF;
		}
	}
	private attachRuntime() {
		const parent = $.world.getWorldObject(this.parentid);
		if (!parent) {
			throw new Error(`[PhysicsDescriptorComponent] Parent '${this.parentid}' not found while attaching physics runtime.`);
		}
		if (parent.get_unique_component(PhysicsComponent)) return;
		// console.log('[PhysicsDescriptorComponent] Attaching runtime physics to', parent.id);
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
			// type: desc.bodyType // future extension
		};
		parent.add_component(new PhysicsComponent({ parentid: this.parentid, physicsOptions: opts }));
	}
	@onload restore() { this.attachRuntime(); }
	// No-op update hooks (tags present so descriptor participates consistently if needed)
	override preprocessingUpdate(): void { }
	override postprocessingUpdate(): void { }
}
