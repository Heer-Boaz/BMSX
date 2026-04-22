import { Camera } from '../../3d/camera';

const hardwareCamera = new Camera();
let hardwareCameraActive = false;

export function setHardwareCamera(view: Float32Array, proj: Float32Array, eyeX: number, eyeY: number, eyeZ: number): void {
	hardwareCamera.setExternalMatrices(view, proj, eyeX, eyeY, eyeZ);
	hardwareCameraActive = true;
}

export function clearHardwareCamera(): void {
	hardwareCameraActive = false;
}

export function resolveActiveCamera3D(): Camera | null {
	if (hardwareCameraActive) {
		return hardwareCamera;
	}
	return null;
}
