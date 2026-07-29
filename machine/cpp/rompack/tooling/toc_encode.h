#pragma once

#include "rompack/toc.h"

namespace bmsx {

auto encodeRomToc(const RomTocPayload& payload) -> std::vector<u8>;

} // namespace bmsx
