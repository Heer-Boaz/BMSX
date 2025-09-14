import { WorldObject } from '../core/object/worldobject';
import { M4, Mat4Float32, quat } from '../render/3d/math3d';
import type { Oriented, Scaled, vec3arr } from '../rompack/rompack';
import { insavegame } from 'bmsx/serializer/serializationhooks';
import { Component, type ComponentAttachOptions } from './basecomponent';

@insavegame
export class TransformComponent extends Component<WorldObject> {
	static unique = true;
	public position: vec3arr;
	// public rotation: vec3arr; // retained for legacy callers; not authoritative if parent supplies quaternion
	private orientationQ: quat = { x: 0, y: 0, z: 0, w: 1 }; // authoritative when parent implements Oriented
	public scale: vec3arr;

	private _parentNode: TransformComponent | null = null;
	private children: TransformComponent[] = [];

	private localMatrix: Mat4Float32 = new Float32Array(16);
	private worldMatrix: Mat4Float32 = new Float32Array(16);
	private dirty = true;

	constructor(opts: ComponentAttachOptions & { position?: vec3arr; scale?: vec3arr; orientationQ?: quat }) {
		super(opts);
		this.position = opts?.position ?? [0, 0, 0];
		this.scale = opts?.scale ?? [1, 1, 1];
		this.orientationQ ??= opts?.orientationQ;
		M4.setIdentity(this.localMatrix);
		M4.setIdentity(this.worldMatrix);
	}

	public get parentNode(): TransformComponent | null {
		return this._parentNode;
	}

	public set parentNode(p: TransformComponent | null) {
		if (this._parentNode === p) return;
		if (this._parentNode) {
			const idx = this._parentNode.children.indexOf(this);
			if (idx >= 0) this._parentNode.children.splice(idx, 1);
		}
		this._parentNode = p;
		if (p) p.children.push(this);
		this.markDirty();
	}

	public markDirty(): void {
		if (!this.dirty) {
			this.dirty = true;
			for (const c of this.children) c.markDirty();
		}
	}

	private updateMatrices(): void {
		M4.fromTRSInto(
			this.localMatrix,
			[this.position[0], this.position[1], this.position[2]],
			[this.orientationQ.x, this.orientationQ.y, this.orientationQ.z, this.orientationQ.w],
			[this.scale[0], this.scale[1], this.scale[2]]
		);
		if (this._parentNode) {
			const pw = this._parentNode.getWorldMatrix();
			M4.mulAffineInto(this.worldMatrix, pw, this.localMatrix);
		} else {
			M4.copyInto(this.worldMatrix, this.localMatrix);
		}
		this.dirty = false;
	}

	public getWorldMatrix(): Mat4Float32 {
		if (this.dirty) this.updateMatrices();
		return this.worldMatrix;
	}

	override postprocessingUpdate(): void {
		const parent = this.parentAs<WorldObject & Oriented & Scaled>();

		if (parent.pos) {
			this.position[0] = parent.x;
			this.position[1] = parent.y;
			this.position[2] = parent.z;
		}

		const oriented = parent as Oriented;
		if (oriented.rotationQ) {
			this.orientationQ = oriented.rotationQ;
		}

		if (parent.scale) {
			this.scale[0] = parent.scale[0];
			this.scale[1] = parent.scale[1];
			this.scale[2] = parent.scale[2];
		}

		this.markDirty();
	}
}
