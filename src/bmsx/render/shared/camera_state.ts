import type { vec3 } from '../../rompack/rompack';
import { resolveActiveCamera3D } from './hardware_camera';

export type ResolvedCameraState = {
	view: Float32Array;
	proj: Float32Array;
	viewProj: Float32Array;
	skyboxView: Float32Array;
	camPos: vec3;
};

export function resolveCameraState(): ResolvedCameraState | null {
	const cam = resolveActiveCamera3D();
	if (!cam) {
		return null;
	}
	const mats = cam.getMatrices();
	return {
		view: mats.view,
		proj: mats.proj,
		viewProj: mats.vp,
		skyboxView: cam.skyboxView,
		camPos: cam.position,
	};
}
