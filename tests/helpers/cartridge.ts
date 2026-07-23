import type { CartridgeSlotMediaPair } from '../../machine/ts/machine/devices/cartridge/contracts';

const EMPTY_CARTRIDGE_ROM = new Uint8Array(0);

export function cartridgeSlots(
	slot0Rom: Uint8Array = EMPTY_CARTRIDGE_ROM,
	slot1Rom: Uint8Array = EMPTY_CARTRIDGE_ROM,
): CartridgeSlotMediaPair {
	return [
		{
			rom: slot0Rom,
			boardWord: 0,
			ramByteCount: 0,
			present: slot0Rom.byteLength !== 0,
			programPresent: false,
		},
		{
			rom: slot1Rom,
			boardWord: 0,
			ramByteCount: 0,
			present: slot1Rom.byteLength !== 0,
			programPresent: false,
		},
	];
}
