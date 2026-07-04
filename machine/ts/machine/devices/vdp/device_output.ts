import type { VdpRpuFrameOutput } from './rpu';

export type VdpSurfaceBacking = {
	baseAddr: number;
	capacity: number;
	surfaceId: number;
	surfaceWidth: number;
	surfaceHeight: number;
	cpuReadback: Uint8Array;
};

export type VdpDeviceOutput = Readonly<{
	ditherType: number;
	scanoutPhase: number;
	scanoutX: number;
	scanoutY: number;
	frameBufferWidth: number;
	frameBufferHeight: number;
	rpu: VdpRpuFrameOutput;
}>;
