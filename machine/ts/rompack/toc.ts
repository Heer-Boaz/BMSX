import {
	ROM_TOC_ASSET_TYPE_AEM,
	ROM_TOC_ASSET_TYPE_AUDIO,
	ROM_TOC_ASSET_TYPE_BIN,
	ROM_TOC_ASSET_TYPE_CODE,
	ROM_TOC_ASSET_TYPE_DATA,
	ROM_TOC_ASSET_TYPE_IMAGE,
	ROM_TOC_ASSET_TYPE_LUA,
	ROM_TOC_ASSET_TYPE_MODEL,
	ROM_TOC_ASSET_TYPE_ROMLABEL,
	ROM_TOC_ASSET_TYPE_TEXTURE,
	ROM_TOC_ENTRY_ASSET_TYPE_OFFSET,
	ROM_TOC_ENTRY_COLLISION_BIN_END_OFFSET,
	ROM_TOC_ENTRY_COLLISION_BIN_START_OFFSET,
	ROM_TOC_ENTRY_COMPILED_END_OFFSET,
	ROM_TOC_ENTRY_COMPILED_START_OFFSET,
	ROM_TOC_ENTRY_DATA_END_OFFSET,
	ROM_TOC_ENTRY_DATA_START_OFFSET,
	ROM_TOC_ENTRY_METADATA_END_OFFSET,
	ROM_TOC_ENTRY_METADATA_START_OFFSET,
	ROM_TOC_ENTRY_MODEL_TEXTURE_END_OFFSET,
	ROM_TOC_ENTRY_MODEL_TEXTURE_START_OFFSET,
	ROM_TOC_ENTRY_NORMALIZED_SOURCE_PATH_LENGTH_OFFSET,
	ROM_TOC_ENTRY_NORMALIZED_SOURCE_PATH_OFFSET,
	ROM_TOC_ENTRY_OPERATION_OFFSET,
	ROM_TOC_ENTRY_RESID_LENGTH_OFFSET,
	ROM_TOC_ENTRY_RESID_OFFSET,
	ROM_TOC_ENTRY_SIZE,
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
	ROM_TOC_HEADER_SIZE,
	ROM_TOC_HEADER_SIZE_OFFSET,
	ROM_TOC_HEADER_STRING_TABLE_LENGTH_OFFSET,
	ROM_TOC_HEADER_STRING_TABLE_OFFSET,
	ROM_TOC_INVALID_U32,
	ROM_TOC_MAGIC,
	ROM_TOC_OP_DELETE,
} from '../spec/bmsx/rom_toc';
import { hashAssetId } from './tokens';
const utf8Decoder = new TextDecoder();

export type AssetType = 'image' | 'texture' | 'audio' | 'data' | 'bin' | 'romlabel' | 'model' | 'aem' | 'lua' | 'code';
export type AssetId = string;
export type RomAssetOp = 'delete';

export type RomTocEntry = {
	resid: AssetId;
	type: AssetType;
	id_token_lo: number;
	id_token_hi: number;
	op?: RomAssetOp;
	start?: number;
	end?: number;
	compiled_start?: number;
	compiled_end?: number;
	metabuffer_start?: number;
	metabuffer_end?: number;
	model_texture_start?: number;
	model_texture_end?: number;
	collision_bin_start?: number;
	collision_bin_end?: number;
	source_path?: string;
	normalized_source_path?: string;
	update_timestamp?: number;
};

export type RomTocPayload = {
	entries: RomTocEntry[];
	projectRootPath: string | null;
};

const ASSET_TYPE_IDS: Record<AssetType, number> = {
	image: ROM_TOC_ASSET_TYPE_IMAGE,
	texture: ROM_TOC_ASSET_TYPE_TEXTURE,
	audio: ROM_TOC_ASSET_TYPE_AUDIO,
	data: ROM_TOC_ASSET_TYPE_DATA,
	bin: ROM_TOC_ASSET_TYPE_BIN,
	romlabel: ROM_TOC_ASSET_TYPE_ROMLABEL,
	model: ROM_TOC_ASSET_TYPE_MODEL,
	aem: ROM_TOC_ASSET_TYPE_AEM,
	lua: ROM_TOC_ASSET_TYPE_LUA,
	code: ROM_TOC_ASSET_TYPE_CODE,
};

export function assetTypeToId(type: AssetType): number {
	const id = ASSET_TYPE_IDS[type];
	if (!id) {
		throw new Error(`Unknown asset type "${type}".`);
	}
	return id;
}

