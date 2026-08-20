#pragma once

#include "common/primitives.h"
#include "spec/bmsx/rom_toc.h"
#include <optional>
#include <span>
#include <string>
#include <vector>

namespace bmsx {

using AssetId = std::string;

enum class AssetType : u32 {
	Image = ROM_TOC_ASSET_TYPE_IMAGE,
	Texture = ROM_TOC_ASSET_TYPE_TEXTURE,
	Audio = ROM_TOC_ASSET_TYPE_AUDIO,
	Data = ROM_TOC_ASSET_TYPE_DATA,
	Bin = ROM_TOC_ASSET_TYPE_BIN,
	CollisionShape = ROM_TOC_ASSET_TYPE_COLLISION_SHAPE,
	Romlabel = ROM_TOC_ASSET_TYPE_ROMLABEL,
	Model = ROM_TOC_ASSET_TYPE_MODEL,
	Aem = ROM_TOC_ASSET_TYPE_AEM,
	Lua = ROM_TOC_ASSET_TYPE_LUA,
	Code = ROM_TOC_ASSET_TYPE_CODE,
};

enum class RomAssetOp : u32 {
	Delete = ROM_TOC_OP_DELETE,
};

struct RomTocEntry {
	AssetId resid;
	AssetType type;
	u32 id_token_lo = 0;
	u32 id_token_hi = 0;
	std::optional<RomAssetOp> op;
	std::optional<u32> start;
	std::optional<u32> end;
	std::optional<u32> compiled_start;
	std::optional<u32> compiled_end;
	std::optional<u32> metabuffer_start;
	std::optional<u32> metabuffer_end;
	std::optional<u32> model_texture_start;
	std::optional<u32> model_texture_end;
	std::optional<u32> collision_bin_start;
	std::optional<u32> collision_bin_end;
	std::optional<std::string> source_path;
	std::optional<std::string> normalized_source_path;
	std::optional<f64> update_timestamp;
};

struct RomTocPayload {
	std::vector<RomTocEntry> entries;
	std::optional<std::string> projectRootPath;
};

auto assetTypeFromId(u32 id) -> AssetType;
auto assetTypeToId(AssetType type) -> u32;
auto decodeRomToc(std::span<const u8> bytes) -> RomTocPayload;

} // namespace bmsx
