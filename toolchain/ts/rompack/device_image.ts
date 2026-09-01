import { CART_ROM_HEADER_SIZE } from '../../../machine/ts/spec/bmsx/rom_package';
import { writeCartRomHeader } from './header_encode';
import { alignRomAssetOffset } from './asset_layout';
import { resolveCartridgeHeaderWords, type CartManifest } from './manifest';
import { layoutRomPrefix } from './rom_prefix_layout';
import { encodeRomToc } from './toc_encode';

/** Builds non-executable cartridge media whose ROM describes a physical board. */
export function buildCartridgeDeviceImage(manifest: CartManifest): Uint8Array {
	const layout = layoutRomPrefix([], false, manifest);
	const toc = encodeRomToc({ entries: [], projectRootPath: '' });
	const tocOffset = alignRomAssetOffset(layout.payloadEnd);
	const bytes = new Uint8Array(tocOffset + toc.byteLength);
	for (let index = 0; index < layout.ranges.length; index += 1) {
		const range = layout.ranges[index];
		bytes.set(range.buffer, range.start);
	}
	bytes.set(toc, tocOffset);
	const board = resolveCartridgeHeaderWords(manifest);
	writeCartRomHeader(bytes, {
		headerSize: CART_ROM_HEADER_SIZE,
		manifestOffset: layout.manifestOffset,
		manifestLength: layout.manifestLength,
		tocOffset,
		tocLength: toc.byteLength,
		dataOffset: 0,
		dataLength: 0,
		blua32ImageOffset: 0,
		blua32ImageByteCount: 0,
		blua32StartupFunctionAddress: 0,
		blua32IrqFunctionAddress: 0,
		blua32ExceptionFunctionAddress: 0,
		blua32StaticLayoutTokenLo: 0,
		blua32StaticLayoutTokenHi: 0,
		blua32DiagnosticDirectoryOffset: 0,
		metadataOffset: 0,
		metadataLength: 0,
		cartridgeBoardId: board.cartridgeBoardId,
		cartridgeBoardWord: board.cartridgeBoardWord,
		cartridgeRamByteCount: board.cartridgeRamByteCount,
	});
	return bytes;
}
