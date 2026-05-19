#pragma once

#include "render/backend/pass/library.h"

namespace bmsx {

#if BMSX_ENABLE_GLES2
class GameView;
class OpenGLES2Backend;

void initMeshPipeline(OpenGLES2Backend& backend);
void renderMeshBatch(OpenGLES2Backend& backend, const GameView& view, void* framebuffer, const MeshPipelineState& state);
void registerMeshPass_GLES2(RenderPassLibrary& registry);
#endif

} // namespace bmsx
