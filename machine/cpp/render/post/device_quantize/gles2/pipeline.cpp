/*
 * pipeline.cpp - GLES2 device quantize post pass
 */

#include "pipeline.h"

#include "render/backend/gles2/backend.h"
#include "render/backend/pass/library.h"
#include "render/backend/gles2/fullscreen_quad.h"
#include "render/post/device_quantize/gles2/shaders/device_quantize_shaders.h"

#include <GLES2/gl2.h>


namespace bmsx {
namespace DeviceQuantizePipeline {
namespace GLES2 {

namespace {

constexpr int kTexUnitPostProcess = 3;

} // namespace

void init(OpenGLES2Backend& backend, State& pipeline) {
	pipeline.program = backend.buildProgram(kPostGLES2FullscreenVertexShader, kDeviceQuantizeFragmentShader, "device_quantize");

	pipeline.attrib_pos = glGetAttribLocation(pipeline.program, "a_position");
	pipeline.attrib_uv = glGetAttribLocation(pipeline.program, "a_texcoord");

	pipeline.uniform_resolution = glGetUniformLocation(pipeline.program, "u_resolution");
	pipeline.uniform_src_resolution = glGetUniformLocation(pipeline.program, "u_srcResolution");
	pipeline.uniform_scale = glGetUniformLocation(pipeline.program, "u_scale");
	pipeline.uniform_fragscale = glGetUniformLocation(pipeline.program, "u_fragscale");
	pipeline.uniform_device_quantize_mode = glGetUniformLocation(pipeline.program, "u_device_quantize_mode");
	pipeline.uniform_texture = glGetUniformLocation(pipeline.program, "u_texture");

	createFullscreenQuad(pipeline.quad);

	glUseProgram(pipeline.program);
	glUniform1i(pipeline.uniform_texture, kTexUnitPostProcess);
}


void shutdown(State& pipeline) {
	if (pipeline.program != 0) glDeleteProgram(pipeline.program);
	destroyFullscreenQuad(pipeline.quad);
	pipeline = State{};
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
	glUniform1i(pipeline.uniform_texture, kTexUnitPostProcess);

	updateFullscreenQuad(pipeline.quad, state.width, state.height);

	glDisable(GL_DEPTH_TEST);
	glDisable(GL_CULL_FACE);
	glDisable(GL_BLEND);

	bindFullscreenQuad(pipeline.quad, pipeline.attrib_pos, pipeline.attrib_uv);

	glUniform2f(pipeline.uniform_resolution, static_cast<float>(state.width), static_cast<float>(state.height));
	glUniform2f(pipeline.uniform_src_resolution, static_cast<float>(state.baseWidth), static_cast<float>(state.baseHeight));
	glUniform1f(pipeline.uniform_scale, 1.0f);
	glUniform1f(pipeline.uniform_fragscale, static_cast<float>(state.width) / static_cast<float>(state.baseWidth));
	glUniform1i(pipeline.uniform_device_quantize_mode, static_cast<i32>(state.deviceQuantizeMode));

	backend.setActiveTextureUnit(kTexUnitPostProcess);
	backend.bindTexture2D(state.colorTex);

	glDrawArrays(GL_TRIANGLES, 0, 6);
}

} // namespace GLES2
} // namespace DeviceQuantizePipeline
} // namespace bmsx
