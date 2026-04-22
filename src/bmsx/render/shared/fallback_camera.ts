import { M4 } from '../3d/math';

export interface FallbackCameraState {
	width: number;
	height: number;
	viewProj: Float32Array;
	camRight: Float32Array;
	camUp: Float32Array;
}

const fallbackViewProj = new Float32Array(16);
const fallbackCamRight = new Float32Array([1, 0, 0]);
const fallbackCamUp = new Float32Array([0, -1, 0]);

const fallbackCameraState: FallbackCameraState = {
	width: 1,
	height: 1,
	viewProj: fallbackViewProj,
	camRight: fallbackCamRight,
	camUp: fallbackCamUp,
};

export function updateFallbackCamera(width: number, height: number): FallbackCameraState {
	fallbackCameraState.width = width;
	fallbackCameraState.height = height;
	M4.orthographicInto(fallbackViewProj, 0, fallbackCameraState.width, fallbackCameraState.height, 0, -1, 1);
	fallbackCamRight[0] = 1; fallbackCamRight[1] = 0; fallbackCamRight[2] = 0;
	fallbackCamUp[0] = 0; fallbackCamUp[1] = -1; fallbackCamUp[2] = 0;
	return fallbackCameraState;
}

export const FALLBACK_CAMERA = fallbackCameraState;
