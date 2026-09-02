import type { CartridgeSocketMediaPair } from '../devices/cartridge/contracts';
import type { MachineModelSpec } from '../../spec/bmsx/model';

export type RuntimeOptions = {
	systemRomBytes: Uint8Array;
	cartridgeSlots: CartridgeSocketMediaPair;
	machineModel: MachineModelSpec;
};
