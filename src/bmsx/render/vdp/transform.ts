import { decodeSignedQ16_16 } from '../../machine/devices/vdp/fixed_point';
import { extractFrustumPlanesInto, M4 } from '../3d/math';

export type VdpTransformSnapshot = {
	view: Float32Array;
	proj: Float32Array;
	viewProj: Float32Array;
	skyboxView: Float32Array;
	frustumPlanes: Float32Array;
	eye: Float32Array;
};

export function createVdpTransformSnapshot(): VdpTransformSnapshot {
	return {
		view: new Float32Array(16),
		proj: new Float32Array(16),
		viewProj: new Float32Array(16),
		skyboxView: new Float32Array(16),
		frustumPlanes: new Float32Array(24),
		eye: new Float32Array(3),
	};
}

export function resolveVdpTransformSnapshot(target: VdpTransformSnapshot, viewMatrixWords: ArrayLike<number>, projectionMatrixWords: ArrayLike<number>): void {
	for (let index = 0; index < 16; index += 1) {
		target.view[index] = decodeSignedQ16_16(viewMatrixWords[index] >>> 0);
		target.proj[index] = decodeSignedQ16_16(projectionMatrixWords[index] >>> 0);
	}
	M4.mulInto(target.viewProj, target.proj, target.view);
	M4.skyboxFromViewInto(target.skyboxView, target.view);
	extractFrustumPlanesInto(target.frustumPlanes, target.viewProj);
	M4.affineViewEyeInto(target.eye, target.view, target.skyboxView);
}
