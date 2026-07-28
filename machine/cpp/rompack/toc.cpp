#include "rompack/toc.h"

#include "common/endian.h"
#include "rompack/tokens.h"

#include <algorithm>
#include <unordered_map>
#include <utility>

namespace bmsx {
namespace {

struct TocStringSlice {
	u32 offset = ROM_TOC_INVALID_U32;
	u32 length = 0;
};

std::optional<i32> optionalI32FromU32(u32 value) {
	if (value == ROM_TOC_INVALID_U32) {
		return std::nullopt;
	}
	return static_cast<i32>(value);
}

std::optional<std::string> decodeTocString(const u8* table, size_t tableSize, u32 offset, u32 length) {
	if (offset == ROM_TOC_INVALID_U32 || length == 0) {
		return std::nullopt;
	}
	if (static_cast<size_t>(offset) + static_cast<size_t>(length) > tableSize) {
		throw BMSX_RUNTIME_ERROR("ROM TOC string table entry out of bounds.");
	}
	return std::string(reinterpret_cast<const char*>(table + offset), static_cast<size_t>(length));
}

u32 tocFieldValue(const std::optional<i32>& value) {
	return value.has_value() ? static_cast<u32>(*value) : ROM_TOC_INVALID_U32;
}

u32 tocUpdateLo(const std::optional<i64>& value) {
	return value.has_value() ? static_cast<u32>(static_cast<u64>(*value) & 0xffffffffu) : 0u;
}

u32 tocUpdateHi(const std::optional<i64>& value) {
	return value.has_value() ? static_cast<u32>(static_cast<u64>(*value) >> 32u) : 0u;
}

void writeTocString(std::vector<u8>& table, std::unordered_map<std::string, TocStringSlice>& index, std::string_view text, TocStringSlice& out) {
	if (text.empty()) {
		out = {};
		return;
	}
	const std::string key(text);
	const auto found = index.find(key);
	if (found != index.end()) {
		out = found->second;
		return;
	}
	out.offset = static_cast<u32>(table.size());
	out.length = static_cast<u32>(text.size());
	for (char value : text) {
		table.push_back(static_cast<u8>(value));
	}
	index.emplace(key, out);
}

TocStringSlice internTocString(std::vector<u8>& table, std::unordered_map<std::string, TocStringSlice>& index, const std::optional<std::string>& text) {
	TocStringSlice ref;
	if (text.has_value()) {
		writeTocString(table, index, *text, ref);
	}
	return ref;
}

TocStringSlice internTocString(std::vector<u8>& table, std::unordered_map<std::string, TocStringSlice>& index, const std::string& text) {
	TocStringSlice ref;
	writeTocString(table, index, text, ref);
	return ref;
}

} // namespace

std::string assetTypeFromId(u32 id) {
	switch (id) {
		case ROM_TOC_ASSET_TYPE_IMAGE: return "image";
		case ROM_TOC_ASSET_TYPE_TEXTURE: return "texture";
		case ROM_TOC_ASSET_TYPE_AUDIO: return "audio";
		case ROM_TOC_ASSET_TYPE_DATA: return "data";
		case ROM_TOC_ASSET_TYPE_BIN: return "bin";
		case ROM_TOC_ASSET_TYPE_ROMLABEL: return "romlabel";
		case ROM_TOC_ASSET_TYPE_MODEL: return "model";
		case ROM_TOC_ASSET_TYPE_AEM: return "aem";
		case ROM_TOC_ASSET_TYPE_LUA: return "lua";
		case ROM_TOC_ASSET_TYPE_CODE: return "code";
		default:
			throw BMSX_RUNTIME_ERROR("Unknown asset type id: " + std::to_string(id));
	}
}

u32 assetTypeToId(std::string_view type) {
	if (type == "image") return ROM_TOC_ASSET_TYPE_IMAGE;
	if (type == "texture") return ROM_TOC_ASSET_TYPE_TEXTURE;
	if (type == "audio") return ROM_TOC_ASSET_TYPE_AUDIO;
	if (type == "data") return ROM_TOC_ASSET_TYPE_DATA;
	if (type == "bin") return ROM_TOC_ASSET_TYPE_BIN;
	if (type == "romlabel") return ROM_TOC_ASSET_TYPE_ROMLABEL;
	if (type == "model") return ROM_TOC_ASSET_TYPE_MODEL;
	if (type == "aem") return ROM_TOC_ASSET_TYPE_AEM;
	if (type == "lua") return ROM_TOC_ASSET_TYPE_LUA;
	if (type == "code") return ROM_TOC_ASSET_TYPE_CODE;
	throw BMSX_RUNTIME_ERROR("Unknown asset type: " + std::string(type));
}

AssetTypeKind resolveAssetTypeKind(std::string_view assetType) {
	if (assetType.empty()) {
		return AssetTypeKind::Unknown;
	}
	switch (assetType[0]) {
		case 'i':
			if (assetType == "image") return AssetTypeKind::Image;
			break;
		case 't':
			if (assetType == "texture") return AssetTypeKind::Texture;
			break;
		case 'a':
			if (assetType == "audio") return AssetTypeKind::Audio;
			if (assetType == "aem") return AssetTypeKind::Aem;
			break;
		case 'm':
			if (assetType == "model") return AssetTypeKind::Model;
			break;
		case 'b':
			if (assetType == "bin") return AssetTypeKind::Bin;
			break;
		case 'l':
			if (assetType == "lua") return AssetTypeKind::Lua;
			break;
		case 'd':
			if (assetType == "data") return AssetTypeKind::Data;
			break;
		case 'r':
			if (assetType == "romlabel") return AssetTypeKind::Skip;
			break;
		case 'c':
			if (assetType == "code") return AssetTypeKind::Code;
			break;
	}
	return AssetTypeKind::Unknown;
}

RomTocPayload decodeRomToc(const u8* data, size_t size) {
	if (size < ROM_TOC_HEADER_SIZE) {
		throw BMSX_RUNTIME_ERROR("ROM TOC is too small.");
	}
	if (readLE32(data + ROM_TOC_HEADER_MAGIC_OFFSET) != ROM_TOC_MAGIC) {
		throw BMSX_RUNTIME_ERROR("Invalid ROM TOC magic.");
	}
	if (readLE32(data + ROM_TOC_HEADER_SIZE_OFFSET) != ROM_TOC_HEADER_SIZE) {
		throw BMSX_RUNTIME_ERROR("Unexpected ROM TOC header size.");
	}
	const u32 entrySize = readLE32(data + ROM_TOC_HEADER_ENTRY_SIZE_OFFSET);
	if (entrySize != ROM_TOC_ENTRY_SIZE) {
		throw BMSX_RUNTIME_ERROR("Unexpected ROM TOC entry size.");
	}
	const u32 entryCount = readLE32(data + ROM_TOC_HEADER_ENTRY_COUNT_OFFSET);
	const u32 entryOffset = readLE32(data + ROM_TOC_HEADER_ENTRY_TABLE_OFFSET);
	if (entryOffset != ROM_TOC_HEADER_SIZE) {
		throw BMSX_RUNTIME_ERROR("Unexpected ROM TOC entry offset.");
	}
	const u32 stringTableOffset = readLE32(data + ROM_TOC_HEADER_STRING_TABLE_OFFSET);
	const u32 stringTableLength = readLE32(data + ROM_TOC_HEADER_STRING_TABLE_LENGTH_OFFSET);
	const u32 projectRootOffset = readLE32(data + ROM_TOC_HEADER_PROJECT_ROOT_OFFSET);
	const u32 projectRootLength = readLE32(data + ROM_TOC_HEADER_PROJECT_ROOT_LENGTH_OFFSET);
	const size_t entriesBytes = static_cast<size_t>(entryCount) * static_cast<size_t>(entrySize);
	const size_t expectedStringOffset = static_cast<size_t>(entryOffset) + entriesBytes;
	if (static_cast<size_t>(stringTableOffset) != expectedStringOffset) {
		throw BMSX_RUNTIME_ERROR("Unexpected ROM TOC string table offset.");
	}
	if (static_cast<size_t>(entryOffset) + entriesBytes > size) {
		throw BMSX_RUNTIME_ERROR("ROM TOC entries out of bounds.");
	}
	if (static_cast<size_t>(stringTableOffset) + static_cast<size_t>(stringTableLength) > size) {
		throw BMSX_RUNTIME_ERROR("ROM TOC string table out of bounds.");
	}

	const u8* stringTable = data + stringTableOffset;
	const size_t stringTableSize = stringTableLength;
	RomTocPayload payload;
	payload.projectRootPath = decodeTocString(stringTable, stringTableSize, projectRootOffset, projectRootLength);
	payload.entries.reserve(entryCount);

	for (u32 index = 0; index < entryCount; index += 1) {
		const u8* entry = data + entryOffset + (index * entrySize);
		const u32 tokenLo = readLE32(entry + ROM_TOC_ENTRY_TOKEN_LO_OFFSET);
		const u32 tokenHi = readLE32(entry + ROM_TOC_ENTRY_TOKEN_HI_OFFSET);
		const AssetToken assetToken = makeAssetToken(tokenLo, tokenHi);
		const u32 typeId = readLE32(entry + ROM_TOC_ENTRY_ASSET_TYPE_OFFSET);
		const u32 opId = readLE32(entry + ROM_TOC_ENTRY_OPERATION_OFFSET);
		const u32 residOffset = readLE32(entry + ROM_TOC_ENTRY_RESID_OFFSET);
		const u32 residLength = readLE32(entry + ROM_TOC_ENTRY_RESID_LENGTH_OFFSET);
		const u32 sourceOffset = readLE32(entry + ROM_TOC_ENTRY_SOURCE_PATH_OFFSET);
		const u32 sourceLength = readLE32(entry + ROM_TOC_ENTRY_SOURCE_PATH_LENGTH_OFFSET);
		const u32 normalizedOffset = readLE32(entry + ROM_TOC_ENTRY_NORMALIZED_SOURCE_PATH_OFFSET);
		const u32 normalizedLength = readLE32(entry + ROM_TOC_ENTRY_NORMALIZED_SOURCE_PATH_LENGTH_OFFSET);
		const u32 updateLo = readLE32(entry + ROM_TOC_ENTRY_UPDATE_TIMESTAMP_LO_OFFSET);
		const u32 updateHi = readLE32(entry + ROM_TOC_ENTRY_UPDATE_TIMESTAMP_HI_OFFSET);

		const std::optional<std::string> assetId = decodeTocString(stringTable, stringTableSize, residOffset, residLength);
		if (!assetId.has_value()) {
			throw BMSX_RUNTIME_ERROR("ROM TOC entry missing asset id.");
		}
		if (hashAssetToken(*assetId) != assetToken) {
			throw BMSX_RUNTIME_ERROR("ROM TOC entry token mismatch for asset '" + *assetId + "'.");
		}

		RomAssetInfo romInfo;
		romInfo.type = assetTypeFromId(typeId);
		if (opId == ROM_TOC_OP_DELETE) {
			romInfo.op = std::string("delete");
		}
		romInfo.start = optionalI32FromU32(readLE32(entry + ROM_TOC_ENTRY_DATA_START_OFFSET));
		romInfo.end = optionalI32FromU32(readLE32(entry + ROM_TOC_ENTRY_DATA_END_OFFSET));
		romInfo.compiledStart = optionalI32FromU32(readLE32(entry + ROM_TOC_ENTRY_COMPILED_START_OFFSET));
		romInfo.compiledEnd = optionalI32FromU32(readLE32(entry + ROM_TOC_ENTRY_COMPILED_END_OFFSET));
		romInfo.metabufferStart = optionalI32FromU32(readLE32(entry + ROM_TOC_ENTRY_METADATA_START_OFFSET));
		romInfo.metabufferEnd = optionalI32FromU32(readLE32(entry + ROM_TOC_ENTRY_METADATA_END_OFFSET));
		romInfo.modelTextureStart = optionalI32FromU32(readLE32(entry + ROM_TOC_ENTRY_MODEL_TEXTURE_START_OFFSET));
		romInfo.modelTextureEnd = optionalI32FromU32(readLE32(entry + ROM_TOC_ENTRY_MODEL_TEXTURE_END_OFFSET));
		romInfo.collisionBinStart = optionalI32FromU32(readLE32(entry + ROM_TOC_ENTRY_COLLISION_BIN_START_OFFSET));
		romInfo.collisionBinEnd = optionalI32FromU32(readLE32(entry + ROM_TOC_ENTRY_COLLISION_BIN_END_OFFSET));
		romInfo.sourcePath = decodeTocString(stringTable, stringTableSize, sourceOffset, sourceLength);
		romInfo.normalizedSourcePath = decodeTocString(stringTable, stringTableSize, normalizedOffset, normalizedLength);
		const u64 updateTimestamp = (static_cast<u64>(updateHi) << 32) | updateLo;
		if (typeId == ROM_TOC_ASSET_TYPE_LUA || updateTimestamp != 0u) {
			romInfo.updateTimestamp = static_cast<i64>(updateTimestamp);
		}

		payload.entries.push_back(RomSourceEntry{*assetId, std::move(romInfo)});
	}
	return payload;
}

std::vector<u8> encodeRomToc(const RomTocPayload& payload) {
	std::vector<RomSourceEntry> entries = payload.entries;
	std::sort(entries.begin(), entries.end(), [](const RomSourceEntry& lhs, const RomSourceEntry& rhs) {
		return lhs.resid < rhs.resid;
	});

	std::vector<u8> stringTable;
	std::unordered_map<std::string, TocStringSlice> stringIndex;
	const TocStringSlice projectRoot = internTocString(stringTable, stringIndex, payload.projectRootPath);

	std::vector<u8> out(ROM_TOC_HEADER_SIZE + (entries.size() * ROM_TOC_ENTRY_SIZE));
	writeLE32(out.data() + ROM_TOC_HEADER_MAGIC_OFFSET, ROM_TOC_MAGIC);
	writeLE32(out.data() + ROM_TOC_HEADER_SIZE_OFFSET, ROM_TOC_HEADER_SIZE);
	writeLE32(out.data() + ROM_TOC_HEADER_ENTRY_SIZE_OFFSET, ROM_TOC_ENTRY_SIZE);
	writeLE32(out.data() + ROM_TOC_HEADER_ENTRY_COUNT_OFFSET, static_cast<u32>(entries.size()));
	writeLE32(out.data() + ROM_TOC_HEADER_ENTRY_TABLE_OFFSET, ROM_TOC_HEADER_SIZE);
	writeLE32(out.data() + ROM_TOC_HEADER_STRING_TABLE_OFFSET, ROM_TOC_HEADER_SIZE + static_cast<u32>(entries.size() * ROM_TOC_ENTRY_SIZE));
	writeLE32(out.data() + ROM_TOC_HEADER_STRING_TABLE_LENGTH_OFFSET, 0u);
	writeLE32(out.data() + ROM_TOC_HEADER_PROJECT_ROOT_OFFSET, projectRoot.offset);
	writeLE32(out.data() + ROM_TOC_HEADER_PROJECT_ROOT_LENGTH_OFFSET, projectRoot.length);
	writeLE32(out.data() + ROM_TOC_HEADER_RESERVED_0_OFFSET, 0u);
	writeLE32(out.data() + ROM_TOC_HEADER_RESERVED_1_OFFSET, 0u);
	writeLE32(out.data() + ROM_TOC_HEADER_RESERVED_2_OFFSET, 0u);

	for (size_t index = 0; index < entries.size(); ++index) {
		const RomSourceEntry& source = entries[index];
		const TocStringSlice resid = internTocString(stringTable, stringIndex, source.resid);
		const TocStringSlice sourcePath = internTocString(stringTable, stringIndex, source.rom.sourcePath);
		const TocStringSlice normalizedSourcePath = internTocString(stringTable, stringIndex, source.rom.normalizedSourcePath);
		const AssetTokenParts token = splitAssetToken(hashAssetToken(source.resid));
		const u32 opId = source.rom.op == "delete" ? ROM_TOC_OP_DELETE : ROM_TOC_OP_NONE;
		u8* entry = out.data() + ROM_TOC_HEADER_SIZE + (index * ROM_TOC_ENTRY_SIZE);
		writeLE32(entry + ROM_TOC_ENTRY_TOKEN_LO_OFFSET, token.lo);
		writeLE32(entry + ROM_TOC_ENTRY_TOKEN_HI_OFFSET, token.hi);
		writeLE32(entry + ROM_TOC_ENTRY_ASSET_TYPE_OFFSET, assetTypeToId(source.rom.type));
		writeLE32(entry + ROM_TOC_ENTRY_OPERATION_OFFSET, opId);
		writeLE32(entry + ROM_TOC_ENTRY_RESID_OFFSET, resid.offset);
		writeLE32(entry + ROM_TOC_ENTRY_RESID_LENGTH_OFFSET, resid.length);
		writeLE32(entry + ROM_TOC_ENTRY_SOURCE_PATH_OFFSET, sourcePath.offset);
		writeLE32(entry + ROM_TOC_ENTRY_SOURCE_PATH_LENGTH_OFFSET, sourcePath.length);
		writeLE32(entry + ROM_TOC_ENTRY_NORMALIZED_SOURCE_PATH_OFFSET, normalizedSourcePath.offset);
		writeLE32(entry + ROM_TOC_ENTRY_NORMALIZED_SOURCE_PATH_LENGTH_OFFSET, normalizedSourcePath.length);
		writeLE32(entry + ROM_TOC_ENTRY_DATA_START_OFFSET, tocFieldValue(source.rom.start));
		writeLE32(entry + ROM_TOC_ENTRY_DATA_END_OFFSET, tocFieldValue(source.rom.end));
		writeLE32(entry + ROM_TOC_ENTRY_COMPILED_START_OFFSET, tocFieldValue(source.rom.compiledStart));
		writeLE32(entry + ROM_TOC_ENTRY_COMPILED_END_OFFSET, tocFieldValue(source.rom.compiledEnd));
		writeLE32(entry + ROM_TOC_ENTRY_METADATA_START_OFFSET, tocFieldValue(source.rom.metabufferStart));
		writeLE32(entry + ROM_TOC_ENTRY_METADATA_END_OFFSET, tocFieldValue(source.rom.metabufferEnd));
		writeLE32(entry + ROM_TOC_ENTRY_MODEL_TEXTURE_START_OFFSET, tocFieldValue(source.rom.modelTextureStart));
		writeLE32(entry + ROM_TOC_ENTRY_MODEL_TEXTURE_END_OFFSET, tocFieldValue(source.rom.modelTextureEnd));
		writeLE32(entry + ROM_TOC_ENTRY_COLLISION_BIN_START_OFFSET, tocFieldValue(source.rom.collisionBinStart));
		writeLE32(entry + ROM_TOC_ENTRY_COLLISION_BIN_END_OFFSET, tocFieldValue(source.rom.collisionBinEnd));
		writeLE32(entry + ROM_TOC_ENTRY_UPDATE_TIMESTAMP_LO_OFFSET, tocUpdateLo(source.rom.updateTimestamp));
		writeLE32(entry + ROM_TOC_ENTRY_UPDATE_TIMESTAMP_HI_OFFSET, tocUpdateHi(source.rom.updateTimestamp));
	}

	writeLE32(out.data() + ROM_TOC_HEADER_STRING_TABLE_LENGTH_OFFSET, static_cast<u32>(stringTable.size()));
	out.insert(out.end(), stringTable.begin(), stringTable.end());
	return out;
}

} // namespace bmsx
