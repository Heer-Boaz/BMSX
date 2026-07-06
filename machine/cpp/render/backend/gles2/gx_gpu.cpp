#include "render/backend/gles2/gx_gpu.h"

#include "machine/devices/gx/gpu_command_buffer.h"
#include "render/backend/gles2/backend.h"
#include "render/backend/gles2/shaders/gx_gpu_shaders.h"
#include "render/backend/pass/library.h"

#include <array>
#include <cstdint>

namespace bmsx {
namespace {

constexpr i32 kGxGpuVramWidth = 1024;
constexpr i32 kGxGpuVramHeight = 512;
constexpr f32 kGxGpuDisplayWidth = 320.0f;
constexpr f32 kGxGpuDisplayHeight = 240.0f;
constexpr i32 kGxGpuScanoutTextureUnit = 0;
constexpr size_t kGxGpuFillVertexFloats = 6u;
constexpr size_t kGxGpuFillVerticesPerRect = 6u;
constexpr size_t kGxGpuFillFloatCapacity = GX_GPU_COMMAND_CAPACITY * kGxGpuFillVerticesPerRect * kGxGpuFillVertexFloats;
constexpr size_t kGxGpuScanoutVertexFloats = 4u;
constexpr size_t kGxGpuScanoutFloatCount = 6u * kGxGpuScanoutVertexFloats;
constexpr GLsizeiptr kGxGpuFillBufferBytes = static_cast<GLsizeiptr>(kGxGpuFillFloatCapacity * sizeof(f32));
constexpr GLsizei kGxGpuFillVertexStride = static_cast<GLsizei>(kGxGpuFillVertexFloats * sizeof(f32));
constexpr GLsizei kGxGpuScanoutVertexStride = static_cast<GLsizei>(kGxGpuScanoutVertexFloats * sizeof(f32));

std::array<f32, kGxGpuFillFloatCapacity> g_fillVertices{};
constexpr std::array<f32, kGxGpuScanoutFloatCount> kScanoutVertices{
	-1.0f, 1.0f, 0.0f, 1.0f,
	-1.0f, -1.0f, 0.0f, 1.0f - kGxGpuDisplayHeight / static_cast<f32>(kGxGpuVramHeight),
	1.0f, 1.0f, kGxGpuDisplayWidth / static_cast<f32>(kGxGpuVramWidth), 1.0f,
	1.0f, 1.0f, kGxGpuDisplayWidth / static_cast<f32>(kGxGpuVramWidth), 1.0f,
	-1.0f, -1.0f, 0.0f, 1.0f - kGxGpuDisplayHeight / static_cast<f32>(kGxGpuVramHeight),
	1.0f, -1.0f, kGxGpuDisplayWidth / static_cast<f32>(kGxGpuVramWidth), 1.0f - kGxGpuDisplayHeight / static_cast<f32>(kGxGpuVramHeight),
};

struct GxGpuGLES2Runtime {
	GLuint fillProgram = 0;
	GLuint scanoutProgram = 0;
	GLES2Texture vramTexture{};
	GLuint vramFramebuffer = 0;
	GLuint fillVertexBuffer = 0;
	GLuint scanoutVertexBuffer = 0;
	GLint fillPositionAttrib = -1;
	GLint fillColorAttrib = -1;
	GLint scanoutPositionAttrib = -1;
	GLint scanoutTexcoordAttrib = -1;
	GLint scanoutVramUniform = -1;
	u32 processedCommandCount = 0;
	u32 processedCommandSerial = 0;
};

GxGpuGLES2Runtime g_gxGpu;

void initGxGpuGLES2(OpenGLES2Backend& backend) {
	g_gxGpu.fillProgram = backend.buildProgram(kGxGpuFillVertexShader, kGxGpuFillFragmentShader, "gx_gpu_fill");
	g_gxGpu.scanoutProgram = backend.buildProgram(kGxGpuScanoutVertexShader, kGxGpuScanoutFragmentShader, "gx_gpu_scanout");

	glGenTextures(1, &g_gxGpu.vramTexture.id);
	g_gxGpu.vramTexture.width = kGxGpuVramWidth;
	g_gxGpu.vramTexture.height = kGxGpuVramHeight;
	backend.setActiveTextureUnit(kGxGpuScanoutTextureUnit);
	backend.bindTexture2D(&g_gxGpu.vramTexture);
	glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, kGxGpuVramWidth, kGxGpuVramHeight, 0, GL_RGBA, GL_UNSIGNED_BYTE, nullptr);
	glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
	glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
	glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
	glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);

