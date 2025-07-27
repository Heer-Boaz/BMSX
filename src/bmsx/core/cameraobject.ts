import { Camera3D } from '../render/3d/camera3d';
import { GLView } from '../render/glview';
import * as GLView3D from '../render/3d/glview.3d';
import type { Vector } from '../rompack/rompack';
import { insavegame } from '../serializer/gameserializer';
import { GameObject } from './gameobject';

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

    public applyToView(_view: GLView): void {
        GLView3D.setCameraPosition(this.camera.position);
        GLView3D.pointCameraAt(this.camera.target);
        GLView3D.setCameraViewDepth(this.camera.near, this.camera.far);
        if (this.camera.projection === 'orthographic') {
            GLView3D.useOrthographicCamera(this.camera.orthoWidth, this.camera.orthoHeight);
        } else {
            GLView3D.usePerspectiveCamera(this.camera.fov);
        }
    }

}
