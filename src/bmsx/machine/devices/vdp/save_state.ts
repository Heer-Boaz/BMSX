import type { VdpBuildingFrameSaveState, VdpSubmittedFrameSaveState } from './frame';
import type { VdpStreamIngressState } from './ingress';
import type { VdpReadbackState } from './readback';
import type { VdpVramState } from './vram';
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
	readback: VdpReadbackState;
	blitterSequence: number;
	skyboxControl: number;
	skyboxFaceWords: number[];
	pmuSelectedBank: number;
	pmuBankWords: number[];
	ditherType: number;
	vdpFaultCode: number;
	vdpFaultDetail: number;
};

export type VdpSaveState = VdpState & {
	vram: VdpVramState;
	displayFrameBufferPixels: Uint8Array;
};
