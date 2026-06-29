import type { CartManifest, MachineManifest, Viewport } from '../../rompack/format';
import type { Memory } from '../memory/memory';

export type RuntimeOptions = {
	viewport: Viewport;
	memory: Memory;
	activeMachineManifest: MachineManifest;
	cartManifest: CartManifest | null;
	cartProjectRootPath: string | null;
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
