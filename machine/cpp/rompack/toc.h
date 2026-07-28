#pragma once

#include "common/primitives.h"
#include "rompack/source.h"
#include "spec/bmsx/rom_toc.h"
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace bmsx {

struct RomTocPayload {
	std::vector<RomSourceEntry> entries;
	std::optional<std::string> projectRootPath;
};

enum class AssetTypeKind {
	Image,
	Texture,
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
