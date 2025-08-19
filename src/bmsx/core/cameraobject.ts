import { Camera } from '../render/3d/camera3d';
import type { Vector } from '../rompack/rompack';
import { insavegame } from '../serializer/gameserializer';
import { GameObject } from './gameobject';

@insavegame
export class CameraObject extends GameObject {
    public camera: Camera;
    public active: boolean;

    constructor(id?: string) {
        super(id);
        this.camera = new Camera();
        this.active = true;
    }

    override onspawn(pos?: Vector): void {
        super.onspawn(pos);
    }

    override dispose(): void {
        super.dispose();
    }
}
