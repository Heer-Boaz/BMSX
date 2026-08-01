import { BLUA32_IMAGE_ID } from './blua32_image';
import {
	BLUA32_SYMBOLS_IMAGE_ID,
	encodeBlua32SymbolsImage,
} from './blua32_symbols';
import {
	BLUA32_BIOS_IMPORTS_IMAGE_ID,
	encodeBlua32BiosImports,
} from './blua32_bios_imports';
import {
	BLUA32_DIAGNOSTICS_IMAGE_ID,
	encodeBlua32DiagnosticDirectory,
	type Blua32DiagnosticSourceMap,
	type PackedBlua32DiagnosticSource,
} from './blua32_diagnostics';
import type {
	LinkedBlua32Image,
	LinkedCartBlua32Image,
	LinkedSystemBlua32Image,
} from './blua32_linker';
import { CART_ROM_HEADER_SIZE } from '../../../machine/ts/spec/bmsx/rom_package';
import {
	parseCartHeader,
} from '../../../machine/ts/rompack/format';
import type { RomAsset } from './assets';
import type { AssetId, AssetType } from '../../../machine/ts/rompack/toc';
import {
	alignRomAssetOffset,
	layoutRomAssetPayloads,
	type RomAssetPayloadLayout,
} from './asset_layout';
import type { RomSourceLayer } from './source';
import { CART_ROM_SIZE, SYSTEM_ROM_SIZE } from '../../../machine/ts/spec/bmsx/memory_map';
import { writeCartRomHeader } from './header_encode';
import { encodeRomToc } from './toc_encode';
import {
	assertSystemBlua32ImageFits,
	SYSTEM_ROM_ASSET_OFFSET,
} from './system';

export type RomAssetEdit = readonly [
	type: AssetType,
	id: AssetId,
	payload: Uint8Array,
];

export function layoutBlua32PublicAssets(
	layer: RomSourceLayer,
	imageByteCount: number,
	assetEdit?: RomAssetEdit,
): RomAssetPayloadLayout {
	const header = parseCartHeader(layer.bytes);
	const imageOffset = header.blua32ImageOffset;
	const entries: RomAsset[] = [];
	const relocatedSources: RomAsset[] = [];
	const relocatedEntryIndices: number[] = [];
	const tailOffset = layer.id === 'system'
		? SYSTEM_ROM_ASSET_OFFSET
		: alignRomAssetOffset(imageOffset + imageByteCount);
	let edited = false;
	for (let index = 0; index < layer.index.entries.length; index += 1) {
		const entry = layer.index.entries[index];
		if (entry.resid === BLUA32_IMAGE_ID
			|| entry.resid === BLUA32_SYMBOLS_IMAGE_ID
			|| entry.resid === BLUA32_DIAGNOSTICS_IMAGE_ID
			|| entry.resid === BLUA32_BIOS_IMPORTS_IMAGE_ID) {
			continue;
		}
		const isEdited = assetEdit
			&& entry.type === assetEdit[0]
			&& entry.resid === assetEdit[1];
		const movePayloads = layer.id === 'system'
			|| isEdited
			|| (entry.start != null && entry.start >= imageOffset)
			|| (entry.compiled_start != null && entry.compiled_start >= imageOffset)
			|| (entry.model_texture_start != null && entry.model_texture_start >= imageOffset)
			|| (entry.collision_bin_start != null && entry.collision_bin_start >= imageOffset);
		if (!movePayloads) {
			entries.push(entry);
			continue;
		}
		const source: RomAsset = {
			...entry,
			buffer: entry.start == null
				? undefined
				: Buffer.from(
					layer.bytes.buffer,
					layer.bytes.byteOffset + entry.start,
					entry.end! - entry.start,
				),
			compiled_buffer: entry.compiled_start == null
				? undefined
				: Buffer.from(
					layer.bytes.buffer,
					layer.bytes.byteOffset + entry.compiled_start,
					entry.compiled_end! - entry.compiled_start,
				),
			model_texture_buffer: entry.model_texture_start == null
				? undefined
				: Buffer.from(
					layer.bytes.buffer,
					layer.bytes.byteOffset + entry.model_texture_start,
					entry.model_texture_end! - entry.model_texture_start,
				),
			collision_bin_buffer: entry.collision_bin_start == null
				? undefined
				: Buffer.from(
					layer.bytes.buffer,
					layer.bytes.byteOffset + entry.collision_bin_start,
					entry.collision_bin_end! - entry.collision_bin_start,
				),
		};
		if (isEdited) {
			source.buffer = Buffer.from(
				assetEdit[2].buffer,
				assetEdit[2].byteOffset,
				assetEdit[2].byteLength,
			);
			edited = true;
		}
		relocatedEntryIndices.push(entries.length);
		relocatedSources.push(source);
		entries.push(entry);
	}
	const layout = layoutRomAssetPayloads(relocatedSources, true, tailOffset);
	for (let index = 0; index < layout.entries.length; index += 1) {
		const entryIndex = relocatedEntryIndices[index];
		const relocated = layout.entries[index];
		if (layer.id !== 'system') {
			relocated.metabuffer_start = entries[entryIndex].metabuffer_start;
			relocated.metabuffer_end = entries[entryIndex].metabuffer_end;
		}
		entries[entryIndex] = relocated;
	}
	if (assetEdit && !edited) {
		throw new Error(`${assetEdit[0]} asset '${assetEdit[1]}' is not present in the ROM.`);
	}
	return {
		entries,
		ranges: layout.ranges,
		payloadEnd: layout.payloadEnd,
		nextOffset: layout.nextOffset,
	};
}

