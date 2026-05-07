#pragma once

#include "common/primitives.h"
#include <string>
#include <string_view>

namespace bmsx {

using AssetId = std::string;
using BitmapId = AssetId;
using AudioId = AssetId;
using ModelId = AssetId;
using DataId = AssetId;
using AssetToken = uint64_t;

struct AssetTokenParts {
	u32 lo = 0;
	u32 hi = 0;
};

AssetToken hashAssetToken(std::string_view id);
AssetTokenParts hashAssetId(std::string_view id);
AssetToken makeAssetToken(u32 lo, u32 hi);
AssetTokenParts splitAssetToken(AssetToken token);
std::string tokenKey(u32 lo, u32 hi);
std::string tokenKeyFromId(std::string_view id);

} // namespace bmsx
