import {
	BMSX_ROM_HEADER_BLUA32_EXCEPTION_FUNCTION_ADDRESS_OFFSET,
	BMSX_ROM_HEADER_BLUA32_IMAGE_BYTE_COUNT_OFFSET,
	BMSX_ROM_HEADER_BLUA32_IMAGE_OFFSET,
	BMSX_ROM_HEADER_BLUA32_IRQ_FUNCTION_ADDRESS_OFFSET,
	BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET,
	BMSX_ROM_HEADER_BLUA32_STATIC_LAYOUT_TOKEN_HI_OFFSET,
	BMSX_ROM_HEADER_BLUA32_STATIC_LAYOUT_TOKEN_LO_OFFSET,
} from '../spec/bmsx/rom_header';
import {
	CART_ROM_HEADER_BLUA32_DIAGNOSTIC_DIRECTORY_OFFSET,
	CART_ROM_HEADER_DATA_LENGTH_OFFSET,
	CART_ROM_HEADER_DATA_OFFSET,
	CART_ROM_HEADER_MANIFEST_LENGTH_OFFSET,
	CART_ROM_HEADER_MANIFEST_OFFSET,
	CART_ROM_HEADER_MAGIC_OFFSET,
	CART_ROM_HEADER_METADATA_LENGTH_OFFSET,
	CART_ROM_HEADER_METADATA_OFFSET,
	CART_ROM_HEADER_SIZE,
	CART_ROM_HEADER_SIZE_OFFSET,
	CART_ROM_HEADER_TOC_LENGTH_OFFSET,
	CART_ROM_HEADER_TOC_OFFSET,
	CART_ROM_MAGIC,
} from '../spec/bmsx/rom_package';
import { formatNumberAsHex } from '../common/byte_hex_string';

export type CartRomHeader = {
	headerSize: number;
	manifestOffset: number;
	manifestLength: number;
	tocOffset: number;
	tocLength: number;
	dataOffset: number;
	dataLength: number;
	blua32ImageOffset: number;
	blua32ImageByteCount: number;
	blua32StartupFunctionAddress: number;
	blua32IrqFunctionAddress: number;
	blua32ExceptionFunctionAddress: number;
	blua32StaticLayoutTokenLo: number;
	blua32StaticLayoutTokenHi: number;
	blua32DiagnosticDirectoryOffset: number;
	metadataOffset: number;
	metadataLength: number;
};

function assertRomSectionRange(offset: number, length: number, total: number, label: string): void {
	if (offset + length > total) {
		throw new Error(`Invalid ROM ${label} range: offset=${formatNumberAsHex(offset)} len=${formatNumberAsHex(length)} total=${formatNumberAsHex(total)}.`);
	}
}

export function parseCartHeader(payload: Uint8Array): CartRomHeader {
	if (payload.byteLength < CART_ROM_HEADER_SIZE) {
		throw new Error('ROM payload is too small for cart header.');
	}
	const view = new DataView(payload.buffer, payload.byteOffset, CART_ROM_HEADER_SIZE);
	if (view.getUint32(CART_ROM_HEADER_MAGIC_OFFSET, true) !== CART_ROM_MAGIC) {
		throw new Error('Invalid ROM cart header.');
	}
	const headerSize = view.getUint32(CART_ROM_HEADER_SIZE_OFFSET, true);
	if (headerSize !== CART_ROM_HEADER_SIZE) {
		throw new Error(`ROM header size ${headerSize} does not match the current ${CART_ROM_HEADER_SIZE}-byte format.`);
	}
	const manifestOffset = view.getUint32(CART_ROM_HEADER_MANIFEST_OFFSET, true);
	const manifestLength = view.getUint32(CART_ROM_HEADER_MANIFEST_LENGTH_OFFSET, true);
	const tocOffset = view.getUint32(CART_ROM_HEADER_TOC_OFFSET, true);
	const tocLength = view.getUint32(CART_ROM_HEADER_TOC_LENGTH_OFFSET, true);
	const dataOffset = view.getUint32(CART_ROM_HEADER_DATA_OFFSET, true);
	const dataLength = view.getUint32(CART_ROM_HEADER_DATA_LENGTH_OFFSET, true);
	const metadataOffset = view.getUint32(CART_ROM_HEADER_METADATA_OFFSET, true);
	const metadataLength = view.getUint32(CART_ROM_HEADER_METADATA_LENGTH_OFFSET, true);

	assertRomSectionRange(manifestOffset, manifestLength, payload.byteLength, 'manifest');
	assertRomSectionRange(tocOffset, tocLength, payload.byteLength, 'toc');
	assertRomSectionRange(dataOffset, dataLength, payload.byteLength, 'data');
	if (metadataLength > 0) {
		assertRomSectionRange(metadataOffset, metadataLength, payload.byteLength, 'metadata');
	}

	return {
		headerSize,
		manifestOffset,
		manifestLength,
		tocOffset,
		tocLength,
		dataOffset,
		dataLength,
		blua32ImageOffset: view.getUint32(BMSX_ROM_HEADER_BLUA32_IMAGE_OFFSET, true),
		blua32ImageByteCount: view.getUint32(BMSX_ROM_HEADER_BLUA32_IMAGE_BYTE_COUNT_OFFSET, true),
		blua32StartupFunctionAddress: view.getUint32(BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET, true),
		blua32IrqFunctionAddress: view.getUint32(BMSX_ROM_HEADER_BLUA32_IRQ_FUNCTION_ADDRESS_OFFSET, true),
		blua32ExceptionFunctionAddress: view.getUint32(BMSX_ROM_HEADER_BLUA32_EXCEPTION_FUNCTION_ADDRESS_OFFSET, true),
		blua32StaticLayoutTokenLo: view.getUint32(BMSX_ROM_HEADER_BLUA32_STATIC_LAYOUT_TOKEN_LO_OFFSET, true),
		blua32StaticLayoutTokenHi: view.getUint32(BMSX_ROM_HEADER_BLUA32_STATIC_LAYOUT_TOKEN_HI_OFFSET, true),
		blua32DiagnosticDirectoryOffset: view.getUint32(CART_ROM_HEADER_BLUA32_DIAGNOSTIC_DIRECTORY_OFFSET, true),
		metadataOffset,
		metadataLength,
	};
}
