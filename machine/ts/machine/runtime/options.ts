import type { CartridgeSlotMediaPair } from '../devices/cartridge/contracts';
import type { MachineModelSpec } from '../model_registry';

export type RuntimeOptions = {
	systemRomBytes: Uint8Array;
	cartridgeSlots: CartridgeSlotMediaPair;
	machineModel: MachineModelSpec;
};
