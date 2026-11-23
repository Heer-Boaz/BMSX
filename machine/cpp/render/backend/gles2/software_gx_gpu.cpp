#include "render/backend/gles2/gx_gpu.h"
#include "render/backend/gles2/backend.h"
#include "render/backend/gles2/shaders/gx_gpu_shaders.h"
#include "render/backend/gles2/texture_units.h"
#include "render/backend/pass/library.h"
#include "render/backend/software/gx_gpu_execution.h"
#include "render/backend/software/gx_gpu_scanout.h"
#include "render/backend/software/gx_gpu_state.h"
#include "render/backend/texture_params.h"
#include "render/gx_gpu_presentation.h"
#include "machine/devices/gx/gpu.h"

#include <algorithm>
#include <array>
#include <bit>
#include <chrono>
#include <cstring>
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

void copyPackedGx16Rows(const GxGpuSoftwareState& software, const GxGpuPcrtcCircuit& circuit,
	u8* target, size_t width) {
	const auto& vram = software.vram;
	u32 address = circuit.framebufferBaseWord + circuit.linearFieldSourceY * circuit.framebufferWidth
		+ circuit.framebufferX;
	const u32 rowAdvance = circuit.linearFieldSourceRowStep * circuit.framebufferWidth;
	for (u32 row = 0; row < circuit.fieldDisplayLineCount; ++row) {
		const size_t start = address & software.vramWordMask;
		const size_t first = std::min(width, vram.size() - start);
		std::memcpy(target, vram.data() + start, first * sizeof(u16));
		if (first != width) {
			std::memcpy(target + first * sizeof(u16), vram.data(), (width - first) * sizeof(u16));
		}
		address += rowAdvance;
		target += width * sizeof(u16);
	}
}

} // namespace

struct OpenGLES2GxGpuState {
	explicit OpenGLES2GxGpuState(size_t vramByteCount) : software(vramByteCount, 0u) {}
	GxGpuSoftwareState software;
	std::vector<u32> scanoutPixels;
	// Rotate frame uploads rather than immediately rewriting the previous source.
	// Reuse can still stall if the GPU has not finished that texture.
	struct Upload {
		GLES2Texture texture;
		GLenum wordType = 0u;
	};
	std::array<Upload, 3> uploads;
	size_t nextUpload = 0u;
	GLuint argbProgram = 0u;
	GLuint packedProgram = 0u;
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
	gx.argbProgram = backend.buildProgram(kImportVertex, kImportFragment, "software GX ARGB scanout",
		std::endian::native == std::endian::little ? "#define BMSX_LITTLE_ENDIAN\n" : "", kImportAttributes);
	gx.packedProgram = backend.buildProgram(kImportVertex, kSoftwareGxPackedScanoutFragmentShader,
		"software GX packed scanout", "", kImportAttributes);
	for (GLuint program : {gx.argbProgram, gx.packedProgram}) {
		backend.drawState.useProgram(program);
		glUniform1i(glGetUniformLocation(program, "u_source"), GLES2_TEXTURE_UNIT_GX_SCANOUT);
	}
	glGenBuffers(1, &gx.vertices);
	backend.drawState.bindBuffer(GL_ARRAY_BUFFER, gx.vertices);
	glBufferData(GL_ARRAY_BUFFER, sizeof(kImportVertices), kImportVertices.data(), GL_STATIC_DRAW);
	for (auto& upload : gx.uploads) glGenTextures(1, &upload.texture.id);
}

void shutdownGxGpu(OpenGLES2Backend& backend) {
	if (!backend.m_gx_gpu) return;
	auto& gx = *backend.m_gx_gpu;
	if (gx.generation == backend.contextGeneration()) {
		backend.drawState.forgetBuffer(gx.vertices);
		backend.drawState.forgetProgram(gx.argbProgram);
		backend.drawState.forgetProgram(gx.packedProgram);
		glDeleteBuffers(1, &gx.vertices);
		glDeleteProgram(gx.argbProgram);
		glDeleteProgram(gx.packedProgram);
		for (const auto& upload : gx.uploads) glDeleteTextures(1, &upload.texture.id);
		backend.invalidateTextureBindingCache();
	}
	backend.m_gx_gpu.reset();
}

