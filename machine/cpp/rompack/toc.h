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
constexpr u32 ROM_TOC_INVALID_U32 = 0xffffffffU;
constexpr u32 ROM_TOC_OP_NONE = 0;
constexpr u32 ROM_TOC_OP_DELETE = 1;
constexpr u32 ROM_TOC_ASSET_TYPE_IMAGE = 1;
constexpr u32 ROM_TOC_ASSET_TYPE_AUDIO = 2;
constexpr u32 ROM_TOC_ASSET_TYPE_DATA = 3;
constexpr u32 ROM_TOC_ASSET_TYPE_BIN = 4;
constexpr u32 ROM_TOC_ASSET_TYPE_ROMLABEL = 6;
constexpr u32 ROM_TOC_ASSET_TYPE_MODEL = 7;
constexpr u32 ROM_TOC_ASSET_TYPE_AEM = 8;
constexpr u32 ROM_TOC_ASSET_TYPE_LUA = 9;
constexpr u32 ROM_TOC_ASSET_TYPE_CODE = 10;

struct RomTocPayload {
	std::vector<RomSourceEntry> entries;
	std::optional<std::string> projectRootPath;
};

enum class AssetTypeKind {
	Image,
	Audio,
	Model,
	Aem,
	Bin,
	Lua,
	Data,
	Code,
	Skip,
	Unknown,
};

auto assetTypeFromId(u32 id) -> std::string;
auto assetTypeToId(std::string_view type) -> u32;
auto resolveAssetTypeKind(std::string_view assetType) -> AssetTypeKind;
auto decodeRomToc(const u8* data, size_t size) -> RomTocPayload;
auto encodeRomToc(const RomTocPayload& payload) -> std::vector<u8>;

} // namespace bmsx
