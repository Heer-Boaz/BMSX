import type { asset_type, RomAsset } from './rompack';
import { hashAssetId } from '../util/asset_tokens';

export const ROM_TOC_MAGIC = 0x434f5442; // 'BTOC' little-endian
export const ROM_TOC_HEADER_SIZE = 48;
export const ROM_TOC_ENTRY_SIZE = 80;
export const ROM_TOC_INVALID_U32 = 0xffffffff;

export type RomTocPayload = {
	assets: RomAsset[];
	projectRootPath: string | null;
};

const ASSET_TYPE_IDS: Record<asset_type, number> = {
	image: 1,
	audio: 2,
	data: 3,
	atlas: 4,
	romlabel: 5,
	model: 6,
	aem: 7,
	lua: 8,
	code: 9,
};

export function assetTypeToId(type: asset_type): number {
	const id = ASSET_TYPE_IDS[type];
	if (!id) {
		throw new Error(`Unknown asset type "${type}".`);
	}
	return id;
}

export function assetTypeFromId(id: number): asset_type {
	switch (id) {
		case 1: return 'image';
		case 2: return 'audio';
		case 3: return 'data';
		case 4: return 'atlas';
		case 5: return 'romlabel';
		case 6: return 'model';
		case 7: return 'aem';
		case 8: return 'lua';
		case 9: return 'code';
		default:
			throw new Error(`Unknown asset type id "${id}".`);
	}
}

type StringRef = { offset: number; length: number };

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
	return typeof value === 'number' ? value : ROM_TOC_INVALID_U32;
}

function writeU32(view: DataView, offset: number, value: number): void {
	view.setUint32(offset, value >>> 0, true);
}

function decodeString(table: Uint8Array, offset: number, length: number, decoder: TextDecoder): string | null {
	if (offset === ROM_TOC_INVALID_U32 || length === 0) {
		return null;
	}
	return decoder.decode(table.subarray(offset, offset + length));
}

