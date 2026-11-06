#pragma once

#include "render/backend/backend.h"
#include "render/host_overlay/pipeline.h"
#include "render/host_overlay/commands.h"
#include "render/host_overlay/clip.h"
#include "render/host_overlay/transform.h"
#include "render/host_overlay/atlas.h"
#include "render/shared/bitmap_font.h"
#include <unordered_map>

#if BMSX_ENABLE_GLES2
#include "render/backend/gles2/backend.h"
#endif

namespace bmsx {

#if BMSX_ENABLE_GLES2
struct HostAtlasGLES2Texture {
	TextureHandle texture;
	FontSampling sampling = FontSampling::Nearest;
};

struct HostOverlayGLES2State {
	HostOverlayClipState clip;
	HostOverlayTransform transform;
	i32 targetHeight = 0;
	u32 generation = 0u;
	GLuint program = 0;
	GLint attribPos = -1;
	GLint attribUv = -1;
	GLint uniformResolution = -1;
	GLint uniformColor = -1;
	GLint uniformGlyphMode = -1;
	GLint uniformScreenRange = -1;
	i32 glyphMode = 0;
	f32 pixelScale = 1;
	GLuint vbo = 0;
	TextureHandle whiteTexture = nullptr;
	std::unordered_map<const HostAtlas*, HostAtlasGLES2Texture> atlases;
	TextureHandle frameTexture = nullptr;
};

void bootstrapHostOverlayGLES2(OpenGLES2Backend& backend, HostOverlayGLES2State& pipeline);
void shutdownHostOverlayGLES2(OpenGLES2Backend& backend, HostOverlayGLES2State& pipeline);
void beginHostOverlayGLES2(OpenGLES2Backend& backend, HostOverlayGLES2State& pipeline, const Host2DPipelineState& state);
void renderHost2DEntryGLES2(OpenGLES2Backend& backend, HostOverlayGLES2State& pipeline, Host2DKind kind, Host2DRef ref);
void endHostOverlayGLES2(OpenGLES2Backend& backend, HostOverlayGLES2State& pipeline);
#endif

} // namespace bmsx
