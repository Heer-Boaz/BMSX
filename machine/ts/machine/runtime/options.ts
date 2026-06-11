import type { CartManifest, MachineManifest, Viewport } from '../../rompack/format';
import type { Memory } from '../memory/memory';

export type RuntimeOptions = {
	viewport: Viewport;
	memory: Memory;
	activeMachineManifest: MachineManifest;
	cartManifest: CartManifest | null;
	cartProjectRootPath: string | null;
	ufpsScaled: number;
	cpuHz: number;
	cycleBudgetPerFrame: number;
	vblankCycles: number;
	vdpWorkUnitsPerSec?: number;
	geoWorkUnitsPerSec?: number;
};