export function assetTypeFromId(id: number): AssetType {
	switch (id) {
		case ROM_TOC_ASSET_TYPE_IMAGE: return 'image';
		case ROM_TOC_ASSET_TYPE_TEXTURE: return 'texture';
		case ROM_TOC_ASSET_TYPE_AUDIO: return 'audio';
		case ROM_TOC_ASSET_TYPE_DATA: return 'data';
		case ROM_TOC_ASSET_TYPE_BIN: return 'bin';
		case ROM_TOC_ASSET_TYPE_ROMLABEL: return 'romlabel';
		case ROM_TOC_ASSET_TYPE_MODEL: return 'model';
		case ROM_TOC_ASSET_TYPE_AEM: return 'aem';
		case ROM_TOC_ASSET_TYPE_LUA: return 'lua';
		case ROM_TOC_ASSET_TYPE_CODE: return 'code';
		default:
			throw new Error(`Unknown asset type id "${id}".`);
	}
}

function decodeString(table: Uint8Array, offset: number, length: number, decoder: TextDecoder): string | null {
	if (offset === ROM_TOC_INVALID_U32 || length === 0) {
		return null;
	}
	if (offset > table.byteLength || length > table.byteLength - offset) {
		throw new Error('ROM TOC string table entry is out of bounds.');
	}
	return decoder.decode(table.subarray(offset, offset + length));
}

