import type { VdpBuildingFrameSaveState, VdpSubmittedFrameSaveState } from './frame';
import type { VdpStreamIngressState } from './ingress';
import type { VdpXfState } from './xf';

export type VdpState = {
	xf: VdpXfState;
	vdpRegisterWords: number[];
	buildFrame: VdpBuildingFrameSaveState;
	activeFrame: VdpSubmittedFrameSaveState;
	pendingFrame: VdpSubmittedFrameSaveState;
	workCarry: number;
	availableWorkUnits: number;
	streamIngress: VdpStreamIngressState;
	blitterSequence: number;
	skyboxControl: number;
	skyboxFaceWords: number[];
	pmuSelectedBank: number;
	pmuBankWords: number[];
	ditherType: number;
	vdpFaultCode: number;
	vdpFaultDetail: number;
};

export type VdpSurfacePixelsState = {
	surfaceId: number;
	surfaceWidth: number;
	surfaceHeight: number;
	pixels: Uint8Array;
};

export type VdpSaveState = VdpState & {
	vramStaging: Uint8Array;
	surfacePixels: VdpSurfacePixelsState[];
	displayFrameBufferPixels: Uint8Array;
};
