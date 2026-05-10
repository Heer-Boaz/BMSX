import { decodeSignedQ16_16, decodeTurn16, decodeUnsignedQ16_16 } from './fixed_point';

export type VdpCameraState = {
	eyeXWord: number;
	eyeYWord: number;
	eyeZWord: number;
	yawWord: number;
	pitchWord: number;
	rollWord: number;
	focalYWord: number;
};

export type VdpCameraSnapshot = {
	view: Float32Array;
	proj: Float32Array;
	viewProj: Float32Array;
	skyboxView: Float32Array;
	frustumPlanes: Float32Array;
	eye: Float32Array;
};

export const VDP_CAMERA_PACKET_KIND = 0x10000000;
export const VDP_CAMERA_PACKET_PAYLOAD_WORDS = 7;

const RESET_CAMERA_ASPECT = 256 / 212;
const RESET_CAMERA_NEAR = 0.1;
const RESET_CAMERA_FAR = 50;
const RESET_CAMERA_DEPTH = (RESET_CAMERA_FAR + RESET_CAMERA_NEAR) / (RESET_CAMERA_NEAR - RESET_CAMERA_FAR);
const RESET_CAMERA_DEPTH_OFFSET = (2 * RESET_CAMERA_FAR * RESET_CAMERA_NEAR) / (RESET_CAMERA_NEAR - RESET_CAMERA_FAR);
export const VDP_CAMERA_RESET_FOCAL_Y_WORD = 0x0001bb68;

export function createVdpCameraSnapshot(): VdpCameraSnapshot {
	return {
		view: new Float32Array(16),
		proj: new Float32Array(16),
		viewProj: new Float32Array(16),
		skyboxView: new Float32Array(16),
		frustumPlanes: new Float32Array(24),
		eye: new Float32Array(3),
	};
}

function setProjectionFromFocalY(out: Float32Array, focalY: number): void {
	out[0] = focalY / RESET_CAMERA_ASPECT; out[1] = 0; out[2] = 0; out[3] = 0;
	out[4] = 0; out[5] = focalY; out[6] = 0; out[7] = 0;
	out[8] = 0; out[9] = 0; out[10] = RESET_CAMERA_DEPTH; out[11] = -1;
	out[12] = 0; out[13] = 0; out[14] = RESET_CAMERA_DEPTH_OFFSET; out[15] = 0;
}

function multiplyMat4Into(out: Float32Array, a: Float32Array, b: Float32Array): void {
	const b0 = b[0], b1 = b[1], b2 = b[2], b3 = b[3];
	const b4 = b[4], b5 = b[5], b6 = b[6], b7 = b[7];
	const b8 = b[8], b9 = b[9], b10 = b[10], b11 = b[11];
	const b12 = b[12], b13 = b[13], b14 = b[14], b15 = b[15];
	for (let i = 0; i < 4; i += 1) {
		const ai0 = a[i], ai1 = a[i + 4], ai2 = a[i + 8], ai3 = a[i + 12];
		out[i] = ai0 * b0 + ai1 * b1 + ai2 * b2 + ai3 * b3;
		out[i + 4] = ai0 * b4 + ai1 * b5 + ai2 * b6 + ai3 * b7;
		out[i + 8] = ai0 * b8 + ai1 * b9 + ai2 * b10 + ai3 * b11;
		out[i + 12] = ai0 * b12 + ai1 * b13 + ai2 * b14 + ai3 * b15;
	}
}

function skyboxFromViewInto(out: Float32Array, view: Float32Array): void {
	out[0] = view[0]; out[1] = view[4]; out[2] = view[8]; out[3] = 0;
	out[4] = view[1]; out[5] = view[5]; out[6] = view[9]; out[7] = 0;
	out[8] = view[2]; out[9] = view[6]; out[10] = view[10]; out[11] = 0;
	out[12] = 0; out[13] = 0; out[14] = 0; out[15] = 1;
}

function extractFrustumPlanesInto(out: Float32Array, viewProjection: Float32Array): void {
	const m = viewProjection;
	out[0] = m[3] + m[0]; out[1] = m[7] + m[4]; out[2] = m[11] + m[8]; out[3] = m[15] + m[12];
	out[4] = m[3] - m[0]; out[5] = m[7] - m[4]; out[6] = m[11] - m[8]; out[7] = m[15] - m[12];
	out[8] = m[3] + m[1]; out[9] = m[7] + m[5]; out[10] = m[11] + m[9]; out[11] = m[15] + m[13];
	out[12] = m[3] - m[1]; out[13] = m[7] - m[5]; out[14] = m[11] - m[9]; out[15] = m[15] - m[13];
	out[16] = m[3] + m[2]; out[17] = m[7] + m[6]; out[18] = m[11] + m[10]; out[19] = m[15] + m[14];
	out[20] = m[3] - m[2]; out[21] = m[7] - m[6]; out[22] = m[11] - m[10]; out[23] = m[15] - m[14];
	for (let index = 0; index < 6; index += 1) {
		const base = index * 4;
		const len = Math.hypot(out[base], out[base + 1], out[base + 2]) || 1;
		out[base] /= len;
		out[base + 1] /= len;
		out[base + 2] /= len;
		out[base + 3] /= len;
	}
}

