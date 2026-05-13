import { SKYBOX_FACE_COUNT, SKYBOX_FACE_WORD_COUNT } from './contracts';
import { VdpBbuFrameBuffer } from './bbu';
import { VdpBlitterCommandBuffer, type VdpResolvedBlitterSample } from './blitter';
import { VdpXfUnit } from './xf';

export const VDP_DEX_FRAME_IDLE = 0;
export const VDP_DEX_FRAME_DIRECT_OPEN = 1;
export const VDP_DEX_FRAME_STREAM_OPEN = 2;

export type VdpDexFrameState =
	| typeof VDP_DEX_FRAME_IDLE
	| typeof VDP_DEX_FRAME_DIRECT_OPEN
	| typeof VDP_DEX_FRAME_STREAM_OPEN;

export type VdpSubmittedFrameState = {
	queue: VdpBlitterCommandBuffer;
	occupied: boolean;
	hasCommands: boolean;
	hasFrameBufferCommands: boolean;
	ready: boolean;
	cost: number;
	workRemaining: number;
	ditherType: number;
	xf: VdpXfUnit;
	skyboxControl: number;
	skyboxFaceWords: Uint32Array;
	skyboxSamples: VdpResolvedBlitterSample[];
	billboards: VdpBbuFrameBuffer;
};

export type VdpBuildingFrameState = {
	queue: VdpBlitterCommandBuffer;
	billboards: VdpBbuFrameBuffer;
	state: VdpDexFrameState;
	cost: number;
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
		xf: new VdpXfUnit(),
		skyboxControl: 0,
		skyboxFaceWords: new Uint32Array(SKYBOX_FACE_WORD_COUNT),
		skyboxSamples: createResolvedBlitterSamples(),
		billboards: new VdpBbuFrameBuffer(),
	};
}
