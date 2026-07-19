/*
 * pipeline.cpp - GLES2 device quantize post pass
 */

#include "pipeline.h"

#include "render/backend/gles2/backend.h"
#include "render/backend/pass/library.h"
#include "render/backend/gles2/fullscreen_quad.h"
#include "render/backend/gles2/texture_units.h"
#include "render/backend/texture_params.h"
#include "render/post/device_quantize/lut.h"
#include "render/post/device_quantize/gles2/shaders/device_quantize_shaders.h"

#include <GLES2/gl2.h>


namespace bmsx {
namespace DeviceQuantizePipeline {
namespace GLES2 {

void init(OpenGLES2Backend& backend, State& pipeline) {
	pipeline.program = backend.buildProgram(kPostGLES2FullscreenVertexShader, kDeviceQuantizeFragmentShader, "device_quantize");

	pipeline.attrib_pos = glGetAttribLocation(pipeline.program, "a_position");
	pipeline.attrib_uv = glGetAttribLocation(pipeline.program, "a_texcoord");

	pipeline.uniform_resolution = glGetUniformLocation(pipeline.program, "u_resolution");
	pipeline.uniform_scale = glGetUniformLocation(pipeline.program, "u_scale");
	pipeline.uniform_texture = glGetUniformLocation(pipeline.program, "u_texture");
	pipeline.uniform_quantize_lut = glGetUniformLocation(pipeline.program, "u_quantize_lut");
	pipeline.lutTextures[0] = backend.createTexture(
		DEVICE_QUANTIZE_LUTS[0].texture.data(),
		static_cast<i32>(DEVICE_QUANTIZE_LUT_WIDTH),
		static_cast<i32>(DEVICE_QUANTIZE_LUT_HEIGHT),
		RGBA8_LINEAR_TEXTURE_PARAMS);
	pipeline.lutTextures[1] = backend.createTexture(
		DEVICE_QUANTIZE_LUTS[1].texture.data(),
		static_cast<i32>(DEVICE_QUANTIZE_LUT_WIDTH),
		static_cast<i32>(DEVICE_QUANTIZE_LUT_HEIGHT),
		RGBA8_LINEAR_TEXTURE_PARAMS);

	createFullscreenQuad(pipeline.quad);

	glUseProgram(pipeline.program);
	glUniform1i(pipeline.uniform_texture, GLES2_TEXTURE_UNIT_POST_PROCESSING_SOURCE);
	glUniform1i(pipeline.uniform_quantize_lut, GLES2_TEXTURE_UNIT_DEVICE_QUANTIZE_LUT);
	glUniform1f(pipeline.uniform_scale, 1.0f);
}


void shutdown(OpenGLES2Backend& backend, State& pipeline) {
	backend.destroyTexture(pipeline.lutTextures[0]);
	backend.destroyTexture(pipeline.lutTextures[1]);
	if (pipeline.program != 0) glDeleteProgram(pipeline.program);
	destroyFullscreenQuad(pipeline.quad);
	pipeline = State{};
}

void releaseLostTextureHandles(OpenGLES2Backend& backend, State& pipeline) {
	for (TextureHandle& texture : pipeline.lutTextures) {
		if (texture != nullptr) {
			backend.destroyTexture(texture);
			texture = nullptr;
		}
	}
}

void renderDeviceQuantizeGLES2(OpenGLES2Backend& backend, State& pipeline, const DeviceQuantizePipelineState& state);

void registerPass(RenderPassLibrary& registry, State& pipeline) {
	RenderPassDef desc;
	desc.id = "device_quantize";
	desc.name = "DeviceQuantize";
	setDeviceQuantizeGraph(desc);
	desc.context = &pipeline;
	desc.exec = executePipelineRenderPass<
		OpenGLES2Backend,
		State,
		DeviceQuantizePipelineState,
		&RenderPassStateStorage::deviceQuantize,
		renderDeviceQuantizeGLES2>;
	desc.shouldExecute = shouldExecuteDeviceQuantizePass;
	registry.registerPass(desc);
}

void renderDeviceQuantizeGLES2(OpenGLES2Backend& backend, State& pipeline, const DeviceQuantizePipelineState& state) {
	glUseProgram(pipeline.program);

	updateFullscreenQuad(pipeline.quad, state.width, state.height);

	glDisable(GL_DEPTH_TEST);
	glDisable(GL_CULL_FACE);
	glDisable(GL_BLEND);

	bindFullscreenQuad(pipeline.quad, pipeline.attrib_pos, pipeline.attrib_uv);

	if (pipeline.publishedConfigurationRevision != state.configurationRevision) {
		glUniform2f(pipeline.uniform_resolution, static_cast<float>(state.width), static_cast<float>(state.height));
		pipeline.activeLutTexture = state.luts == &DEVICE_QUANTIZE_LUTS[0]
			? pipeline.lutTextures[0]
			: pipeline.lutTextures[1];
		pipeline.publishedConfigurationRevision = state.configurationRevision;
	}

	backend.setActiveTextureUnit(GLES2_TEXTURE_UNIT_POST_PROCESSING_SOURCE);
	backend.bindTexture2D(state.colorTex);
	backend.setActiveTextureUnit(GLES2_TEXTURE_UNIT_DEVICE_QUANTIZE_LUT);
	backend.bindTexture2D(pipeline.activeLutTexture);

	glDrawArrays(GL_TRIANGLES, 0, 6);
}

} // namespace GLES2
} // namespace DeviceQuantizePipeline
} // namespace bmsx
