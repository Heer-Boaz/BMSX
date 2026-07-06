import type { VdpBuildingFrameSaveState, VdpSubmittedFrameSaveState } from './frame';
import type { VdpStreamIngressState } from './ingress';
import type { VdpReadbackState } from './readback';
import type { VdpRpuSaveState } from './rpu';
import type { VdpVramState } from './vram';
import type { VdpXfState } from './xf';

export type VdpState = {
	displayModeWord: number;
	xf: VdpXfState;
	vdpRegisterWords: number[];
	buildFrame: VdpBuildingFrameSaveState;
	activeFrame: VdpSubmittedFrameSaveState;
	pendingFrame: VdpSubmittedFrameSaveState;
	rpu: VdpRpuSaveState;
	vram: VdpVramState;
	workCarry: number;
	availableWorkUnits: number;
	streamIngress: VdpStreamIngressState;
	readback: VdpReadbackState;
	lightRegisterWords: number[];
	morphWeightWords: number[];
	jointMatrixWords: number[];
	ditherType: number;
	vdpFaultCode: number;
	vdpFaultDetail: number;
};

export type VdpSaveState = VdpState & {
	displayFrameBufferPixels: Uint8Array;
};
