#include "render/backend/gles2/gx_gpu.h"

#include "machine/devices/gx/gpu.h"
#include "machine/devices/gx/gpu_command_buffer.h"
#include "machine/model_registry.h"
#include "render/backend/gles2/backend.h"
#include "render/backend/gles2/shaders/gx_gpu_shaders.h"
#include "render/backend/pass/library.h"

#include <array>
#include <cstdint>

namespace bmsx {
namespace {

constexpr i32 kGxGpuVramWidth = static_cast<i32>(GX_GPU_VRAM_WIDTH);
constexpr i32 kGxGpuVramHeight = static_cast<i32>(GX_GPU_VRAM_HEIGHT);
constexpr i32 kGxGpuScanoutTextureUnit = 0;
constexpr i32 kGxGpuTextureSampleUnit = 1;
constexpr i32 kGxGpuTextureTransferUnit = 2;
constexpr size_t kGxGpuSolidVertexFloats = 6u;
constexpr size_t kGxGpuSolidVerticesPerCommand = 6u;
constexpr size_t kGxGpuSolidFloatCapacity = GX_GPU_COMMAND_CAPACITY * kGxGpuSolidVerticesPerCommand * kGxGpuSolidVertexFloats;
constexpr size_t kGxGpuLineVertexFloats = 12u;
constexpr size_t kGxGpuLineVerticesPerSegment = 6u;
constexpr size_t kGxGpuLineSegmentFloats = kGxGpuLineVerticesPerSegment * kGxGpuLineVertexFloats;
constexpr size_t kGxGpuLineSegmentCapacity = 1024u;
constexpr size_t kGxGpuLineFloatCapacity = kGxGpuLineSegmentCapacity * kGxGpuLineSegmentFloats;
constexpr size_t kGxGpuTexturedVertexFloats = 7u;
constexpr size_t kGxGpuTexturedVerticesPerCommand = 6u;
constexpr size_t kGxGpuTexturedFloatCapacity = kGxGpuTexturedVerticesPerCommand * kGxGpuTexturedVertexFloats;
constexpr size_t kGxGpuTransferVertexFloats = 4u;
constexpr size_t kGxGpuTransferVerticesPerSegment = 6u;
constexpr size_t kGxGpuTransferSegmentsPerRow = 3u;
constexpr size_t kGxGpuTransferFloatCapacity = static_cast<size_t>(kGxGpuVramHeight) * kGxGpuTransferSegmentsPerRow * kGxGpuTransferVerticesPerSegment * kGxGpuTransferVertexFloats;
constexpr size_t kGxGpuScanoutVertexFloats = 4u;
constexpr size_t kGxGpuScanoutFloatCount = 6u * kGxGpuScanoutVertexFloats;
constexpr size_t kGxGpuRawVramBytesPerPixel = 4u;
constexpr size_t kGxGpuRawVramUploadRowBytes = static_cast<size_t>(kGxGpuVramWidth) * kGxGpuRawVramBytesPerPixel;
constexpr u32 kGxGpuFullDrawingAreaTopLeftWord = 0u;
constexpr u32 kGxGpuFullDrawingAreaBottomRightWord = (static_cast<u32>(kGxGpuVramWidth) - 1u) | ((static_cast<u32>(kGxGpuVramHeight) - 1u) << 10u);
constexpr GLsizeiptr kGxGpuSolidBufferBytes = static_cast<GLsizeiptr>(kGxGpuSolidFloatCapacity * sizeof(f32));
constexpr GLsizeiptr kGxGpuLineBufferBytes = static_cast<GLsizeiptr>(kGxGpuLineFloatCapacity * sizeof(f32));
constexpr GLsizeiptr kGxGpuTexturedBufferBytes = static_cast<GLsizeiptr>(kGxGpuTexturedFloatCapacity * sizeof(f32));
constexpr GLsizeiptr kGxGpuTransferBufferBytes = static_cast<GLsizeiptr>(kGxGpuTransferFloatCapacity * sizeof(f32));
constexpr GLsizei kGxGpuSolidVertexStride = static_cast<GLsizei>(kGxGpuSolidVertexFloats * sizeof(f32));
constexpr GLsizei kGxGpuLineVertexStride = static_cast<GLsizei>(kGxGpuLineVertexFloats * sizeof(f32));
constexpr GLsizei kGxGpuTexturedVertexStride = static_cast<GLsizei>(kGxGpuTexturedVertexFloats * sizeof(f32));
constexpr GLsizei kGxGpuTransferVertexStride = static_cast<GLsizei>(kGxGpuTransferVertexFloats * sizeof(f32));
constexpr GLsizei kGxGpuScanoutVertexStride = static_cast<GLsizei>(kGxGpuScanoutVertexFloats * sizeof(f32));

std::array<f32, kGxGpuSolidFloatCapacity> g_solidVertices{};
std::array<f32, kGxGpuLineFloatCapacity> g_lineVertices{};
std::array<f32, kGxGpuTexturedFloatCapacity> g_texturedVertices{};
std::array<f32, kGxGpuTransferFloatCapacity> g_transferVertices{};
std::array<u8, kGxGpuRawVramUploadRowBytes> g_rawVramUploadRow{};
std::array<f32, kGxGpuScanoutFloatCount> g_scanoutVertices{};

struct GxGpuGLES2Runtime {
	GLuint solidProgram = 0;
	GLuint lineProgram = 0;
	GLuint texturedProgram = 0;
	GLuint transferProgram = 0;
	GLuint scanoutProgram = 0;
	GLES2Texture vramTexture{};
	GLES2Texture vramSampleTexture{};
	GLES2Texture vramTransferTexture{};
	GLuint vramFramebuffer = 0;
	GLuint solidVertexBuffer = 0;
	GLuint lineVertexBuffer = 0;
	GLuint texturedVertexBuffer = 0;
	GLuint transferVertexBuffer = 0;
	GLuint scanoutVertexBuffer = 0;
	GLint solidPositionAttrib = -1;
	GLint solidColorAttrib = -1;
	GLint solidVramUniform = -1;
	GLint solidBlendEnableUniform = -1;
	GLint solidBlendModeUniform = -1;
	GLint solidCheckMaskBitUniform = -1;
	GLint solidSetMaskBitUniform = -1;
	GLint linePositionAttrib = -1;
	GLint lineStartAttrib = -1;
	GLint lineEndAttrib = -1;
	GLint lineColor0Attrib = -1;
	GLint lineColor1Attrib = -1;
	GLint lineVramUniform = -1;
	GLint lineBlendEnableUniform = -1;
	GLint lineBlendModeUniform = -1;
	GLint lineCheckMaskBitUniform = -1;
	GLint lineSetMaskBitUniform = -1;
	GLint texturedPositionAttrib = -1;
	GLint texturedColorAttrib = -1;
	GLint texturedTexcoordAttrib = -1;
	GLint texturedVramUniform = -1;
	GLint texturedTexPageBaseUniform = -1;
	GLint texturedClutBaseUniform = -1;
	GLint texturedTextureWindowAndUniform = -1;
	GLint texturedTextureWindowOrUniform = -1;
	GLint texturedTextureModeUniform = -1;
	GLint texturedRawTextureUniform = -1;
	GLint texturedBlendEnableUniform = -1;
	GLint texturedBlendModeUniform = -1;
	GLint texturedCheckMaskBitUniform = -1;
	GLint texturedSetMaskBitUniform = -1;
	GLint transferPositionAttrib = -1;
	GLint transferTexcoordAttrib = -1;
	GLint transferSourceUniform = -1;
	GLint transferVramUniform = -1;
	GLint transferCheckMaskBitUniform = -1;
	GLint transferSetMaskBitUniform = -1;
	GLint scanoutPositionAttrib = -1;
	GLint scanoutTexcoordAttrib = -1;
	GLint scanoutVramUniform = -1;
	u32 scanoutDisplayStartWord = 0u;
	u32 processedCommandCount = 0;
	u32 processedCommandSerial = 0;
};

GxGpuGLES2Runtime g_gxGpu;

void updateGxGpuScanoutVertices(u32 displayStartWord);

void initGxGpuGLES2(OpenGLES2Backend& backend) {
	g_gxGpu.solidProgram = backend.buildProgram(kGxGpuFillVertexShader, kGxGpuFillFragmentShader, "gx_gpu_fill");
	g_gxGpu.lineProgram = backend.buildProgram(kGxGpuLineVertexShader, kGxGpuLineFragmentShader, "gx_gpu_line");
	g_gxGpu.texturedProgram = backend.buildProgram(kGxGpuTexturedVertexShader, kGxGpuTexturedFragmentShader, "gx_gpu_textured");
	g_gxGpu.transferProgram = backend.buildProgram(kGxGpuTransferVertexShader, kGxGpuTransferFragmentShader, "gx_gpu_transfer");
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

	glGenTextures(1, &g_gxGpu.vramSampleTexture.id);
	g_gxGpu.vramSampleTexture.width = kGxGpuVramWidth;
	g_gxGpu.vramSampleTexture.height = kGxGpuVramHeight;
	backend.setActiveTextureUnit(kGxGpuTextureSampleUnit);
	backend.bindTexture2D(&g_gxGpu.vramSampleTexture);
	glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, kGxGpuVramWidth, kGxGpuVramHeight, 0, GL_RGBA, GL_UNSIGNED_BYTE, nullptr);
	glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
	glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
	glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
	glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);

	glGenTextures(1, &g_gxGpu.vramTransferTexture.id);
	g_gxGpu.vramTransferTexture.width = kGxGpuVramWidth;
	g_gxGpu.vramTransferTexture.height = kGxGpuVramHeight;
	backend.setActiveTextureUnit(kGxGpuTextureTransferUnit);
	backend.bindTexture2D(&g_gxGpu.vramTransferTexture);
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

	glGenBuffers(1, &g_gxGpu.solidVertexBuffer);
	glBindBuffer(GL_ARRAY_BUFFER, g_gxGpu.solidVertexBuffer);
	glBufferData(GL_ARRAY_BUFFER, kGxGpuSolidBufferBytes, nullptr, GL_DYNAMIC_DRAW);

	glGenBuffers(1, &g_gxGpu.lineVertexBuffer);
	glBindBuffer(GL_ARRAY_BUFFER, g_gxGpu.lineVertexBuffer);
	glBufferData(GL_ARRAY_BUFFER, kGxGpuLineBufferBytes, nullptr, GL_DYNAMIC_DRAW);

