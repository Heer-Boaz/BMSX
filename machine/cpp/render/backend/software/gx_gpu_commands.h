#pragma once

#include <cstddef>

namespace bmsx {

struct GxGpuCommandBuffer;

size_t executeGxGpuSoftwareCommands(const GxGpuCommandBuffer& commandBuffer, size_t processedCommandCount);

} // namespace bmsx
