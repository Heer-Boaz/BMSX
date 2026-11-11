#include "render/backend/gles2/gx_gpu.h"
#include "render/backend/gles2/backend.h"
#include "render/backend/gles2/texture_units.h"
#include "render/backend/pass/library.h"
#include "render/backend/software/gx_gpu_execution.h"
#include "render/backend/software/gx_gpu_scanout.h"
#include "render/backend/software/gx_gpu_state.h"
#include "render/backend/texture_params.h"
#include "render/gx_gpu_presentation.h"
#include "machine/devices/gx/gpu.h"

#include <array>
#include <bit>
#include <vector>

namespace bmsx {
namespace {

// CPU scanout produces top-down packed ARGB. Import it without a color-space
// conversion into the normal FrameColor graph resource, including its alpha.
constexpr const char* kImportVertex = R"(
attribute vec2 a_position;
varying mediump vec2 v_uv;
void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    v_uv = vec2((a_position.x + 1.0) * 0.5, (1.0 - a_position.y) * 0.5);
}
)";
constexpr const char* kImportFragment = R"(
precision mediump float;
varying mediump vec2 v_uv;
uniform sampler2D u_source;
void main() {
#ifdef BMSX_LITTLE_ENDIAN
    gl_FragColor = texture2D(u_source, v_uv).bgra;
#else
    gl_FragColor = texture2D(u_source, v_uv).gbar;
#endif
}
)";
constexpr std::array<GLfloat, 6> kImportVertices{-1.0f, -1.0f, 3.0f, -1.0f, -1.0f, 3.0f};
constexpr std::array<GLES2AttributeBinding, 1> kImportAttributes{{{0u, "a_position"}}};

} // namespace

struct OpenGLES2GxGpuState {
	explicit OpenGLES2GxGpuState(size_t vramByteCount) : software(vramByteCount, 0u) {}
	GxGpuSoftwareState software;
	std::vector<u32> scanoutPixels;
	// Rotate frame uploads rather than immediately rewriting the previous source.
	// Reuse can still stall if the GPU has not finished that texture.
	std::array<TextureHandle, 3> uploads{};
	size_t nextUpload = 0u;
	GLuint program = 0u;
	GLuint vertices = 0u;
	u32 generation = 0u;
};

void OpenGLES2GxGpuStateDeleter::operator()(OpenGLES2GxGpuState* state) const noexcept {
	delete state;
}

void initGxGpu(OpenGLES2Backend& backend) {
	backend.m_gx_gpu.reset(new OpenGLES2GxGpuState(
		static_cast<size_t>(backend.gxGpuVramTextureRows()) * GX_GPU_VRAM_ADDRESS_ROW_BYTE_COUNT));
	auto& gx = *backend.m_gx_gpu;
	gx.generation = backend.contextGeneration();
	gx.program = backend.buildProgram(kImportVertex, kImportFragment, "software GX scanout import",
		std::endian::native == std::endian::little ? "#define BMSX_LITTLE_ENDIAN\n" : "", kImportAttributes);
	backend.drawState.useProgram(gx.program);
	glUniform1i(glGetUniformLocation(gx.program, "u_source"), GLES2_TEXTURE_UNIT_GX_SCANOUT);
	glGenBuffers(1, &gx.vertices);
	backend.drawState.bindBuffer(GL_ARRAY_BUFFER, gx.vertices);
	glBufferData(GL_ARRAY_BUFFER, sizeof(kImportVertices), kImportVertices.data(), GL_STATIC_DRAW);
	for (auto& texture : gx.uploads) texture = backend.createTexture(nullptr, 1, 1, RGBA8_LINEAR_TEXTURE_PARAMS);
}

void shutdownGxGpu(OpenGLES2Backend& backend) {
	if (!backend.m_gx_gpu) return;
	auto& gx = *backend.m_gx_gpu;
	if (gx.generation == backend.contextGeneration()) {
		backend.drawState.forgetBuffer(gx.vertices);
		backend.drawState.forgetProgram(gx.program);
		glDeleteBuffers(1, &gx.vertices);
		glDeleteProgram(gx.program);
	}
	for (auto texture : gx.uploads) backend.destroyTexture(texture);
	backend.m_gx_gpu.reset();
}

