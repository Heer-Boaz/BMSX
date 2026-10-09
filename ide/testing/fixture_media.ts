import type { MachineModelSpec } from '../../machine/ts/spec/bmsx/model';
import type { ScenarioTestSource } from '../../toolchain/ts/rompack/scenario_test';

export type FixtureMedia = {
	readonly sourceOnlyModules?: readonly ScenarioTestSource[];
	readonly systemRom: Uint8Array;
	readonly cartridgeSlots: readonly [Uint8Array | null, Uint8Array | null];
	readonly machineModel: MachineModelSpec;
	readonly optLevel: 0 | 1 | 2 | 3;
};
