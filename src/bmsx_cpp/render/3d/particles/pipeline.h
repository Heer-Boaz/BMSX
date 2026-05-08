#pragma once

#include "render/backend/pass/library.h"

namespace bmsx {

#if BMSX_ENABLE_GLES2
class OpenGLES2Backend;

// Mirrors the TS ParticleRuntime object. TS also carries the WebGL context; the
// native GLES2 path uses the current libretro GL context owned by
// OpenGLES2Backend, so a fake `gl` field would be nameplate parity. C++ exposes
// the nominal struct in the header because the render entrypoint is compiled
// across translation units.
struct ParticleRuntime {
	OpenGLES2Backend& backend;
	GameView& context;
};

void initParticlePipeline(OpenGLES2Backend& backend);
void setupParticleUniforms();
void setupParticleLocations();
void renderParticleBatch(ParticleRuntime& runtime, void* framebuffer, const ParticlePipelineState& state);
void registerParticlesPass_GLES2(RenderPassLibrary& registry);
#endif

} // namespace bmsx
