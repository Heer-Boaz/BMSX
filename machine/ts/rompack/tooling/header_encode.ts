import {
	CART_ROM_HEADER_SIZE,
	CART_ROM_MAGIC_BYTES,
	CART_VDP_CLASS_PSX,
	type CartRomHeader,
} from '../format';

export function writeCartRomHeader(target: Uint8Array, header: CartRomHeader): void {
	target.set(CART_ROM_MAGIC_BYTES, 0);
	const view = new DataView(target.buffer, target.byteOffset, CART_ROM_HEADER_SIZE);
	view.setUint32(4, header.headerSize, true);
	view.setUint32(8, header.manifestOffset, true);
	view.setUint32(12, header.manifestLength, true);
	view.setUint32(16, header.tocOffset, true);
	view.setUint32(20, header.tocLength, true);
	view.setUint32(24, header.dataOffset, true);
	view.setUint32(28, header.dataLength, true);
	view.setUint32(32, header.programBootVersion, true);
	view.setUint32(36, header.programBootFlags, true);
	view.setUint32(40, header.programEntryProtoIndex, true);
	view.setUint32(44, header.programCodeByteCount, true);
	view.setUint32(48, header.programConstPoolCount, true);
	view.setUint32(52, header.programProtoCount, true);
	view.setUint32(56, header.programReserved0, true);
	view.setUint32(60, header.programConstRelocCount, true);
	view.setUint32(64, header.metadataOffset, true);
	view.setUint32(68, header.metadataLength, true);
	view.setUint32(72, CART_VDP_CLASS_PSX, true);
	view.setUint32(76, header.cartridgeBoardWord, true);
	view.setUint32(80, header.cartridgeRamByteCount, true);
}