	glGenBuffers(1, &g_gxGpu.texturedVertexBuffer);
	glBindBuffer(GL_ARRAY_BUFFER, g_gxGpu.texturedVertexBuffer);
	glBufferData(GL_ARRAY_BUFFER, kGxGpuTexturedBufferBytes, nullptr, GL_DYNAMIC_DRAW);

	glGenBuffers(1, &g_gxGpu.transferVertexBuffer);
	glBindBuffer(GL_ARRAY_BUFFER, g_gxGpu.transferVertexBuffer);
	glBufferData(GL_ARRAY_BUFFER, kGxGpuTransferBufferBytes, nullptr, GL_DYNAMIC_DRAW);

	glGenBuffers(1, &g_gxGpu.scanoutVertexBuffer);
	glBindBuffer(GL_ARRAY_BUFFER, g_gxGpu.scanoutVertexBuffer);
	updateGxGpuScanoutVertices(0u);
	glBufferData(GL_ARRAY_BUFFER, static_cast<GLsizeiptr>(g_scanoutVertices.size() * sizeof(f32)), g_scanoutVertices.data(), GL_DYNAMIC_DRAW);

	g_gxGpu.solidPositionAttrib = glGetAttribLocation(g_gxGpu.solidProgram, "a_position");
	g_gxGpu.solidColorAttrib = glGetAttribLocation(g_gxGpu.solidProgram, "a_color");
	g_gxGpu.solidVramUniform = glGetUniformLocation(g_gxGpu.solidProgram, "u_vram");
	g_gxGpu.solidBlendEnableUniform = glGetUniformLocation(g_gxGpu.solidProgram, "u_blendEnable");
	g_gxGpu.solidBlendModeUniform = glGetUniformLocation(g_gxGpu.solidProgram, "u_blendMode");
	g_gxGpu.solidCheckMaskBitUniform = glGetUniformLocation(g_gxGpu.solidProgram, "u_checkMaskBit");
	g_gxGpu.solidSetMaskBitUniform = glGetUniformLocation(g_gxGpu.solidProgram, "u_setMaskBit");
	g_gxGpu.linePositionAttrib = glGetAttribLocation(g_gxGpu.lineProgram, "a_position");
	g_gxGpu.lineStartAttrib = glGetAttribLocation(g_gxGpu.lineProgram, "a_lineStart");
	g_gxGpu.lineEndAttrib = glGetAttribLocation(g_gxGpu.lineProgram, "a_lineEnd");
	g_gxGpu.lineColor0Attrib = glGetAttribLocation(g_gxGpu.lineProgram, "a_color0");
	g_gxGpu.lineColor1Attrib = glGetAttribLocation(g_gxGpu.lineProgram, "a_color1");
	g_gxGpu.lineVramUniform = glGetUniformLocation(g_gxGpu.lineProgram, "u_vram");
	g_gxGpu.lineBlendEnableUniform = glGetUniformLocation(g_gxGpu.lineProgram, "u_blendEnable");
	g_gxGpu.lineBlendModeUniform = glGetUniformLocation(g_gxGpu.lineProgram, "u_blendMode");
	g_gxGpu.lineCheckMaskBitUniform = glGetUniformLocation(g_gxGpu.lineProgram, "u_checkMaskBit");
	g_gxGpu.lineSetMaskBitUniform = glGetUniformLocation(g_gxGpu.lineProgram, "u_setMaskBit");
	g_gxGpu.texturedPositionAttrib = glGetAttribLocation(g_gxGpu.texturedProgram, "a_position");
	g_gxGpu.texturedColorAttrib = glGetAttribLocation(g_gxGpu.texturedProgram, "a_color");
	g_gxGpu.texturedTexcoordAttrib = glGetAttribLocation(g_gxGpu.texturedProgram, "a_texcoord");
	g_gxGpu.texturedVramUniform = glGetUniformLocation(g_gxGpu.texturedProgram, "u_vram");
	g_gxGpu.texturedTexPageBaseUniform = glGetUniformLocation(g_gxGpu.texturedProgram, "u_texPageBase");
	g_gxGpu.texturedClutBaseUniform = glGetUniformLocation(g_gxGpu.texturedProgram, "u_clutBase");
	g_gxGpu.texturedTextureWindowAndUniform = glGetUniformLocation(g_gxGpu.texturedProgram, "u_textureWindowAnd");
	g_gxGpu.texturedTextureWindowOrUniform = glGetUniformLocation(g_gxGpu.texturedProgram, "u_textureWindowOr");
	g_gxGpu.texturedTextureModeUniform = glGetUniformLocation(g_gxGpu.texturedProgram, "u_textureMode");
	g_gxGpu.texturedRawTextureUniform = glGetUniformLocation(g_gxGpu.texturedProgram, "u_rawTexture");
	g_gxGpu.texturedBlendEnableUniform = glGetUniformLocation(g_gxGpu.texturedProgram, "u_blendEnable");
	g_gxGpu.texturedBlendModeUniform = glGetUniformLocation(g_gxGpu.texturedProgram, "u_blendMode");
	g_gxGpu.texturedCheckMaskBitUniform = glGetUniformLocation(g_gxGpu.texturedProgram, "u_checkMaskBit");
	g_gxGpu.texturedSetMaskBitUniform = glGetUniformLocation(g_gxGpu.texturedProgram, "u_setMaskBit");
	g_gxGpu.transferPositionAttrib = glGetAttribLocation(g_gxGpu.transferProgram, "a_position");
	g_gxGpu.transferTexcoordAttrib = glGetAttribLocation(g_gxGpu.transferProgram, "a_texcoord");
	g_gxGpu.transferSourceUniform = glGetUniformLocation(g_gxGpu.transferProgram, "u_source");
	g_gxGpu.transferVramUniform = glGetUniformLocation(g_gxGpu.transferProgram, "u_vram");
	g_gxGpu.transferCheckMaskBitUniform = glGetUniformLocation(g_gxGpu.transferProgram, "u_checkMaskBit");
	g_gxGpu.transferSetMaskBitUniform = glGetUniformLocation(g_gxGpu.transferProgram, "u_setMaskBit");
	g_gxGpu.scanoutPositionAttrib = glGetAttribLocation(g_gxGpu.scanoutProgram, "a_position");
	g_gxGpu.scanoutTexcoordAttrib = glGetAttribLocation(g_gxGpu.scanoutProgram, "a_texcoord");
	g_gxGpu.scanoutVramUniform = glGetUniformLocation(g_gxGpu.scanoutProgram, "u_vram");
	g_gxGpu.scanoutDisplayStartWord = 0u;
	glBindFramebuffer(GL_FRAMEBUFFER, 0);
}

void clearGxGpuVram(OpenGLES2Backend& backend) {
	backend.setRenderTarget(g_gxGpu.vramFramebuffer, kGxGpuVramWidth, kGxGpuVramHeight);
	glDisable(GL_SCISSOR_TEST);
	glClearColor(0.0f, 0.0f, 0.0f, 1.0f);
	glClear(GL_COLOR_BUFFER_BIT);
}

size_t writeSolidVertex(size_t offset, f32 x, f32 y, f32 r, f32 g, f32 b) {
	g_solidVertices[offset] = x;
	g_solidVertices[offset + 1u] = y;
	g_solidVertices[offset + 2u] = r;
	g_solidVertices[offset + 3u] = g;
	g_solidVertices[offset + 4u] = b;
	g_solidVertices[offset + 5u] = 1.0f;
	return offset + kGxGpuSolidVertexFloats;
}

size_t writeSolidColorVertex(size_t offset, f32 x, f32 y, u32 colorWord) {
	return writeSolidVertex(
		offset,
		x,
		y,
		static_cast<f32>(colorWord & 0xffu) / 255.0f,
		static_cast<f32>((colorWord >> 8u) & 0xffu) / 255.0f,
		static_cast<f32>((colorWord >> 16u) & 0xffu) / 255.0f);
}

size_t appendSolidTriangle(
	size_t vertexFloatCount,
	f32 x0,
	f32 y0,
	u32 color0,
	f32 x1,
	f32 y1,
	u32 color1,
	f32 x2,
	f32 y2,
	u32 color2) {
	size_t offset = vertexFloatCount;
	offset = writeSolidColorVertex(offset, x0, y0, color0);
	offset = writeSolidColorVertex(offset, x1, y1, color1);
	offset = writeSolidColorVertex(offset, x2, y2, color2);
	return offset;
}

size_t appendSolidQuad(
	size_t vertexFloatCount,
	f32 x0,
	f32 y0,
	u32 color0,
	f32 x1,
	f32 y1,
	u32 color1,
	f32 x2,
	f32 y2,
	u32 color2,
	f32 x3,
	f32 y3,
	u32 color3) {
	size_t offset = vertexFloatCount;
	offset = appendSolidTriangle(offset, x0, y0, color0, x1, y1, color1, x2, y2, color2);
	offset = appendSolidTriangle(offset, x2, y2, color2, x1, y1, color1, x3, y3, color3);
	return offset;
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
	return appendSolidQuad(vertexFloatCount, x0, y0, colorWord, x0, y1, colorWord, x1, y0, colorWord, x1, y1, colorWord);
}

