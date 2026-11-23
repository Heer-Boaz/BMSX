#pragma once

#include <cstddef>

namespace bmsx {

struct GxGpuCommandStorage;
struct GxGpuSoftwareState;
struct GxUploadProfileFrame;

size_t executeGxGpuSoftwareCommands(
	GxGpuSoftwareState& software,
	const GxGpuCommandStorage& commandBuffer,
	size_t processedCommandCount,
	size_t commandLimit,
	GxUploadProfileFrame* profile = nullptr);

} // namespace bmsx
