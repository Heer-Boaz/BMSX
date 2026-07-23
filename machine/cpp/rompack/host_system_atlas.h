#pragma once

#include "common/types.h"

#include <span>
#include <string_view>

namespace bmsx {

struct HostSystemAtlasImage {
	std::string_view id;
	i32 width;
	i32 height;
	u32 u;
	u32 v;
	u32 w;
	u32 h;
};

struct HostSystemAtlas {
	u32 width;
	u32 height;
	std::span<const u8> pixels;
	std::span<const HostSystemAtlasImage> images;
};

extern const HostSystemAtlas HOST_SYSTEM_ATLAS;

const HostSystemAtlasImage& hostSystemAtlasImage(std::string_view id);

} // namespace bmsx
