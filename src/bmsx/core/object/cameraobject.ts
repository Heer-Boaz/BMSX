import { Camera } from '../../render/3d/camera3d';
import { quat, V3 } from '../../render/3d/math3d';
import type { Oriented, vec3 } from '../../rompack/rompack';
import { insavegame, type RevivableObjectArgs } from 'bmsx/serializer/serializationhooks';
import { WorldObject } from './worldobject';

@insavegame
export class CameraObject extends WorldObject implements Oriented {
	public camera: Camera;

	public get rotationQ(): quat {
		return this.camera.rotationQ;
	}

	constructor(opts?: RevivableObjectArgs & { id?: string, fsm_id?: string }) {
		super(opts);
		if (opts?.constructReason === 'revive') return;

		this.camera = new Camera(opts);
		this.active = true;
	}

	override onspawn(pos?: vec3): void {
		super.onspawn(pos);
		this.camera.position = V3.of(this.pos.x, this.pos.y, this.pos.z);
		this.camera.markDirty();
	}

	override dispose(): void {
		super.dispose();
	}
}