	glGenFramebuffers(1, &g_gxGpu.vramFramebuffer);
	glBindFramebuffer(GL_FRAMEBUFFER, g_gxGpu.vramFramebuffer);
	glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, g_gxGpu.vramTexture.id, 0);
	glViewport(0, 0, kGxGpuVramWidth, kGxGpuVramHeight);
	glClearColor(0.0f, 0.0f, 0.0f, 1.0f);
	glClear(GL_COLOR_BUFFER_BIT);

	glGenBuffers(1, &g_gxGpu.fillVertexBuffer);
	glBindBuffer(GL_ARRAY_BUFFER, g_gxGpu.fillVertexBuffer);
	glBufferData(GL_ARRAY_BUFFER, kGxGpuFillBufferBytes, nullptr, GL_DYNAMIC_DRAW);

	glGenBuffers(1, &g_gxGpu.scanoutVertexBuffer);
	glBindBuffer(GL_ARRAY_BUFFER, g_gxGpu.scanoutVertexBuffer);
	glBufferData(GL_ARRAY_BUFFER, static_cast<GLsizeiptr>(kScanoutVertices.size() * sizeof(f32)), kScanoutVertices.data(), GL_STATIC_DRAW);

	g_gxGpu.fillPositionAttrib = glGetAttribLocation(g_gxGpu.fillProgram, "a_position");
	g_gxGpu.fillColorAttrib = glGetAttribLocation(g_gxGpu.fillProgram, "a_color");
	g_gxGpu.scanoutPositionAttrib = glGetAttribLocation(g_gxGpu.scanoutProgram, "a_position");
	g_gxGpu.scanoutTexcoordAttrib = glGetAttribLocation(g_gxGpu.scanoutProgram, "a_texcoord");
	g_gxGpu.scanoutVramUniform = glGetUniformLocation(g_gxGpu.scanoutProgram, "u_vram");
	glBindFramebuffer(GL_FRAMEBUFFER, 0);
}

void clearGxGpuVram(OpenGLES2Backend& backend) {
	backend.setRenderTarget(g_gxGpu.vramFramebuffer, kGxGpuVramWidth, kGxGpuVramHeight);
	glClearColor(0.0f, 0.0f, 0.0f, 1.0f);
	glClear(GL_COLOR_BUFFER_BIT);
}

size_t writeFillVertex(size_t offset, f32 x, f32 y, f32 r, f32 g, f32 b) {
	g_fillVertices[offset] = x;
	g_fillVertices[offset + 1u] = y;
	g_fillVertices[offset + 2u] = r;
	g_fillVertices[offset + 3u] = g;
	g_fillVertices[offset + 4u] = b;
	g_fillVertices[offset + 5u] = 1.0f;
	return offset + kGxGpuFillVertexFloats;
}

size_t appendFillRectangle(const GxGpuCommandBuffer& commandBuffer, u32 commandIndex, size_t vertexFloatCount) {
	const u32 wordStart = commandBuffer.commandWordStart[commandIndex];
	const u32 colorWord = commandBuffer.words[wordStart];
	const u32 xyWord = commandBuffer.words[wordStart + 1u];
	const u32 whWord = commandBuffer.words[wordStart + 2u];
	const u32 width = ((whWord & 0x3ffu) + 0x0fu) & ~0x0fu;
	const u32 height = (whWord >> 16u) & 0x1ffu;
	if (width == 0u || height == 0u) {
		return vertexFloatCount;
	}
	const f32 x0 = static_cast<f32>(xyWord & 0x3f0u);
	const f32 y0 = static_cast<f32>((xyWord >> 16u) & 0x1ffu);
	const f32 x1 = x0 + static_cast<f32>(width);
	const f32 y1 = y0 + static_cast<f32>(height);
	const f32 r = static_cast<f32>(colorWord & 0xffu) / 255.0f;
	const f32 g = static_cast<f32>((colorWord >> 8u) & 0xffu) / 255.0f;
	const f32 b = static_cast<f32>((colorWord >> 16u) & 0xffu) / 255.0f;
	size_t offset = vertexFloatCount;
	offset = writeFillVertex(offset, x0, y0, r, g, b);
	offset = writeFillVertex(offset, x0, y1, r, g, b);
	offset = writeFillVertex(offset, x1, y0, r, g, b);
	offset = writeFillVertex(offset, x1, y0, r, g, b);
	offset = writeFillVertex(offset, x0, y1, r, g, b);
	offset = writeFillVertex(offset, x1, y1, r, g, b);
	return offset;
}

GLsizei uploadNewFillCommands(const GxGpuCommandBuffer& commandBuffer) {
	u32 commandIndex = g_gxGpu.processedCommandCount;
	size_t vertexFloatCount = 0u;
	for (; commandIndex < commandBuffer.commandCount; commandIndex += 1u) {
		if (commandBuffer.commandKind[commandIndex] == GX_GPU_COMMAND_FILL_RECTANGLE) {
			vertexFloatCount = appendFillRectangle(commandBuffer, commandIndex, vertexFloatCount);
		}
	}
	g_gxGpu.processedCommandCount = static_cast<u32>(commandBuffer.commandCount);
	if (vertexFloatCount != 0u) {
		glBindBuffer(GL_ARRAY_BUFFER, g_gxGpu.fillVertexBuffer);
		glBufferSubData(GL_ARRAY_BUFFER, 0, static_cast<GLsizeiptr>(vertexFloatCount * sizeof(f32)), g_fillVertices.data());
	}
	return static_cast<GLsizei>(vertexFloatCount / kGxGpuFillVertexFloats);
}

