import { encodeBinary } from '../../common/serializer/binencoder';
import {
	encodeProgramImage,
	PROGRAM_IMAGE_ID,
	PROGRAM_SYMBOLS_IMAGE_ID,
	type ProgramImage,
	type ProgramSymbolsImage,
} from '../../machine/program/loader';
import {
	CART_ROM_HEADER_SIZE,
	PROGRAM_BOOT_HEADER_VERSION,
	parseCartHeader,
	type RomAsset,
} from '../format';
import { alignRomAssetOffset } from '../asset_layout';
import type { RomSourceLayer } from '../source';
import { writeCartRomHeader } from './header_encode';
import { encodeRomToc } from './toc_encode';
import { CART_ROM_SIZE, SYSTEM_ROM_SIZE } from '../../machine/memory/map';

export function buildProgramTail(
	layer: RomSourceLayer,
	image: ProgramImage,
	metadata: ProgramSymbolsImage,
): RomSourceLayer {
	const header = parseCartHeader(layer.payload);
	const entries = layer.index.entries;
	let programEntry!: RomAsset;
	let symbolsEntry!: RomAsset;
	for (let index = 0; index < entries.length; index += 1) {
		const entry = entries[index];
		if (entry.resid === PROGRAM_IMAGE_ID) {
			programEntry = entry;
		} else if (entry.resid === PROGRAM_SYMBOLS_IMAGE_ID) {
			symbolsEntry = entry;
		}
	}
	const encoded = encodeProgramImage(image);
	const symbols = encodeBinary({ metadata });
	let offset = programEntry.start!;

	programEntry.start = offset;
	offset += encoded.sections.byteLength;
	programEntry.end = offset;
	offset = alignRomAssetOffset(offset);
	programEntry.compiled_start = offset;
	offset += encoded.descriptor.byteLength;
	programEntry.compiled_end = offset;
	offset = alignRomAssetOffset(offset);
	symbolsEntry.start = offset;
	offset += symbols.byteLength;
	symbolsEntry.end = offset;
	const dataEnd = offset;

	const toc = encodeRomToc({
		entries,
		projectRootPath: layer.index.projectRootPath,
	});
	offset = alignRomAssetOffset(offset);
	const tocOffset = offset;
	offset += toc.byteLength;
	const romCapacity = layer.id === 'system' ? SYSTEM_ROM_SIZE : CART_ROM_SIZE;
	if (offset > romCapacity) {
		throw new Error(`ROM payload exceeds the ${romCapacity}-byte ${layer.id} ROM window.`);
	}

	const sourcePayload = layer.payload;
	const payload = offset <= sourcePayload.byteLength ? sourcePayload : new Uint8Array(offset);
	if (payload !== sourcePayload) {
		payload.set(sourcePayload.subarray(0, programEntry.start), 0);
	}
	payload.set(encoded.sections, programEntry.start);
	payload.fill(0, programEntry.end, programEntry.compiled_start);
	payload.set(encoded.descriptor, programEntry.compiled_start);
	payload.fill(0, programEntry.compiled_end, symbolsEntry.start);
	payload.set(symbols, symbolsEntry.start);
	payload.fill(0, symbolsEntry.end, tocOffset);
	payload.set(toc, tocOffset);
	if (offset < payload.byteLength) {
		payload.fill(0, offset);
	}

	header.headerSize = CART_ROM_HEADER_SIZE;
	header.tocOffset = tocOffset;
	header.tocLength = toc.byteLength;
	header.dataLength = dataEnd - header.dataOffset;
	header.programBootVersion = PROGRAM_BOOT_HEADER_VERSION;
	header.programBootFlags = 0;
	header.programEntryProtoIndex = image.vectors.resetProtoIndex;
	header.programCodeByteCount = image.sections.text.code.byteLength;
	header.programConstPoolCount = image.sections.rodata.constPool.length;
	header.programProtoCount = image.sections.text.protos.length;
	header.programReserved0 = 0;
	header.programConstRelocCount = 0;
	writeCartRomHeader(payload, header);
	layer.payload = payload;
	return layer;
}