export function encodeRomToc(params: { assets: RomAsset[]; projectRootPath?: string | null; }): Uint8Array {
	const encoder = new TextEncoder();
	const stringChunks: Uint8Array[] = [];
	const stringIndex = new Map<string, StringRef>();
	let stringTableLength = 0;
	const assets = params.assets
		.map((asset) => {
			const token = (typeof asset.id_token_lo === 'number' && typeof asset.id_token_hi === 'number')
				? { lo: asset.id_token_lo, hi: asset.id_token_hi }
				: hashAssetId(asset.resid);
			return { asset, token };
		})
		.sort((a, b) => (a.token.hi - b.token.hi) || (a.token.lo - b.token.lo));

	const intern = (value: string | null | undefined): StringRef => {
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

	const projectRootRef = intern(params.projectRootPath ?? '');
	const entryBuffer = new Uint8Array(assets.length * ROM_TOC_ENTRY_SIZE);
	const entryView = new DataView(entryBuffer.buffer, entryBuffer.byteOffset, entryBuffer.byteLength);

	for (let i = 0; i < assets.length; i += 1) {
		const { asset, token } = assets[i];
		const base = i * ROM_TOC_ENTRY_SIZE;
		const typeId = assetTypeToId(asset.type);
		const opId = asset.op === 'delete' ? 1 : 0;
		const residRef = intern(asset.resid);
		const sourceRef = intern(asset.source_path);
		const normalizedRef = intern(asset.normalized_source_path);

		const updateTimestamp = typeof asset.update_timestamp === 'number' ? Math.floor(asset.update_timestamp) : 0;
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
		writeU32(entryView, base + 40, asU32(asset.start));
		writeU32(entryView, base + 44, asU32(asset.end));
		writeU32(entryView, base + 48, asU32(asset.compiled_start));
		writeU32(entryView, base + 52, asU32(asset.compiled_end));
		writeU32(entryView, base + 56, asU32(asset.metabuffer_start));
		writeU32(entryView, base + 60, asU32(asset.metabuffer_end));
		writeU32(entryView, base + 64, asU32(asset.texture_start));
		writeU32(entryView, base + 68, asU32(asset.texture_end));
		writeU32(entryView, base + 72, updateLo);
		writeU32(entryView, base + 76, updateHi);
	}

	const stringTable = concatArrays(stringChunks, stringTableLength);
	const headerBuffer = new Uint8Array(ROM_TOC_HEADER_SIZE);
	const headerView = new DataView(headerBuffer.buffer, headerBuffer.byteOffset, headerBuffer.byteLength);
	const entryTableSize = entryBuffer.byteLength;
	const stringTableOffset = ROM_TOC_HEADER_SIZE + entryTableSize;

	writeU32(headerView, 0, ROM_TOC_MAGIC);
	writeU32(headerView, 4, ROM_TOC_HEADER_SIZE);
	writeU32(headerView, 8, ROM_TOC_ENTRY_SIZE);
	writeU32(headerView, 12, assets.length);
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

export function decodeRomToc(buffer: Uint8Array): RomTocPayload {
	if (buffer.byteLength < ROM_TOC_HEADER_SIZE) {
		throw new Error('ROM TOC buffer is too small.');
	}
	const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
	const magic = view.getUint32(0, true);
	if (magic !== ROM_TOC_MAGIC) {
		throw new Error('Invalid ROM TOC magic.');
	}
	const headerSize = view.getUint32(4, true);
	if (headerSize !== ROM_TOC_HEADER_SIZE) {
		throw new Error(`Unexpected ROM TOC header size ${headerSize}.`);
	}
	const entrySize = view.getUint32(8, true);
	if (entrySize !== ROM_TOC_ENTRY_SIZE) {
		throw new Error(`Unexpected ROM TOC entry size ${entrySize}.`);
	}
	const entryCount = view.getUint32(12, true);
	const entryOffset = view.getUint32(16, true);
	const stringTableOffset = view.getUint32(20, true);
	const stringTableLength = view.getUint32(24, true);
	const projectRootOffset = view.getUint32(28, true);
	const projectRootLength = view.getUint32(32, true);
	if (entryOffset !== ROM_TOC_HEADER_SIZE) {
		throw new Error(`Unexpected ROM TOC entry offset ${entryOffset}.`);
	}
	const entriesByteLength = entryCount * entrySize;
	const expectedStringOffset = entryOffset + entriesByteLength;
	if (stringTableOffset !== expectedStringOffset) {
		throw new Error(`Unexpected ROM TOC string table offset ${stringTableOffset} (expected ${expectedStringOffset}).`);
	}

	const stringTable = buffer.subarray(stringTableOffset, stringTableOffset + stringTableLength);
	const decoder = new TextDecoder();
	const projectRootPath = decodeString(stringTable, projectRootOffset, projectRootLength, decoder);

	const assets: RomAsset[] = [];
	for (let i = 0; i < entryCount; i += 1) {
		const base = entryOffset + i * entrySize;
		const tokenLo = view.getUint32(base + 0, true);
		const tokenHi = view.getUint32(base + 4, true);
		const typeId = view.getUint32(base + 8, true);
		const opId = view.getUint32(base + 12, true);
		const residOffset = view.getUint32(base + 16, true);
		const residLength = view.getUint32(base + 20, true);
		const sourceOffset = view.getUint32(base + 24, true);
		const sourceLength = view.getUint32(base + 28, true);
		const normalizedOffset = view.getUint32(base + 32, true);
		const normalizedLength = view.getUint32(base + 36, true);

		const start = view.getUint32(base + 40, true);
		const end = view.getUint32(base + 44, true);
		const compiledStart = view.getUint32(base + 48, true);
		const compiledEnd = view.getUint32(base + 52, true);
		const metaStart = view.getUint32(base + 56, true);
		const metaEnd = view.getUint32(base + 60, true);
		const textureStart = view.getUint32(base + 64, true);
		const textureEnd = view.getUint32(base + 68, true);
		const updateLo = view.getUint32(base + 72, true);
		const updateHi = view.getUint32(base + 76, true);

		const resid = decodeString(stringTable, residOffset, residLength, decoder);
		if (!resid) {
			throw new Error('ROM TOC entry is missing resid.');
		}
		const asset: RomAsset = {
			resid,
			type: assetTypeFromId(typeId),
			id_token_lo: tokenLo,
			id_token_hi: tokenHi,
		};
		if (opId === 1) {
			asset.op = 'delete';
		}
		const sourcePath = decodeString(stringTable, sourceOffset, sourceLength, decoder);
		const normalizedSourcePath = decodeString(stringTable, normalizedOffset, normalizedLength, decoder);
		if (sourcePath) asset.source_path = sourcePath;
		if (normalizedSourcePath) asset.normalized_source_path = normalizedSourcePath;

		if (start !== ROM_TOC_INVALID_U32) asset.start = start;
		if (end !== ROM_TOC_INVALID_U32) asset.end = end;
		if (compiledStart !== ROM_TOC_INVALID_U32) asset.compiled_start = compiledStart;
		if (compiledEnd !== ROM_TOC_INVALID_U32) asset.compiled_end = compiledEnd;
		if (metaStart !== ROM_TOC_INVALID_U32) asset.metabuffer_start = metaStart;
		if (metaEnd !== ROM_TOC_INVALID_U32) asset.metabuffer_end = metaEnd;
		if (textureStart !== ROM_TOC_INVALID_U32) asset.texture_start = textureStart;
		if (textureEnd !== ROM_TOC_INVALID_U32) asset.texture_end = textureEnd;

		const updateTimestamp = (updateHi * 0x100000000) + updateLo;
		if (updateTimestamp > 0) {
			asset.update_timestamp = updateTimestamp;
		}

		assets.push(asset);
	}

	return { assets, projectRootPath };
}
