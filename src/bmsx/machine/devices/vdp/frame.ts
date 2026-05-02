import { SKYBOX_FACE_COUNT, SKYBOX_FACE_WORD_COUNT } from './contracts';
import { VdpBbuFrameBuffer } from './bbu';
import { VdpBlitterCommandBuffer, type VdpResolvedBlitterSample } from './blitter';
import { createVdpCameraSnapshot, type VdpCameraSnapshot } from './camera';

export type VdpSubmittedFrameState = {
	queue: VdpBlitterCommandBuffer;
	occupied: boolean;
	hasCommands: boolean;
	hasFrameBufferCommands: boolean;
	ready: boolean;
	cost: number;
	workRemaining: number;
	ditherType: number;
	skyboxControl: number;
	skyboxFaceWords: Uint32Array;
	skyboxSamples: VdpResolvedBlitterSample[];
	camera: VdpCameraSnapshot;
	billboards: VdpBbuFrameBuffer;
};

export type VdpBuildingFrameState = {
	queue: VdpBlitterCommandBuffer;
	billboards: VdpBbuFrameBuffer;
	open: boolean;
	cost: number;
};

export type VdpExecutionState = {
	queue: VdpBlitterCommandBuffer;
	pending: boolean;
};

export function createResolvedBlitterSample(): VdpResolvedBlitterSample {
	return {
		source: {
			surfaceId: 0,
			srcX: 0,
			srcY: 0,
			width: 0,
			height: 0,
		},
		surfaceWidth: 0,
		surfaceHeight: 0,
		slot: 0,
	};
}

export function createResolvedBlitterSamples(): VdpResolvedBlitterSample[] {
	const samples: VdpResolvedBlitterSample[] = [];
	for (let index = 0; index < SKYBOX_FACE_COUNT; index += 1) {
		samples.push(createResolvedBlitterSample());
	}
	return samples;
}

export function copyResolvedBlitterSample(target: VdpResolvedBlitterSample, source: VdpResolvedBlitterSample): void {
	target.source.surfaceId = source.source.surfaceId;
	target.source.srcX = source.source.srcX;
	target.source.srcY = source.source.srcY;
	target.source.width = source.source.width;
	target.source.height = source.source.height;
	target.surfaceWidth = source.surfaceWidth;
	target.surfaceHeight = source.surfaceHeight;
	target.slot = source.slot;
}

export function allocateSubmittedFrameSlot(): VdpSubmittedFrameState {
	return {
		queue: new VdpBlitterCommandBuffer(),
		occupied: false,
		hasCommands: false,
		hasFrameBufferCommands: false,
		ready: false,
		cost: 0,
		workRemaining: 0,
		ditherType: 0,
		skyboxControl: 0,
		skyboxFaceWords: new Uint32Array(SKYBOX_FACE_WORD_COUNT),
		skyboxSamples: createResolvedBlitterSamples(),
		camera: createVdpCameraSnapshot(),
		billboards: new VdpBbuFrameBuffer(),
	};
}