size_t appendSolidPolygon(const GxGpuCommandBuffer& commandBuffer, u32 commandIndex, size_t vertexFloatCount) {
	const u32 opcode = commandBuffer.commandOpcode[commandIndex];
	if (gxGpuCommandTextureEnabled(opcode)) {
		return vertexFloatCount;
	}
	const u32 wordStart = commandBuffer.commandWordStart[commandIndex];
	const u32 drawingOffsetWord = commandBuffer.commandDrawingOffsetWord[commandIndex];
	const i32 dx = gxGpuDrawingOffsetX(drawingOffsetWord);
	const i32 dy = gxGpuDrawingOffsetY(drawingOffsetWord);
	if (gxGpuCommandGouraud(opcode)) {
		const u32 color0 = commandBuffer.words[wordStart];
		const u32 xy0 = commandBuffer.words[wordStart + 1u];
		const u32 color1 = commandBuffer.words[wordStart + 2u];
		const u32 xy1 = commandBuffer.words[wordStart + 3u];
		const u32 color2 = commandBuffer.words[wordStart + 4u];
		const u32 xy2 = commandBuffer.words[wordStart + 5u];
		size_t offset = appendSolidTriangle(
			vertexFloatCount,
			static_cast<f32>(dx + gxGpuVertexX(xy0)),
			static_cast<f32>(dy + gxGpuVertexY(xy0)),
			color0,
			static_cast<f32>(dx + gxGpuVertexX(xy1)),
			static_cast<f32>(dy + gxGpuVertexY(xy1)),
			color1,
			static_cast<f32>(dx + gxGpuVertexX(xy2)),
			static_cast<f32>(dy + gxGpuVertexY(xy2)),
			color2);
		if (gxGpuCommandQuadPolygon(opcode)) {
			const u32 color3 = commandBuffer.words[wordStart + 6u];
			const u32 xy3 = commandBuffer.words[wordStart + 7u];
			offset = appendSolidTriangle(
				offset,
				static_cast<f32>(dx + gxGpuVertexX(xy2)),
				static_cast<f32>(dy + gxGpuVertexY(xy2)),
				color2,
				static_cast<f32>(dx + gxGpuVertexX(xy1)),
				static_cast<f32>(dy + gxGpuVertexY(xy1)),
				color1,
				static_cast<f32>(dx + gxGpuVertexX(xy3)),
				static_cast<f32>(dy + gxGpuVertexY(xy3)),
				color3);
		}
		return offset;
	}

	const u32 color = commandBuffer.words[wordStart];
	const u32 xy0 = commandBuffer.words[wordStart + 1u];
	const u32 xy1 = commandBuffer.words[wordStart + 2u];
	const u32 xy2 = commandBuffer.words[wordStart + 3u];
	size_t offset = appendSolidTriangle(
		vertexFloatCount,
		static_cast<f32>(dx + gxGpuVertexX(xy0)),
		static_cast<f32>(dy + gxGpuVertexY(xy0)),
		color,
		static_cast<f32>(dx + gxGpuVertexX(xy1)),
		static_cast<f32>(dy + gxGpuVertexY(xy1)),
		color,
		static_cast<f32>(dx + gxGpuVertexX(xy2)),
		static_cast<f32>(dy + gxGpuVertexY(xy2)),
		color);
	if (gxGpuCommandQuadPolygon(opcode)) {
		const u32 xy3 = commandBuffer.words[wordStart + 4u];
		offset = appendSolidTriangle(
			offset,
			static_cast<f32>(dx + gxGpuVertexX(xy2)),
			static_cast<f32>(dy + gxGpuVertexY(xy2)),
			color,
			static_cast<f32>(dx + gxGpuVertexX(xy1)),
			static_cast<f32>(dy + gxGpuVertexY(xy1)),
			color,
			static_cast<f32>(dx + gxGpuVertexX(xy3)),
			static_cast<f32>(dy + gxGpuVertexY(xy3)),
			color);
	}
	return offset;
}

size_t appendSolidRectangle(const GxGpuCommandBuffer& commandBuffer, u32 commandIndex, size_t vertexFloatCount) {
	const u32 opcode = commandBuffer.commandOpcode[commandIndex];
	if (gxGpuCommandTextureEnabled(opcode)) {
		return vertexFloatCount;
	}
	const u32 wordStart = commandBuffer.commandWordStart[commandIndex];
	const u32 colorWord = commandBuffer.words[wordStart];
	const u32 xyWord = commandBuffer.words[wordStart + 1u];
	const u32 sizeWord = commandBuffer.words[wordStart + commandBuffer.commandWordCount[commandIndex] - 1u];
	const u32 width = gxGpuCommandRectangleWidth(opcode, sizeWord);
	const u32 height = gxGpuCommandRectangleHeight(opcode, sizeWord);
	if (width == 0u || height == 0u) {
		return vertexFloatCount;
	}
	const u32 drawingOffsetWord = commandBuffer.commandDrawingOffsetWord[commandIndex];
	const f32 x0 = static_cast<f32>(gxGpuDrawingOffsetX(drawingOffsetWord) + gxGpuVertexX(xyWord));
	const f32 y0 = static_cast<f32>(gxGpuDrawingOffsetY(drawingOffsetWord) + gxGpuVertexY(xyWord));
	const f32 x1 = x0 + static_cast<f32>(width);
	const f32 y1 = y0 + static_cast<f32>(height);
	return appendSolidQuad(vertexFloatCount, x0, y0, colorWord, x0, y1, colorWord, x1, y0, colorWord, x1, y1, colorWord);
}

size_t writeLineVertex(
	size_t offset,
	f32 x,
	f32 y,
	f32 x0,
	f32 y0,
	f32 x1,
	f32 y1,
	u32 color0,
	u32 color1) {
	g_lineVertices[offset] = x;
	g_lineVertices[offset + 1u] = y;
	g_lineVertices[offset + 2u] = x0;
	g_lineVertices[offset + 3u] = y0;
	g_lineVertices[offset + 4u] = x1;
	g_lineVertices[offset + 5u] = y1;
	g_lineVertices[offset + 6u] = static_cast<f32>(color0 & 0xffu) / 255.0f;
	g_lineVertices[offset + 7u] = static_cast<f32>((color0 >> 8u) & 0xffu) / 255.0f;
	g_lineVertices[offset + 8u] = static_cast<f32>((color0 >> 16u) & 0xffu) / 255.0f;
	g_lineVertices[offset + 9u] = static_cast<f32>(color1 & 0xffu) / 255.0f;
	g_lineVertices[offset + 10u] = static_cast<f32>((color1 >> 8u) & 0xffu) / 255.0f;
	g_lineVertices[offset + 11u] = static_cast<f32>((color1 >> 16u) & 0xffu) / 255.0f;
	return offset + kGxGpuLineVertexFloats;
}

size_t appendLineSegment(size_t vertexFloatCount, i32 x0, i32 y0, u32 color0, i32 x1, i32 y1, u32 color1) {
	const i32 left = x0 < x1 ? x0 : x1;
	const i32 right = x0 > x1 ? x0 : x1;
	const i32 top = y0 < y1 ? y0 : y1;
	const i32 bottom = y0 > y1 ? y0 : y1;
	const i32 width = right - left + 1;
	const i32 height = bottom - top + 1;
	if (width > kGxGpuVramWidth || height > kGxGpuVramHeight) {
		return vertexFloatCount;
	}
	const f32 leftFloat = static_cast<f32>(left);
	const f32 topFloat = static_cast<f32>(top);
	const f32 rightFloat = static_cast<f32>(right + 1);
	const f32 bottomFloat = static_cast<f32>(bottom + 1);
	const f32 x0Float = static_cast<f32>(x0);
	const f32 y0Float = static_cast<f32>(y0);
	const f32 x1Float = static_cast<f32>(x1);
	const f32 y1Float = static_cast<f32>(y1);
	size_t offset = vertexFloatCount;
	offset = writeLineVertex(offset, leftFloat, topFloat, x0Float, y0Float, x1Float, y1Float, color0, color1);
	offset = writeLineVertex(offset, leftFloat, bottomFloat, x0Float, y0Float, x1Float, y1Float, color0, color1);
	offset = writeLineVertex(offset, rightFloat, topFloat, x0Float, y0Float, x1Float, y1Float, color0, color1);
	offset = writeLineVertex(offset, rightFloat, topFloat, x0Float, y0Float, x1Float, y1Float, color0, color1);
	offset = writeLineVertex(offset, leftFloat, bottomFloat, x0Float, y0Float, x1Float, y1Float, color0, color1);
	offset = writeLineVertex(offset, rightFloat, bottomFloat, x0Float, y0Float, x1Float, y1Float, color0, color1);
	return offset;
}

size_t writeTexturedVertex(size_t offset, f32 x, f32 y, u32 colorWord, u32 u, u32 v) {
	g_texturedVertices[offset] = x;
	g_texturedVertices[offset + 1u] = y;
	g_texturedVertices[offset + 2u] = static_cast<f32>(colorWord & 0xffu) / 255.0f;
	g_texturedVertices[offset + 3u] = static_cast<f32>((colorWord >> 8u) & 0xffu) / 255.0f;
	g_texturedVertices[offset + 4u] = static_cast<f32>((colorWord >> 16u) & 0xffu) / 255.0f;
	g_texturedVertices[offset + 5u] = static_cast<f32>(u);
	g_texturedVertices[offset + 6u] = static_cast<f32>(v);
	return offset + kGxGpuTexturedVertexFloats;
}

size_t appendTexturedTriangle(
	size_t vertexFloatCount,
	f32 x0,
	f32 y0,
	u32 color0,
	u32 u0,
	u32 v0,
	f32 x1,
	f32 y1,
	u32 color1,
	u32 u1,
	u32 v1,
	f32 x2,
	f32 y2,
	u32 color2,
	u32 u2,
	u32 v2) {
	size_t offset = vertexFloatCount;
	offset = writeTexturedVertex(offset, x0, y0, color0, u0, v0);
	offset = writeTexturedVertex(offset, x1, y1, color1, u1, v1);
	offset = writeTexturedVertex(offset, x2, y2, color2, u2, v2);
	return offset;
}

