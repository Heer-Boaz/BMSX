#pragma once

#include "render/backend/backend.h"
#include "render/host_overlay/pipeline.h"
#include "render/host_overlay/commands.h"

#if BMSX_ENABLE_GLES2
#include "render/backend/gles2/backend.h"
#endif

namespace bmsx {

#if BMSX_ENABLE_GLES2
struct HostOverlayGLES2State {
	u32 generation = 0u;
	GLuint program = 0;
	GLint attribPos = -1;
	GLint attribUv = -1;
	GLint uniformResolution = -1;
	GLint uniformColor = -1;
	GLuint vbo = 0;
	TextureHandle whiteTexture = nullptr;
	TextureHandle hostAtlasTexture = nullptr;
};

void bootstrapHostOverlayGLES2(OpenGLES2Backend& backend, HostOverlayGLES2State& pipeline);
void shutdownHostOverlayGLES2(OpenGLES2Backend& backend, HostOverlayGLES2State& pipeline);
void beginHostOverlayGLES2(OpenGLES2Backend& backend, HostOverlayGLES2State& pipeline, const Host2DPipelineState& state);
void renderHost2DEntryGLES2(OpenGLES2Backend& backend, HostOverlayGLES2State& pipeline, Host2DKind kind, Host2DRef ref);
void endHostOverlayGLES2(OpenGLES2Backend& backend, HostOverlayGLES2State& pipeline);
#endif

} // namespace bmsx
