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
import type { AssetId, AssetType } from '../../../machine/ts/rompack/toc';
import { alignRomAssetOffset } from './asset_layout';
import type { RomSourceLayer } from './source';
import { CART_ROM_SIZE, SYSTEM_ROM_SIZE } from '../../../machine/ts/spec/bmsx/memory_map';
import { writeCartRomHeader } from './header_encode';
import { encodeRomToc } from './toc_encode';

export type RomAssetEdit = readonly [
	type: AssetType,
	id: AssetId,
	payload: Uint8Array,
];

export function layoutBlua32PublicAssets(
	layer: RomSourceLayer,
	imageByteCount: number,
	assetEdit?: RomAssetEdit,
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
		const isEdited = assetEdit
			&& entry.type === assetEdit[0]
			&& entry.resid === assetEdit[1];
		if (!isEdited && (entry.start == null || entry.start < imageOffset)) {
			entries.push(entry);
			continue;
		}
		const byteLength = isEdited ? assetEdit[2].byteLength : entry.end! - entry.start!;
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
	if (assetEdit && !edited) {
		throw new Error(`${assetEdit[0]} asset '${assetEdit[1]}' is not present in the ROM.`);
	}
	return [entries, tailOffset];
}

export function buildBlua32Tail(
	layer: RomSourceLayer,
	linked: LinkedBlua32Image,
	assetEdit?: RomAssetEdit,
): RomSourceLayer {
	const header = parseCartHeader(layer.bytes);
	const imageOffset = header.blua32ImageOffset;
	const imageEnd = imageOffset + linked.bytes.byteLength;
	const [entries, symbolsOffset] = layoutBlua32PublicAssets(
		layer,
		linked.bytes.byteLength,
		assetEdit,
	);
	const symbols = encodeBlua32SymbolsImage(linked.symbols);
	const symbolsEnd = symbolsOffset + symbols.byteLength;
	const publicEntryCount = entries.length;
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
	for (let index = 0; index < publicEntryCount; index += 1) {
		const entry = entries[index];
		if (entry.start == null || entry.start < imageEnd) {
			continue;
		}
		if (assetEdit
			&& entry.type === assetEdit[0]
			&& entry.resid === assetEdit[1]) {
			payload.set(assetEdit[2], entry.start);
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