size_t appendTexturedPolygon(const GxGpuCommandBuffer& commandBuffer, u32 commandIndex, size_t vertexFloatCount) {
	const u32 opcode = commandBuffer.commandOpcode[commandIndex];
	const u32 wordStart = commandBuffer.commandWordStart[commandIndex];
	const u32 drawingOffsetWord = commandBuffer.commandDrawingOffsetWord[commandIndex];
	const i32 dx = gxGpuDrawingOffsetX(drawingOffsetWord);
	const i32 dy = gxGpuDrawingOffsetY(drawingOffsetWord);
	if (gxGpuCommandGouraud(opcode)) {
		const u32 color0 = commandBuffer.words[wordStart];
		const u32 xy0 = commandBuffer.words[wordStart + 1u];
		const u32 texture0 = commandBuffer.words[wordStart + 2u];
		const u32 color1 = commandBuffer.words[wordStart + 3u];
		const u32 xy1 = commandBuffer.words[wordStart + 4u];
		const u32 texture1 = commandBuffer.words[wordStart + 5u];
		const u32 color2 = commandBuffer.words[wordStart + 6u];
		const u32 xy2 = commandBuffer.words[wordStart + 7u];
		const u32 texture2 = commandBuffer.words[wordStart + 8u];
		size_t offset = appendTexturedTriangle(
			vertexFloatCount,
			static_cast<f32>(dx + gxGpuVertexX(xy0)),
			static_cast<f32>(dy + gxGpuVertexY(xy0)),
			color0,
			gxGpuTextureU(texture0),
			gxGpuTextureV(texture0),
			static_cast<f32>(dx + gxGpuVertexX(xy1)),
			static_cast<f32>(dy + gxGpuVertexY(xy1)),
			color1,
			gxGpuTextureU(texture1),
			gxGpuTextureV(texture1),
			static_cast<f32>(dx + gxGpuVertexX(xy2)),
			static_cast<f32>(dy + gxGpuVertexY(xy2)),
			color2,
			gxGpuTextureU(texture2),
			gxGpuTextureV(texture2));
		if (gxGpuCommandQuadPolygon(opcode)) {
			const u32 color3 = commandBuffer.words[wordStart + 9u];
			const u32 xy3 = commandBuffer.words[wordStart + 10u];
			const u32 texture3 = commandBuffer.words[wordStart + 11u];
			offset = appendTexturedTriangle(
				offset,
				static_cast<f32>(dx + gxGpuVertexX(xy2)),
				static_cast<f32>(dy + gxGpuVertexY(xy2)),
				color2,
				gxGpuTextureU(texture2),
				gxGpuTextureV(texture2),
				static_cast<f32>(dx + gxGpuVertexX(xy1)),
				static_cast<f32>(dy + gxGpuVertexY(xy1)),
				color1,
				gxGpuTextureU(texture1),
				gxGpuTextureV(texture1),
				static_cast<f32>(dx + gxGpuVertexX(xy3)),
				static_cast<f32>(dy + gxGpuVertexY(xy3)),
				color3,
				gxGpuTextureU(texture3),
				gxGpuTextureV(texture3));
		}
		return offset;
	}

	const u32 color = commandBuffer.words[wordStart];
	const u32 xy0 = commandBuffer.words[wordStart + 1u];
	const u32 texture0 = commandBuffer.words[wordStart + 2u];
	const u32 xy1 = commandBuffer.words[wordStart + 3u];
	const u32 texture1 = commandBuffer.words[wordStart + 4u];
	const u32 xy2 = commandBuffer.words[wordStart + 5u];
	const u32 texture2 = commandBuffer.words[wordStart + 6u];
	size_t offset = appendTexturedTriangle(
		vertexFloatCount,
		static_cast<f32>(dx + gxGpuVertexX(xy0)),
		static_cast<f32>(dy + gxGpuVertexY(xy0)),
		color,
		gxGpuTextureU(texture0),
		gxGpuTextureV(texture0),
		static_cast<f32>(dx + gxGpuVertexX(xy1)),
		static_cast<f32>(dy + gxGpuVertexY(xy1)),
		color,
		gxGpuTextureU(texture1),
		gxGpuTextureV(texture1),
		static_cast<f32>(dx + gxGpuVertexX(xy2)),
		static_cast<f32>(dy + gxGpuVertexY(xy2)),
		color,
		gxGpuTextureU(texture2),
		gxGpuTextureV(texture2));
	if (gxGpuCommandQuadPolygon(opcode)) {
		const u32 xy3 = commandBuffer.words[wordStart + 7u];
		const u32 texture3 = commandBuffer.words[wordStart + 8u];
		offset = appendTexturedTriangle(
			offset,
			static_cast<f32>(dx + gxGpuVertexX(xy2)),
			static_cast<f32>(dy + gxGpuVertexY(xy2)),
			color,
			gxGpuTextureU(texture2),
			gxGpuTextureV(texture2),
			static_cast<f32>(dx + gxGpuVertexX(xy1)),
			static_cast<f32>(dy + gxGpuVertexY(xy1)),
			color,
			gxGpuTextureU(texture1),
			gxGpuTextureV(texture1),
			static_cast<f32>(dx + gxGpuVertexX(xy3)),
			static_cast<f32>(dy + gxGpuVertexY(xy3)),
			color,
			gxGpuTextureU(texture3),
			gxGpuTextureV(texture3));
	}
	return offset;
}

size_t appendTexturedRectangle(const GxGpuCommandBuffer& commandBuffer, u32 commandIndex, size_t vertexFloatCount) {
	const u32 opcode = commandBuffer.commandOpcode[commandIndex];
	const u32 wordStart = commandBuffer.commandWordStart[commandIndex];
	const u32 colorWord = commandBuffer.words[wordStart];
	const u32 xyWord = commandBuffer.words[wordStart + 1u];
	const u32 textureWord = commandBuffer.words[wordStart + 2u];
	const u32 sizeWord = commandBuffer.words[wordStart + commandBuffer.commandWordCount[commandIndex] - 1u];
	const u32 width = gxGpuCommandRectangleWidth(opcode, sizeWord);
	const u32 height = gxGpuCommandRectangleHeight(opcode, sizeWord);
	if (width == 0u || height == 0u) {
		return vertexFloatCount;
	}
	const u32 drawingOffsetWord = commandBuffer.commandDrawingOffsetWord[commandIndex];
	const f32 x0 = static_cast<f32>(gxGpuDrawingOffsetX(drawingOffsetWord) + gxGpuVertexX(xyWord));
	const f32 y0 = static_cast<f32>(gxGpuDrawingOffsetY(drawingOffsetWord) + gxGpuVertexY(xyWord));
	const f32 x1 = x0 + static_cast<f32>(width);
	const f32 y1 = y0 + static_cast<f32>(height);
	const u32 u0 = gxGpuTextureU(textureWord);
	const u32 v0 = gxGpuTextureV(textureWord);
	const u32 u1 = u0 + width;
	const u32 v1 = v0 + height;
	size_t offset = vertexFloatCount;
	offset = appendTexturedTriangle(offset, x0, y0, colorWord, u0, v0, x1, y0, colorWord, u1, v0, x0, y1, colorWord, u0, v1);
	offset = appendTexturedTriangle(offset, x0, y1, colorWord, u0, v1, x1, y0, colorWord, u1, v0, x1, y1, colorWord, u1, v1);
	return offset;
}

size_t writeTransferVertex(size_t offset, f32 x, f32 y, f32 u, f32 v) {
	g_transferVertices[offset] = x;
	g_transferVertices[offset + 1u] = y;
	g_transferVertices[offset + 2u] = u;
	g_transferVertices[offset + 3u] = v;
	return offset + kGxGpuTransferVertexFloats;
}

size_t appendTransferTriangle(
	size_t vertexFloatCount,
	f32 x0,
	f32 y0,
	f32 u0,
	f32 v0,
	f32 x1,
	f32 y1,
	f32 u1,
	f32 v1,
	f32 x2,
	f32 y2,
	f32 u2,
	f32 v2) {
	size_t offset = vertexFloatCount;
	offset = writeTransferVertex(offset, x0, y0, u0, v0);
	offset = writeTransferVertex(offset, x1, y1, u1, v1);
	offset = writeTransferVertex(offset, x2, y2, u2, v2);
	return offset;
}

size_t appendTransferQuad(size_t vertexFloatCount, u32 x, u32 y, u32 width, u32 height, u32 u, u32 v) {
	const f32 x0 = static_cast<f32>(x);
	const f32 y0 = static_cast<f32>(y);
	const f32 x1 = static_cast<f32>(x + width);
	const f32 y1 = static_cast<f32>(y + height);
	const f32 u0 = static_cast<f32>(u);
	const f32 v0 = static_cast<f32>(v);
	const f32 u1 = static_cast<f32>(u + width);
	const f32 v1 = static_cast<f32>(v + height);
	size_t offset = vertexFloatCount;
	offset = appendTransferTriangle(offset, x0, y0, u0, v0, x1, y0, u1, v0, x0, y1, u0, v1);
	offset = appendTransferTriangle(offset, x0, y1, u0, v1, x1, y0, u1, v0, x1, y1, u1, v1);
	return offset;
}

size_t writeRawVramUploadPixel(size_t rowByteOffset, u32 pixelWord) {
	g_rawVramUploadRow[rowByteOffset] = static_cast<u8>(pixelWord & 0xffu);
	g_rawVramUploadRow[rowByteOffset + 1u] = static_cast<u8>((pixelWord >> 8u) & 0xffu);
	g_rawVramUploadRow[rowByteOffset + 2u] = 0u;
	g_rawVramUploadRow[rowByteOffset + 3u] = 0xffu;
	return rowByteOffset + kGxGpuRawVramBytesPerPixel;
}

void writeCpuToVramUploadRow(const GxGpuCommandBuffer& commandBuffer, u32 payloadWordStart, u32 rowPixelStart, u32 width) {
	size_t rowByteOffset = 0u;
	for (u32 column = 0u; column < width; column += 1u) {
		const u32 pixelIndex = rowPixelStart + column;
		const u32 payloadWord = commandBuffer.words[payloadWordStart + (pixelIndex >> 1u)];
		rowByteOffset = writeRawVramUploadPixel(rowByteOffset, gxGpuTransferPixelWord(payloadWord, pixelIndex));
	}
}

void copyGxGpuVramToSampleTexture(OpenGLES2Backend& backend);
void renderTransferCommands(OpenGLES2Backend& backend, size_t vertexFloatCount, GLES2Texture& sourceTexture, i32 sourceTextureUnit, u32 maskBitModeWord);

void uploadCpuToVram(OpenGLES2Backend& backend, const GxGpuCommandBuffer& commandBuffer, u32 commandIndex) {
	const u32 wordStart = commandBuffer.commandWordStart[commandIndex];
	const u32 xyWord = commandBuffer.words[wordStart + 1u];
	const u32 sizeWord = commandBuffer.words[wordStart + 2u];
	const u32 x = gxGpuTransferX(xyWord);
	const u32 y = gxGpuTransferY(xyWord);
	const u32 width = gxGpuTransferWidth(sizeWord);
	const u32 height = gxGpuTransferHeight(sizeWord);
	const u32 payloadWordStart = wordStart + 3u;
	const u32 maskBitModeWord = commandBuffer.commandMaskBitModeWord[commandIndex];
	size_t transferVertexFloatCount = 0u;

	backend.setRenderTarget(0, kGxGpuVramWidth, kGxGpuVramHeight);
	backend.setActiveTextureUnit(maskBitModeWord == 0u ? kGxGpuScanoutTextureUnit : kGxGpuTextureTransferUnit);
	backend.bindTexture2D(maskBitModeWord == 0u ? &g_gxGpu.vramTexture : &g_gxGpu.vramTransferTexture);
	for (u32 row = 0u; row < height; row += 1u) {
		writeCpuToVramUploadRow(commandBuffer, payloadWordStart, row * width, width);
		const u32 targetY = (y + row) & (static_cast<u32>(kGxGpuVramHeight) - 1u);
		const u32 storageY = (static_cast<u32>(kGxGpuVramHeight) - 1u) - targetY;
		const u32 firstWidth = width <= static_cast<u32>(kGxGpuVramWidth) - x ? width : static_cast<u32>(kGxGpuVramWidth) - x;
		glTexSubImage2D(GL_TEXTURE_2D, 0, static_cast<GLint>(x), static_cast<GLint>(storageY), static_cast<GLsizei>(firstWidth), 1, GL_RGBA, GL_UNSIGNED_BYTE, g_rawVramUploadRow.data());
		if (maskBitModeWord != 0u) {
			transferVertexFloatCount = appendTransferQuad(transferVertexFloatCount, x, targetY, firstWidth, 1u, x, targetY);
		}
		if (firstWidth != width) {
			glTexSubImage2D(
				GL_TEXTURE_2D,
				0,
				0,
				static_cast<GLint>(storageY),
				static_cast<GLsizei>(width - firstWidth),
				1,
				GL_RGBA,
				GL_UNSIGNED_BYTE,
				g_rawVramUploadRow.data() + firstWidth * kGxGpuRawVramBytesPerPixel);
			if (maskBitModeWord != 0u) {
				transferVertexFloatCount = appendTransferQuad(transferVertexFloatCount, 0u, targetY, width - firstWidth, 1u, 0u, targetY);
			}
		}
	}
	if (maskBitModeWord != 0u) {
		if (gxGpuMaskBitCheckBeforeDraw(maskBitModeWord)) {
			copyGxGpuVramToSampleTexture(backend);
		}
		renderTransferCommands(backend, transferVertexFloatCount, g_gxGpu.vramTransferTexture, kGxGpuTextureTransferUnit, maskBitModeWord);
	}
}

