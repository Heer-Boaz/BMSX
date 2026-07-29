#pragma once

#include <cstddef>

namespace bmsx {

struct GxGpuCommandBuffer;
struct GxGpuSoftwareState;

size_t executeGxGpuSoftwareCommands(
	GxGpuSoftwareState& software,
	const GxGpuCommandBuffer& commandBuffer,
	size_t processedCommandCount,
	size_t commandLimit);

} // namespace bmsx
