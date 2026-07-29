#pragma once

#include "common/primitives.h"

#include <span>

namespace bmsx {

void initializeGxGpuVramPowerOn(std::span<u8> vramBytes);

} // namespace bmsx
