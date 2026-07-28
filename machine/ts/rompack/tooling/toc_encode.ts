import type { RomAsset } from '../format';
import { hashAssetId } from '../tokens';
import { assetTypeToId } from '../toc';
import {
	ROM_TOC_ENTRY_ASSET_TYPE_OFFSET,
	ROM_TOC_ENTRY_COLLISION_BIN_END_OFFSET,
	ROM_TOC_ENTRY_COLLISION_BIN_START_OFFSET,
	ROM_TOC_ENTRY_COMPILED_END_OFFSET,
	ROM_TOC_ENTRY_COMPILED_START_OFFSET,
	ROM_TOC_ENTRY_DATA_END_OFFSET,
	ROM_TOC_ENTRY_DATA_START_OFFSET,
	ROM_TOC_ENTRY_SIZE,
	ROM_TOC_ENTRY_METADATA_END_OFFSET,
	ROM_TOC_ENTRY_METADATA_START_OFFSET,
	ROM_TOC_ENTRY_MODEL_TEXTURE_END_OFFSET,
	ROM_TOC_ENTRY_MODEL_TEXTURE_START_OFFSET,
	ROM_TOC_ENTRY_NORMALIZED_SOURCE_PATH_LENGTH_OFFSET,
	ROM_TOC_ENTRY_NORMALIZED_SOURCE_PATH_OFFSET,
	ROM_TOC_ENTRY_OPERATION_OFFSET,
	ROM_TOC_ENTRY_RESID_LENGTH_OFFSET,
	ROM_TOC_ENTRY_RESID_OFFSET,
	ROM_TOC_ENTRY_SOURCE_PATH_LENGTH_OFFSET,
	ROM_TOC_ENTRY_SOURCE_PATH_OFFSET,
	ROM_TOC_ENTRY_TOKEN_HI_OFFSET,
	ROM_TOC_ENTRY_TOKEN_LO_OFFSET,
	ROM_TOC_ENTRY_UPDATE_TIMESTAMP_HI_OFFSET,
	ROM_TOC_ENTRY_UPDATE_TIMESTAMP_LO_OFFSET,
	ROM_TOC_HEADER_ENTRY_COUNT_OFFSET,
	ROM_TOC_HEADER_ENTRY_SIZE_OFFSET,
	ROM_TOC_HEADER_ENTRY_TABLE_OFFSET,
	ROM_TOC_HEADER_MAGIC_OFFSET,
	ROM_TOC_HEADER_PROJECT_ROOT_LENGTH_OFFSET,
	ROM_TOC_HEADER_PROJECT_ROOT_OFFSET,
	ROM_TOC_HEADER_RESERVED_0_OFFSET,
	ROM_TOC_HEADER_RESERVED_1_OFFSET,
	ROM_TOC_HEADER_RESERVED_2_OFFSET,
	ROM_TOC_HEADER_SIZE,
	ROM_TOC_HEADER_SIZE_OFFSET,
	ROM_TOC_HEADER_STRING_TABLE_LENGTH_OFFSET,
	ROM_TOC_HEADER_STRING_TABLE_OFFSET,
	ROM_TOC_INVALID_U32,
	ROM_TOC_MAGIC,
	ROM_TOC_OP_DELETE,
	ROM_TOC_OP_NONE,
} from '../../spec/bmsx/rom_toc';

type TocStringSlice = { offset: number; length: number };

function concatArrays(chunks: Uint8Array[], totalLength: number): Uint8Array {
	const output = new Uint8Array(totalLength);
	let offset = 0;
	for (const chunk of chunks) {
		output.set(chunk, offset);
		offset += chunk.length;
	}
	return output;
}

function asU32(value: number | undefined): number {
	return value !== undefined ? value : ROM_TOC_INVALID_U32;
}

function writeU32(view: DataView, offset: number, value: number): void {
	view.setUint32(offset, value >>> 0, true);
}

