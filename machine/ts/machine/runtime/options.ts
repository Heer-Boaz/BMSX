import type { CartridgeSlotMediaPair } from '../devices/cartridge/contracts';
import type { MachineModelSpec } from '../../spec/bmsx/model';

export type RuntimeOptions = {
	systemRomBytes: Uint8Array;
	cartridgeSlots: CartridgeSlotMediaPair;
	machineModel: MachineModelSpec;
};
