import type { CartridgeSocketMediaPair } from '../devices/cartridge/contracts';
import type { MachineModelSpec } from '../../spec/bmsx/model';
import type { CpuExecutionBackend } from '../cpu/compiled_block';

export type RuntimeOptions = {
	systemRomBytes: Uint8Array;
	cartridgeSlots: CartridgeSocketMediaPair;
	machineModel: MachineModelSpec;
	cpuExecutionBackend?: CpuExecutionBackend;
};