void renderNewFillCommands(OpenGLES2Backend& backend, GLsizei vertexCount) {
	backend.setRenderTarget(g_gxGpu.vramFramebuffer, kGxGpuVramWidth, kGxGpuVramHeight);
	glDisable(GL_DEPTH_TEST);
	glDepthMask(GL_FALSE);
	glDisable(GL_CULL_FACE);
	glDisable(GL_BLEND);
	glUseProgram(g_gxGpu.fillProgram);
	glBindBuffer(GL_ARRAY_BUFFER, g_gxGpu.fillVertexBuffer);
	glEnableVertexAttribArray(static_cast<GLuint>(g_gxGpu.fillPositionAttrib));
	glVertexAttribPointer(static_cast<GLuint>(g_gxGpu.fillPositionAttrib), 2, GL_FLOAT, GL_FALSE, kGxGpuFillVertexStride, nullptr);
	glEnableVertexAttribArray(static_cast<GLuint>(g_gxGpu.fillColorAttrib));
	glVertexAttribPointer(static_cast<GLuint>(g_gxGpu.fillColorAttrib), 4, GL_FLOAT, GL_FALSE, kGxGpuFillVertexStride, reinterpret_cast<const void*>(2u * sizeof(f32)));
	glDrawArrays(GL_TRIANGLES, 0, vertexCount);
}

void scanoutGxGpuVram(OpenGLES2Backend& backend, GLuint frameFbo, const GxGpuPipelineState& state) {
	backend.setRenderTarget(frameFbo, state.width, state.height);
	glDisable(GL_DEPTH_TEST);
	glDepthMask(GL_FALSE);
	glDisable(GL_CULL_FACE);
	glDisable(GL_BLEND);
	glUseProgram(g_gxGpu.scanoutProgram);
	glUniform1i(g_gxGpu.scanoutVramUniform, kGxGpuScanoutTextureUnit);
	backend.setActiveTextureUnit(kGxGpuScanoutTextureUnit);
	backend.bindTexture2D(&g_gxGpu.vramTexture);
	glBindBuffer(GL_ARRAY_BUFFER, g_gxGpu.scanoutVertexBuffer);
	glEnableVertexAttribArray(static_cast<GLuint>(g_gxGpu.scanoutPositionAttrib));
	glVertexAttribPointer(static_cast<GLuint>(g_gxGpu.scanoutPositionAttrib), 2, GL_FLOAT, GL_FALSE, kGxGpuScanoutVertexStride, nullptr);
	glEnableVertexAttribArray(static_cast<GLuint>(g_gxGpu.scanoutTexcoordAttrib));
	glVertexAttribPointer(static_cast<GLuint>(g_gxGpu.scanoutTexcoordAttrib), 2, GL_FLOAT, GL_FALSE, kGxGpuScanoutVertexStride, reinterpret_cast<const void*>(2u * sizeof(f32)));
	glDrawArrays(GL_TRIANGLES, 0, 6);
}

void renderGxGpuGLES2(OpenGLES2Backend& backend, GLuint frameFbo, const GxGpuPipelineState& state) {
	if (g_gxGpu.processedCommandSerial != state.commandBuffer->serial) {
		clearGxGpuVram(backend);
		g_gxGpu.processedCommandCount = 0u;
		g_gxGpu.processedCommandSerial = state.commandBuffer->serial;
	}
	const GLsizei vertexCount = uploadNewFillCommands(*state.commandBuffer);
	if (vertexCount != 0) {
		renderNewFillCommands(backend, vertexCount);
	}
	scanoutGxGpuVram(backend, frameFbo, state);
}

void executeGxGpuPass(GPUBackend* backend, GameView*, void* fbo, RenderPassStateStorage& stateStorage, void*) {
	auto& typedBackend = *static_cast<OpenGLES2Backend*>(backend);
	const uintptr_t frameFbo = reinterpret_cast<uintptr_t>(fbo);
	renderGxGpuGLES2(typedBackend, static_cast<GLuint>(frameFbo), stateStorage.gxGpu);
}

} // namespace

void registerGxGpuPass(RenderPassLibrary& registry) {
	RenderPassDef desc;
	desc.id = "gx_gpu";
	desc.name = "GXGPU";
	setGxGpuGraph(desc);
	desc.bootstrap = bootstrapBackendRenderPass<OpenGLES2Backend, initGxGpuGLES2>;
	desc.exec = executeGxGpuPass;
	registry.registerPass(desc);
}

} // namespace bmsx