void copyVramToVram(OpenGLES2Backend& backend, const GxGpuCommandBuffer& commandBuffer, u32 commandIndex) {
	const u32 wordStart = commandBuffer.commandWordStart[commandIndex];
	const u32 sourceWord = commandBuffer.words[wordStart + 1u];
	const u32 targetWord = commandBuffer.words[wordStart + 2u];
	const u32 sizeWord = commandBuffer.words[wordStart + 3u];
	const u32 sourceX = gxGpuTransferX(sourceWord);
	const u32 sourceY = gxGpuTransferY(sourceWord);
	const u32 targetX = gxGpuTransferX(targetWord);
	const u32 targetY = gxGpuTransferY(targetWord);
	const u32 width = gxGpuTransferWidth(sizeWord);
	const u32 height = gxGpuTransferHeight(sizeWord);
	size_t transferVertexFloatCount = 0u;
	for (u32 row = 0u; row < height; row += 1u) {
		const u32 rowSourceY = (sourceY + row) & (static_cast<u32>(kGxGpuVramHeight) - 1u);
		const u32 rowTargetY = (targetY + row) & (static_cast<u32>(kGxGpuVramHeight) - 1u);
		u32 rowSourceX = sourceX;
		u32 rowTargetX = targetX;
		u32 remainingWidth = width;
		while (remainingWidth != 0u) {
			const u32 sourceRunWidth = static_cast<u32>(kGxGpuVramWidth) - rowSourceX;
			const u32 targetRunWidth = static_cast<u32>(kGxGpuVramWidth) - rowTargetX;
			u32 runWidth = remainingWidth;
			if (sourceRunWidth < runWidth) {
				runWidth = sourceRunWidth;
			}
			if (targetRunWidth < runWidth) {
				runWidth = targetRunWidth;
			}
			transferVertexFloatCount = appendTransferQuad(transferVertexFloatCount, rowTargetX, rowTargetY, runWidth, 1u, rowSourceX, rowSourceY);
			rowSourceX = (rowSourceX + runWidth) & (static_cast<u32>(kGxGpuVramWidth) - 1u);
			rowTargetX = (rowTargetX + runWidth) & (static_cast<u32>(kGxGpuVramWidth) - 1u);
			remainingWidth -= runWidth;
		}
	}
	copyGxGpuVramToSampleTexture(backend);
	renderTransferCommands(backend, transferVertexFloatCount, g_gxGpu.vramSampleTexture, kGxGpuTextureSampleUnit, commandBuffer.commandMaskBitModeWord[commandIndex]);
}

void applyGxGpuDrawingAreaScissor(u32 topLeftWord, u32 bottomRightWord) {
	const u32 left = gxGpuDrawingAreaLeft(topLeftWord, bottomRightWord);
	const u32 top = gxGpuDrawingAreaTop(topLeftWord, bottomRightWord);
	const u32 right = gxGpuDrawingAreaRightExclusive(topLeftWord, bottomRightWord);
	const u32 bottom = gxGpuDrawingAreaBottomExclusive(topLeftWord, bottomRightWord);
	glEnable(GL_SCISSOR_TEST);
	glScissor(
		static_cast<GLint>(left),
		static_cast<GLint>(static_cast<u32>(kGxGpuVramHeight) - bottom),
		static_cast<GLsizei>(right - left),
		static_cast<GLsizei>(bottom - top));
}

void copyGxGpuVramToSampleTexture(OpenGLES2Backend& backend) {
	backend.setRenderTarget(g_gxGpu.vramFramebuffer, kGxGpuVramWidth, kGxGpuVramHeight);
	backend.setActiveTextureUnit(kGxGpuTextureSampleUnit);
	backend.bindTexture2D(&g_gxGpu.vramSampleTexture);
	glCopyTexSubImage2D(GL_TEXTURE_2D, 0, 0, 0, 0, 0, kGxGpuVramWidth, kGxGpuVramHeight);
}

void writeSolidUniforms(bool blendEnabled, u32 blendMode, u32 maskBitModeWord) {
	glUniform1i(g_gxGpu.solidVramUniform, kGxGpuTextureSampleUnit);
	glUniform1f(g_gxGpu.solidBlendEnableUniform, blendEnabled ? 1.0f : 0.0f);
	glUniform1f(g_gxGpu.solidBlendModeUniform, static_cast<f32>(blendMode));
	glUniform1f(g_gxGpu.solidCheckMaskBitUniform, gxGpuMaskBitCheckBeforeDraw(maskBitModeWord) ? 1.0f : 0.0f);
	glUniform1f(g_gxGpu.solidSetMaskBitUniform, gxGpuMaskBitSetWhileDrawing(maskBitModeWord) ? 1.0f : 0.0f);
}

void writeLineUniforms(bool blendEnabled, u32 blendMode, u32 maskBitModeWord) {
	glUniform1i(g_gxGpu.lineVramUniform, kGxGpuTextureSampleUnit);
	glUniform1f(g_gxGpu.lineBlendEnableUniform, blendEnabled ? 1.0f : 0.0f);
	glUniform1f(g_gxGpu.lineBlendModeUniform, static_cast<f32>(blendMode));
	glUniform1f(g_gxGpu.lineCheckMaskBitUniform, gxGpuMaskBitCheckBeforeDraw(maskBitModeWord) ? 1.0f : 0.0f);
	glUniform1f(g_gxGpu.lineSetMaskBitUniform, gxGpuMaskBitSetWhileDrawing(maskBitModeWord) ? 1.0f : 0.0f);
}

void writeTexturedUniforms(const GxGpuCommandBuffer& commandBuffer, u32 commandIndex) {
	const u32 opcode = commandBuffer.commandOpcode[commandIndex];
	const u32 drawModeWord = commandBuffer.commandDrawModeWord[commandIndex];
	const u32 textureWord = commandBuffer.words[commandBuffer.commandWordStart[commandIndex] + 2u];
	const u32 textureWindowWord = commandBuffer.commandTextureWindowWord[commandIndex];
	glUniform1i(g_gxGpu.texturedVramUniform, kGxGpuTextureSampleUnit);
	glUniform2f(g_gxGpu.texturedTexPageBaseUniform, static_cast<f32>(gxGpuDrawModeTexturePageBaseX(drawModeWord)), static_cast<f32>(gxGpuDrawModeTexturePageBaseY(drawModeWord)));
	glUniform2f(g_gxGpu.texturedClutBaseUniform, static_cast<f32>(gxGpuTextureClutBaseX(textureWord)), static_cast<f32>(gxGpuTextureClutBaseY(textureWord)));
	glUniform2f(g_gxGpu.texturedTextureWindowAndUniform, static_cast<f32>(gxGpuTextureWindowAndX(textureWindowWord)), static_cast<f32>(gxGpuTextureWindowAndY(textureWindowWord)));
	glUniform2f(g_gxGpu.texturedTextureWindowOrUniform, static_cast<f32>(gxGpuTextureWindowOrX(textureWindowWord)), static_cast<f32>(gxGpuTextureWindowOrY(textureWindowWord)));
	glUniform1f(g_gxGpu.texturedTextureModeUniform, static_cast<f32>(gxGpuDrawModeTextureMode(drawModeWord)));
	glUniform1f(g_gxGpu.texturedRawTextureUniform, gxGpuCommandRawTextureEnabled(opcode) ? 1.0f : 0.0f);
	glUniform1f(g_gxGpu.texturedBlendEnableUniform, gxGpuCommandSemiTransparencyEnabled(opcode) ? 1.0f : 0.0f);
	glUniform1f(g_gxGpu.texturedBlendModeUniform, static_cast<f32>(gxGpuDrawModeTransparencyMode(drawModeWord)));
	glUniform1f(g_gxGpu.texturedCheckMaskBitUniform, gxGpuMaskBitCheckBeforeDraw(commandBuffer.commandMaskBitModeWord[commandIndex]) ? 1.0f : 0.0f);
	glUniform1f(g_gxGpu.texturedSetMaskBitUniform, gxGpuMaskBitSetWhileDrawing(commandBuffer.commandMaskBitModeWord[commandIndex]) ? 1.0f : 0.0f);
}

void writeTransferUniforms(i32 sourceTextureUnit, u32 maskBitModeWord) {
	glUniform1i(g_gxGpu.transferSourceUniform, sourceTextureUnit);
	glUniform1i(g_gxGpu.transferVramUniform, kGxGpuTextureSampleUnit);
	glUniform1f(g_gxGpu.transferCheckMaskBitUniform, gxGpuMaskBitCheckBeforeDraw(maskBitModeWord) ? 1.0f : 0.0f);
	glUniform1f(g_gxGpu.transferSetMaskBitUniform, gxGpuMaskBitSetWhileDrawing(maskBitModeWord) ? 1.0f : 0.0f);
}

