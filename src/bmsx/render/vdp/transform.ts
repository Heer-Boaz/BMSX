import { decodeSignedQ16_16 } from '../../common/fixed_point';
import { VDP_XF_MATRIX_WORDS } from '../../machine/devices/vdp/xf';
import { extractFrustumPlanesInto, M4 } from '../3d/math';

export type VdpTransformSnapshot = {
	view: Float32Array;
	proj: Float32Array;
	viewProj: Float32Array;
	viewRotationInverse: Float32Array;
	frustumPlanes: Float32Array;
	eye: Float32Array;
};

export function createVdpTransformSnapshot(): VdpTransformSnapshot {
	return {
		view: new Float32Array(16),
		proj: new Float32Array(16),
		viewProj: new Float32Array(16),
		viewRotationInverse: new Float32Array(16),
		frustumPlanes: new Float32Array(24),
		eye: new Float32Array(3),
	};
}

export function resolveVdpTransformSnapshot(target: VdpTransformSnapshot, matrixWords: ArrayLike<number>, viewMatrixIndex: number, projectionMatrixIndex: number): void {
	const viewBase = viewMatrixIndex * VDP_XF_MATRIX_WORDS;
	const projectionBase = projectionMatrixIndex * VDP_XF_MATRIX_WORDS;
	for (let index = 0; index < 16; index += 1) {
		target.view[index] = decodeSignedQ16_16(matrixWords[viewBase + index] >>> 0);
		target.proj[index] = decodeSignedQ16_16(matrixWords[projectionBase + index] >>> 0);
	}
	M4.mulInto(target.viewProj, target.proj, target.view);
	M4.viewRotationInverseFromViewInto(target.viewRotationInverse, target.view);
	extractFrustumPlanesInto(target.frustumPlanes, target.viewProj);
	M4.affineViewEyeInto(target.eye, target.view, target.viewRotationInverse);
}
