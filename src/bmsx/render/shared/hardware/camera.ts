import { Camera } from '../../3d/camera';
import { new_vec3 } from '../../../common/vector';
import { Q } from '../../3d/math';

const RESET_CAMERA_ASPECT = 256 / 212;
const RESET_CAMERA_FOV_DEGREES = 60;
const RESET_CAMERA_NEAR = 0.1;
const RESET_CAMERA_FAR = 50;
export const hardwareCameraBank0 = new Camera();

resetHardwareCameraBank0();

export function resetHardwareCameraBank0(): void {
	hardwareCameraBank0.position = new_vec3(0, 0, 0);
	hardwareCameraBank0.setRotationQ(Q.ident(), true);
	hardwareCameraBank0.projectionType = 'perspective';
	hardwareCameraBank0.setAspect(RESET_CAMERA_ASPECT);
	hardwareCameraBank0.setFov(RESET_CAMERA_FOV_DEGREES);
	hardwareCameraBank0.setClip(RESET_CAMERA_NEAR, RESET_CAMERA_FAR);
}