export function decodeRomToc(buffer: Uint8Array): RomTocPayload {
	if (buffer.byteLength < ROM_TOC_HEADER_SIZE) {
		throw new Error('ROM TOC buffer is too small.');
	}
	const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
	const magic = view.getUint32(ROM_TOC_HEADER_MAGIC_OFFSET, true);
	if (magic !== ROM_TOC_MAGIC) {
		throw new Error('Invalid ROM TOC magic.');
	}
	const headerSize = view.getUint32(ROM_TOC_HEADER_SIZE_OFFSET, true);
	if (headerSize !== ROM_TOC_HEADER_SIZE) {
		throw new Error(`Unexpected ROM TOC header size ${headerSize}.`);
	}
	const entrySize = view.getUint32(ROM_TOC_HEADER_ENTRY_SIZE_OFFSET, true);
	if (entrySize !== ROM_TOC_ENTRY_SIZE) {
		throw new Error(`Unexpected ROM TOC entry size ${entrySize}.`);
	}
	const entryCount = view.getUint32(ROM_TOC_HEADER_ENTRY_COUNT_OFFSET, true);
	const entryOffset = view.getUint32(ROM_TOC_HEADER_ENTRY_TABLE_OFFSET, true);
	const stringTableOffset = view.getUint32(ROM_TOC_HEADER_STRING_TABLE_OFFSET, true);
	const stringTableLength = view.getUint32(ROM_TOC_HEADER_STRING_TABLE_LENGTH_OFFSET, true);
	const projectRootOffset = view.getUint32(ROM_TOC_HEADER_PROJECT_ROOT_OFFSET, true);
	const projectRootLength = view.getUint32(ROM_TOC_HEADER_PROJECT_ROOT_LENGTH_OFFSET, true);
	if (entryOffset !== ROM_TOC_HEADER_SIZE) {
		throw new Error(`Unexpected ROM TOC entry offset ${entryOffset}.`);
	}
	const entriesByteLength = entryCount * entrySize;
	const expectedStringOffset = entryOffset + entriesByteLength;
	if (stringTableOffset !== expectedStringOffset) {
		throw new Error(`Unexpected ROM TOC string table offset ${stringTableOffset} (expected ${expectedStringOffset}).`);
	}
	if (entryOffset + entriesByteLength > buffer.byteLength) {
		throw new Error('ROM TOC entries are out of bounds.');
	}
	if (stringTableOffset + stringTableLength > buffer.byteLength) {
		throw new Error('ROM TOC string table is out of bounds.');
	}

	const stringTable = buffer.subarray(stringTableOffset, stringTableOffset + stringTableLength);
	const projectRootPath = decodeString(stringTable, projectRootOffset, projectRootLength, utf8Decoder);

	const entries: RomTocEntry[] = [];
	for (let i = 0; i < entryCount; i += 1) {
		const base = entryOffset + i * entrySize;
		const tokenLo = view.getUint32(base + ROM_TOC_ENTRY_TOKEN_LO_OFFSET, true);
		const tokenHi = view.getUint32(base + ROM_TOC_ENTRY_TOKEN_HI_OFFSET, true);
		const typeId = view.getUint32(base + ROM_TOC_ENTRY_ASSET_TYPE_OFFSET, true);
		const opId = view.getUint32(base + ROM_TOC_ENTRY_OPERATION_OFFSET, true);
		const residOffset = view.getUint32(base + ROM_TOC_ENTRY_RESID_OFFSET, true);
		const residLength = view.getUint32(base + ROM_TOC_ENTRY_RESID_LENGTH_OFFSET, true);
		const sourceOffset = view.getUint32(base + ROM_TOC_ENTRY_SOURCE_PATH_OFFSET, true);
		const sourceLength = view.getUint32(base + ROM_TOC_ENTRY_SOURCE_PATH_LENGTH_OFFSET, true);
		const normalizedOffset = view.getUint32(base + ROM_TOC_ENTRY_NORMALIZED_SOURCE_PATH_OFFSET, true);
		const normalizedLength = view.getUint32(base + ROM_TOC_ENTRY_NORMALIZED_SOURCE_PATH_LENGTH_OFFSET, true);

		const start = view.getUint32(base + ROM_TOC_ENTRY_DATA_START_OFFSET, true);
		const end = view.getUint32(base + ROM_TOC_ENTRY_DATA_END_OFFSET, true);
		const compiledStart = view.getUint32(base + ROM_TOC_ENTRY_COMPILED_START_OFFSET, true);
		const compiledEnd = view.getUint32(base + ROM_TOC_ENTRY_COMPILED_END_OFFSET, true);
		const metaStart = view.getUint32(base + ROM_TOC_ENTRY_METADATA_START_OFFSET, true);
		const metaEnd = view.getUint32(base + ROM_TOC_ENTRY_METADATA_END_OFFSET, true);
		const modelTextureStart = view.getUint32(base + ROM_TOC_ENTRY_MODEL_TEXTURE_START_OFFSET, true);
		const modelTextureEnd = view.getUint32(base + ROM_TOC_ENTRY_MODEL_TEXTURE_END_OFFSET, true);
		const collisionBinStart = view.getUint32(base + ROM_TOC_ENTRY_COLLISION_BIN_START_OFFSET, true);
		const collisionBinEnd = view.getUint32(base + ROM_TOC_ENTRY_COLLISION_BIN_END_OFFSET, true);
		const updateLo = view.getUint32(base + ROM_TOC_ENTRY_UPDATE_TIMESTAMP_LO_OFFSET, true);
		const updateHi = view.getUint32(base + ROM_TOC_ENTRY_UPDATE_TIMESTAMP_HI_OFFSET, true);
		if ((start === ROM_TOC_INVALID_U32) !== (end === ROM_TOC_INVALID_U32)
			|| (compiledStart === ROM_TOC_INVALID_U32) !== (compiledEnd === ROM_TOC_INVALID_U32)
			|| (metaStart === ROM_TOC_INVALID_U32) !== (metaEnd === ROM_TOC_INVALID_U32)
			|| (modelTextureStart === ROM_TOC_INVALID_U32) !== (modelTextureEnd === ROM_TOC_INVALID_U32)
			|| (collisionBinStart === ROM_TOC_INVALID_U32) !== (collisionBinEnd === ROM_TOC_INVALID_U32)) {
			throw new Error('ROM TOC entry has an incomplete payload range.');
		}

		const resid = decodeString(stringTable, residOffset, residLength, utf8Decoder);
		if (!resid) {
			throw new Error('ROM TOC entry is missing resid.');
		}
		const token = hashAssetId(resid);
		if (token.lo !== tokenLo || token.hi !== tokenHi) {
			throw new Error(`ROM TOC entry token mismatch for asset '${resid}'.`);
		}
		const entry: RomTocEntry = {
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

		if (start !== ROM_TOC_INVALID_U32) {
			entry.start = start;
			entry.end = end;
		}
		if (compiledStart !== ROM_TOC_INVALID_U32) {
			entry.compiled_start = compiledStart;
			entry.compiled_end = compiledEnd;
		}
		if (metaStart !== ROM_TOC_INVALID_U32) {
			entry.metabuffer_start = metaStart;
			entry.metabuffer_end = metaEnd;
		}
		if (modelTextureStart !== ROM_TOC_INVALID_U32) {
			entry.model_texture_start = modelTextureStart;
			entry.model_texture_end = modelTextureEnd;
		}
		if (collisionBinStart !== ROM_TOC_INVALID_U32) {
			entry.collision_bin_start = collisionBinStart;
			entry.collision_bin_end = collisionBinEnd;
		}

		const updateTimestamp = (updateHi * 0x100000000) + updateLo;
		if (entry.type === 'lua' || updateTimestamp > 0) {
			entry.update_timestamp = updateTimestamp;
		}

		entries.push(entry);
	}

	return { entries, projectRootPath };
}