export function encodeRomToc(params: { entries: RomAsset[]; projectRootPath?: string | null; }): Uint8Array {
	const encoder = new TextEncoder();
	const stringChunks: Uint8Array[] = [];
	const stringIndex = new Map<string, TocStringSlice>();
	let stringTableLength = 0;
	const entries = params.entries
		.map((entry) => {
			const token = (entry.id_token_lo !== undefined && entry.id_token_hi !== undefined)
				? { lo: entry.id_token_lo, hi: entry.id_token_hi }
				: hashAssetId(entry.resid);
			return { entry, token };
		})
		.sort((a, b) => (a.token.hi - b.token.hi) || (a.token.lo - b.token.lo));

	const intern = (value: string | null | undefined): TocStringSlice => {
		if (!value || value.length === 0) {
			return { offset: ROM_TOC_INVALID_U32, length: 0 };
		}
		const existing = stringIndex.get(value);
		if (existing) {
			return existing;
		}
		const bytes = encoder.encode(value);
		const ref = { offset: stringTableLength, length: bytes.length };
		stringIndex.set(value, ref);
		stringChunks.push(bytes);
		stringTableLength += bytes.length;
		return ref;
	};

	const projectRootRef = intern(params.projectRootPath);
	const entryBuffer = new Uint8Array(entries.length * ROM_TOC_ENTRY_SIZE);
	const entryView = new DataView(entryBuffer.buffer, entryBuffer.byteOffset, entryBuffer.byteLength);

	for (let i = 0; i < entries.length; i += 1) {
		const { entry, token } = entries[i];
		const base = i * ROM_TOC_ENTRY_SIZE;
		const typeId = assetTypeToId(entry.type);
		const opId = entry.op === 'delete' ? ROM_TOC_OP_DELETE : ROM_TOC_OP_NONE;
		const residRef = intern(entry.resid);
		const sourceRef = intern(entry.source_path);
		const normalizedRef = intern(entry.normalized_source_path);

		const updateTimestamp = entry.update_timestamp !== undefined ? Math.floor(entry.update_timestamp) : 0;
		const updateLo = updateTimestamp >>> 0;
		const updateHi = Math.floor(updateTimestamp / 0x100000000) >>> 0;

		writeU32(entryView, base + ROM_TOC_ENTRY_TOKEN_LO_OFFSET, token.lo);
		writeU32(entryView, base + ROM_TOC_ENTRY_TOKEN_HI_OFFSET, token.hi);
		writeU32(entryView, base + ROM_TOC_ENTRY_ASSET_TYPE_OFFSET, typeId);
		writeU32(entryView, base + ROM_TOC_ENTRY_OPERATION_OFFSET, opId);
		writeU32(entryView, base + ROM_TOC_ENTRY_RESID_OFFSET, residRef.offset);
		writeU32(entryView, base + ROM_TOC_ENTRY_RESID_LENGTH_OFFSET, residRef.length);
		writeU32(entryView, base + ROM_TOC_ENTRY_SOURCE_PATH_OFFSET, sourceRef.offset);
		writeU32(entryView, base + ROM_TOC_ENTRY_SOURCE_PATH_LENGTH_OFFSET, sourceRef.length);
		writeU32(entryView, base + ROM_TOC_ENTRY_NORMALIZED_SOURCE_PATH_OFFSET, normalizedRef.offset);
		writeU32(entryView, base + ROM_TOC_ENTRY_NORMALIZED_SOURCE_PATH_LENGTH_OFFSET, normalizedRef.length);
		writeU32(entryView, base + ROM_TOC_ENTRY_DATA_START_OFFSET, asU32(entry.start));
		writeU32(entryView, base + ROM_TOC_ENTRY_DATA_END_OFFSET, asU32(entry.end));
		writeU32(entryView, base + ROM_TOC_ENTRY_COMPILED_START_OFFSET, asU32(entry.compiled_start));
		writeU32(entryView, base + ROM_TOC_ENTRY_COMPILED_END_OFFSET, asU32(entry.compiled_end));
		writeU32(entryView, base + ROM_TOC_ENTRY_METADATA_START_OFFSET, asU32(entry.metabuffer_start));
		writeU32(entryView, base + ROM_TOC_ENTRY_METADATA_END_OFFSET, asU32(entry.metabuffer_end));
		writeU32(entryView, base + ROM_TOC_ENTRY_MODEL_TEXTURE_START_OFFSET, asU32(entry.model_texture_start));
		writeU32(entryView, base + ROM_TOC_ENTRY_MODEL_TEXTURE_END_OFFSET, asU32(entry.model_texture_end));
		writeU32(entryView, base + ROM_TOC_ENTRY_COLLISION_BIN_START_OFFSET, asU32(entry.collision_bin_start));
		writeU32(entryView, base + ROM_TOC_ENTRY_COLLISION_BIN_END_OFFSET, asU32(entry.collision_bin_end));
		writeU32(entryView, base + ROM_TOC_ENTRY_UPDATE_TIMESTAMP_LO_OFFSET, updateLo);
		writeU32(entryView, base + ROM_TOC_ENTRY_UPDATE_TIMESTAMP_HI_OFFSET, updateHi);
	}

	const stringTable = concatArrays(stringChunks, stringTableLength);
	const headerBuffer = new Uint8Array(ROM_TOC_HEADER_SIZE);
	const headerView = new DataView(headerBuffer.buffer, headerBuffer.byteOffset, headerBuffer.byteLength);
	const entryTableSize = entryBuffer.byteLength;
	const stringTableOffset = ROM_TOC_HEADER_SIZE + entryTableSize;

	writeU32(headerView, ROM_TOC_HEADER_MAGIC_OFFSET, ROM_TOC_MAGIC);
	writeU32(headerView, ROM_TOC_HEADER_SIZE_OFFSET, ROM_TOC_HEADER_SIZE);
	writeU32(headerView, ROM_TOC_HEADER_ENTRY_SIZE_OFFSET, ROM_TOC_ENTRY_SIZE);
	writeU32(headerView, ROM_TOC_HEADER_ENTRY_COUNT_OFFSET, entries.length);
	writeU32(headerView, ROM_TOC_HEADER_ENTRY_TABLE_OFFSET, ROM_TOC_HEADER_SIZE);
	writeU32(headerView, ROM_TOC_HEADER_STRING_TABLE_OFFSET, stringTableOffset);
	writeU32(headerView, ROM_TOC_HEADER_STRING_TABLE_LENGTH_OFFSET, stringTable.byteLength);
	writeU32(headerView, ROM_TOC_HEADER_PROJECT_ROOT_OFFSET, projectRootRef.offset);
	writeU32(headerView, ROM_TOC_HEADER_PROJECT_ROOT_LENGTH_OFFSET, projectRootRef.length);
	writeU32(headerView, ROM_TOC_HEADER_RESERVED_0_OFFSET, 0);
	writeU32(headerView, ROM_TOC_HEADER_RESERVED_1_OFFSET, 0);
	writeU32(headerView, ROM_TOC_HEADER_RESERVED_2_OFFSET, 0);

	return concatArrays([headerBuffer, entryBuffer, stringTable], stringTableOffset + stringTable.byteLength);
}