void renderNewSolidCommands(OpenGLES2Backend& backend, GLsizei vertexCount, u32 topLeftWord, u32 bottomRightWord, bool blendEnabled, u32 blendMode, u32 maskBitModeWord);
void renderSolidCommand(OpenGLES2Backend& backend, const GxGpuCommandBuffer& commandBuffer, u32 commandIndex, u32 topLeftWord, u32 bottomRightWord);
void renderLineCommand(OpenGLES2Backend& backend, const GxGpuCommandBuffer& commandBuffer, u32 commandIndex, u32 topLeftWord, u32 bottomRightWord);
void renderTexturedCommand(OpenGLES2Backend& backend, const GxGpuCommandBuffer& commandBuffer, u32 commandIndex, u32 topLeftWord, u32 bottomRightWord);

size_t flushSolidCommands(OpenGLES2Backend& backend, size_t vertexFloatCount, u32 topLeftWord, u32 bottomRightWord, u32 maskBitModeWord) {
	if (vertexFloatCount != 0u) {
		glBindBuffer(GL_ARRAY_BUFFER, g_gxGpu.solidVertexBuffer);
		glBufferSubData(GL_ARRAY_BUFFER, 0, static_cast<GLsizeiptr>(vertexFloatCount * sizeof(f32)), g_solidVertices.data());
		renderNewSolidCommands(backend, static_cast<GLsizei>(vertexFloatCount / kGxGpuSolidVertexFloats), topLeftWord, bottomRightWord, false, 0u, maskBitModeWord);
	}
	return 0u;
}

void renderNewLineCommands(
	OpenGLES2Backend& backend,
	size_t vertexFloatCount,
	u32 topLeftWord,
	u32 bottomRightWord,
	bool blendEnabled,
	u32 blendMode,
	u32 maskBitModeWord) {
	glBindBuffer(GL_ARRAY_BUFFER, g_gxGpu.lineVertexBuffer);
	glBufferSubData(GL_ARRAY_BUFFER, 0, static_cast<GLsizeiptr>(vertexFloatCount * sizeof(f32)), g_lineVertices.data());
	backend.setRenderTarget(g_gxGpu.vramFramebuffer, kGxGpuVramWidth, kGxGpuVramHeight);
	glDisable(GL_DEPTH_TEST);
	glDepthMask(GL_FALSE);
	glDisable(GL_CULL_FACE);
	glDisable(GL_BLEND);
	applyGxGpuDrawingAreaScissor(topLeftWord, bottomRightWord);
	glUseProgram(g_gxGpu.lineProgram);
	writeLineUniforms(blendEnabled, blendMode, maskBitModeWord);
	backend.setActiveTextureUnit(kGxGpuTextureSampleUnit);
	backend.bindTexture2D(&g_gxGpu.vramSampleTexture);
	glBindBuffer(GL_ARRAY_BUFFER, g_gxGpu.lineVertexBuffer);
	glEnableVertexAttribArray(static_cast<GLuint>(g_gxGpu.linePositionAttrib));
	glVertexAttribPointer(static_cast<GLuint>(g_gxGpu.linePositionAttrib), 2, GL_FLOAT, GL_FALSE, kGxGpuLineVertexStride, nullptr);
	glEnableVertexAttribArray(static_cast<GLuint>(g_gxGpu.lineStartAttrib));
	glVertexAttribPointer(static_cast<GLuint>(g_gxGpu.lineStartAttrib), 2, GL_FLOAT, GL_FALSE, kGxGpuLineVertexStride, reinterpret_cast<const void*>(2u * sizeof(f32)));
	glEnableVertexAttribArray(static_cast<GLuint>(g_gxGpu.lineEndAttrib));
	glVertexAttribPointer(static_cast<GLuint>(g_gxGpu.lineEndAttrib), 2, GL_FLOAT, GL_FALSE, kGxGpuLineVertexStride, reinterpret_cast<const void*>(4u * sizeof(f32)));
	glEnableVertexAttribArray(static_cast<GLuint>(g_gxGpu.lineColor0Attrib));
	glVertexAttribPointer(static_cast<GLuint>(g_gxGpu.lineColor0Attrib), 3, GL_FLOAT, GL_FALSE, kGxGpuLineVertexStride, reinterpret_cast<const void*>(6u * sizeof(f32)));
	glEnableVertexAttribArray(static_cast<GLuint>(g_gxGpu.lineColor1Attrib));
	glVertexAttribPointer(static_cast<GLuint>(g_gxGpu.lineColor1Attrib), 3, GL_FLOAT, GL_FALSE, kGxGpuLineVertexStride, reinterpret_cast<const void*>(9u * sizeof(f32)));
	glDrawArrays(GL_TRIANGLES, 0, static_cast<GLsizei>(vertexFloatCount / kGxGpuLineVertexFloats));
	glDisable(GL_SCISSOR_TEST);
}

size_t flushLineCommands(
	OpenGLES2Backend& backend,
	size_t vertexFloatCount,
	u32 topLeftWord,
	u32 bottomRightWord,
	bool blendEnabled,
	u32 blendMode,
	u32 maskBitModeWord) {
	if (vertexFloatCount != 0u) {
		renderNewLineCommands(backend, vertexFloatCount, topLeftWord, bottomRightWord, blendEnabled, blendMode, maskBitModeWord);
	}
	return 0u;
}

void renderLineSegmentCommand(
	OpenGLES2Backend& backend,
	u32 topLeftWord,
	u32 bottomRightWord,
	bool blendEnabled,
	u32 blendMode,
	u32 maskBitModeWord,
	i32 x0,
	i32 y0,
	u32 color0,
	i32 x1,
	i32 y1,
	u32 color1) {
	const size_t vertexFloatCount = appendLineSegment(0u, x0, y0, color0, x1, y1, color1);
	if (vertexFloatCount != 0u) {
		copyGxGpuVramToSampleTexture(backend);
		renderNewLineCommands(backend, vertexFloatCount, topLeftWord, bottomRightWord, blendEnabled, blendMode, maskBitModeWord);
	}
}

size_t appendBatchedLineSegment(
	OpenGLES2Backend& backend,
	size_t vertexFloatCount,
	u32 topLeftWord,
	u32 bottomRightWord,
	bool blendEnabled,
	u32 blendMode,
	u32 maskBitModeWord,
	i32 x0,
	i32 y0,
	u32 color0,
	i32 x1,
	i32 y1,
	u32 color1) {
	size_t offset = vertexFloatCount;
	if (offset + kGxGpuLineSegmentFloats > kGxGpuLineFloatCapacity) {
		offset = flushLineCommands(backend, offset, topLeftWord, bottomRightWord, blendEnabled, blendMode, maskBitModeWord);
	}
	return appendLineSegment(offset, x0, y0, color0, x1, y1, color1);
}

size_t emitLineSegment(
	OpenGLES2Backend& backend,
	size_t vertexFloatCount,
	u32 topLeftWord,
	u32 bottomRightWord,
	bool blendEnabled,
	u32 blendMode,
	u32 maskBitModeWord,
	bool readsVram,
	i32 x0,
	i32 y0,
	u32 color0,
	i32 x1,
	i32 y1,
	u32 color1) {
	if (readsVram) {
		renderLineSegmentCommand(backend, topLeftWord, bottomRightWord, blendEnabled, blendMode, maskBitModeWord, x0, y0, color0, x1, y1, color1);
		return vertexFloatCount;
	}
	return appendBatchedLineSegment(backend, vertexFloatCount, topLeftWord, bottomRightWord, blendEnabled, blendMode, maskBitModeWord, x0, y0, color0, x1, y1, color1);
}

