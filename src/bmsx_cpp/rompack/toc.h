#pragma once

#include "common/primitives.h"
#include "rompack/source.h"
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace bmsx {

constexpr u32 ROM_TOC_MAGIC = 0x434f5442; // 'BTOC' little-endian
constexpr u32 ROM_TOC_HEADER_SIZE = 48;
constexpr u32 ROM_TOC_ENTRY_SIZE = 88;
constexpr u32 ROM_TOC_INVALID_U32 = 0xffffffffu;

struct RomTocPayload {
	std::vector<RomSourceEntry> entries;
	std::optional<std::string> projectRootPath;
};

enum class AssetTypeKind {
	ImageAtlas,
	Audio,
	Model,
	Aem,
	Bin,
	Lua,
	Data,
	Skip,
	Unknown,
};

std::string assetTypeFromId(u32 id);
u32 assetTypeToId(std::string_view type);
AssetTypeKind resolveAssetTypeKind(std::string_view assetType);
RomTocPayload decodeRomToc(const u8* data, size_t size);

} // namespace bmsx
