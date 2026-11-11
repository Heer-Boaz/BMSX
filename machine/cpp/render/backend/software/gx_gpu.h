#pragma once

#include "render/gx_gpu_presentation.h"

namespace bmsx {

class RenderPassLibrary;
class SoftwareBackend;
struct GxGpuPipelineState;

void renderGxGpuSoftwareFrame(
	SoftwareBackend& backend,
	const GxGpuPipelineState& state,
	const GxGpuPresentation& output
);
void registerGxGpuPassSoftware(RenderPassLibrary& registry);

} // namespace bmsx
