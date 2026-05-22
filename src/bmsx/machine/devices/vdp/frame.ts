import { VDP_JTU_REGISTER_WORDS, VDP_MFU_WEIGHT_COUNT } from './contracts';
import { VdpXfUnit, type VdpXfState } from './xf';
import { VDP_LPU_REGISTER_WORDS } from './lpu';
import {
	captureVdpRpuFrameState,
	createVdpRpuFrameOutput,
	resetVdpRpuFrameOutput,
	restoreVdpRpuFrameState,
	type VdpRpuFrameOutput,
	type VdpRpuFrameSaveState,
} from './rpu';

export const VDP_DEX_FRAME_IDLE = 0;
export const VDP_DEX_FRAME_DIRECT_OPEN = 1;
export const VDP_DEX_FRAME_STREAM_OPEN = 2;

export type VdpDexFrameState =
	| typeof VDP_DEX_FRAME_IDLE
	| typeof VDP_DEX_FRAME_DIRECT_OPEN
	| typeof VDP_DEX_FRAME_STREAM_OPEN;

export const VDP_SUBMITTED_FRAME_EMPTY = 0;
export const VDP_SUBMITTED_FRAME_QUEUED = 1;
export const VDP_SUBMITTED_FRAME_EXECUTING = 2;
export const VDP_SUBMITTED_FRAME_READY = 3;

export type VdpSubmittedFrameState =
	| typeof VDP_SUBMITTED_FRAME_EMPTY
	| typeof VDP_SUBMITTED_FRAME_QUEUED
	| typeof VDP_SUBMITTED_FRAME_EXECUTING
	| typeof VDP_SUBMITTED_FRAME_READY;

export type VdpSubmittedFrame = {
	state: VdpSubmittedFrameState;
	hasCommands: boolean;
	cost: number;
	workRemaining: number;
	ditherType: number;
	frameBufferWidth: number;
	frameBufferHeight: number;
	xf: VdpXfUnit;
	lightRegisterWords: Uint32Array;
	morphWeightWords: Uint32Array;
	jointMatrixWords: Uint32Array;
	rpu: VdpRpuFrameOutput;
};

export type VdpBuildingFrameState = {
	rpu: VdpRpuFrameOutput;
	state: VdpDexFrameState;
	cost: number;
};

export type VdpBuildingFrameSaveState = {
	state: VdpDexFrameState;
	rpu: VdpRpuFrameSaveState;
	cost: number;
};

export type VdpSubmittedFrameSaveState = {
	state: VdpSubmittedFrameState;
	hasCommands: boolean;
	cost: number;
	workRemaining: number;
	ditherType: number;
	frameBufferWidth: number;
	frameBufferHeight: number;
	xf: VdpXfState;
	lightRegisterWords: number[];
	morphWeightWords: number[];
	jointMatrixWords: number[];
	rpu: VdpRpuFrameSaveState;
};

export function allocateSubmittedFrameSlot(): VdpSubmittedFrame {
	return {
		state: VDP_SUBMITTED_FRAME_EMPTY,
		hasCommands: false,
		cost: 0,
		workRemaining: 0,
		ditherType: 0,
		frameBufferWidth: 0,
		frameBufferHeight: 0,
		xf: new VdpXfUnit(),
		lightRegisterWords: new Uint32Array(VDP_LPU_REGISTER_WORDS),
		morphWeightWords: new Uint32Array(VDP_MFU_WEIGHT_COUNT),
		jointMatrixWords: new Uint32Array(VDP_JTU_REGISTER_WORDS),
		rpu: createVdpRpuFrameOutput(),
	};
}

export function resetBuildingFrame(frame: VdpBuildingFrameState): void {
	resetVdpRpuFrameOutput(frame.rpu);
	frame.cost = 0;
	frame.state = VDP_DEX_FRAME_IDLE;
}

export function resetSubmittedFrameSlot(frame: VdpSubmittedFrame): void {
	frame.state = VDP_SUBMITTED_FRAME_EMPTY;
	frame.hasCommands = false;
	frame.cost = 0;
	frame.workRemaining = 0;
	frame.ditherType = 0;
	frame.frameBufferWidth = 0;
	frame.frameBufferHeight = 0;
	frame.xf.reset();
	frame.lightRegisterWords.fill(0);
	frame.morphWeightWords.fill(0);
	frame.jointMatrixWords.fill(0);
	resetVdpRpuFrameOutput(frame.rpu);
}

export function captureBuildingFrameState(frame: VdpBuildingFrameState): VdpBuildingFrameSaveState {
	return {
		state: frame.state,
		rpu: captureVdpRpuFrameState(frame.rpu),
		cost: frame.cost,
	};
}

export function restoreBuildingFrameState(frame: VdpBuildingFrameState, state: VdpBuildingFrameSaveState): void {
	frame.state = state.state;
	restoreVdpRpuFrameState(frame.rpu, state.rpu);
	frame.cost = state.cost;
}

export function captureSubmittedFrameState(frame: VdpSubmittedFrame): VdpSubmittedFrameSaveState {
	const lightRegisterWords: number[] = [];
	for (let index = 0; index < frame.lightRegisterWords.length; index += 1) {
		lightRegisterWords[index] = frame.lightRegisterWords[index]!;
	}
	const morphWeightWords: number[] = [];
	for (let index = 0; index < frame.morphWeightWords.length; index += 1) {
		morphWeightWords[index] = frame.morphWeightWords[index]!;
	}
	const jointMatrixWords: number[] = [];
	for (let index = 0; index < frame.jointMatrixWords.length; index += 1) {
		jointMatrixWords[index] = frame.jointMatrixWords[index]!;
	}
	return {
		state: frame.state,
		hasCommands: frame.hasCommands,
		cost: frame.cost,
		workRemaining: frame.workRemaining,
		ditherType: frame.ditherType,
		frameBufferWidth: frame.frameBufferWidth,
		frameBufferHeight: frame.frameBufferHeight,
		xf: frame.xf.captureState(),
		lightRegisterWords,
		morphWeightWords,
		jointMatrixWords,
		rpu: captureVdpRpuFrameState(frame.rpu),
	};
}

export function restoreSubmittedFrameState(frame: VdpSubmittedFrame, state: VdpSubmittedFrameSaveState): void {
	frame.state = state.state;
	frame.hasCommands = state.hasCommands;
	frame.cost = state.cost;
	frame.workRemaining = state.workRemaining;
	frame.ditherType = state.ditherType;
	frame.frameBufferWidth = state.frameBufferWidth;
	frame.frameBufferHeight = state.frameBufferHeight;
	frame.xf.restoreState(state.xf);
	for (let index = 0; index < frame.lightRegisterWords.length; index += 1) {
		frame.lightRegisterWords[index] = state.lightRegisterWords[index]!;
	}
	for (let index = 0; index < frame.morphWeightWords.length; index += 1) {
		frame.morphWeightWords[index] = state.morphWeightWords[index]!;
	}
	for (let index = 0; index < frame.jointMatrixWords.length; index += 1) {
		frame.jointMatrixWords[index] = state.jointMatrixWords[index]!;
	}
	restoreVdpRpuFrameState(frame.rpu, state.rpu);
}
