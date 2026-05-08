#pragma once

#include "render/backend/pass/library.h"

#if BMSX_ENABLE_GLES2
#include <GLES2/gl2.h>
#endif

namespace bmsx {

#if BMSX_ENABLE_GLES2
class OpenGLES2Backend;

// Mirrors the TS SkyboxRuntime object. TS also carries the WebGL context; the
// native GLES2 path uses the current libretro GL context owned by
// OpenGLES2Backend, so a fake `gl` field would be nameplate parity.
struct SkyboxRuntime {
	OpenGLES2Backend& backend;
	GameView& context;
};

extern GLuint skyboxBuffer;

void initSkyboxPipeline(OpenGLES2Backend& backend);
void createSkyboxProgram(OpenGLES2Backend& backend);
void setupSkyboxLocations();
void createSkyboxBuffer();
void drawSkybox(SkyboxRuntime& runtime, void* framebuffer, const SkyboxPipelineState& state);
void registerSkyboxPass_GLES2(RenderPassLibrary& registry);
#endif

} // namespace bmsx
