#include "rompack/toc.h"

#include "common/endian.h"
#include "rompack/tokens.h"

#include <utility>

namespace bmsx {
namespace {

std::optional<u32> optionalU32(u32 value) {
	if (value == ROM_TOC_INVALID_U32) {
		return std::nullopt;
	}
	return value;
}

std::optional<std::string> decodeTocString(
	std::span<const u8> table,
	u32 offset,
	u32 length
) {
	if (offset == ROM_TOC_INVALID_U32 || length == 0) {
		return std::nullopt;
	}
	if (static_cast<size_t>(offset) + static_cast<size_t>(length) > table.size()) {
		throw BMSX_RUNTIME_ERROR("ROM TOC string table entry out of bounds.");
	}
	return std::string(
		reinterpret_cast<const char*>(table.data() + offset),
		static_cast<size_t>(length)
	);
}

} // namespace

AssetType assetTypeFromId(u32 id) {
	switch (id) {
		case ROM_TOC_ASSET_TYPE_IMAGE: return AssetType::Image;
		case ROM_TOC_ASSET_TYPE_TEXTURE: return AssetType::Texture;
		case ROM_TOC_ASSET_TYPE_AUDIO: return AssetType::Audio;
		case ROM_TOC_ASSET_TYPE_DATA: return AssetType::Data;
		case ROM_TOC_ASSET_TYPE_BIN: return AssetType::Bin;
		case ROM_TOC_ASSET_TYPE_COLLISION_SHAPE: return AssetType::CollisionShape;
		case ROM_TOC_ASSET_TYPE_ROMLABEL: return AssetType::Romlabel;
		case ROM_TOC_ASSET_TYPE_MODEL: return AssetType::Model;
		case ROM_TOC_ASSET_TYPE_AEM: return AssetType::Aem;
		case ROM_TOC_ASSET_TYPE_LUA: return AssetType::Lua;
		case ROM_TOC_ASSET_TYPE_CODE: return AssetType::Code;
		default:
			throw BMSX_RUNTIME_ERROR("Unknown asset type id: " + std::to_string(id));
	}
}

u32 assetTypeToId(AssetType type) {
	return static_cast<u32>(type);
}

RomTocPayload decodeRomToc(std::span<const u8> bytes) {
	if (bytes.size() < ROM_TOC_HEADER_SIZE) {
		throw BMSX_RUNTIME_ERROR("ROM TOC is too small.");
	}
	const u8* data = bytes.data();
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
	if (static_cast<size_t>(entryOffset) + entriesBytes > bytes.size()) {
		throw BMSX_RUNTIME_ERROR("ROM TOC entries out of bounds.");
	}
	if (static_cast<size_t>(stringTableOffset) + static_cast<size_t>(stringTableLength) > bytes.size()) {
		throw BMSX_RUNTIME_ERROR("ROM TOC string table out of bounds.");
	}

	const std::span<const u8> stringTable = bytes.subspan(
		stringTableOffset,
		stringTableLength
	);
	RomTocPayload payload;
	payload.projectRootPath = decodeTocString(
		stringTable,
		projectRootOffset,
		projectRootLength
	);
	payload.entries.reserve(entryCount);

	for (u32 index = 0; index < entryCount; index += 1) {
		const u8* entry = data + entryOffset + (index * entrySize);
		const u32 tokenLo = readLE32(entry + ROM_TOC_ENTRY_TOKEN_LO_OFFSET);
		const u32 tokenHi = readLE32(entry + ROM_TOC_ENTRY_TOKEN_HI_OFFSET);
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

		const std::optional<std::string> assetId = decodeTocString(
			stringTable,
			residOffset,
			residLength
		);
		if (!assetId.has_value()) {
			throw BMSX_RUNTIME_ERROR("ROM TOC entry missing asset id.");
		}
		const AssetToken token = hashAssetId(*assetId);
		if (token.lo != tokenLo || token.hi != tokenHi) {
			throw BMSX_RUNTIME_ERROR("ROM TOC entry token mismatch for asset '" + *assetId + "'.");
		}

		RomTocEntry decoded;
		decoded.resid = *assetId;
		decoded.type = assetTypeFromId(typeId);
		decoded.id_token_lo = tokenLo;
		decoded.id_token_hi = tokenHi;
		if (opId == ROM_TOC_OP_DELETE) {
			decoded.op = RomAssetOp::Delete;
		}
		decoded.start = optionalU32(readLE32(entry + ROM_TOC_ENTRY_DATA_START_OFFSET));
		decoded.end = optionalU32(readLE32(entry + ROM_TOC_ENTRY_DATA_END_OFFSET));
		decoded.compiled_start = optionalU32(readLE32(entry + ROM_TOC_ENTRY_COMPILED_START_OFFSET));
		decoded.compiled_end = optionalU32(readLE32(entry + ROM_TOC_ENTRY_COMPILED_END_OFFSET));
		decoded.metabuffer_start = optionalU32(readLE32(entry + ROM_TOC_ENTRY_METADATA_START_OFFSET));
		decoded.metabuffer_end = optionalU32(readLE32(entry + ROM_TOC_ENTRY_METADATA_END_OFFSET));
		decoded.model_texture_start = optionalU32(readLE32(entry + ROM_TOC_ENTRY_MODEL_TEXTURE_START_OFFSET));
		decoded.model_texture_end = optionalU32(readLE32(entry + ROM_TOC_ENTRY_MODEL_TEXTURE_END_OFFSET));
		decoded.collision_bin_start = optionalU32(readLE32(entry + ROM_TOC_ENTRY_COLLISION_BIN_START_OFFSET));
		decoded.collision_bin_end = optionalU32(readLE32(entry + ROM_TOC_ENTRY_COLLISION_BIN_END_OFFSET));
		if (decoded.start.has_value() != decoded.end.has_value()
			|| decoded.compiled_start.has_value() != decoded.compiled_end.has_value()
			|| decoded.metabuffer_start.has_value() != decoded.metabuffer_end.has_value()
			|| decoded.model_texture_start.has_value() != decoded.model_texture_end.has_value()
			|| decoded.collision_bin_start.has_value() != decoded.collision_bin_end.has_value()) {
			throw BMSX_RUNTIME_ERROR("ROM TOC entry has an incomplete payload range.");
		}
		decoded.source_path = decodeTocString(
			stringTable,
			sourceOffset,
			sourceLength
		);
		decoded.normalized_source_path = decodeTocString(
			stringTable,
			normalizedOffset,
			normalizedLength
		);
		const u64 updateTimestamp = (static_cast<u64>(updateHi) << 32) | updateLo;
		if (decoded.type == AssetType::Lua || updateTimestamp != 0u) {
			decoded.update_timestamp = static_cast<f64>(updateTimestamp);
		}

		payload.entries.push_back(std::move(decoded));
	}
	return payload;
}

} // namespace bmsx