export function buildBlua32Tail(
	layer: RomSourceLayer<'system'>,
	linked: LinkedSystemBlua32Image,
	diagnosticSources: Blua32DiagnosticSourceMap | null,
	assetEdit?: RomAssetEdit,
): RomSourceLayer<'system'>;
export function buildBlua32Tail(
	layer: RomSourceLayer<'cart'>,
	linked: LinkedCartBlua32Image,
	diagnosticSources: Blua32DiagnosticSourceMap | null,
	assetEdit?: RomAssetEdit,
): RomSourceLayer<'cart'>;
export function buildBlua32Tail(
	layer: RomSourceLayer,
	linked: LinkedBlua32Image,
	diagnosticSources: Blua32DiagnosticSourceMap | null,
	assetEdit?: RomAssetEdit,
): RomSourceLayer {
	const header = parseCartHeader(layer.bytes);
	const imageOffset = header.blua32ImageOffset;
	const imageEnd = imageOffset + linked.bytes.byteLength;
	if (layer.id === 'system') {
		assertSystemBlua32ImageFits(imageEnd);
	}
	const publicAssets = layoutBlua32PublicAssets(
		layer,
		linked.bytes.byteLength,
		assetEdit,
	);
	const entries = publicAssets.entries;
	let metadataOffset = header.metadataOffset;
	let manifestOffset = header.manifestOffset;
	let toolingOffset = publicAssets.nextOffset;
	if (linked.domain === 'system') {
		if (header.metadataLength !== 0) {
			metadataOffset = toolingOffset;
			const metadataDelta = metadataOffset - header.metadataOffset;
			let installedIndex = 0;
			for (let index = 0; index < entries.length; index += 1) {
				const entry = entries[index];
				while (layer.index.entries[installedIndex].type !== entry.type
					|| layer.index.entries[installedIndex].resid !== entry.resid) {
					installedIndex += 1;
				}
				const installed = layer.index.entries[installedIndex];
				installedIndex += 1;
				if (installed.metabuffer_start != null) {
					entry.metabuffer_start = installed.metabuffer_start + metadataDelta;
					entry.metabuffer_end = installed.metabuffer_end! + metadataDelta;
				}
			}
			toolingOffset = alignRomAssetOffset(metadataOffset + header.metadataLength);
		} else {
			metadataOffset = 0;
		}
		if (header.manifestLength !== 0) {
			manifestOffset = toolingOffset;
			toolingOffset = alignRomAssetOffset(manifestOffset + header.manifestLength);
		} else {
			manifestOffset = 0;
		}
	}
	const symbolsPayload = encodeBlua32SymbolsImage(linked.symbols);
	const toolingAssets: RomAsset[] = [{
		resid: BLUA32_SYMBOLS_IMAGE_ID,
		type: 'code',
		buffer: Buffer.from(
			symbolsPayload.buffer,
			symbolsPayload.byteOffset,
			symbolsPayload.byteLength,
		),
		source_path: BLUA32_SYMBOLS_IMAGE_ID,
	}];
	if (linked.domain === 'system') {
		const biosImportsPayload = encodeBlua32BiosImports(linked.biosImports);
		toolingAssets.push({
			resid: BLUA32_BIOS_IMPORTS_IMAGE_ID,
			type: 'code',
			buffer: Buffer.from(
				biosImportsPayload.buffer,
				biosImportsPayload.byteOffset,
				biosImportsPayload.byteLength,
			),
			source_path: BLUA32_BIOS_IMPORTS_IMAGE_ID,
		});
	}
	const toolingLayout = layoutRomAssetPayloads(toolingAssets, true, toolingOffset);
	entries.push({
		resid: BLUA32_IMAGE_ID,
		type: 'code',
		start: imageOffset,
		end: imageEnd,
		source_path: BLUA32_IMAGE_ID,
	});
	entries.push(...toolingLayout.entries);
	let diagnosticDirectoryOffset = 0;
	let toolingPayloadEnd = toolingLayout.payloadEnd;
	let toolingNextOffset = toolingLayout.nextOffset;
	let diagnosticLayout: RomAssetPayloadLayout | null = null;
	if (diagnosticSources) {
		const packedEntryBySourcePath = new Map<string, RomAsset>();
		for (let index = 0; index < publicAssets.entries.length; index += 1) {
			const entry = publicAssets.entries[index];
			if (entry.type === 'lua' && entry.source_path) {
				packedEntryBySourcePath.set(entry.source_path, entry);
			}
		}
		const relocatedSourceBytesByOffset = new Map<number, Uint8Array>();
		for (let index = 0; index < publicAssets.ranges.length; index += 1) {
			const range = publicAssets.ranges[index];
			relocatedSourceBytesByOffset.set(range.start, range.buffer);
		}
		const packedSources = new Map<string, PackedBlua32DiagnosticSource>();
		for (const [rangePath, source] of diagnosticSources) {
			const entry = packedEntryBySourcePath.get(source.displayPath);
			if (!entry) {
				continue;
			}
			const relocatedBytes = relocatedSourceBytesByOffset.get(entry.start!);
			packedSources.set(rangePath, {
				offset: entry.start!,
				bytes: relocatedBytes
					? relocatedBytes
					: layer.bytes.subarray(entry.start!, entry.end!),
			});
		}
		diagnosticDirectoryOffset = toolingNextOffset;
		const diagnosticPayload = encodeBlua32DiagnosticDirectory({
			directoryOffset: diagnosticDirectoryOffset,
			textAddress: linked.layout.header.textAddress,
			textByteCount: linked.layout.header.textByteCount,
			debugRanges: linked.symbols.metadata.debugRanges,
			sources: diagnosticSources,
			packedSources,
		});
		diagnosticLayout = layoutRomAssetPayloads([{
			resid: BLUA32_DIAGNOSTICS_IMAGE_ID,
			type: 'code',
			buffer: Buffer.from(
				diagnosticPayload.buffer,
				diagnosticPayload.byteOffset,
				diagnosticPayload.byteLength,
			),
			source_path: BLUA32_DIAGNOSTICS_IMAGE_ID,
		}], true, diagnosticDirectoryOffset);
		entries.push(...diagnosticLayout.entries);
		toolingPayloadEnd = diagnosticLayout.payloadEnd;
		toolingNextOffset = diagnosticLayout.nextOffset;
	}

	const toc = encodeRomToc({
		entries,
		projectRootPath: layer.index.projectRootPath,
	});
	const tocOffset = toolingNextOffset;
	const payloadByteCount = tocOffset + toc.byteLength;
	const romCapacity = layer.id === 'system' ? SYSTEM_ROM_SIZE : CART_ROM_SIZE;
	if (payloadByteCount > romCapacity) {
		throw new Error(`ROM payload exceeds the ${romCapacity}-byte ${layer.id} ROM window.`);
	}

	const payload = new Uint8Array(payloadByteCount);
	payload.set(layer.bytes.subarray(0, imageOffset));
	payload.set(linked.bytes, imageOffset);
	for (let index = 0; index < publicAssets.ranges.length; index += 1) {
		const range = publicAssets.ranges[index];
		payload.set(range.buffer, range.start);
	}
	if (linked.domain === 'system') {
		if (header.metadataLength !== 0) {
			payload.set(
				layer.bytes.subarray(
					header.metadataOffset,
					header.metadataOffset + header.metadataLength,
				),
				metadataOffset,
			);
		}
		if (header.manifestLength !== 0) {
			payload.set(
				layer.bytes.subarray(
					header.manifestOffset,
					header.manifestOffset + header.manifestLength,
				),
				manifestOffset,
			);
		}
	}
	for (let index = 0; index < toolingLayout.ranges.length; index += 1) {
		const range = toolingLayout.ranges[index];
		payload.set(range.buffer, range.start);
	}
	if (diagnosticLayout) {
		for (let index = 0; index < diagnosticLayout.ranges.length; index += 1) {
			const range = diagnosticLayout.ranges[index];
			payload.set(range.buffer, range.start);
		}
	}
	payload.set(toc, tocOffset);
	writeCartRomHeader(payload, {
		...header,
		headerSize: CART_ROM_HEADER_SIZE,
		metadataOffset,
		manifestOffset,
		tocOffset,
		tocLength: toc.byteLength,
		dataLength: toolingPayloadEnd - header.dataOffset,
		blua32ImageByteCount: linked.bytes.byteLength,
		blua32StartupFunctionAddress: linked.startupFunctionAddress,
		blua32IrqFunctionAddress: linked.irqFunctionAddress,
		blua32ExceptionFunctionAddress: linked.exceptionFunctionAddress,
		blua32StaticLayoutTokenLo: linked.symbols.staticLayoutToken.lo,
		blua32StaticLayoutTokenHi: linked.symbols.staticLayoutToken.hi,
		blua32DiagnosticDirectoryOffset: diagnosticDirectoryOffset,
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
