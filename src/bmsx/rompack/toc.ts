import type { asset_type, RomAsset } from './format';

export const ROM_TOC_MAGIC = 0x434f5442; // 'BTOC' little-endian
export const ROM_TOC_HEADER_SIZE = 48;
export const ROM_TOC_ENTRY_SIZE = 88;
export const ROM_TOC_INVALID_U32 = 0xffffffff;
export const ROM_TOC_OP_NONE = 0;
export const ROM_TOC_OP_DELETE = 1;
export const ROM_TOC_ASSET_TYPE_IMAGE = 1;
export const ROM_TOC_ASSET_TYPE_AUDIO = 2;
export const ROM_TOC_ASSET_TYPE_DATA = 3;
export const ROM_TOC_ASSET_TYPE_BIN = 4;
export const ROM_TOC_ASSET_TYPE_ATLAS = 5;
export const ROM_TOC_ASSET_TYPE_ROMLABEL = 6;
export const ROM_TOC_ASSET_TYPE_MODEL = 7;
export const ROM_TOC_ASSET_TYPE_AEM = 8;
export const ROM_TOC_ASSET_TYPE_LUA = 9;
export const ROM_TOC_ASSET_TYPE_CODE = 10;
const utf8Decoder = new TextDecoder();

export type RomTocPayload = {
	entries: RomAsset[];
	projectRootPath: string | null;
};

export enum AssetTypeKind {
	ImageAtlas,
	Audio,
	Model,
	Aem,
	Bin,
	Lua,
	Data,
	Code,
	Skip,
	Unknown,
}

const ASSET_TYPE_IDS: Record<asset_type, number> = {
	image: ROM_TOC_ASSET_TYPE_IMAGE,
	audio: ROM_TOC_ASSET_TYPE_AUDIO,
	data: ROM_TOC_ASSET_TYPE_DATA,
	bin: ROM_TOC_ASSET_TYPE_BIN,
	atlas: ROM_TOC_ASSET_TYPE_ATLAS,
	romlabel: ROM_TOC_ASSET_TYPE_ROMLABEL,
	model: ROM_TOC_ASSET_TYPE_MODEL,
	aem: ROM_TOC_ASSET_TYPE_AEM,
	lua: ROM_TOC_ASSET_TYPE_LUA,
	code: ROM_TOC_ASSET_TYPE_CODE,
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
		case ROM_TOC_ASSET_TYPE_IMAGE: return 'image';
		case ROM_TOC_ASSET_TYPE_AUDIO: return 'audio';
		case ROM_TOC_ASSET_TYPE_DATA: return 'data';
		case ROM_TOC_ASSET_TYPE_BIN: return 'bin';
		case ROM_TOC_ASSET_TYPE_ATLAS: return 'atlas';
		case ROM_TOC_ASSET_TYPE_ROMLABEL: return 'romlabel';
		case ROM_TOC_ASSET_TYPE_MODEL: return 'model';
		case ROM_TOC_ASSET_TYPE_AEM: return 'aem';
		case ROM_TOC_ASSET_TYPE_LUA: return 'lua';
		case ROM_TOC_ASSET_TYPE_CODE: return 'code';
		default:
			throw new Error(`Unknown asset type id "${id}".`);
	}
}

export function resolveAssetTypeKind(assetType: asset_type): AssetTypeKind {
	switch (assetType[0]) {
		case 'i':
			if (assetType === 'image') return AssetTypeKind.ImageAtlas;
			break;
		case 'a':
			if (assetType === 'atlas') return AssetTypeKind.ImageAtlas;
			if (assetType === 'audio') return AssetTypeKind.Audio;
			if (assetType === 'aem') return AssetTypeKind.Aem;
			break;
		case 'm':
			if (assetType === 'model') return AssetTypeKind.Model;
			break;
		case 'b':
			if (assetType === 'bin') return AssetTypeKind.Bin;
			break;
		case 'l':
			if (assetType === 'lua') return AssetTypeKind.Lua;
			break;
		case 'd':
			if (assetType === 'data') return AssetTypeKind.Data;
			break;
		case 'r':
			if (assetType === 'romlabel') return AssetTypeKind.Skip;
			break;
		case 'c':
			if (assetType === 'code') return AssetTypeKind.Code;
			break;
	}
	return AssetTypeKind.Unknown;
}

function decodeString(table: Uint8Array, offset: number, length: number, decoder: TextDecoder): string | null {
	if (offset === ROM_TOC_INVALID_U32 || length === 0) {
		return null;
	}
	return decoder.decode(table.subarray(offset, offset + length));
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
	const projectRootPath = decodeString(stringTable, projectRootOffset, projectRootLength, utf8Decoder);

	const entries: RomAsset[] = [];
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
		const collisionBinStart = view.getUint32(base + 72, true);
		const collisionBinEnd = view.getUint32(base + 76, true);
		const updateLo = view.getUint32(base + 80, true);
		const updateHi = view.getUint32(base + 84, true);

		const resid = decodeString(stringTable, residOffset, residLength, utf8Decoder);
		if (!resid) {
			throw new Error('ROM TOC entry is missing resid.');
		}
		const entry: RomAsset = {
			resid,
			type: assetTypeFromId(typeId),
			id_token_lo: tokenLo,
			id_token_hi: tokenHi,
		};
		if (opId === ROM_TOC_OP_DELETE) {
			entry.op = 'delete';
		}
		const sourcePath = decodeString(stringTable, sourceOffset, sourceLength, utf8Decoder);
		const normalizedSourcePath = decodeString(stringTable, normalizedOffset, normalizedLength, utf8Decoder);
		if (sourcePath) entry.source_path = sourcePath;
		if (normalizedSourcePath) entry.normalized_source_path = normalizedSourcePath;

		if (start !== ROM_TOC_INVALID_U32) entry.start = start;
		if (end !== ROM_TOC_INVALID_U32) entry.end = end;
		if (compiledStart !== ROM_TOC_INVALID_U32) entry.compiled_start = compiledStart;
		if (compiledEnd !== ROM_TOC_INVALID_U32) entry.compiled_end = compiledEnd;
		if (metaStart !== ROM_TOC_INVALID_U32) entry.metabuffer_start = metaStart;
		if (metaEnd !== ROM_TOC_INVALID_U32) entry.metabuffer_end = metaEnd;
		if (textureStart !== ROM_TOC_INVALID_U32) entry.texture_start = textureStart;
		if (textureEnd !== ROM_TOC_INVALID_U32) entry.texture_end = textureEnd;
		if (collisionBinStart !== ROM_TOC_INVALID_U32) entry.collision_bin_start = collisionBinStart;
		if (collisionBinEnd !== ROM_TOC_INVALID_U32) entry.collision_bin_end = collisionBinEnd;

		const updateTimestamp = (updateHi * 0x100000000) + updateLo;
		if (updateTimestamp > 0) {
			entry.update_timestamp = updateTimestamp;
		}

		entries.push(entry);
	}

	return { entries, projectRootPath };
}
