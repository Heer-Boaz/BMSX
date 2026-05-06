#include "rompack/toc.h"

#include "common/endian.h"
#include "rompack/tokens.h"

namespace bmsx {
namespace {

std::optional<i32> optionalI32FromU32(u32 value) {
	if (value == ROM_TOC_INVALID_U32) {
		return std::nullopt;
	}
	return static_cast<i32>(value);
}

std::optional<i64> optionalI64FromU64(u64 value) {
	if (value == 0) {
		return std::nullopt;
	}
	return static_cast<i64>(value);
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

} // namespace

std::string assetTypeFromId(u32 id) {
	switch (id) {
		case 1: return "image";
		case 2: return "audio";
		case 3: return "data";
		case 4: return "bin";
		case 5: return "atlas";
		case 6: return "romlabel";
		case 7: return "model";
		case 8: return "aem";
		case 9: return "lua";
		case 10: return "code";
		default:
			throw BMSX_RUNTIME_ERROR("Unknown asset type id: " + std::to_string(id));
	}
}

u32 assetTypeToId(std::string_view type) {
	if (type == "image") return 1;
	if (type == "audio") return 2;
	if (type == "data") return 3;
	if (type == "bin") return 4;
	if (type == "atlas") return 5;
	if (type == "romlabel") return 6;
	if (type == "model") return 7;
	if (type == "aem") return 8;
	if (type == "lua") return 9;
	if (type == "code") return 10;
	throw BMSX_RUNTIME_ERROR("Unknown asset type: " + std::string(type));
}

AssetTypeKind resolveAssetTypeKind(std::string_view assetType) {
	switch (assetType[0]) {
		case 'i':
			if (assetType == "image") return AssetTypeKind::ImageAtlas;
			break;
		case 'a':
			if (assetType == "atlas") return AssetTypeKind::ImageAtlas;
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
			if (assetType == "code") return AssetTypeKind::Skip;
			break;
	}
	return AssetTypeKind::Unknown;
}

RomTocPayload decodeRomToc(const u8* data, size_t size) {
	if (size < ROM_TOC_HEADER_SIZE) {
		throw BMSX_RUNTIME_ERROR("ROM TOC is too small.");
	}
	if (readLE32(data + 0) != ROM_TOC_MAGIC) {
		throw BMSX_RUNTIME_ERROR("Invalid ROM TOC magic.");
	}
	if (readLE32(data + 4) != ROM_TOC_HEADER_SIZE) {
		throw BMSX_RUNTIME_ERROR("Unexpected ROM TOC header size.");
	}
	const u32 entrySize = readLE32(data + 8);
	if (entrySize != ROM_TOC_ENTRY_SIZE) {
		throw BMSX_RUNTIME_ERROR("Unexpected ROM TOC entry size.");
	}
	const u32 entryCount = readLE32(data + 12);
	const u32 entryOffset = readLE32(data + 16);
	if (entryOffset != ROM_TOC_HEADER_SIZE) {
		throw BMSX_RUNTIME_ERROR("Unexpected ROM TOC entry offset.");
	}
	const u32 stringTableOffset = readLE32(data + 20);
	const u32 stringTableLength = readLE32(data + 24);
	const u32 projectRootOffset = readLE32(data + 28);
	const u32 projectRootLength = readLE32(data + 32);
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
		const u32 tokenLo = readLE32(entry + 0);
		const u32 tokenHi = readLE32(entry + 4);
		const AssetToken assetToken = makeAssetToken(tokenLo, tokenHi);
		const u32 typeId = readLE32(entry + 8);
		const u32 opId = readLE32(entry + 12);
		const u32 residOffset = readLE32(entry + 16);
		const u32 residLength = readLE32(entry + 20);
		const u32 sourceOffset = readLE32(entry + 24);
		const u32 sourceLength = readLE32(entry + 28);
		const u32 normalizedOffset = readLE32(entry + 32);
		const u32 normalizedLength = readLE32(entry + 36);
		const u32 updateLo = readLE32(entry + 80);
		const u32 updateHi = readLE32(entry + 84);

		const std::optional<std::string> assetId = decodeTocString(stringTable, stringTableSize, residOffset, residLength);
		if (!assetId.has_value()) {
			throw BMSX_RUNTIME_ERROR("ROM TOC entry missing asset id.");
		}
		if (hashAssetToken(*assetId) != assetToken) {
			throw BMSX_RUNTIME_ERROR("ROM TOC entry token mismatch for asset '" + *assetId + "'.");
		}

		RomAssetInfo romInfo;
		romInfo.type = assetTypeFromId(typeId);
		if (opId == 1) {
			romInfo.op = std::string("delete");
		}
		romInfo.start = optionalI32FromU32(readLE32(entry + 40));
		romInfo.end = optionalI32FromU32(readLE32(entry + 44));
		romInfo.compiledStart = optionalI32FromU32(readLE32(entry + 48));
		romInfo.compiledEnd = optionalI32FromU32(readLE32(entry + 52));
		romInfo.metabufferStart = optionalI32FromU32(readLE32(entry + 56));
		romInfo.metabufferEnd = optionalI32FromU32(readLE32(entry + 60));
		romInfo.textureStart = optionalI32FromU32(readLE32(entry + 64));
		romInfo.textureEnd = optionalI32FromU32(readLE32(entry + 68));
		romInfo.collisionBinStart = optionalI32FromU32(readLE32(entry + 72));
		romInfo.collisionBinEnd = optionalI32FromU32(readLE32(entry + 76));
		romInfo.sourcePath = decodeTocString(stringTable, stringTableSize, sourceOffset, sourceLength);
		romInfo.normalizedSourcePath = decodeTocString(stringTable, stringTableSize, normalizedOffset, normalizedLength);
		romInfo.updateTimestamp = optionalI64FromU64((static_cast<u64>(updateHi) << 32) | updateLo);

		payload.entries.push_back(RomSourceEntry{*assetId, std::move(romInfo)});
	}
	return payload;
}

} // namespace bmsx