void executeNewGxGpuCommands(OpenGLES2Backend& backend, const GxGpuCommandBuffer& commandBuffer) {
	u32 commandIndex = g_gxGpu.processedCommandCount;
	size_t vertexFloatCount = 0u;
	u32 solidBatchTopLeftWord = kGxGpuFullDrawingAreaTopLeftWord;
	u32 solidBatchBottomRightWord = kGxGpuFullDrawingAreaBottomRightWord;
	u32 solidBatchMaskBitModeWord = 0u;
	for (; commandIndex < commandBuffer.commandCount; commandIndex += 1u) {
		switch (commandBuffer.commandKind[commandIndex]) {
		case GX_GPU_COMMAND_DRAW_POLYGON: {
			const u32 opcode = commandBuffer.commandOpcode[commandIndex];
			const u32 topLeftWord = commandBuffer.commandDrawingAreaTopLeftWord[commandIndex];
			const u32 bottomRightWord = commandBuffer.commandDrawingAreaBottomRightWord[commandIndex];
			const u32 maskBitModeWord = commandBuffer.commandMaskBitModeWord[commandIndex];
			const bool readsVram = gxGpuCommandSemiTransparencyEnabled(opcode) || gxGpuMaskBitCheckBeforeDraw(maskBitModeWord);
			const bool batchMaskChange = gxGpuMaskBitSetWhileDrawing(maskBitModeWord) != gxGpuMaskBitSetWhileDrawing(solidBatchMaskBitModeWord);
			if (vertexFloatCount != 0u && (topLeftWord != solidBatchTopLeftWord || bottomRightWord != solidBatchBottomRightWord || batchMaskChange || readsVram || gxGpuCommandTextureEnabled(opcode))) {
				vertexFloatCount = flushSolidCommands(backend, vertexFloatCount, solidBatchTopLeftWord, solidBatchBottomRightWord, solidBatchMaskBitModeWord);
			}
			solidBatchTopLeftWord = topLeftWord;
			solidBatchBottomRightWord = bottomRightWord;
			solidBatchMaskBitModeWord = maskBitModeWord;
			if (gxGpuCommandTextureEnabled(opcode)) {
				renderTexturedCommand(backend, commandBuffer, commandIndex, topLeftWord, bottomRightWord);
			} else if (readsVram) {
				renderSolidCommand(backend, commandBuffer, commandIndex, topLeftWord, bottomRightWord);
			} else {
				vertexFloatCount = appendSolidPolygon(commandBuffer, commandIndex, vertexFloatCount);
			}
			break;
		}
		case GX_GPU_COMMAND_DRAW_RECTANGLE: {
			const u32 opcode = commandBuffer.commandOpcode[commandIndex];
			const u32 topLeftWord = commandBuffer.commandDrawingAreaTopLeftWord[commandIndex];
			const u32 bottomRightWord = commandBuffer.commandDrawingAreaBottomRightWord[commandIndex];
			const u32 maskBitModeWord = commandBuffer.commandMaskBitModeWord[commandIndex];
			const bool readsVram = gxGpuCommandSemiTransparencyEnabled(opcode) || gxGpuMaskBitCheckBeforeDraw(maskBitModeWord);
			const bool batchMaskChange = gxGpuMaskBitSetWhileDrawing(maskBitModeWord) != gxGpuMaskBitSetWhileDrawing(solidBatchMaskBitModeWord);
			if (vertexFloatCount != 0u && (topLeftWord != solidBatchTopLeftWord || bottomRightWord != solidBatchBottomRightWord || batchMaskChange || readsVram || gxGpuCommandTextureEnabled(opcode))) {
				vertexFloatCount = flushSolidCommands(backend, vertexFloatCount, solidBatchTopLeftWord, solidBatchBottomRightWord, solidBatchMaskBitModeWord);
			}
			solidBatchTopLeftWord = topLeftWord;
			solidBatchBottomRightWord = bottomRightWord;
			solidBatchMaskBitModeWord = maskBitModeWord;
			if (gxGpuCommandTextureEnabled(opcode)) {
				renderTexturedCommand(backend, commandBuffer, commandIndex, topLeftWord, bottomRightWord);
			} else if (readsVram) {
				renderSolidCommand(backend, commandBuffer, commandIndex, topLeftWord, bottomRightWord);
			} else {
				vertexFloatCount = appendSolidRectangle(commandBuffer, commandIndex, vertexFloatCount);
			}
			break;
		}
		case GX_GPU_COMMAND_FILL_RECTANGLE: {
			const u32 topLeftWord = kGxGpuFullDrawingAreaTopLeftWord;
			const u32 bottomRightWord = kGxGpuFullDrawingAreaBottomRightWord;
			const bool batchMaskChange = gxGpuMaskBitSetWhileDrawing(solidBatchMaskBitModeWord);
			if (vertexFloatCount != 0u && (solidBatchTopLeftWord != topLeftWord || solidBatchBottomRightWord != bottomRightWord || batchMaskChange)) {
				vertexFloatCount = flushSolidCommands(backend, vertexFloatCount, solidBatchTopLeftWord, solidBatchBottomRightWord, solidBatchMaskBitModeWord);
			}
			solidBatchTopLeftWord = topLeftWord;
			solidBatchBottomRightWord = bottomRightWord;
			solidBatchMaskBitModeWord = 0u;
			vertexFloatCount = appendFillRectangle(commandBuffer, commandIndex, vertexFloatCount);
			break;
		}
		case GX_GPU_COMMAND_DRAW_LINE:
		case GX_GPU_COMMAND_DRAW_POLYLINE: {
			vertexFloatCount = flushSolidCommands(backend, vertexFloatCount, solidBatchTopLeftWord, solidBatchBottomRightWord, solidBatchMaskBitModeWord);
			const u32 topLeftWord = commandBuffer.commandDrawingAreaTopLeftWord[commandIndex];
			const u32 bottomRightWord = commandBuffer.commandDrawingAreaBottomRightWord[commandIndex];
			renderLineCommand(backend, commandBuffer, commandIndex, topLeftWord, bottomRightWord);
			break;
		}
		case GX_GPU_COMMAND_COPY_VRAM_TO_VRAM:
			vertexFloatCount = flushSolidCommands(backend, vertexFloatCount, solidBatchTopLeftWord, solidBatchBottomRightWord, solidBatchMaskBitModeWord);
			copyVramToVram(backend, commandBuffer, commandIndex);
			break;
		case GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM:
			vertexFloatCount = flushSolidCommands(backend, vertexFloatCount, solidBatchTopLeftWord, solidBatchBottomRightWord, solidBatchMaskBitModeWord);
			uploadCpuToVram(backend, commandBuffer, commandIndex);
			break;
		}
	}
	g_gxGpu.processedCommandCount = static_cast<u32>(commandBuffer.commandCount);
	flushSolidCommands(backend, vertexFloatCount, solidBatchTopLeftWord, solidBatchBottomRightWord, solidBatchMaskBitModeWord);
}

void renderSolidCommand(
	OpenGLES2Backend& backend,
	const GxGpuCommandBuffer& commandBuffer,
	u32 commandIndex,
	u32 topLeftWord,
	u32 bottomRightWord) {
	size_t vertexFloatCount = 0u;
	switch (commandBuffer.commandKind[commandIndex]) {
	case GX_GPU_COMMAND_DRAW_POLYGON:
		vertexFloatCount = appendSolidPolygon(commandBuffer, commandIndex, vertexFloatCount);
		break;
	case GX_GPU_COMMAND_DRAW_RECTANGLE:
		vertexFloatCount = appendSolidRectangle(commandBuffer, commandIndex, vertexFloatCount);
		break;
	case GX_GPU_COMMAND_FILL_RECTANGLE:
		vertexFloatCount = appendFillRectangle(commandBuffer, commandIndex, vertexFloatCount);
		break;
	}
	if (vertexFloatCount == 0u) {
		return;
	}
	copyGxGpuVramToSampleTexture(backend);
	glBindBuffer(GL_ARRAY_BUFFER, g_gxGpu.solidVertexBuffer);
	glBufferSubData(GL_ARRAY_BUFFER, 0, static_cast<GLsizeiptr>(vertexFloatCount * sizeof(f32)), g_solidVertices.data());
	const bool blendEnabled = commandBuffer.commandKind[commandIndex] != GX_GPU_COMMAND_FILL_RECTANGLE && gxGpuCommandSemiTransparencyEnabled(commandBuffer.commandOpcode[commandIndex]);
	const u32 maskBitModeWord = commandBuffer.commandKind[commandIndex] == GX_GPU_COMMAND_FILL_RECTANGLE ? 0u : commandBuffer.commandMaskBitModeWord[commandIndex];
	renderNewSolidCommands(
		backend,
		static_cast<GLsizei>(vertexFloatCount / kGxGpuSolidVertexFloats),
		topLeftWord,
		bottomRightWord,
		blendEnabled,
		gxGpuDrawModeTransparencyMode(commandBuffer.commandDrawModeWord[commandIndex]),
		maskBitModeWord);
}

void renderLineCommand(
	OpenGLES2Backend& backend,
	const GxGpuCommandBuffer& commandBuffer,
	u32 commandIndex,
	u32 topLeftWord,
	u32 bottomRightWord) {
	const u32 opcode = commandBuffer.commandOpcode[commandIndex];
	const u32 wordStart = commandBuffer.commandWordStart[commandIndex];
	const u32 wordEnd = wordStart + commandBuffer.commandWordCount[commandIndex];
	const u32 drawingOffsetWord = commandBuffer.commandDrawingOffsetWord[commandIndex];
	const i32 dx = gxGpuDrawingOffsetX(drawingOffsetWord);
	const i32 dy = gxGpuDrawingOffsetY(drawingOffsetWord);
	const bool blendEnabled = gxGpuCommandSemiTransparencyEnabled(opcode);
	const u32 blendMode = gxGpuDrawModeTransparencyMode(commandBuffer.commandDrawModeWord[commandIndex]);
	const u32 maskBitModeWord = commandBuffer.commandMaskBitModeWord[commandIndex];
	const bool readsVram = blendEnabled || gxGpuMaskBitCheckBeforeDraw(maskBitModeWord);
	size_t vertexFloatCount = 0u;

	if (commandBuffer.commandKind[commandIndex] == GX_GPU_COMMAND_DRAW_LINE) {
		const u32 color0 = commandBuffer.words[wordStart];
		const u32 xy0 = commandBuffer.words[wordStart + 1u];
		if (gxGpuCommandGouraud(opcode)) {
			const u32 color1 = commandBuffer.words[wordStart + 2u];
			const u32 xy1 = commandBuffer.words[wordStart + 3u];
			vertexFloatCount = emitLineSegment(
				backend,
				vertexFloatCount,
				topLeftWord,
				bottomRightWord,
				blendEnabled,
				blendMode,
				maskBitModeWord,
				readsVram,
				dx + gxGpuVertexX(xy0),
				dy + gxGpuVertexY(xy0),
				color0,
				dx + gxGpuVertexX(xy1),
				dy + gxGpuVertexY(xy1),
				color1);
		} else {
			const u32 xy1 = commandBuffer.words[wordStart + 2u];
			vertexFloatCount = emitLineSegment(
				backend,
				vertexFloatCount,
				topLeftWord,
				bottomRightWord,
				blendEnabled,
				blendMode,
				maskBitModeWord,
				readsVram,
				dx + gxGpuVertexX(xy0),
				dy + gxGpuVertexY(xy0),
				color0,
				dx + gxGpuVertexX(xy1),
				dy + gxGpuVertexY(xy1),
				color0);
		}
		flushLineCommands(backend, vertexFloatCount, topLeftWord, bottomRightWord, blendEnabled, blendMode, maskBitModeWord);
		return;
	}

	if (gxGpuCommandGouraud(opcode)) {
		u32 color0 = commandBuffer.words[wordStart];
		u32 xy0 = commandBuffer.words[wordStart + 1u];
		for (u32 wordIndex = wordStart + 2u; wordIndex + 1u < wordEnd; wordIndex += 2u) {
			const u32 color1 = commandBuffer.words[wordIndex];
			const u32 xy1 = commandBuffer.words[wordIndex + 1u];
			vertexFloatCount = emitLineSegment(
				backend,
				vertexFloatCount,
				topLeftWord,
				bottomRightWord,
				blendEnabled,
				blendMode,
				maskBitModeWord,
				readsVram,
				dx + gxGpuVertexX(xy0),
				dy + gxGpuVertexY(xy0),
				color0,
				dx + gxGpuVertexX(xy1),
				dy + gxGpuVertexY(xy1),
				color1);
			color0 = color1;
			xy0 = xy1;
		}
	} else {
		const u32 color = commandBuffer.words[wordStart];
		u32 xy0 = commandBuffer.words[wordStart + 1u];
		for (u32 wordIndex = wordStart + 2u; wordIndex < wordEnd; wordIndex += 1u) {
			const u32 xy1 = commandBuffer.words[wordIndex];
			vertexFloatCount = emitLineSegment(
				backend,
				vertexFloatCount,
				topLeftWord,
				bottomRightWord,
				blendEnabled,
				blendMode,
				maskBitModeWord,
				readsVram,
				dx + gxGpuVertexX(xy0),
				dy + gxGpuVertexY(xy0),
				color,
				dx + gxGpuVertexX(xy1),
				dy + gxGpuVertexY(xy1),
				color);
			xy0 = xy1;
		}
	}
	flushLineCommands(backend, vertexFloatCount, topLeftWord, bottomRightWord, blendEnabled, blendMode, maskBitModeWord);
}

