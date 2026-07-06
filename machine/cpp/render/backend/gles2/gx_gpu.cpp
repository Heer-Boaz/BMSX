#include "render/backend/gles2/gx_gpu.h"

#include "machine/devices/gx/gpu_command_buffer.h"
#include "render/backend/gles2/backend.h"
#include "render/backend/gles2/shaders/gx_gpu_shaders.h"
#include "render/backend/pass/library.h"

#include <array>
#include <cstdint>

namespace bmsx {
namespace {

constexpr i32 kGxGpuVramWidth = static_cast<i32>(GX_GPU_VRAM_WIDTH);
constexpr i32 kGxGpuVramHeight = static_cast<i32>(GX_GPU_VRAM_HEIGHT);
constexpr f32 kGxGpuDisplayWidth = 320.0f;
constexpr f32 kGxGpuDisplayHeight = 240.0f;
constexpr i32 kGxGpuScanoutTextureUnit = 0;
constexpr size_t kGxGpuSolidVertexFloats = 6u;
constexpr size_t kGxGpuSolidVerticesPerCommand = 6u;
constexpr size_t kGxGpuSolidFloatCapacity = GX_GPU_COMMAND_CAPACITY * kGxGpuSolidVerticesPerCommand * kGxGpuSolidVertexFloats;
constexpr size_t kGxGpuScanoutVertexFloats = 4u;
constexpr size_t kGxGpuScanoutFloatCount = 6u * kGxGpuScanoutVertexFloats;
constexpr size_t kGxGpuRawVramBytesPerPixel = 4u;
constexpr size_t kGxGpuRawVramUploadRowBytes = static_cast<size_t>(kGxGpuVramWidth) * kGxGpuRawVramBytesPerPixel;
constexpr u32 kGxGpuFullDrawingAreaTopLeftWord = 0u;
constexpr u32 kGxGpuFullDrawingAreaBottomRightWord = (static_cast<u32>(kGxGpuVramWidth) - 1u) | ((static_cast<u32>(kGxGpuVramHeight) - 1u) << 10u);
constexpr GLsizeiptr kGxGpuSolidBufferBytes = static_cast<GLsizeiptr>(kGxGpuSolidFloatCapacity * sizeof(f32));
constexpr GLsizei kGxGpuSolidVertexStride = static_cast<GLsizei>(kGxGpuSolidVertexFloats * sizeof(f32));
constexpr GLsizei kGxGpuScanoutVertexStride = static_cast<GLsizei>(kGxGpuScanoutVertexFloats * sizeof(f32));

std::array<f32, kGxGpuSolidFloatCapacity> g_solidVertices{};
std::array<u8, kGxGpuRawVramUploadRowBytes> g_rawVramUploadRow{};
constexpr std::array<f32, kGxGpuScanoutFloatCount> kScanoutVertices{
	-1.0f, 1.0f, 0.0f, 1.0f,
	-1.0f, -1.0f, 0.0f, 1.0f - kGxGpuDisplayHeight / static_cast<f32>(kGxGpuVramHeight),
	1.0f, 1.0f, kGxGpuDisplayWidth / static_cast<f32>(kGxGpuVramWidth), 1.0f,
	1.0f, 1.0f, kGxGpuDisplayWidth / static_cast<f32>(kGxGpuVramWidth), 1.0f,
	-1.0f, -1.0f, 0.0f, 1.0f - kGxGpuDisplayHeight / static_cast<f32>(kGxGpuVramHeight),
	1.0f, -1.0f, kGxGpuDisplayWidth / static_cast<f32>(kGxGpuVramWidth), 1.0f - kGxGpuDisplayHeight / static_cast<f32>(kGxGpuVramHeight),
};

struct GxGpuGLES2Runtime {
	GLuint solidProgram = 0;
	GLuint scanoutProgram = 0;
	GLES2Texture vramTexture{};
	GLuint vramFramebuffer = 0;
	GLuint solidVertexBuffer = 0;
	GLuint scanoutVertexBuffer = 0;
	GLint solidPositionAttrib = -1;
	GLint solidColorAttrib = -1;
	GLint scanoutPositionAttrib = -1;
	GLint scanoutTexcoordAttrib = -1;
	GLint scanoutVramUniform = -1;
	u32 processedCommandCount = 0;
	u32 processedCommandSerial = 0;
};

GxGpuGLES2Runtime g_gxGpu;

void initGxGpuGLES2(OpenGLES2Backend& backend) {
	g_gxGpu.solidProgram = backend.buildProgram(kGxGpuFillVertexShader, kGxGpuFillFragmentShader, "gx_gpu_fill");
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

	glGenBuffers(1, &g_gxGpu.solidVertexBuffer);
	glBindBuffer(GL_ARRAY_BUFFER, g_gxGpu.solidVertexBuffer);
	glBufferData(GL_ARRAY_BUFFER, kGxGpuSolidBufferBytes, nullptr, GL_DYNAMIC_DRAW);

	glGenBuffers(1, &g_gxGpu.scanoutVertexBuffer);
	glBindBuffer(GL_ARRAY_BUFFER, g_gxGpu.scanoutVertexBuffer);
	glBufferData(GL_ARRAY_BUFFER, static_cast<GLsizeiptr>(kScanoutVertices.size() * sizeof(f32)), kScanoutVertices.data(), GL_STATIC_DRAW);

	g_gxGpu.solidPositionAttrib = glGetAttribLocation(g_gxGpu.solidProgram, "a_position");
	g_gxGpu.solidColorAttrib = glGetAttribLocation(g_gxGpu.solidProgram, "a_color");
	g_gxGpu.scanoutPositionAttrib = glGetAttribLocation(g_gxGpu.scanoutProgram, "a_position");
	g_gxGpu.scanoutTexcoordAttrib = glGetAttribLocation(g_gxGpu.scanoutProgram, "a_texcoord");
	g_gxGpu.scanoutVramUniform = glGetUniformLocation(g_gxGpu.scanoutProgram, "u_vram");
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

void uploadCpuToVram(OpenGLES2Backend& backend, const GxGpuCommandBuffer& commandBuffer, u32 commandIndex) {
	const u32 wordStart = commandBuffer.commandWordStart[commandIndex];
	const u32 xyWord = commandBuffer.words[wordStart + 1u];
	const u32 sizeWord = commandBuffer.words[wordStart + 2u];
	const u32 x = gxGpuTransferX(xyWord);
	const u32 y = gxGpuTransferY(xyWord);
	const u32 width = gxGpuTransferWidth(sizeWord);
	const u32 height = gxGpuTransferHeight(sizeWord);
	const u32 payloadWordStart = wordStart + 3u;

	backend.setRenderTarget(0, kGxGpuVramWidth, kGxGpuVramHeight);
	backend.setActiveTextureUnit(kGxGpuScanoutTextureUnit);
	backend.bindTexture2D(&g_gxGpu.vramTexture);
	for (u32 row = 0u; row < height; row += 1u) {
		writeCpuToVramUploadRow(commandBuffer, payloadWordStart, row * width, width);
		const u32 targetY = (y + row) & (kGxGpuVramHeight - 1u);
		const u32 firstWidth = width <= static_cast<u32>(kGxGpuVramWidth) - x ? width : static_cast<u32>(kGxGpuVramWidth) - x;
		glTexSubImage2D(GL_TEXTURE_2D, 0, static_cast<GLint>(x), static_cast<GLint>(targetY), static_cast<GLsizei>(firstWidth), 1, GL_RGBA, GL_UNSIGNED_BYTE, g_rawVramUploadRow.data());
		if (firstWidth != width) {
			glTexSubImage2D(
				GL_TEXTURE_2D,
				0,
				0,
				static_cast<GLint>(targetY),
				static_cast<GLsizei>(width - firstWidth),
				1,
				GL_RGBA,
				GL_UNSIGNED_BYTE,
				g_rawVramUploadRow.data() + firstWidth * kGxGpuRawVramBytesPerPixel);
		}
	}
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

void renderNewSolidCommands(OpenGLES2Backend& backend, GLsizei vertexCount, u32 topLeftWord, u32 bottomRightWord);

size_t flushSolidCommands(OpenGLES2Backend& backend, size_t vertexFloatCount, u32 topLeftWord, u32 bottomRightWord) {
	if (vertexFloatCount != 0u) {
		glBindBuffer(GL_ARRAY_BUFFER, g_gxGpu.solidVertexBuffer);
		glBufferSubData(GL_ARRAY_BUFFER, 0, static_cast<GLsizeiptr>(vertexFloatCount * sizeof(f32)), g_solidVertices.data());
		renderNewSolidCommands(backend, static_cast<GLsizei>(vertexFloatCount / kGxGpuSolidVertexFloats), topLeftWord, bottomRightWord);
	}
	return 0u;
}

void executeNewGxGpuCommands(OpenGLES2Backend& backend, const GxGpuCommandBuffer& commandBuffer) {
	u32 commandIndex = g_gxGpu.processedCommandCount;
	size_t vertexFloatCount = 0u;
	u32 solidBatchTopLeftWord = kGxGpuFullDrawingAreaTopLeftWord;
	u32 solidBatchBottomRightWord = kGxGpuFullDrawingAreaBottomRightWord;
	for (; commandIndex < commandBuffer.commandCount; commandIndex += 1u) {
		switch (commandBuffer.commandKind[commandIndex]) {
		case GX_GPU_COMMAND_DRAW_POLYGON: {
			const u32 topLeftWord = commandBuffer.commandDrawingAreaTopLeftWord[commandIndex];
			const u32 bottomRightWord = commandBuffer.commandDrawingAreaBottomRightWord[commandIndex];
			if (vertexFloatCount != 0u && (topLeftWord != solidBatchTopLeftWord || bottomRightWord != solidBatchBottomRightWord)) {
				vertexFloatCount = flushSolidCommands(backend, vertexFloatCount, solidBatchTopLeftWord, solidBatchBottomRightWord);
			}
			solidBatchTopLeftWord = topLeftWord;
			solidBatchBottomRightWord = bottomRightWord;
			vertexFloatCount = appendSolidPolygon(commandBuffer, commandIndex, vertexFloatCount);
			break;
		}
		case GX_GPU_COMMAND_DRAW_RECTANGLE: {
			const u32 topLeftWord = commandBuffer.commandDrawingAreaTopLeftWord[commandIndex];
			const u32 bottomRightWord = commandBuffer.commandDrawingAreaBottomRightWord[commandIndex];
			if (vertexFloatCount != 0u && (topLeftWord != solidBatchTopLeftWord || bottomRightWord != solidBatchBottomRightWord)) {
				vertexFloatCount = flushSolidCommands(backend, vertexFloatCount, solidBatchTopLeftWord, solidBatchBottomRightWord);
			}
			solidBatchTopLeftWord = topLeftWord;
			solidBatchBottomRightWord = bottomRightWord;
			vertexFloatCount = appendSolidRectangle(commandBuffer, commandIndex, vertexFloatCount);
			break;
		}
		case GX_GPU_COMMAND_FILL_RECTANGLE:
			if (vertexFloatCount != 0u && (solidBatchTopLeftWord != kGxGpuFullDrawingAreaTopLeftWord || solidBatchBottomRightWord != kGxGpuFullDrawingAreaBottomRightWord)) {
				vertexFloatCount = flushSolidCommands(backend, vertexFloatCount, solidBatchTopLeftWord, solidBatchBottomRightWord);
			}
			solidBatchTopLeftWord = kGxGpuFullDrawingAreaTopLeftWord;
			solidBatchBottomRightWord = kGxGpuFullDrawingAreaBottomRightWord;
			vertexFloatCount = appendFillRectangle(commandBuffer, commandIndex, vertexFloatCount);
			break;
		case GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM:
			vertexFloatCount = flushSolidCommands(backend, vertexFloatCount, solidBatchTopLeftWord, solidBatchBottomRightWord);
			uploadCpuToVram(backend, commandBuffer, commandIndex);
			break;
		}
	}
	g_gxGpu.processedCommandCount = static_cast<u32>(commandBuffer.commandCount);
	flushSolidCommands(backend, vertexFloatCount, solidBatchTopLeftWord, solidBatchBottomRightWord);
}

void renderNewSolidCommands(OpenGLES2Backend& backend, GLsizei vertexCount, u32 topLeftWord, u32 bottomRightWord) {
	backend.setRenderTarget(g_gxGpu.vramFramebuffer, kGxGpuVramWidth, kGxGpuVramHeight);
	glDisable(GL_DEPTH_TEST);
	glDepthMask(GL_FALSE);
	glDisable(GL_CULL_FACE);
	glDisable(GL_BLEND);
	applyGxGpuDrawingAreaScissor(topLeftWord, bottomRightWord);
	glUseProgram(g_gxGpu.solidProgram);
	glBindBuffer(GL_ARRAY_BUFFER, g_gxGpu.solidVertexBuffer);
	glEnableVertexAttribArray(static_cast<GLuint>(g_gxGpu.solidPositionAttrib));
	glVertexAttribPointer(static_cast<GLuint>(g_gxGpu.solidPositionAttrib), 2, GL_FLOAT, GL_FALSE, kGxGpuSolidVertexStride, nullptr);
	glEnableVertexAttribArray(static_cast<GLuint>(g_gxGpu.solidColorAttrib));
	glVertexAttribPointer(static_cast<GLuint>(g_gxGpu.solidColorAttrib), 4, GL_FLOAT, GL_FALSE, kGxGpuSolidVertexStride, reinterpret_cast<const void*>(2u * sizeof(f32)));
	glDrawArrays(GL_TRIANGLES, 0, vertexCount);
	glDisable(GL_SCISSOR_TEST);
}

void scanoutGxGpuVram(OpenGLES2Backend& backend, GLuint frameFbo, const GxGpuPipelineState& state) {
	backend.setRenderTarget(frameFbo, state.width, state.height);
	glDisable(GL_SCISSOR_TEST);
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
