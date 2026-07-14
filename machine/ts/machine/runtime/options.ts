import type { Memory } from '../memory/memory';

export type RuntimeOptions = {
	memory: Memory;
	psxGpuDisplayModeWord: number;
	ufpsScaled: number;
	cpuHz: number;
	cycleBudgetPerFrame: number;
	vblankCycles: number;
	dmaWordsPerSec: number;
	geoWorkUnitsPerSec: number;
};
