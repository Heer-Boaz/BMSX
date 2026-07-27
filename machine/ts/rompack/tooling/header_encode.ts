import {
	CART_ROM_HEADER_SIZE,
	CART_ROM_MAGIC_BYTES,
	CART_VDP_CLASS_PSX,
	type CartRomHeader,
} from '../format';
import {
	BMSX_ROM_HEADER_BLUA32_EXCEPTION_FUNCTION_ADDRESS_OFFSET,
	BMSX_ROM_HEADER_BLUA32_IMAGE_BYTE_COUNT_OFFSET,
	BMSX_ROM_HEADER_BLUA32_IMAGE_OFFSET,
	BMSX_ROM_HEADER_BLUA32_IRQ_FUNCTION_ADDRESS_OFFSET,
	BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET,
	BMSX_ROM_HEADER_BLUA32_STATIC_LAYOUT_TOKEN_HI_OFFSET,
	BMSX_ROM_HEADER_BLUA32_STATIC_LAYOUT_TOKEN_LO_OFFSET,
} from '../../spec/bmsx/rom_header';

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
	view.setUint32(BMSX_ROM_HEADER_BLUA32_IMAGE_OFFSET, header.blua32ImageOffset, true);
	view.setUint32(BMSX_ROM_HEADER_BLUA32_IMAGE_BYTE_COUNT_OFFSET, header.blua32ImageByteCount, true);
	view.setUint32(BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET, header.blua32StartupFunctionAddress, true);
	view.setUint32(BMSX_ROM_HEADER_BLUA32_IRQ_FUNCTION_ADDRESS_OFFSET, header.blua32IrqFunctionAddress, true);
	view.setUint32(BMSX_ROM_HEADER_BLUA32_EXCEPTION_FUNCTION_ADDRESS_OFFSET, header.blua32ExceptionFunctionAddress, true);
	view.setUint32(BMSX_ROM_HEADER_BLUA32_STATIC_LAYOUT_TOKEN_LO_OFFSET, header.blua32StaticLayoutTokenLo, true);
	view.setUint32(BMSX_ROM_HEADER_BLUA32_STATIC_LAYOUT_TOKEN_HI_OFFSET, header.blua32StaticLayoutTokenHi, true);
	view.setUint32(60, 0, true);
	view.setUint32(64, header.metadataOffset, true);
	view.setUint32(68, header.metadataLength, true);
	view.setUint32(72, CART_VDP_CLASS_PSX, true);
	view.setUint32(76, header.cartridgeBoardWord, true);
	view.setUint32(80, header.cartridgeRamByteCount, true);
}
