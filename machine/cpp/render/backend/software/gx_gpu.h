#pragma once

namespace bmsx {

class RenderPassLibrary;
class SoftwareBackend;
struct GxGpuDeviceOutput;
struct GxGpuPipelineState;

void renderGxGpuSoftwareFrame(
	SoftwareBackend& backend,
	const GxGpuPipelineState& state,
	const GxGpuDeviceOutput& output
);
void registerGxGpuPassSoftware(RenderPassLibrary& registry);

} // namespace bmsx
