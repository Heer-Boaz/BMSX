#pragma once

#include "render/backend/pass/library.h"

namespace bmsx {

#if BMSX_ENABLE_GLES2
class OpenGLES2Backend;

struct VdpRpuRuntime {
	OpenGLES2Backend& backend;
};

void initVdpRpuPipeline(OpenGLES2Backend& backend);
void setupVdpRpuLocations(OpenGLES2Backend& backend);
void renderVdpRpuFrame(VdpRpuRuntime& runtime, void* framebuffer, const VdpRpuPipelineState& state);
void registerVdpRpuPass(RenderPassLibrary& registry);
#endif

} // namespace bmsx
