import type { CartridgeCardMedia } from '../../machine/ts/machine/devices/cartridge/contracts';
import type { CartridgePackage } from '../../machine/ts/rompack/image';

export function cartridgeMediaFromPackage(image: CartridgePackage): CartridgeCardMedia {
	let rom: Uint8Array | null = null;
	let ramByteCount: number | null = null;
	let mailboxPresent = false;
	for (let index = 0; index < image.manifest.hardware.length; index += 1) {
		const device = image.manifest.hardware[index]!;
		switch (device.type) {
		case 'rom':
			rom = image.bytes;
			continue;
		case 'ram':
			ramByteCount = device.bytes;
			continue;
		case 'mailbox':
			mailboxPresent = true;
			continue;
		}
		const unhandledDevice: never = device;
		void unhandledDevice;
	}
	return { rom, ramByteCount, mailboxPresent };
}
