/*
 * pipeline.h - GLES2 device quantize post pass
 */

#ifndef BMSX_DEVICE_QUANTIZE_GLES2_PIPELINE_H
#define BMSX_DEVICE_QUANTIZE_GLES2_PIPELINE_H

#include "render/backend/backend.h"
#include "render/backend/gles2/fullscreen_quad.h"

#include <array>
#include <GLES2/gl2.h>

namespace bmsx {

class OpenGLES2Backend;
class RenderPassLibrary;

namespace DeviceQuantizePipeline {
namespace GLES2 {

struct State {
	GLuint program = 0;
	GLint attrib_pos = -1;
	GLint attrib_uv = -1;
	GLint uniform_resolution = -1;
	GLint uniform_scale = -1;
	GLint uniform_texture = -1;
	GLint uniform_quantize_lut = -1;
	std::array<TextureHandle, 2> lutTextures{};
	TextureHandle activeLutTexture = nullptr;
	u64 publishedConfigurationRevision = 0xffffffffffffffffull;
	FullscreenQuad quad;
};

void init(OpenGLES2Backend& backend, State& pipeline);
void shutdown(OpenGLES2Backend& backend, State& pipeline);
void releaseLostTextureHandles(OpenGLES2Backend& backend, State& pipeline);
void registerPass(RenderPassLibrary& registry, State& pipeline);

} // namespace GLES2
} // namespace DeviceQuantizePipeline
} // namespace bmsx

#endif // BMSX_DEVICE_QUANTIZE_GLES2_PIPELINE_H
