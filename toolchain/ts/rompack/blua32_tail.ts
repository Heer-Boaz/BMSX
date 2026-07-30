import { BLUA32_IMAGE_ID } from './blua32_image';
import {
	BLUA32_SYMBOLS_IMAGE_ID,
	encodeBlua32SymbolsImage,
} from './blua32_symbols';
import type { LinkedBlua32Image } from './blua32_linker';
import { CART_ROM_HEADER_SIZE } from '../../../machine/ts/spec/bmsx/rom_package';
import {
	parseCartHeader,
} from '../../../machine/ts/rompack/format';
import type { RomAsset } from './assets';
import type { AssetId } from '../../../machine/ts/rompack/toc';
import { alignRomAssetOffset } from './asset_layout';
import type { RomSourceLayer } from './source';
import { CART_ROM_SIZE, SYSTEM_ROM_SIZE } from '../../../machine/ts/spec/bmsx/memory_map';
import { writeCartRomHeader } from './header_encode';
import { encodeRomToc } from './toc_encode';

export type Blua32AemEdit = readonly [assetId: AssetId, payload: Uint8Array];

export function layoutBlua32PublicAssets(
	layer: RomSourceLayer,
	imageByteCount: number,
	aemEdit?: Blua32AemEdit,
): readonly [entries: RomAsset[], tailOffset: number] {
	const header = parseCartHeader(layer.bytes);
	const imageOffset = header.blua32ImageOffset;
	const entries: RomAsset[] = [];
	let tailOffset = alignRomAssetOffset(imageOffset + imageByteCount);
	let edited = false;
	for (let index = 0; index < layer.index.entries.length; index += 1) {
		const entry = layer.index.entries[index];
		if (entry.resid === BLUA32_IMAGE_ID || entry.resid === BLUA32_SYMBOLS_IMAGE_ID) {
			continue;
		}
		const isEdited = aemEdit && entry.type === 'aem' && entry.resid === aemEdit[0];
		if (entry.type !== 'aem' || (!isEdited && entry.start! < imageOffset)) {
			entries.push(entry);
			continue;
		}
		const byteLength = isEdited ? aemEdit[1].byteLength : entry.end! - entry.start!;
		entries.push({
			...entry,
			start: tailOffset,
			end: tailOffset + byteLength,
		});
		tailOffset = alignRomAssetOffset(tailOffset + byteLength);
		if (isEdited) {
			edited = true;
		}
	}
	if (aemEdit && !edited) {
		throw new Error(`AEM asset '${aemEdit[0]}' is not present in the ROM.`);
	}
	return [entries, tailOffset];
}

export function buildBlua32Tail(
	layer: RomSourceLayer,
	linked: LinkedBlua32Image,
	aemEdit?: Blua32AemEdit,
): RomSourceLayer {
	const header = parseCartHeader(layer.bytes);
	const imageOffset = header.blua32ImageOffset;
	const imageEnd = imageOffset + linked.bytes.byteLength;
	const [entries, symbolsOffset] = layoutBlua32PublicAssets(
		layer,
		linked.bytes.byteLength,
		aemEdit,
	);
	const symbols = encodeBlua32SymbolsImage(linked.symbols);
	const symbolsEnd = symbolsOffset + symbols.byteLength;
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
	payload.set(layer.bytes.subarray(0, imageOffset));
	payload.set(linked.bytes, imageOffset);
	for (let index = 0; index < entries.length; index += 1) {
		const entry = entries[index];
		if (entry.type !== 'aem' || entry.start! < imageEnd) {
			continue;
		}
		if (aemEdit && entry.resid === aemEdit[0]) {
			payload.set(aemEdit[1], entry.start);
			continue;
		}
		let sourceIndex = 0;
		while (layer.index.entries[sourceIndex].resid !== entry.resid
			|| layer.index.entries[sourceIndex].type !== entry.type) {
			sourceIndex += 1;
		}
		const source = layer.index.entries[sourceIndex];
		payload.set(layer.bytes.subarray(source.start!, source.end!), entry.start);
	}
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
		bytes: payload,
	};
}
