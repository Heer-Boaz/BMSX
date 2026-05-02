import type { vec3 } from '../../rompack/format';
import { hardwareCameraBank0 } from './hardware/camera';

export type ResolvedCameraState = {
	view: Float32Array;
	proj: Float32Array;
	viewProj: Float32Array;
	skyboxView: Float32Array;
	camPos: vec3;
};

export function resolveCameraState(): ResolvedCameraState {
	const cam = hardwareCameraBank0;
	const mats = cam.getMatrices();
	return {
		view: mats.view,
		proj: mats.proj,
		viewProj: mats.vp,
		skyboxView: cam.skyboxView,
		camPos: cam.position,
	};
}
