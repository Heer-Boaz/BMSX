import {
	parseCartHeader,
	type CartRomHeader,
} from './format';
import {
	decodeCartManifest,
	type CartManifest,
	type CartridgeDeviceConfig,
} from './manifest';
import { CART_ROM_SIZE, SYSTEM_ROM_SIZE } from '../spec/bmsx/memory_map';
import { CART_PACKAGE_MAX_BYTE_COUNT } from '../spec/bmsx/rom_package';

export type RomImageDomain = 'system' | 'cart';

export type RomImage = {
	bytes: Uint8Array;
	header: CartRomHeader;
};

export type CartridgePackage = RomImage & {
	manifest: CartManifest;
};

export function parseSystemRomImage(bytes: Uint8Array): RomImage {
	if (bytes.byteLength > SYSTEM_ROM_SIZE) {
		throw new Error(`System ROM payload exceeds its ${SYSTEM_ROM_SIZE}-byte address window.`);
	}
	return { bytes, header: parseCartHeader(bytes) };
}

export function assertCartridgePackageFitsHardware(
	byteCount: number,
	header: CartRomHeader,
	hardware: readonly CartridgeDeviceConfig[],
): void {
	if (byteCount > CART_PACKAGE_MAX_BYTE_COUNT) {
		throw new Error(`Cartridge package exceeds its ${CART_PACKAGE_MAX_BYTE_COUNT}-byte format limit.`);
	}
	let romPresent = false;
	for (let index = 0; index < hardware.length; index += 1) {
		if (hardware[index]!.type === 'rom') {
			romPresent = true;
			if (byteCount > CART_ROM_SIZE) {
				throw new Error(`Cartridge ROM device exceeds its ${CART_ROM_SIZE}-byte address window.`);
			}
		}
	}
	if (!romPresent && (
		header.blua32ImageOffset !== 0
			|| header.blua32ImageByteCount !== 0
			|| header.blua32StartupFunctionAddress !== 0
			|| header.blua32IrqFunctionAddress !== 0
			|| header.blua32ExceptionFunctionAddress !== 0
			|| header.blua32StaticLayoutTokenLo !== 0
			|| header.blua32StaticLayoutTokenHi !== 0
	)) {
		throw new Error('Cartridge BLua32 metadata requires an installed ROM device.');
	}
}

export function parseCartridgePackage(bytes: Uint8Array): CartridgePackage {
	const header = parseCartHeader(bytes);
	const manifest = decodeCartManifest(bytes, header);
	assertCartridgePackageFitsHardware(bytes.byteLength, header, manifest.hardware);
	return {
		bytes,
		header,
		manifest,
	};
}
