import { Component } from '../component/basecomponent';
import { $ } from '../core/game';
import { WorldObject } from '../core/object/worldobject';
import { new_vec3 } from '../utils/utils';
import type { Identifier, Oriented } from '../rompack/rompack';
import { excludeclassfromsavegame, type RevivableObjectArgs } from 'bmsx/serializer/serializationhooks';
import { PhysicsBody, PhysicsBodyDesc } from './physicsbody';
import { PhysicsWorld } from './physicsworld';

export interface PhysicsComponentOptions extends Omit<PhysicsBodyDesc, 'position'> {
	syncAxis?: { x?: boolean; y?: boolean; z?: boolean }; // selective axis sync
	writeBack?: boolean; // if true: body -> WorldObject each frame (default true)
	layer?: number; // collision layer bit (0..31)
	mask?: number; // collision mask bits
}

@excludeclassfromsavegame
export class PhysicsComponent extends Component {
	static unique = true;
	body: PhysicsBody | null = null;
	syncAxis = { x: true, y: true, z: true };
	writeBack = true; // if true: body -> WorldObject each frame (default true)
	layer = 1;
	mask = 0xFFFFFFFF;
	private shape!: PhysicsBodyDesc['shape'];
	private mass = 0;
	private restitution = 0;
	private friction = 0.2;
	private linearDamping = 0;
	private angularDamping = 0;
	private angularVelocity = new_vec3(0, 0, 0);
	private isTrigger = false;
	private isKinematic = false;
	private _bodyBuilt = false;

	constructor(opts: RevivableObjectArgs & { parentid: Identifier, physicsOptions: PhysicsComponentOptions }) {
		super(opts);
		this.syncAxis = { ...this.syncAxis, ...(opts.physicsOptions.syncAxis || {}) };
		this.writeBack = opts.physicsOptions.writeBack ?? true;
		this.layer = opts.physicsOptions.layer ?? 1;
		this.mask = opts.physicsOptions.mask ?? 0xFFFFFFFF;
		this.shape = opts.physicsOptions.shape;
		this.mass = opts.physicsOptions.mass ?? 0;
		this.restitution = opts.physicsOptions.restitution ?? 0;
		this.friction = opts.physicsOptions.friction ?? 0.2;
		this.linearDamping = opts.physicsOptions.linearDamping ?? 0;
		this.angularDamping = opts.physicsOptions.angularDamping ?? 0;
		if (opts.physicsOptions.angularVelocity) this.angularVelocity = opts.physicsOptions.angularVelocity;
		this.isTrigger = !!opts.physicsOptions.isTrigger;
		this.isKinematic = opts.physicsOptions.type === 'kinematic';
		this.tryBuildBody();
	}

	override preprocessingUpdate(): void {
		// Ensure body is created when the parent WorldObject becomes available
		this.tryBuildBody();

		// Temporary aggressive sync: always copy WorldObject -> physics body before physics step.
		// This is a diagnostic change to confirm whether lack of sync is the root cause.
		if (this.body && !this.writeBack) {
			const wo = $.world.getWorldObject(this.parentid);
			if (wo) {
				let positionChanged = false;
				if (this.syncAxis.x && this.body.position.x !== wo.x) {
					this.body.position.x = wo.x;
					positionChanged = true;
				}
				if (this.syncAxis.y && this.body.position.y !== wo.y) {
					this.body.position.y = wo.y;
					positionChanged = true;
				}
				if (this.syncAxis.z && this.body.position.z !== wo.z) {
					this.body.position.z = wo.z;
					positionChanged = true;
				}

				// Mark body dirty if position changed so broadphase updates
				if (positionChanged) {
					// console.log('[PhysAggSync]', this.parentid, 'sync -> body pos', this.body.position);
					const world = PhysicsWorld.ensure();
					world.markBodyDirty(this.body); // Mark dirty without requiring dynamic body
				}
			}
		}
	}

	override postprocessingUpdate(): void {
		if (!this.body) return;
		if (!this.writeBack) return;
		const wo = $.world.getWorldObject<WorldObject & Oriented>(this.parentid);
		if (!wo) return;
		if (this.syncAxis.x) wo.x_nonotify = this.body.position.x;
		if (this.syncAxis.y) wo.y_nonotify = this.body.position.y;
		if (this.syncAxis.z) wo.z_nonotify = this.body.position.z;
		// Orientation sync (if WorldObject supports quaternion fields qx,qy,qz,qw)
		if (wo.rotationQ) {
			wo.rotationQ.x = this.body.rotationQ.x;
			wo.rotationQ.y = this.body.rotationQ.y;
			wo.rotationQ.z = this.body.rotationQ.z;
			wo.rotationQ.w = this.body.rotationQ.w;
		}
	// if (PhysicsComponent._debugFrames < 5) {
		// 	if (beforeX !== wo.x_nonotify || beforeY !== wo.y_nonotify || beforeZ !== wo.z_nonotify) {
		// 		// console.log(`[PhysSync]`, this.parentid, `body`, this.body.position, `goBefore: [${beforeX}, ${beforeY}, ${beforeZ}] goAfter: [${wo.x_nonotify}, ${wo.y_nonotify}, ${wo.z_nonotify}]`);
		// 	}
		// 	// else console.log(`No update: [${beforeX}, ${beforeY}, ${beforeZ}] -> [${wo.x_nonotify}, ${wo.y_nonotify}, ${wo.z_nonotify}]`);
		// 	PhysicsComponent._debugFrames++;
		// }
	}

	// private static _debugFrames = 0; // removed (unused)

	override dispose(): void {
		super.dispose();
		const world = $.get<PhysicsWorld>('physics_world');
		if (world && this.body) world.removeBody(this.body);
		this.body = null;
	}

	private tryBuildBody() {
		if (this._bodyBuilt) return;
		const world = PhysicsWorld.ensure();
		const wo = $.world.getWorldObject(this.parentid);
		if (!wo) return; // parent not yet available
		const startPos = new_vec3(wo.x, wo.y, wo.z);
		// console.log('[PhysicsComponent] Building body for', wo.id, 'at position', startPos, 'shape:', this.shape, 'mass:', this.mass, 'layer:', this.layer, 'mask:', this.mask);
		this.body = world.addBody({
			position: startPos,
			shape: this.shape,
			mass: this.mass,
			restitution: this.restitution,
			friction: this.friction,
			linearDamping: this.linearDamping,
			angularDamping: this.angularDamping,
			angularVelocity: this.angularVelocity,
			isTrigger: this.isTrigger,
			type: this.isKinematic ? 'kinematic' : undefined,
			userData: wo.id,
			layer: this.layer,
			mask: this.mask
		});
		this._bodyBuilt = true;
	}
}
