import type { Memory } from '../memory/memory';

export type RuntimeViewport = {
	width: number;
	height: number;
};

export type RuntimeOptions = {
	viewport: RuntimeViewport;
	memory: Memory;
	machineRegionWord: number;
	ufpsScaled: number;
	cpuHz: number;
	cycleBudgetPerFrame: number;
	vblankCycles: number;
	imgDecBytesPerSec: number;
	dmaBytesPerSecIso: number;
	dmaBytesPerSecBulk: number;
	vdpWorkUnitsPerSec: number;
	geoWorkUnitsPerSec: number;
};
