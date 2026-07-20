import type { Memory } from '../memory/memory';

export type RuntimeOptions = {
	memory: Memory;
	pcrtcRunning: boolean;
	ufpsScaled: number;
	cpuHz: number;
	cycleBudgetPerFrame: number;
	totalHalfLines: number;
	activeDisplayHalfLines: number;
	dmaWordsPerSec: number;
	dmaRamRowReopenCycles: number;
	dmaRomWaitCyclesPerWord: number;
	geoWorkUnitsPerSec: number;
};