void executeGxGpuPass(GPUBackend* backend, VideoPresenter*, void* fbo,
	RenderPassStateStorage& stateStorage, void*, const GxGpuPresentation& output) {
	auto& gles = *static_cast<OpenGLES2Backend*>(backend);
	auto& gx = *gles.m_gx_gpu;
	const auto& state = stateStorage.gxGpu;
	const size_t pixels = static_cast<size_t>(state.width) * state.height;
	auto* profile = gles.gxUploadProfile();
	using Clock = std::chrono::steady_clock;
	Clock::time_point scanoutStart;
	if (profile != nullptr) scanoutStart = Clock::now();
	const auto& scanout = output.pcrtcScanout;
	const bool packed = !scanout.interlaced && scanout.compositionPath == GX_GPU_PCRTC_COMPOSE_GX16_DIRECT_CIRCUIT1
		&& static_cast<u32>(state.width) == scanout.outputWidth && static_cast<u32>(state.height) == scanout.outputHeight;
	const size_t bytes = pixels * (packed ? sizeof(u16) : sizeof(u32));
	gx.scanoutPixels.resize((bytes + sizeof(u32) - 1u) / sizeof(u32));
	if (packed) {
		// We did not compose a retained interlaced field.
		gx.software.interlacedValid = false;
		copyPackedGx16Rows(gx.software, scanout.circuits[0u],
			reinterpret_cast<u8*>(gx.scanoutPixels.data()), state.width);
	} else {
		scanoutGxGpuSoftwareVram(gx.software, gx.scanoutPixels.data(), state.width,
			state, scanout, output.vramReplacementSerial);
	}
	if (profile != nullptr) {
		const auto elapsed = std::chrono::duration_cast<std::chrono::nanoseconds>(Clock::now() - scanoutStart).count();
		profile->softwareScanoutNanoseconds += static_cast<u64>(elapsed);
		profile->softwareScanoutPixels += pixels;
	}
	auto& upload = gx.uploads[gx.nextUpload];
	gx.nextUpload = (gx.nextUpload + 1u) % gx.uploads.size();
	Clock::time_point uploadStart;
	if (profile != nullptr) uploadStart = Clock::now();
	const GLenum wordType = packed ? GL_UNSIGNED_SHORT_4_4_4_4 : GL_UNSIGNED_BYTE;
	auto& texture = upload.texture;
	gles.bindTextureForUpload(texture.id, RGBA8_LINEAR_TEXTURE_PARAMS);
	if (texture.width != state.width || texture.height != state.height || upload.wordType != wordType) {
		glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, state.width, state.height, 0, GL_RGBA,
			wordType, gx.scanoutPixels.data());
		texture.width = state.width;
		texture.height = state.height;
		upload.wordType = wordType;
	} else {
		glTexSubImage2D(GL_TEXTURE_2D, 0, 0, 0, state.width, state.height, GL_RGBA,
			wordType, gx.scanoutPixels.data());
	}
	if (profile != nullptr) {
		const auto elapsed = std::chrono::duration_cast<std::chrono::nanoseconds>(Clock::now() - uploadStart).count();
		profile->scanoutUploadNanoseconds += static_cast<u64>(elapsed);
		profile->scanoutUploadCalls += 1u;
		profile->scanoutUploadBytes += bytes;
	}
	gles.setRenderTarget(gles.framebufferName(fbo), state.width, state.height);
	auto& draw = gles.drawState;
	draw.disable(GLES2Capability::Blend);
	draw.disable(GLES2Capability::CullFace);
	draw.disable(GLES2Capability::DepthTest);
	draw.disable(GLES2Capability::Dither);
	draw.disable(GLES2Capability::ScissorTest);
	draw.disable(GLES2Capability::StencilTest);
	draw.colorMask(GL_TRUE, GL_TRUE, GL_TRUE, GL_TRUE);
	draw.useProgram(packed ? gx.packedProgram : gx.argbProgram);
	gles.setActiveTextureUnit(GLES2_TEXTURE_UNIT_GX_SCANOUT);
	gles.bindTexture2D(&texture);
	draw.bindBuffer(GL_ARRAY_BUFFER, gx.vertices);
	draw.enableVertexAttribArray(0u);
	draw.vertexAttribPointer(0u, 2, GL_FLOAT, GL_FALSE, 0, nullptr);
	glDrawArrays(GL_TRIANGLES, 0, 3);
}

void OpenGLES2Backend::executeGxGpuPresentation(const GxGpuDeviceOutput& output) {
	invalidateContextState();
	executeGxGpuSoftwareVramCommands(m_gx_gpu->software, output, output.commandBuffer.presentCommandCount, gxUploadProfile());
}

void OpenGLES2Backend::executeGxGpuCommands(const GxGpuCommandStorage& commands) {
	executeGxGpuSoftwareCommandPrefix(m_gx_gpu->software, commands, commands.executedCommandCount, gxUploadProfile());
}

void OpenGLES2Backend::replaceGxGpuVramSnapshot(std::span<const u8> bytes, u64 serial) {
	replaceGxGpuSoftwareVramSnapshot(m_gx_gpu->software, bytes, serial);
}

void OpenGLES2Backend::readGxGpuVram(const GxGpuReadbackRequest& request, u8* pixels) {
	readGxGpuSoftwareVram(m_gx_gpu->software, request, pixels);
}

void OpenGLES2Backend::executeGxGpuReadback(GxGpu& gxGpu) {
	const auto& output = gxGpu.readDeviceOutput();
	executeGxGpuSoftwareVramCommands(m_gx_gpu->software, output, output.readbackPort.fenceCommandCount(), gxUploadProfile());
}

void OpenGLES2Backend::executeGxGpuCommandDrain(GxGpu& gxGpu) {
	const auto& output = gxGpu.readDeviceOutput();
	executeGxGpuSoftwareVramCommands(m_gx_gpu->software, output, output.commandBuffer.executedCommandCount, gxUploadProfile());
	gxGpu.retireExecutedCommands();
}

void OpenGLES2Backend::finishGxGpuReadbacks() {
	// The software datapath publishes GPUREAD synchronously.
}

void OpenGLES2Backend::captureGxGpuVramSnapshot(GxGpu& gxGpu) {
	captureGxGpuSoftwareVramSnapshot(m_gx_gpu->software, gxGpu, gxUploadProfile());
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
