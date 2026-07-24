import {
	BLUA32_IMAGE_ID,
	BLUA32_SYMBOLS_IMAGE_ID,
} from '../../machine/cpu/blua32_image';
import { encodeBlua32SymbolsImage } from '../../machine/cpu/blua32_symbols';
import type { LinkedBlua32Image } from './blua32_linker';
import {
	CART_ROM_HEADER_SIZE,
	parseCartHeader,
	type RomAsset,
} from '../format';
import { alignRomAssetOffset } from '../asset_layout';
import type { RomSourceLayer } from '../source';
import { CART_ROM_SIZE, SYSTEM_ROM_SIZE } from '../../machine/memory/map';
import { writeCartRomHeader } from './header_encode';
import { encodeRomToc } from './toc_encode';

export function buildBlua32Tail(layer: RomSourceLayer, linked: LinkedBlua32Image): RomSourceLayer {
	const header = parseCartHeader(layer.payload);
	const imageOffset = header.blua32ImageOffset;
	const imageEnd = imageOffset + linked.bytes.byteLength;
	const symbolsOffset = alignRomAssetOffset(imageEnd);
	const symbols = encodeBlua32SymbolsImage(linked.symbols);
	const symbolsEnd = symbolsOffset + symbols.byteLength;

	const entries: RomAsset[] = [];
	for (let index = 0; index < layer.index.entries.length; index += 1) {
		const entry = layer.index.entries[index];
		if (entry.resid !== BLUA32_IMAGE_ID && entry.resid !== BLUA32_SYMBOLS_IMAGE_ID) {
			entries.push(entry);
		}
	}
	entries.push({
		resid: BLUA32_IMAGE_ID,
		type: 'code',
		start: imageOffset,
		end: imageEnd,
		source_path: BLUA32_IMAGE_ID,
	});
	entries.push({
		resid: BLUA32_SYMBOLS_IMAGE_ID,
		type: 'code',
		start: symbolsOffset,
		end: symbolsEnd,
		source_path: BLUA32_SYMBOLS_IMAGE_ID,
	});

	const toc = encodeRomToc({
		entries,
		projectRootPath: layer.index.projectRootPath,
	});
	const tocOffset = alignRomAssetOffset(symbolsEnd);
	const payloadByteCount = tocOffset + toc.byteLength;
	const romCapacity = layer.id === 'system' ? SYSTEM_ROM_SIZE : CART_ROM_SIZE;
	if (payloadByteCount > romCapacity) {
		throw new Error(`ROM payload exceeds the ${romCapacity}-byte ${layer.id} ROM window.`);
	}

	const payload = new Uint8Array(payloadByteCount);
	payload.set(layer.payload.subarray(0, imageOffset));
	payload.set(linked.bytes, imageOffset);
	payload.set(symbols, symbolsOffset);
	payload.set(toc, tocOffset);
	writeCartRomHeader(payload, {
		...header,
		headerSize: CART_ROM_HEADER_SIZE,
		tocOffset,
		tocLength: toc.byteLength,
		dataLength: symbolsEnd - header.dataOffset,
		blua32ImageByteCount: linked.bytes.byteLength,
		blua32StartupFunctionAddress: linked.startupFunctionAddress,
		blua32IrqFunctionAddress: linked.irqFunctionAddress,
		blua32ExceptionFunctionAddress: linked.exceptionFunctionAddress,
		blua32StaticLayoutTokenLo: linked.symbols.staticLayoutToken.lo,
		blua32StaticLayoutTokenHi: linked.symbols.staticLayoutToken.hi,
	});
	return {
		id: layer.id,
		index: {
			...layer.index,
			entries,
		},
		payload,
	};
}