void renderNewSolidCommands(OpenGLES2Backend& backend, GLsizei vertexCount, u32 topLeftWord, u32 bottomRightWord, bool blendEnabled, u32 blendMode, u32 maskBitModeWord) {
	backend.setRenderTarget(g_gxGpu.vramFramebuffer, kGxGpuVramWidth, kGxGpuVramHeight);
	glDisable(GL_DEPTH_TEST);
	glDepthMask(GL_FALSE);
	glDisable(GL_CULL_FACE);
	glDisable(GL_BLEND);
	applyGxGpuDrawingAreaScissor(topLeftWord, bottomRightWord);
	glUseProgram(g_gxGpu.solidProgram);
	writeSolidUniforms(blendEnabled, blendMode, maskBitModeWord);
	backend.setActiveTextureUnit(kGxGpuTextureSampleUnit);
	backend.bindTexture2D(&g_gxGpu.vramSampleTexture);
	glBindBuffer(GL_ARRAY_BUFFER, g_gxGpu.solidVertexBuffer);
	glEnableVertexAttribArray(static_cast<GLuint>(g_gxGpu.solidPositionAttrib));
	glVertexAttribPointer(static_cast<GLuint>(g_gxGpu.solidPositionAttrib), 2, GL_FLOAT, GL_FALSE, kGxGpuSolidVertexStride, nullptr);
	glEnableVertexAttribArray(static_cast<GLuint>(g_gxGpu.solidColorAttrib));
	glVertexAttribPointer(static_cast<GLuint>(g_gxGpu.solidColorAttrib), 4, GL_FLOAT, GL_FALSE, kGxGpuSolidVertexStride, reinterpret_cast<const void*>(2u * sizeof(f32)));
	glDrawArrays(GL_TRIANGLES, 0, vertexCount);
	glDisable(GL_SCISSOR_TEST);
}

void renderTransferCommands(OpenGLES2Backend& backend, size_t vertexFloatCount, GLES2Texture& sourceTexture, i32 sourceTextureUnit, u32 maskBitModeWord) {
	glBindBuffer(GL_ARRAY_BUFFER, g_gxGpu.transferVertexBuffer);
	glBufferSubData(GL_ARRAY_BUFFER, 0, static_cast<GLsizeiptr>(vertexFloatCount * sizeof(f32)), g_transferVertices.data());
	backend.setRenderTarget(g_gxGpu.vramFramebuffer, kGxGpuVramWidth, kGxGpuVramHeight);
	glDisable(GL_SCISSOR_TEST);
	glDisable(GL_DEPTH_TEST);
	glDepthMask(GL_FALSE);
	glDisable(GL_CULL_FACE);
	glDisable(GL_BLEND);
	glUseProgram(g_gxGpu.transferProgram);
	writeTransferUniforms(sourceTextureUnit, maskBitModeWord);
	backend.setActiveTextureUnit(sourceTextureUnit);
	backend.bindTexture2D(&sourceTexture);
	backend.setActiveTextureUnit(kGxGpuTextureSampleUnit);
	backend.bindTexture2D(&g_gxGpu.vramSampleTexture);
	glBindBuffer(GL_ARRAY_BUFFER, g_gxGpu.transferVertexBuffer);
	glEnableVertexAttribArray(static_cast<GLuint>(g_gxGpu.transferPositionAttrib));
	glVertexAttribPointer(static_cast<GLuint>(g_gxGpu.transferPositionAttrib), 2, GL_FLOAT, GL_FALSE, kGxGpuTransferVertexStride, nullptr);
	glEnableVertexAttribArray(static_cast<GLuint>(g_gxGpu.transferTexcoordAttrib));
	glVertexAttribPointer(static_cast<GLuint>(g_gxGpu.transferTexcoordAttrib), 2, GL_FLOAT, GL_FALSE, kGxGpuTransferVertexStride, reinterpret_cast<const void*>(2u * sizeof(f32)));
	glDrawArrays(GL_TRIANGLES, 0, static_cast<GLsizei>(vertexFloatCount / kGxGpuTransferVertexFloats));
}

void renderTexturedCommand(
	OpenGLES2Backend& backend,
	const GxGpuCommandBuffer& commandBuffer,
	u32 commandIndex,
	u32 topLeftWord,
	u32 bottomRightWord) {
	size_t vertexFloatCount = 0u;
	if (commandBuffer.commandKind[commandIndex] == GX_GPU_COMMAND_DRAW_POLYGON) {
		vertexFloatCount = appendTexturedPolygon(commandBuffer, commandIndex, vertexFloatCount);
	} else {
		vertexFloatCount = appendTexturedRectangle(commandBuffer, commandIndex, vertexFloatCount);
	}
	if (vertexFloatCount == 0u) {
		return;
	}
	copyGxGpuVramToSampleTexture(backend);
	glBindBuffer(GL_ARRAY_BUFFER, g_gxGpu.texturedVertexBuffer);
	glBufferSubData(GL_ARRAY_BUFFER, 0, static_cast<GLsizeiptr>(vertexFloatCount * sizeof(f32)), g_texturedVertices.data());
	backend.setRenderTarget(g_gxGpu.vramFramebuffer, kGxGpuVramWidth, kGxGpuVramHeight);
	glDisable(GL_DEPTH_TEST);
	glDepthMask(GL_FALSE);
	glDisable(GL_CULL_FACE);
	glDisable(GL_BLEND);
	applyGxGpuDrawingAreaScissor(topLeftWord, bottomRightWord);
	glUseProgram(g_gxGpu.texturedProgram);
	writeTexturedUniforms(commandBuffer, commandIndex);
	backend.setActiveTextureUnit(kGxGpuTextureSampleUnit);
	backend.bindTexture2D(&g_gxGpu.vramSampleTexture);
	glBindBuffer(GL_ARRAY_BUFFER, g_gxGpu.texturedVertexBuffer);
	glEnableVertexAttribArray(static_cast<GLuint>(g_gxGpu.texturedPositionAttrib));
	glVertexAttribPointer(static_cast<GLuint>(g_gxGpu.texturedPositionAttrib), 2, GL_FLOAT, GL_FALSE, kGxGpuTexturedVertexStride, nullptr);
	glEnableVertexAttribArray(static_cast<GLuint>(g_gxGpu.texturedColorAttrib));
	glVertexAttribPointer(static_cast<GLuint>(g_gxGpu.texturedColorAttrib), 3, GL_FLOAT, GL_FALSE, kGxGpuTexturedVertexStride, reinterpret_cast<const void*>(2u * sizeof(f32)));
	glEnableVertexAttribArray(static_cast<GLuint>(g_gxGpu.texturedTexcoordAttrib));
	glVertexAttribPointer(static_cast<GLuint>(g_gxGpu.texturedTexcoordAttrib), 2, GL_FLOAT, GL_FALSE, kGxGpuTexturedVertexStride, reinterpret_cast<const void*>(5u * sizeof(f32)));
	glDrawArrays(GL_TRIANGLES, 0, static_cast<GLsizei>(vertexFloatCount / kGxGpuTexturedVertexFloats));
	glDisable(GL_SCISSOR_TEST);
}

size_t writeScanoutVertex(size_t offset, f32 x, f32 y, f32 u, f32 v) {
	g_scanoutVertices[offset] = x;
	g_scanoutVertices[offset + 1u] = y;
	g_scanoutVertices[offset + 2u] = u;
	g_scanoutVertices[offset + 3u] = v;
	return offset + kGxGpuScanoutVertexFloats;
}

void updateGxGpuScanoutVertices(u32 displayStartWord) {
	const u32 sourceLeft = gxGpuDisplayStartX(displayStartWord);
	const u32 sourceTop = gxGpuDisplayStartY(displayStartWord);
	const f32 u0 = static_cast<f32>(sourceLeft) / static_cast<f32>(GX_GPU_VRAM_WIDTH);
	const f32 v0 = 1.0f - static_cast<f32>(sourceTop) / static_cast<f32>(GX_GPU_VRAM_HEIGHT);
	const f32 u1 = static_cast<f32>(sourceLeft + static_cast<u32>(PSX_GPU_DISPLAY_WIDTH)) / static_cast<f32>(GX_GPU_VRAM_WIDTH);
	const f32 v1 = 1.0f - static_cast<f32>(sourceTop + static_cast<u32>(PSX_GPU_DISPLAY_HEIGHT)) / static_cast<f32>(GX_GPU_VRAM_HEIGHT);
	size_t offset = 0u;
	offset = writeScanoutVertex(offset, -1.0f, 1.0f, u0, v0);
	offset = writeScanoutVertex(offset, -1.0f, -1.0f, u0, v1);
	offset = writeScanoutVertex(offset, 1.0f, 1.0f, u1, v0);
	offset = writeScanoutVertex(offset, 1.0f, 1.0f, u1, v0);
	offset = writeScanoutVertex(offset, -1.0f, -1.0f, u0, v1);
	writeScanoutVertex(offset, 1.0f, -1.0f, u1, v1);
}

void scanoutGxGpuVram(OpenGLES2Backend& backend, GLuint frameFbo, const GxGpuPipelineState& state) {
	backend.setRenderTarget(frameFbo, state.width, state.height);
	glDisable(GL_SCISSOR_TEST);
	if ((state.statusWord & GX_GPU_STATUS_DISPLAY_DISABLE) != 0u) {
		glClearColor(0.0f, 0.0f, 0.0f, 1.0f);
		glClear(GL_COLOR_BUFFER_BIT);
		return;
	}
	glDisable(GL_DEPTH_TEST);
	glDepthMask(GL_FALSE);
	glDisable(GL_CULL_FACE);
	glDisable(GL_BLEND);
	glUseProgram(g_gxGpu.scanoutProgram);
	glUniform1i(g_gxGpu.scanoutVramUniform, kGxGpuScanoutTextureUnit);
	backend.setActiveTextureUnit(kGxGpuScanoutTextureUnit);
	backend.bindTexture2D(&g_gxGpu.vramTexture);
	glBindBuffer(GL_ARRAY_BUFFER, g_gxGpu.scanoutVertexBuffer);
	if (g_gxGpu.scanoutDisplayStartWord != state.displayStartWord) {
		updateGxGpuScanoutVertices(state.displayStartWord);
		glBufferSubData(GL_ARRAY_BUFFER, 0, static_cast<GLsizeiptr>(g_scanoutVertices.size() * sizeof(f32)), g_scanoutVertices.data());
		g_gxGpu.scanoutDisplayStartWord = state.displayStartWord;
	}
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
	executeNewGxGpuCommands(backend, *state.commandBuffer);
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
