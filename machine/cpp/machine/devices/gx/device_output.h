#pragma once

namespace bmsx {

struct GxGpuCommandBuffer;

struct GxGpuDeviceOutput {
	const GxGpuCommandBuffer* commandBuffer = nullptr;
};

} // namespace bmsx
