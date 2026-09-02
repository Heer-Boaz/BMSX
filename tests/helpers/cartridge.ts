import type { CartridgeSocketMediaPair } from '../../machine/ts/machine/devices/cartridge/contracts';

export function cartridgeSlots(
	slot0Rom: Uint8Array | null = null,
	slot1Rom: Uint8Array | null = null,
): CartridgeSocketMediaPair {
	return [
		slot0Rom === null
			? null
			: { rom: slot0Rom, ramByteCount: null, mailboxPresent: false },
		slot1Rom === null
			? null
			: { rom: slot1Rom, ramByteCount: null, mailboxPresent: false },
	];
}