void executeGxGpuPass(GPUBackend* backend, VideoPresenter*, void* fbo,
	RenderPassStateStorage& stateStorage, void*, const GxGpuPresentation& output) {
	auto& gles = *static_cast<OpenGLES2Backend*>(backend);
	auto& gx = *gles.m_gx_gpu;
	const auto& state = stateStorage.gxGpu;
	gx.scanoutPixels.resize(static_cast<size_t>(state.width) * state.height);
	scanoutGxGpuSoftwareVram(gx.software, gx.scanoutPixels.data(), state.width,
		state, output.pcrtcScanout, output.vramReplacementSerial);
	const TextureHandle upload = gx.uploads[gx.nextUpload];
	gx.nextUpload = (gx.nextUpload + 1u) % gx.uploads.size();
	gles.updateTexture(upload, reinterpret_cast<const u8*>(gx.scanoutPixels.data()),
		state.width, state.height, RGBA8_LINEAR_TEXTURE_PARAMS);
	gles.setRenderTarget(gles.framebufferName(fbo), state.width, state.height);
	auto& draw = gles.drawState;
	draw.disable(GLES2Capability::Blend);
	draw.disable(GLES2Capability::CullFace);
	draw.disable(GLES2Capability::DepthTest);
	draw.disable(GLES2Capability::Dither);
	draw.disable(GLES2Capability::ScissorTest);
	draw.disable(GLES2Capability::StencilTest);
	draw.colorMask(GL_TRUE, GL_TRUE, GL_TRUE, GL_TRUE);
	draw.useProgram(gx.program);
	gles.setActiveTextureUnit(GLES2_TEXTURE_UNIT_GX_SCANOUT);
	gles.bindTexture2D(upload);
	draw.bindBuffer(GL_ARRAY_BUFFER, gx.vertices);
	draw.enableVertexAttribArray(0u);
	draw.vertexAttribPointer(0u, 2, GL_FLOAT, GL_FALSE, 0, nullptr);
	glDrawArrays(GL_TRIANGLES, 0, 3);
}

void OpenGLES2Backend::executeGxGpuPresentation(const GxGpuDeviceOutput& output) {
	invalidateContextState();
	executeGxGpuSoftwareVramCommands(m_gx_gpu->software, output, output.commandBuffer.presentCommandCount);
}

void OpenGLES2Backend::executeGxGpuCommands(const GxGpuCommandStorage& commands) {
	executeGxGpuSoftwareCommandPrefix(m_gx_gpu->software, commands, commands.executedCommandCount);
}

void OpenGLES2Backend::replaceGxGpuVramSnapshot(std::span<const u8> bytes, u64 serial) {
	replaceGxGpuSoftwareVramSnapshot(m_gx_gpu->software, bytes, serial);
}

void OpenGLES2Backend::readGxGpuVram(const GxGpuReadbackRequest& request, u8* pixels) {
	readGxGpuSoftwareVram(m_gx_gpu->software, request, pixels);
}

void OpenGLES2Backend::executeGxGpuReadback(GxGpu& gxGpu) {
	const auto& output = gxGpu.readDeviceOutput();
	executeGxGpuSoftwareVramCommands(m_gx_gpu->software, output, output.readbackPort.fenceCommandCount());
}

void OpenGLES2Backend::executeGxGpuCommandDrain(GxGpu& gxGpu) {
	const auto& output = gxGpu.readDeviceOutput();
	executeGxGpuSoftwareVramCommands(m_gx_gpu->software, output, output.commandBuffer.executedCommandCount);
	gxGpu.retireExecutedCommands();
}

void OpenGLES2Backend::finishGxGpuReadbacks() {
	// The software datapath publishes GPUREAD synchronously.
}

void OpenGLES2Backend::captureGxGpuVramSnapshot(GxGpu& gxGpu) {
	captureGxGpuSoftwareVramSnapshot(m_gx_gpu->software, gxGpu);
}

void registerGxGpuPass(RenderPassLibrary& registry) {
	RenderPassDef desc;
	desc.id = "gx_gpu";
	desc.name = "GXGPU";
	setGxGpuGraph(desc);
	desc.bootstrap = bootstrapBackendRenderPass<OpenGLES2Backend, initGxGpu>;
	desc.teardown = teardownBackendRenderPass<OpenGLES2Backend, shutdownGxGpu>;
	desc.exec = executeGxGpuPass;
	registry.registerPass(desc);
}

} // namespace bmsx
