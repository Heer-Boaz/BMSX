#pragma once

#include "common/primitives.h"
#include "rompack/tokens.h"
#include "spec/bmsx/rom_toc.h"
#include <cstddef>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace bmsx {

struct RomAssetInfo {
	std::string type;
	std::optional<std::string> op;
	std::optional<i32> start;
	std::optional<i32> end;
	std::optional<i32> compiledStart;
	std::optional<i32> compiledEnd;
	std::optional<i32> metabufferStart;
	std::optional<i32> metabufferEnd;
	std::optional<i32> modelTextureStart;
	std::optional<i32> modelTextureEnd;
	std::optional<i32> collisionBinStart;
	std::optional<i32> collisionBinEnd;
	std::optional<std::string> sourcePath;
	std::optional<std::string> normalizedSourcePath;
	std::optional<i64> updateTimestamp;
	std::optional<std::string> payloadId;
};

struct RomSourceEntry {
	AssetId resid;
	RomAssetInfo rom;
};

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
