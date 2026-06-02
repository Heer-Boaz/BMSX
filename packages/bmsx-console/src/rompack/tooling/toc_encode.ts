import type { RomAsset } from '../format';
import { hashAssetId } from '../tokens';
import {
	assetTypeToId,
	ROM_TOC_ENTRY_SIZE,
	ROM_TOC_HEADER_SIZE,
	ROM_TOC_INVALID_U32,
	ROM_TOC_MAGIC,
	ROM_TOC_OP_DELETE,
	ROM_TOC_OP_NONE,
} from '../toc';

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

		writeU32(entryView, base + 0, token.lo);
		writeU32(entryView, base + 4, token.hi);
		writeU32(entryView, base + 8, typeId);
		writeU32(entryView, base + 12, opId);
		writeU32(entryView, base + 16, residRef.offset);
		writeU32(entryView, base + 20, residRef.length);
		writeU32(entryView, base + 24, sourceRef.offset);
		writeU32(entryView, base + 28, sourceRef.length);
		writeU32(entryView, base + 32, normalizedRef.offset);
		writeU32(entryView, base + 36, normalizedRef.length);
		writeU32(entryView, base + 40, asU32(entry.start));
		writeU32(entryView, base + 44, asU32(entry.end));
		writeU32(entryView, base + 48, asU32(entry.compiled_start));
		writeU32(entryView, base + 52, asU32(entry.compiled_end));
		writeU32(entryView, base + 56, asU32(entry.metabuffer_start));
		writeU32(entryView, base + 60, asU32(entry.metabuffer_end));
		writeU32(entryView, base + 64, asU32(entry.texture_start));
		writeU32(entryView, base + 68, asU32(entry.texture_end));
		writeU32(entryView, base + 72, asU32(entry.collision_bin_start));
		writeU32(entryView, base + 76, asU32(entry.collision_bin_end));
		writeU32(entryView, base + 80, updateLo);
		writeU32(entryView, base + 84, updateHi);
	}

	const stringTable = concatArrays(stringChunks, stringTableLength);
	const headerBuffer = new Uint8Array(ROM_TOC_HEADER_SIZE);
	const headerView = new DataView(headerBuffer.buffer, headerBuffer.byteOffset, headerBuffer.byteLength);
	const entryTableSize = entryBuffer.byteLength;
	const stringTableOffset = ROM_TOC_HEADER_SIZE + entryTableSize;

	writeU32(headerView, 0, ROM_TOC_MAGIC);
	writeU32(headerView, 4, ROM_TOC_HEADER_SIZE);
	writeU32(headerView, 8, ROM_TOC_ENTRY_SIZE);
	writeU32(headerView, 12, entries.length);
	writeU32(headerView, 16, ROM_TOC_HEADER_SIZE);
	writeU32(headerView, 20, stringTableOffset);
	writeU32(headerView, 24, stringTable.byteLength);
	writeU32(headerView, 28, projectRootRef.offset);
	writeU32(headerView, 32, projectRootRef.length);
	writeU32(headerView, 36, 0);
	writeU32(headerView, 40, 0);
	writeU32(headerView, 44, 0);

	return concatArrays([headerBuffer, entryBuffer, stringTable], stringTableOffset + stringTable.byteLength);
}
