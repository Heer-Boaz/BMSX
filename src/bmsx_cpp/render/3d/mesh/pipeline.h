#pragma once

#include "render/backend/pass/library.h"

namespace bmsx {

#if BMSX_ENABLE_GLES2
class OpenGLES2Backend;
struct RuntimeRomPackage;

struct MeshRuntime {
	OpenGLES2Backend& backend;
	const GameView& context;
	const RuntimeRomPackage& rom;
};

void initMeshPipeline(OpenGLES2Backend& backend);
void renderMeshBatch(const MeshRuntime& runtime, void* framebuffer, const MeshPipelineState& state);
void registerMeshPass_GLES2(RenderPassLibrary& registry);
#endif

} // namespace bmsx
