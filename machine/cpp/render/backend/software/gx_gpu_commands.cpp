#include "render/backend/software/gx_gpu_commands.h"

#include "machine/devices/gx/gpu_command_buffer.h"
#include "render/backend/gx_gpu_render_rules.h"
#include "render/backend/software/gx_gpu_rasterizer.h"
#include "render/backend/software/gx_gpu_vram.h"

#include <array>

namespace bmsx {
namespace {

std::array<u16, kGxGpuSoftwareVramWords> g_gxGpuSoftwareCopyScratch{};

void executeFillRectangle(const GxGpuCommandBuffer& commandBuffer, size_t commandIndex) {
	const u32 wordStart = commandBuffer.commandWordStart[commandIndex];
	const u16 colorWord = gxGpuSoftwareRgb888WordToRgb555(commandBuffer.words[wordStart]);
	const u32 xyWord = commandBuffer.words[wordStart + 1u];
	const u32 sizeWord = commandBuffer.words[wordStart + 2u];
	const i32 x = static_cast<i32>(gxGpuFillX(xyWord));
	const i32 y = static_cast<i32>(gxGpuTransferY(xyWord));
	const i32 width = static_cast<i32>(gxGpuFillWidth(sizeWord));
	const i32 height = static_cast<i32>(gxGpuFillHeight(sizeWord));
	const u32 interlacedRenderWord = commandBuffer.commandInterlacedRenderWord[commandIndex];
	for (i32 row = 0; row < height; row += 1) {
		const i32 targetY = (y + row) & static_cast<i32>(GX_GPU_VRAM_HEIGHT - 1u);
		if (gxGpuSoftwareInterlacedSkipsLine(targetY, interlacedRenderWord)) {
			continue;
		}
		for (i32 column = 0; column < width; column += 1) {
			g_gxGpuSoftwareVram[gxGpuSoftwareVramIndex(x + column, targetY)] = colorWord;
		}
	}
}

void executeCpuToVram(const GxGpuCommandBuffer& commandBuffer, size_t commandIndex) {
	const u32 wordStart = commandBuffer.commandWordStart[commandIndex];
	const u32 xyWord = commandBuffer.words[wordStart + 1u];
	const u32 sizeWord = commandBuffer.words[wordStart + 2u];
	const i32 x = static_cast<i32>(gxGpuTransferX(xyWord));
	const i32 y = static_cast<i32>(gxGpuTransferY(xyWord));
	const u32 width = gxGpuTransferWidth(sizeWord);
	const u32 height = gxGpuTransferHeight(sizeWord);
	const u32 emittedPixels = gxGpuTransferEmittedPixelCount(width, height, commandBuffer.commandWordCount[commandIndex]);
	const u32 payloadWordStart = wordStart + 3u;
	const u32 maskBitModeWord = commandBuffer.commandMaskBitModeWord[commandIndex];
	u32 emittedPixel = 0u;
	for (u32 row = 0u; row < height && emittedPixel < emittedPixels; row += 1u) {
		const u32 rowRemaining = emittedPixels - emittedPixel;
		const u32 rowWidth = rowRemaining < width ? rowRemaining : width;
		const i32 targetY = (y + static_cast<i32>(row)) & static_cast<i32>(GX_GPU_VRAM_HEIGHT - 1u);
		for (u32 column = 0u; column < rowWidth; column += 1u) {
			const u32 payloadWord = commandBuffer.words[payloadWordStart + (emittedPixel >> 1u)];
			gxGpuSoftwareWriteMaskedVramWord(gxGpuSoftwareVramIndex(x + static_cast<i32>(column), targetY), gxGpuTransferPixelWord(payloadWord, emittedPixel), maskBitModeWord);
			emittedPixel += 1u;
		}
	}
}

void copyVramArea(i32 sourceX, i32 sourceY, i32 targetX, i32 targetY, u32 width, u32 height, u32 maskBitModeWord) {
	size_t scratchIndex = 0u;
	for (u32 row = 0u; row < height; row += 1u) {
		const i32 rowSourceY = sourceY + static_cast<i32>(row);
		for (u32 column = 0u; column < width; column += 1u) {
			g_gxGpuSoftwareCopyScratch[scratchIndex] = g_gxGpuSoftwareVram[gxGpuSoftwareVramIndex(sourceX + static_cast<i32>(column), rowSourceY)];
			scratchIndex += 1u;
		}
	}
	scratchIndex = 0u;
	for (u32 row = 0u; row < height; row += 1u) {
		const i32 rowTargetY = targetY + static_cast<i32>(row);
		for (u32 column = 0u; column < width; column += 1u) {
			gxGpuSoftwareWriteMaskedVramWord(gxGpuSoftwareVramIndex(targetX + static_cast<i32>(column), rowTargetY), g_gxGpuSoftwareCopyScratch[scratchIndex], maskBitModeWord);
			scratchIndex += 1u;
		}
	}
}

void executeVramToVram(const GxGpuCommandBuffer& commandBuffer, size_t commandIndex) {
	const u32 wordStart = commandBuffer.commandWordStart[commandIndex];
	const u32 sourceWord = commandBuffer.words[wordStart + 1u];
	const u32 targetWord = commandBuffer.words[wordStart + 2u];
	const u32 sizeWord = commandBuffer.words[wordStart + 3u];
	copyVramArea(
		static_cast<i32>(gxGpuTransferX(sourceWord)),
		static_cast<i32>(gxGpuTransferY(sourceWord)),
		static_cast<i32>(gxGpuTransferX(targetWord)),
		static_cast<i32>(gxGpuTransferY(targetWord)),
		gxGpuTransferWidth(sizeWord),
		gxGpuTransferHeight(sizeWord),
		commandBuffer.commandMaskBitModeWord[commandIndex]);
}

void executeDrawPolygon(const GxGpuCommandBuffer& commandBuffer, size_t commandIndex) {
	const u32 opcode = commandBuffer.commandOpcode[commandIndex];
	const u32 drawModeWord = commandBuffer.commandDrawModeWord[commandIndex];
	const u32 wordStart = commandBuffer.commandWordStart[commandIndex];
	const u32 drawingOffsetWord = commandBuffer.commandDrawingOffsetWord[commandIndex];
	const i32 dx = gxGpuDrawingOffsetX(drawingOffsetWord);
	const i32 dy = gxGpuDrawingOffsetY(drawingOffsetWord);
	const bool ditherEnabled = gxGpuDitheredPolygon(drawModeWord, opcode);
	const bool gouraud = gxGpuCommandGouraud(opcode);
	if (gxGpuCommandDrawsTexture(opcode, drawModeWord)) {
		if (gouraud) {
			const u32 color0 = commandBuffer.words[wordStart];
			const u32 xy0 = commandBuffer.words[wordStart + 1u];
			const u32 texture0 = commandBuffer.words[wordStart + 2u];
			const u32 color1 = commandBuffer.words[wordStart + 3u];
			const u32 xy1 = commandBuffer.words[wordStart + 4u];
			const u32 texture1 = commandBuffer.words[wordStart + 5u];
			const u32 color2 = commandBuffer.words[wordStart + 6u];
			const u32 xy2 = commandBuffer.words[wordStart + 7u];
			const u32 texture2 = commandBuffer.words[wordStart + 8u];
			drawGxGpuSoftwareTexturedTriangle(commandBuffer, commandIndex, dx + gxGpuVertexX(xy0), dy + gxGpuVertexY(xy0), color0, gxGpuTextureU(texture0), gxGpuTextureV(texture0), dx + gxGpuVertexX(xy1), dy + gxGpuVertexY(xy1), color1, gxGpuTextureU(texture1), gxGpuTextureV(texture1), dx + gxGpuVertexX(xy2), dy + gxGpuVertexY(xy2), color2, gxGpuTextureU(texture2), gxGpuTextureV(texture2), ditherEnabled);
			if (gxGpuCommandQuadPolygon(opcode)) {
				const u32 color3 = commandBuffer.words[wordStart + 9u];
				const u32 xy3 = commandBuffer.words[wordStart + 10u];
				const u32 texture3 = commandBuffer.words[wordStart + 11u];
				drawGxGpuSoftwareTexturedTriangle(commandBuffer, commandIndex, dx + gxGpuVertexX(xy2), dy + gxGpuVertexY(xy2), color2, gxGpuTextureU(texture2), gxGpuTextureV(texture2), dx + gxGpuVertexX(xy1), dy + gxGpuVertexY(xy1), color1, gxGpuTextureU(texture1), gxGpuTextureV(texture1), dx + gxGpuVertexX(xy3), dy + gxGpuVertexY(xy3), color3, gxGpuTextureU(texture3), gxGpuTextureV(texture3), ditherEnabled);
			}
			return;
		}

		const u32 color = commandBuffer.words[wordStart];
		const u32 xy0 = commandBuffer.words[wordStart + 1u];
		const u32 texture0 = commandBuffer.words[wordStart + 2u];
		const u32 xy1 = commandBuffer.words[wordStart + 3u];
		const u32 texture1 = commandBuffer.words[wordStart + 4u];
		const u32 xy2 = commandBuffer.words[wordStart + 5u];
		const u32 texture2 = commandBuffer.words[wordStart + 6u];
		drawGxGpuSoftwareTexturedTriangle(commandBuffer, commandIndex, dx + gxGpuVertexX(xy0), dy + gxGpuVertexY(xy0), color, gxGpuTextureU(texture0), gxGpuTextureV(texture0), dx + gxGpuVertexX(xy1), dy + gxGpuVertexY(xy1), color, gxGpuTextureU(texture1), gxGpuTextureV(texture1), dx + gxGpuVertexX(xy2), dy + gxGpuVertexY(xy2), color, gxGpuTextureU(texture2), gxGpuTextureV(texture2), ditherEnabled);
		if (gxGpuCommandQuadPolygon(opcode)) {
			const u32 xy3 = commandBuffer.words[wordStart + 7u];
			const u32 texture3 = commandBuffer.words[wordStart + 8u];
			drawGxGpuSoftwareTexturedTriangle(commandBuffer, commandIndex, dx + gxGpuVertexX(xy2), dy + gxGpuVertexY(xy2), color, gxGpuTextureU(texture2), gxGpuTextureV(texture2), dx + gxGpuVertexX(xy1), dy + gxGpuVertexY(xy1), color, gxGpuTextureU(texture1), gxGpuTextureV(texture1), dx + gxGpuVertexX(xy3), dy + gxGpuVertexY(xy3), color, gxGpuTextureU(texture3), gxGpuTextureV(texture3), ditherEnabled);
		}
		return;
	}
	if (gxGpuCommandTextureEnabled(opcode)) {
		if (gouraud) {
			const u32 color0 = commandBuffer.words[wordStart];
			const u32 xy0 = commandBuffer.words[wordStart + 1u];
			const u32 color1 = commandBuffer.words[wordStart + 3u];
			const u32 xy1 = commandBuffer.words[wordStart + 4u];
			const u32 color2 = commandBuffer.words[wordStart + 6u];
			const u32 xy2 = commandBuffer.words[wordStart + 7u];
			drawGxGpuSoftwareTriangle(commandBuffer, commandIndex, dx + gxGpuVertexX(xy0), dy + gxGpuVertexY(xy0), color0, dx + gxGpuVertexX(xy1), dy + gxGpuVertexY(xy1), color1, dx + gxGpuVertexX(xy2), dy + gxGpuVertexY(xy2), color2, ditherEnabled);
			if (gxGpuCommandQuadPolygon(opcode)) {
				const u32 color3 = commandBuffer.words[wordStart + 9u];
				const u32 xy3 = commandBuffer.words[wordStart + 10u];
				drawGxGpuSoftwareTriangle(commandBuffer, commandIndex, dx + gxGpuVertexX(xy2), dy + gxGpuVertexY(xy2), color2, dx + gxGpuVertexX(xy1), dy + gxGpuVertexY(xy1), color1, dx + gxGpuVertexX(xy3), dy + gxGpuVertexY(xy3), color3, ditherEnabled);
			}
			return;
		}

		const u32 color = commandBuffer.words[wordStart];
		const u32 xy0 = commandBuffer.words[wordStart + 1u];
		const u32 xy1 = commandBuffer.words[wordStart + 3u];
		const u32 xy2 = commandBuffer.words[wordStart + 5u];
		drawGxGpuSoftwareTriangle(commandBuffer, commandIndex, dx + gxGpuVertexX(xy0), dy + gxGpuVertexY(xy0), color, dx + gxGpuVertexX(xy1), dy + gxGpuVertexY(xy1), color, dx + gxGpuVertexX(xy2), dy + gxGpuVertexY(xy2), color, ditherEnabled);
		if (gxGpuCommandQuadPolygon(opcode)) {
			const u32 xy3 = commandBuffer.words[wordStart + 7u];
			drawGxGpuSoftwareTriangle(commandBuffer, commandIndex, dx + gxGpuVertexX(xy2), dy + gxGpuVertexY(xy2), color, dx + gxGpuVertexX(xy1), dy + gxGpuVertexY(xy1), color, dx + gxGpuVertexX(xy3), dy + gxGpuVertexY(xy3), color, ditherEnabled);
		}
		return;
	}

	if (gouraud) {
		const u32 color0 = commandBuffer.words[wordStart];
		const u32 xy0 = commandBuffer.words[wordStart + 1u];
		const u32 color1 = commandBuffer.words[wordStart + 2u];
		const u32 xy1 = commandBuffer.words[wordStart + 3u];
		const u32 color2 = commandBuffer.words[wordStart + 4u];
		const u32 xy2 = commandBuffer.words[wordStart + 5u];
		drawGxGpuSoftwareTriangle(commandBuffer, commandIndex, dx + gxGpuVertexX(xy0), dy + gxGpuVertexY(xy0), color0, dx + gxGpuVertexX(xy1), dy + gxGpuVertexY(xy1), color1, dx + gxGpuVertexX(xy2), dy + gxGpuVertexY(xy2), color2, ditherEnabled);
		if (gxGpuCommandQuadPolygon(opcode)) {
			const u32 color3 = commandBuffer.words[wordStart + 6u];
			const u32 xy3 = commandBuffer.words[wordStart + 7u];
			drawGxGpuSoftwareTriangle(commandBuffer, commandIndex, dx + gxGpuVertexX(xy2), dy + gxGpuVertexY(xy2), color2, dx + gxGpuVertexX(xy1), dy + gxGpuVertexY(xy1), color1, dx + gxGpuVertexX(xy3), dy + gxGpuVertexY(xy3), color3, ditherEnabled);
		}
		return;
	}

	const u32 color = commandBuffer.words[wordStart];
	const u32 xy0 = commandBuffer.words[wordStart + 1u];
	const u32 xy1 = commandBuffer.words[wordStart + 2u];
	const u32 xy2 = commandBuffer.words[wordStart + 3u];
	drawGxGpuSoftwareTriangle(commandBuffer, commandIndex, dx + gxGpuVertexX(xy0), dy + gxGpuVertexY(xy0), color, dx + gxGpuVertexX(xy1), dy + gxGpuVertexY(xy1), color, dx + gxGpuVertexX(xy2), dy + gxGpuVertexY(xy2), color, ditherEnabled);
	if (gxGpuCommandQuadPolygon(opcode)) {
		const u32 xy3 = commandBuffer.words[wordStart + 4u];
		drawGxGpuSoftwareTriangle(commandBuffer, commandIndex, dx + gxGpuVertexX(xy2), dy + gxGpuVertexY(xy2), color, dx + gxGpuVertexX(xy1), dy + gxGpuVertexY(xy1), color, dx + gxGpuVertexX(xy3), dy + gxGpuVertexY(xy3), color, ditherEnabled);
	}
}

void executeDrawRectangle(const GxGpuCommandBuffer& commandBuffer, size_t commandIndex) {
	const u32 opcode = commandBuffer.commandOpcode[commandIndex];
	const u32 drawModeWord = commandBuffer.commandDrawModeWord[commandIndex];
	const u32 wordStart = commandBuffer.commandWordStart[commandIndex];
	const u32 colorWord = commandBuffer.words[wordStart];
	const u32 xyWord = commandBuffer.words[wordStart + 1u];
	const u32 sizeWord = commandBuffer.words[wordStart + commandBuffer.commandWordCount[commandIndex] - 1u];
	const u32 width = gxGpuCommandRectangleWidth(opcode, sizeWord);
	const u32 height = gxGpuCommandRectangleHeight(opcode, sizeWord);
	const u32 drawingOffsetWord = commandBuffer.commandDrawingOffsetWord[commandIndex];
	const i32 x = gxGpuDrawingOffsetX(drawingOffsetWord) + gxGpuVertexX(xyWord);
	const i32 y = gxGpuDrawingOffsetY(drawingOffsetWord) + gxGpuVertexY(xyWord);
	if (gxGpuCommandDrawsTexture(opcode, drawModeWord)) {
		drawGxGpuSoftwareTexturedRectangle(commandBuffer, commandIndex, x, y, width, height, colorWord, commandBuffer.words[wordStart + 2u]);
		return;
	}
	drawGxGpuSoftwareRectangle(commandBuffer, commandIndex, x, y, width, height, colorWord);
}

void executeDrawLine(const GxGpuCommandBuffer& commandBuffer, size_t commandIndex) {
	const u32 opcode = commandBuffer.commandOpcode[commandIndex];
	const u32 wordStart = commandBuffer.commandWordStart[commandIndex];
	const u32 drawingOffsetWord = commandBuffer.commandDrawingOffsetWord[commandIndex];
	const i32 dx = gxGpuDrawingOffsetX(drawingOffsetWord);
	const i32 dy = gxGpuDrawingOffsetY(drawingOffsetWord);
	const u32 color0 = commandBuffer.words[wordStart];
	const u32 xy0 = commandBuffer.words[wordStart + 1u];
	if (gxGpuCommandGouraud(opcode)) {
		const u32 color1 = commandBuffer.words[wordStart + 2u];
		const u32 xy1 = commandBuffer.words[wordStart + 3u];
		drawGxGpuSoftwareLineSegment(commandBuffer, commandIndex, dx + gxGpuVertexX(xy0), dy + gxGpuVertexY(xy0), color0, dx + gxGpuVertexX(xy1), dy + gxGpuVertexY(xy1), color1);
		return;
	}
	const u32 xy1 = commandBuffer.words[wordStart + 2u];
	drawGxGpuSoftwareLineSegment(commandBuffer, commandIndex, dx + gxGpuVertexX(xy0), dy + gxGpuVertexY(xy0), color0, dx + gxGpuVertexX(xy1), dy + gxGpuVertexY(xy1), color0);
}

void executeDrawPolyline(const GxGpuCommandBuffer& commandBuffer, size_t commandIndex) {
	const u32 opcode = commandBuffer.commandOpcode[commandIndex];
	const u32 wordStart = commandBuffer.commandWordStart[commandIndex];
	const u32 wordEnd = wordStart + commandBuffer.commandWordCount[commandIndex];
	const u32 drawingOffsetWord = commandBuffer.commandDrawingOffsetWord[commandIndex];
	const i32 dx = gxGpuDrawingOffsetX(drawingOffsetWord);
	const i32 dy = gxGpuDrawingOffsetY(drawingOffsetWord);
	if (gxGpuCommandGouraud(opcode)) {
		u32 color0 = commandBuffer.words[wordStart];
		u32 xy0 = commandBuffer.words[wordStart + 1u];
		for (u32 wordIndex = wordStart + 2u; wordIndex + 1u < wordEnd; wordIndex += 2u) {
			const u32 color1 = commandBuffer.words[wordIndex];
			const u32 xy1 = commandBuffer.words[wordIndex + 1u];
			drawGxGpuSoftwareLineSegment(commandBuffer, commandIndex, dx + gxGpuVertexX(xy0), dy + gxGpuVertexY(xy0), color0, dx + gxGpuVertexX(xy1), dy + gxGpuVertexY(xy1), color1);
			color0 = color1;
			xy0 = xy1;
		}
		return;
	}
	const u32 color = commandBuffer.words[wordStart];
	u32 xy0 = commandBuffer.words[wordStart + 1u];
	for (u32 wordIndex = wordStart + 2u; wordIndex < wordEnd; wordIndex += 1u) {
		const u32 xy1 = commandBuffer.words[wordIndex];
		drawGxGpuSoftwareLineSegment(commandBuffer, commandIndex, dx + gxGpuVertexX(xy0), dy + gxGpuVertexY(xy0), color, dx + gxGpuVertexX(xy1), dy + gxGpuVertexY(xy1), color);
		xy0 = xy1;
	}
}

} // namespace

size_t executeGxGpuSoftwareCommands(const GxGpuCommandBuffer& commandBuffer, size_t processedCommandCount) {
	for (size_t commandIndex = processedCommandCount; commandIndex < commandBuffer.commandCount; commandIndex += 1u) {
		switch (commandBuffer.commandKind[commandIndex]) {
			case GX_GPU_COMMAND_DRAW_POLYGON:
				executeDrawPolygon(commandBuffer, commandIndex);
				break;
			case GX_GPU_COMMAND_DRAW_LINE:
				executeDrawLine(commandBuffer, commandIndex);
				break;
			case GX_GPU_COMMAND_DRAW_POLYLINE:
				executeDrawPolyline(commandBuffer, commandIndex);
				break;
			case GX_GPU_COMMAND_DRAW_RECTANGLE:
				executeDrawRectangle(commandBuffer, commandIndex);
				break;
			case GX_GPU_COMMAND_FILL_RECTANGLE:
				executeFillRectangle(commandBuffer, commandIndex);
				break;
			case GX_GPU_COMMAND_COPY_VRAM_TO_VRAM:
				executeVramToVram(commandBuffer, commandIndex);
				break;
			case GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM:
				executeCpuToVram(commandBuffer, commandIndex);
				break;
		}
	}
	return commandBuffer.commandCount;
}

} // namespace bmsx
