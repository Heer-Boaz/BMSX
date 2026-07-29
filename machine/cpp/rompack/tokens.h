#pragma once

#include "common/primitives.h"
#include <string>
#include <string_view>

namespace bmsx {

struct AssetToken {
	u32 lo = 0;
	u32 hi = 0;
};

AssetToken hashAssetId(std::string_view id);
std::string tokenKey(u32 lo, u32 hi);
std::string tokenKeyFromId(std::string_view id);

} // namespace bmsx
