import type { CartridgeCardMedia, CartridgeSocketMediaPair } from '../../machine/ts/machine/devices/cartridge/contracts';
import { parseCartridgePackage, type CartridgePackage } from '../../machine/ts/rompack/image';

/** Decode immutable socket images at host construction, not in IDE features. */
export function cartridgeMediaFromImages(images: readonly [Uint8Array | null, Uint8Array | null]): CartridgeSocketMediaPair {
	const media: CartridgeSocketMediaPair = [null, null];
	for (let slot = 0; slot < images.length; slot += 1) {
		const bytes = images[slot];
		if (bytes !== null) media[slot] = cartridgeMediaFromPackage(parseCartridgePackage(bytes));
	}
	return media;
}

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
