#pragma once

#include "common/primitives.h"
#include "rompack/host_system_atlas_generated.h"

#include <cstdint>
#include <string_view>
#include <vector>

namespace bmsx {

std::uint32_t hostSystemAtlasWidth();
std::uint32_t hostSystemAtlasHeight();

const std::vector<u8>& hostSystemAtlasPixels();
const HostSystemAtlasGeneratedImage& hostSystemAtlasImage(std::string_view id);

} // namespace bmsx
