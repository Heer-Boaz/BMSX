import { Component, componenttags_postprocessing, componenttags_preprocessing } from '../component/basecomponent';
import { $ } from '../core/game';
import { GameObject } from '../core/gameobject';
import { new_vec3 } from '../core/utils';
import type { Identifier, Oriented } from '../rompack/rompack';
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
@componenttags_postprocessing('physics_post') // Postprocessing update to check for, and handle, collisions or leaving the screen, etc.
export class PhysicsComponent extends Component {
	body: PhysicsBody | null = null;
	syncAxis = { x: true, y: true, z: true };
	writeBack = true; // if true: body -> GameObject each frame (default true)
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
		this.linearDamping = opts.linearDamping ?? 0;
		this.angularDamping = opts.angularDamping ?? 0;
		if (opts.angularVelocity) this.angularVelocity = opts.angularVelocity;
		this.isTrigger = !!opts.isTrigger;
		this.isKinematic = opts.type === 'kinematic';
		this.tryBuildBody();
	}

	override preprocessingUpdate(): void {
		// Ensure body is created when the parent GameObject becomes available
		this.tryBuildBody();

		// Temporary aggressive sync: always copy GameObject -> physics body before physics step.
		// This is a diagnostic change to confirm whether lack of sync is the root cause.
		if (this.body && !this.writeBack) {
			const go = $.model.getGameObject(this.parentid);
			if (go) {
				let positionChanged = false;
				if (this.syncAxis.x && this.body.position.x !== go.x) {
					this.body.position.x = go.x;
					positionChanged = true;
				}
				if (this.syncAxis.y && this.body.position.y !== go.y) {
					this.body.position.y = go.y;
					positionChanged = true;
				}
				if (this.syncAxis.z && this.body.position.z !== go.z) {
					this.body.position.z = go.z;
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
		const go = $.model.getGameObject<GameObject & Oriented>(this.parentid);
		if (!go) return;
		const beforeX = go.x_nonotify, beforeY = go.y_nonotify, beforeZ = go.z_nonotify;
		if (this.syncAxis.x) go.x_nonotify = this.body.position.x;
		if (this.syncAxis.y) go.y_nonotify = this.body.position.y;
		if (this.syncAxis.z) go.z_nonotify = this.body.position.z;
		// Orientation sync (if GameObject supports quaternion fields qx,qy,qz,qw)
		if (go.rotationQ) {
			go.rotationQ.x = this.body.rotationQ.x;
			go.rotationQ.y = this.body.rotationQ.y;
			go.rotationQ.z = this.body.rotationQ.z;
			go.rotationQ.w = this.body.rotationQ.w;
		}
		// if (PhysicsComponent._debugFrames < 5) {
		// 	if (beforeX !== go.x_nonotify || beforeY !== go.y_nonotify || beforeZ !== go.z_nonotify) {
		// 		// console.log(`[PhysSync]`, this.parentid, `body`, this.body.position, `goBefore: [${beforeX}, ${beforeY}, ${beforeZ}] goAfter: [${go.x_nonotify}, ${go.y_nonotify}, ${go.z_nonotify}]`);
		// 	}
		// 	// else console.log(`No update: [${beforeX}, ${beforeY}, ${beforeZ}] -> [${go.x_nonotify}, ${go.y_nonotify}, ${go.z_nonotify}]`);
		// 	PhysicsComponent._debugFrames++;
		// }
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
		// console.log('[PhysicsComponent] Building body for', go.id, 'at position', startPos, 'shape:', this.shape, 'mass:', this.mass, 'layer:', this.layer, 'mask:', this.mask);
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
			userData: go.id,
			layer: this.layer,
			mask: this.mask
		});
		this._bodyBuilt = true;
	}
}