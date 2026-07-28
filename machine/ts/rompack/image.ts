import {
	parseCartHeader,
	type CartRomHeader,
	type CartridgeLayerId,
} from './format';
import { CART_ROM_SIZE, SYSTEM_ROM_SIZE } from '../spec/bmsx/memory_map';

export type RomImage = {
	bytes: Uint8Array;
	header: CartRomHeader;
};

export function parseRomImage(
	bytes: Uint8Array,
	domain: CartridgeLayerId,
): RomImage {
	const capacity = domain === 'system' ? SYSTEM_ROM_SIZE : CART_ROM_SIZE;
	if (bytes.byteLength > capacity) {
		throw new Error(`${domain === 'system' ? 'System' : 'Cartridge'} ROM payload exceeds its ${capacity}-byte address window.`);
	}
	return { bytes, header: parseCartHeader(bytes) };
}