function setViewFromPoseInto(out: Float32Array, eyeX: number, eyeY: number, eyeZ: number, yawWord: number, pitchWord: number, rollWord: number): void {
	const yaw = decodeTurn16(yawWord);
	const pitch = decodeTurn16(pitchWord);
	const roll = decodeTurn16(rollWord);
	const cy = Math.cos(yaw);
	const sy = -Math.sin(yaw);
	const cp = Math.cos(pitch);
	const sp = Math.sin(pitch);
	const cr = Math.cos(roll);
	const sr = Math.sin(roll);
	const r00 = cy * cr + sy * sp * sr;
	const r01 = sr * cp;
	const r02 = -sy * cr + cy * sp * sr;
	const r10 = -cy * sr + sy * sp * cr;
	const r11 = cr * cp;
	const r12 = sr * sy + cy * sp * cr;
	const r20 = sy * cp;
	const r21 = -sp;
	const r22 = cy * cp;
	out[0] = r00; out[4] = r01; out[8] = r02; out[12] = -(r00 * eyeX + r01 * eyeY + r02 * eyeZ);
	out[1] = r10; out[5] = r11; out[9] = r12; out[13] = -(r10 * eyeX + r11 * eyeY + r12 * eyeZ);
	out[2] = r20; out[6] = r21; out[10] = r22; out[14] = -(r20 * eyeX + r21 * eyeY + r22 * eyeZ);
	out[3] = 0; out[7] = 0; out[11] = 0; out[15] = 1;
}

export class VdpCameraUnit {
	public readonly snapshot = createVdpCameraSnapshot();
	public readonly pose: VdpCameraState = {
		eyeXWord: 0,
		eyeYWord: 0,
		eyeZWord: 0,
		yawWord: 0,
		pitchWord: 0,
		rollWord: 0,
		focalYWord: VDP_CAMERA_RESET_FOCAL_Y_WORD,
	};

	public constructor() {
		this.reset();
	}

	public reset(): void {
		this.pose.eyeXWord = 0;
		this.pose.eyeYWord = 0;
		this.pose.eyeZWord = 0;
		this.pose.yawWord = 0;
		this.pose.pitchWord = 0;
		this.pose.rollWord = 0;
		this.pose.focalYWord = VDP_CAMERA_RESET_FOCAL_Y_WORD;
		this.rebuildFromPose();
	}

	public writePosePacket(eyeXWord: number, eyeYWord: number, eyeZWord: number, yawWord: number, pitchWord: number, rollWord: number, focalYWord: number): void {
		this.pose.eyeXWord = eyeXWord >>> 0;
		this.pose.eyeYWord = eyeYWord >>> 0;
		this.pose.eyeZWord = eyeZWord >>> 0;
		this.pose.yawWord = yawWord >>> 0;
		this.pose.pitchWord = pitchWord >>> 0;
		this.pose.rollWord = rollWord >>> 0;
		this.pose.focalYWord = focalYWord >>> 0;
		this.rebuildFromPose();
	}

	private rebuildFromPose(): void {
		const eyeX = decodeSignedQ16_16(this.pose.eyeXWord);
		const eyeY = decodeSignedQ16_16(this.pose.eyeYWord);
		const eyeZ = decodeSignedQ16_16(this.pose.eyeZWord);
		setViewFromPoseInto(this.snapshot.view, eyeX, eyeY, eyeZ, this.pose.yawWord, this.pose.pitchWord, this.pose.rollWord);
		setProjectionFromFocalY(this.snapshot.proj, decodeUnsignedQ16_16(this.pose.focalYWord));
		multiplyMat4Into(this.snapshot.viewProj, this.snapshot.proj, this.snapshot.view);
		skyboxFromViewInto(this.snapshot.skyboxView, this.snapshot.view);
		extractFrustumPlanesInto(this.snapshot.frustumPlanes, this.snapshot.viewProj);
		this.snapshot.eye[0] = eyeX;
		this.snapshot.eye[1] = eyeY;
		this.snapshot.eye[2] = eyeZ;
	}

	public restoreState(state: VdpCameraState): void {
		this.pose.eyeXWord = state.eyeXWord >>> 0;
		this.pose.eyeYWord = state.eyeYWord >>> 0;
		this.pose.eyeZWord = state.eyeZWord >>> 0;
		this.pose.yawWord = state.yawWord >>> 0;
		this.pose.pitchWord = state.pitchWord >>> 0;
		this.pose.rollWord = state.rollWord >>> 0;
		this.pose.focalYWord = state.focalYWord >>> 0;
		this.rebuildFromPose();
	}

}
