import { GameObject } from './gameobject';
import { Camera3D } from '../render/camera3d';
import { GLView } from '../render/glview';
import { insavegame } from '../serializer/gameserializer';
import type { Vector } from '../rompack/rompack';

@insavegame
export class CameraObject extends GameObject {
    public camera: Camera3D;
    public active: boolean;

    constructor(id?: string) {
        super(id);
        this.camera = new Camera3D();
        this.active = true;
    }

    override onspawn(pos?: Vector): void {
        super.onspawn(pos);
        if (!$.model.activeCameraId) {
            $.model.setActiveCamera(this.id);
        }
    }

    override dispose(): void {
        if ($.model.activeCameraId === this.id) $.model.activeCameraId = null;
        super.dispose();
    }

    public applyToView(view: GLView): void {
        view.setCameraPosition(this.camera.position);
        view.pointCameraAt(this.camera.target);
        view.setCameraViewDepth(this.camera.near, this.camera.far);
        if (this.camera.projection === 'orthographic') {
            view.useOrthographicCamera(this.camera.orthoWidth, this.camera.orthoHeight);
        } else {
            view.usePerspectiveCamera(this.camera.fov);
        }
    }

}
