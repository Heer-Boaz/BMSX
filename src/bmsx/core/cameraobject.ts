import { Camera } from '../render/3d/camera3d';
import { quat, V3 } from '../render/3d/math3d';
import type { Oriented } from '../rompack/rompack';
import { insavegame } from '../serializer/gameserializer';
import { GameObject } from './gameobject';

@insavegame
export class CameraObject extends GameObject implements Oriented {
    public camera: Camera;
    public active: boolean;

    public get rotationQ(): quat {
        return this.camera.rotationQ;
    }

    constructor(id?: string) {
        super(id);
        this.camera = new Camera();
        this.active = true;
    }

    override onspawn(pos?: import('../rompack/rompack').vec3): void {
        super.onspawn(pos);
        this.camera.position = V3.of(this.pos.x, this.pos.y, this.pos.z);
        this.camera.markDirty();
    }

    override run(): void {
        super.run();
        this.x_nonotify = this.camera.position.x;
        this.y_nonotify = this.camera.position.y;
        this.z_nonotify = this.camera.position.z;
    }

    override dispose(): void {
        super.dispose();
    }
}
