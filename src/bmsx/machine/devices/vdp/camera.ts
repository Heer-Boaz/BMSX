export type VdpCameraState = {
	view: number[];
	proj: number[];
	eye: [number, number, number];
};

export type VdpCameraSnapshot = {
	view: Float32Array;
	proj: Float32Array;
	viewProj: Float32Array;
	skyboxView: Float32Array;
	eye: Float32Array;
};

const RESET_CAMERA_ASPECT = 256 / 212;
const RESET_CAMERA_FOCAL_Y = 1.73205080757;
const RESET_CAMERA_NEAR = 0.1;
const RESET_CAMERA_FAR = 50;
const RESET_CAMERA_DEPTH = (RESET_CAMERA_FAR + RESET_CAMERA_NEAR) / (RESET_CAMERA_NEAR - RESET_CAMERA_FAR);
const RESET_CAMERA_DEPTH_OFFSET = (2 * RESET_CAMERA_FAR * RESET_CAMERA_NEAR) / (RESET_CAMERA_NEAR - RESET_CAMERA_FAR);

export function createVdpCameraSnapshot(): VdpCameraSnapshot {
	return {
		view: new Float32Array(16),
		proj: new Float32Array(16),
		viewProj: new Float32Array(16),
		skyboxView: new Float32Array(16),
		eye: new Float32Array(3),
	};
}

function setIdentity(out: Float32Array): void {
	out[0] = 1; out[1] = 0; out[2] = 0; out[3] = 0;
	out[4] = 0; out[5] = 1; out[6] = 0; out[7] = 0;
	out[8] = 0; out[9] = 0; out[10] = 1; out[11] = 0;
	out[12] = 0; out[13] = 0; out[14] = 0; out[15] = 1;
}

function setResetProjection(out: Float32Array): void {
	out[0] = RESET_CAMERA_FOCAL_Y / RESET_CAMERA_ASPECT; out[1] = 0; out[2] = 0; out[3] = 0;
	out[4] = 0; out[5] = RESET_CAMERA_FOCAL_Y; out[6] = 0; out[7] = 0;
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

export function copyVdpCameraSnapshot(target: VdpCameraSnapshot, source: VdpCameraSnapshot): void {
	target.view.set(source.view);
	target.proj.set(source.proj);
	target.viewProj.set(source.viewProj);
	target.skyboxView.set(source.skyboxView);
	target.eye.set(source.eye);
}

export class VdpCameraUnit {
	private readonly live = createVdpCameraSnapshot();

	public constructor() {
		this.reset();
	}

	public reset(): void {
		setIdentity(this.live.view);
		setResetProjection(this.live.proj);
		this.live.viewProj.set(this.live.proj);
		setIdentity(this.live.skyboxView);
		this.live.eye[0] = 0;
		this.live.eye[1] = 0;
		this.live.eye[2] = 0;
	}

	public writeCameraBank0(view: Float32Array, proj: Float32Array, eyeX: number, eyeY: number, eyeZ: number): void {
		this.live.view.set(view);
		this.live.proj.set(proj);
		multiplyMat4Into(this.live.viewProj, this.live.proj, this.live.view);
		skyboxFromViewInto(this.live.skyboxView, this.live.view);
		this.live.eye[0] = eyeX;
		this.live.eye[1] = eyeY;
		this.live.eye[2] = eyeZ;
	}

	public latchFrame(target: VdpCameraSnapshot): void {
		copyVdpCameraSnapshot(target, this.live);
	}

	public captureState(): VdpCameraState {
		return {
			view: Array.from(this.live.view),
			proj: Array.from(this.live.proj),
			eye: [this.live.eye[0], this.live.eye[1], this.live.eye[2]],
		};
	}

	public restoreState(state: VdpCameraState): void {
		this.live.view.set(state.view);
		this.live.proj.set(state.proj);
		multiplyMat4Into(this.live.viewProj, this.live.proj, this.live.view);
		skyboxFromViewInto(this.live.skyboxView, this.live.view);
		this.live.eye[0] = state.eye[0];
		this.live.eye[1] = state.eye[1];
		this.live.eye[2] = state.eye[2];
	}
}
