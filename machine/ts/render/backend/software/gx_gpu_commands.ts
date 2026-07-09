import {
	GX_GPU_COMMAND_COPY_VRAM_TO_VRAM,
	GX_GPU_COMMAND_DRAW_LINE,
	GX_GPU_COMMAND_DRAW_POLYGON,
	GX_GPU_COMMAND_DRAW_POLYLINE,
	GX_GPU_COMMAND_DRAW_RECTANGLE,
	GX_GPU_COMMAND_FILL_RECTANGLE,
	GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM,
	GX_GPU_VRAM_HEIGHT,
	gxGpuTransferHeight,
	gxGpuTransferWidth,
	type GxGpuCommandBufferView,
} from '../../../machine/devices/gx/gpu_command_buffer';
import {
	gxGpuCommandDrawsTexture,
	gxGpuCommandGouraud,
	gxGpuCommandQuadPolygon,
	gxGpuCommandRectangleHeight,
	gxGpuCommandRectangleWidth,
	gxGpuCommandTextureEnabled,
	gxGpuDitheredPolygon,
	gxGpuDrawingOffsetY,
	gxGpuFillHeight,
	gxGpuFillWidth,
	gxGpuFillX,
	gxGpuTransferEmittedPixelCount,
	gxGpuTransferPixelWord,
	gxGpuTransferX,
	gxGpuTransferY,
	gxGpuTextureU,
	gxGpuTextureV,
	gxGpuSigned11,
	gxGpuVertexY,
} from '../gx_gpu_render_rules';
import {
	GX_GPU_SOFTWARE_VRAM_WORDS,
	gxGpuSoftwareInterlacedSkipsLine,
	gxGpuSoftwareRgb888WordToRgb555,
	gxGpuSoftwareVram,
	gxGpuSoftwareVramIndex,
	gxGpuSoftwareWriteMaskedVramWord,
} from './gx_gpu_vram';

import {
	drawGxGpuSoftwareLineSegment,
	drawGxGpuSoftwareRectangle,
	drawGxGpuSoftwareTexturedRectangle,
	drawGxGpuSoftwareTexturedTriangle,
	drawGxGpuSoftwareTriangle,
} from './gx_gpu_rasterizer';

const gxGpuSoftwareCopyScratch = new Uint16Array(GX_GPU_SOFTWARE_VRAM_WORDS);

function executeFillRectangle(commandBuffer: GxGpuCommandBufferView, commandIndex: number): void {
	const wordStart = commandBuffer.commandWordStart[commandIndex];
	const colorWord = gxGpuSoftwareRgb888WordToRgb555(commandBuffer.words[wordStart]);
	const xyWord = commandBuffer.words[wordStart + 1];
	const sizeWord = commandBuffer.words[wordStart + 2];
	const x = gxGpuFillX(xyWord);
	const y = gxGpuTransferY(xyWord);
	const width = gxGpuFillWidth(sizeWord);
	const height = gxGpuFillHeight(sizeWord);
	const interlacedRenderWord = commandBuffer.commandInterlacedRenderWord[commandIndex];
	for (let row = 0; row < height; row += 1) {
		const targetY = (y + row) & (GX_GPU_VRAM_HEIGHT - 1);
		if (gxGpuSoftwareInterlacedSkipsLine(targetY, interlacedRenderWord)) {
			continue;
		}
		for (let column = 0; column < width; column += 1) {
			gxGpuSoftwareVram[gxGpuSoftwareVramIndex(x + column, targetY)] = colorWord;
		}
	}
}

function executeCpuToVram(commandBuffer: GxGpuCommandBufferView, commandIndex: number): void {
	const wordStart = commandBuffer.commandWordStart[commandIndex];
	const xyWord = commandBuffer.words[wordStart + 1];
	const sizeWord = commandBuffer.words[wordStart + 2];
	const x = gxGpuTransferX(xyWord);
	const y = gxGpuTransferY(xyWord);
	const width = gxGpuTransferWidth(sizeWord);
	const height = gxGpuTransferHeight(sizeWord);
	const emittedPixels = gxGpuTransferEmittedPixelCount(width, height, commandBuffer.commandWordCount[commandIndex]);
	const payloadWordStart = wordStart + 3;
	const maskBitModeWord = commandBuffer.commandMaskBitModeWord[commandIndex];
	let emittedPixel = 0;
	for (let row = 0; row < height && emittedPixel < emittedPixels; row += 1) {
		const rowRemaining = emittedPixels - emittedPixel;
		const rowWidth = rowRemaining < width ? rowRemaining : width;
		const targetY = (y + row) & (GX_GPU_VRAM_HEIGHT - 1);
		for (let column = 0; column < rowWidth; column += 1) {
			const payloadWord = commandBuffer.words[payloadWordStart + (emittedPixel >>> 1)];
			gxGpuSoftwareWriteMaskedVramWord(gxGpuSoftwareVramIndex(x + column, targetY), gxGpuTransferPixelWord(payloadWord, emittedPixel), maskBitModeWord);
			emittedPixel += 1;
		}
	}
}

function copyVramArea(sourceX: number, sourceY: number, targetX: number, targetY: number, width: number, height: number, maskBitModeWord: number): void {
	let scratchIndex = 0;
	for (let row = 0; row < height; row += 1) {
		const rowSourceY = sourceY + row;
		for (let column = 0; column < width; column += 1) {
			gxGpuSoftwareCopyScratch[scratchIndex] = gxGpuSoftwareVram[gxGpuSoftwareVramIndex(sourceX + column, rowSourceY)];
			scratchIndex += 1;
		}
	}
	scratchIndex = 0;
	for (let row = 0; row < height; row += 1) {
		const rowTargetY = targetY + row;
		for (let column = 0; column < width; column += 1) {
			gxGpuSoftwareWriteMaskedVramWord(gxGpuSoftwareVramIndex(targetX + column, rowTargetY), gxGpuSoftwareCopyScratch[scratchIndex], maskBitModeWord);
			scratchIndex += 1;
		}
	}
}

function executeVramToVram(commandBuffer: GxGpuCommandBufferView, commandIndex: number): void {
	const wordStart = commandBuffer.commandWordStart[commandIndex];
	const sourceWord = commandBuffer.words[wordStart + 1];
	const targetWord = commandBuffer.words[wordStart + 2];
	const sizeWord = commandBuffer.words[wordStart + 3];
	copyVramArea(
		gxGpuTransferX(sourceWord),
		gxGpuTransferY(sourceWord),
		gxGpuTransferX(targetWord),
		gxGpuTransferY(targetWord),
		gxGpuTransferWidth(sizeWord),
		gxGpuTransferHeight(sizeWord),
		commandBuffer.commandMaskBitModeWord[commandIndex],
	);
}

function executeDrawPolygon(commandBuffer: GxGpuCommandBufferView, commandIndex: number): void {
	const opcode = commandBuffer.commandOpcode[commandIndex];
	const drawModeWord = commandBuffer.commandDrawModeWord[commandIndex];
	const wordStart = commandBuffer.commandWordStart[commandIndex];
	const drawingOffsetWord = commandBuffer.commandDrawingOffsetWord[commandIndex];
	const dx = gxGpuSigned11(drawingOffsetWord);
	const dy = gxGpuDrawingOffsetY(drawingOffsetWord);
	const ditherEnabled = gxGpuDitheredPolygon(drawModeWord, opcode);
	const gouraud = gxGpuCommandGouraud(opcode);
	if (gxGpuCommandDrawsTexture(opcode, drawModeWord)) {
		if (gouraud) {
			const color0 = commandBuffer.words[wordStart];
			const xy0 = commandBuffer.words[wordStart + 1];
			const texture0 = commandBuffer.words[wordStart + 2];
			const color1 = commandBuffer.words[wordStart + 3];
			const xy1 = commandBuffer.words[wordStart + 4];
			const texture1 = commandBuffer.words[wordStart + 5];
			const color2 = commandBuffer.words[wordStart + 6];
			const xy2 = commandBuffer.words[wordStart + 7];
			const texture2 = commandBuffer.words[wordStart + 8];
			drawGxGpuSoftwareTexturedTriangle(commandBuffer, commandIndex, dx + gxGpuSigned11(xy0), dy + gxGpuVertexY(xy0), color0, gxGpuTextureU(texture0), gxGpuTextureV(texture0), dx + gxGpuSigned11(xy1), dy + gxGpuVertexY(xy1), color1, gxGpuTextureU(texture1), gxGpuTextureV(texture1), dx + gxGpuSigned11(xy2), dy + gxGpuVertexY(xy2), color2, gxGpuTextureU(texture2), gxGpuTextureV(texture2), ditherEnabled);
			if (gxGpuCommandQuadPolygon(opcode)) {
				const color3 = commandBuffer.words[wordStart + 9];
				const xy3 = commandBuffer.words[wordStart + 10];
				const texture3 = commandBuffer.words[wordStart + 11];
				drawGxGpuSoftwareTexturedTriangle(commandBuffer, commandIndex, dx + gxGpuSigned11(xy2), dy + gxGpuVertexY(xy2), color2, gxGpuTextureU(texture2), gxGpuTextureV(texture2), dx + gxGpuSigned11(xy1), dy + gxGpuVertexY(xy1), color1, gxGpuTextureU(texture1), gxGpuTextureV(texture1), dx + gxGpuSigned11(xy3), dy + gxGpuVertexY(xy3), color3, gxGpuTextureU(texture3), gxGpuTextureV(texture3), ditherEnabled);
			}
			return;
		}

		const color = commandBuffer.words[wordStart];
		const xy0 = commandBuffer.words[wordStart + 1];
		const texture0 = commandBuffer.words[wordStart + 2];
		const xy1 = commandBuffer.words[wordStart + 3];
		const texture1 = commandBuffer.words[wordStart + 4];
		const xy2 = commandBuffer.words[wordStart + 5];
		const texture2 = commandBuffer.words[wordStart + 6];
		drawGxGpuSoftwareTexturedTriangle(commandBuffer, commandIndex, dx + gxGpuSigned11(xy0), dy + gxGpuVertexY(xy0), color, gxGpuTextureU(texture0), gxGpuTextureV(texture0), dx + gxGpuSigned11(xy1), dy + gxGpuVertexY(xy1), color, gxGpuTextureU(texture1), gxGpuTextureV(texture1), dx + gxGpuSigned11(xy2), dy + gxGpuVertexY(xy2), color, gxGpuTextureU(texture2), gxGpuTextureV(texture2), ditherEnabled);
		if (gxGpuCommandQuadPolygon(opcode)) {
			const xy3 = commandBuffer.words[wordStart + 7];
			const texture3 = commandBuffer.words[wordStart + 8];
			drawGxGpuSoftwareTexturedTriangle(commandBuffer, commandIndex, dx + gxGpuSigned11(xy2), dy + gxGpuVertexY(xy2), color, gxGpuTextureU(texture2), gxGpuTextureV(texture2), dx + gxGpuSigned11(xy1), dy + gxGpuVertexY(xy1), color, gxGpuTextureU(texture1), gxGpuTextureV(texture1), dx + gxGpuSigned11(xy3), dy + gxGpuVertexY(xy3), color, gxGpuTextureU(texture3), gxGpuTextureV(texture3), ditherEnabled);
		}
		return;
	}
	if (gxGpuCommandTextureEnabled(opcode)) {
		if (gouraud) {
			const color0 = commandBuffer.words[wordStart];
			const xy0 = commandBuffer.words[wordStart + 1];
			const color1 = commandBuffer.words[wordStart + 3];
			const xy1 = commandBuffer.words[wordStart + 4];
			const color2 = commandBuffer.words[wordStart + 6];
			const xy2 = commandBuffer.words[wordStart + 7];
			drawGxGpuSoftwareTriangle(commandBuffer, commandIndex, dx + gxGpuSigned11(xy0), dy + gxGpuVertexY(xy0), color0, dx + gxGpuSigned11(xy1), dy + gxGpuVertexY(xy1), color1, dx + gxGpuSigned11(xy2), dy + gxGpuVertexY(xy2), color2, ditherEnabled);
			if (gxGpuCommandQuadPolygon(opcode)) {
				const color3 = commandBuffer.words[wordStart + 9];
				const xy3 = commandBuffer.words[wordStart + 10];
				drawGxGpuSoftwareTriangle(commandBuffer, commandIndex, dx + gxGpuSigned11(xy2), dy + gxGpuVertexY(xy2), color2, dx + gxGpuSigned11(xy1), dy + gxGpuVertexY(xy1), color1, dx + gxGpuSigned11(xy3), dy + gxGpuVertexY(xy3), color3, ditherEnabled);
			}
			return;
		}

		const color = commandBuffer.words[wordStart];
		const xy0 = commandBuffer.words[wordStart + 1];
		const xy1 = commandBuffer.words[wordStart + 3];
		const xy2 = commandBuffer.words[wordStart + 5];
		drawGxGpuSoftwareTriangle(commandBuffer, commandIndex, dx + gxGpuSigned11(xy0), dy + gxGpuVertexY(xy0), color, dx + gxGpuSigned11(xy1), dy + gxGpuVertexY(xy1), color, dx + gxGpuSigned11(xy2), dy + gxGpuVertexY(xy2), color, ditherEnabled);
		if (gxGpuCommandQuadPolygon(opcode)) {
			const xy3 = commandBuffer.words[wordStart + 7];
			drawGxGpuSoftwareTriangle(commandBuffer, commandIndex, dx + gxGpuSigned11(xy2), dy + gxGpuVertexY(xy2), color, dx + gxGpuSigned11(xy1), dy + gxGpuVertexY(xy1), color, dx + gxGpuSigned11(xy3), dy + gxGpuVertexY(xy3), color, ditherEnabled);
		}
		return;
	}

	if (gouraud) {
		const color0 = commandBuffer.words[wordStart];
		const xy0 = commandBuffer.words[wordStart + 1];
		const color1 = commandBuffer.words[wordStart + 2];
		const xy1 = commandBuffer.words[wordStart + 3];
		const color2 = commandBuffer.words[wordStart + 4];
		const xy2 = commandBuffer.words[wordStart + 5];
		drawGxGpuSoftwareTriangle(commandBuffer, commandIndex, dx + gxGpuSigned11(xy0), dy + gxGpuVertexY(xy0), color0, dx + gxGpuSigned11(xy1), dy + gxGpuVertexY(xy1), color1, dx + gxGpuSigned11(xy2), dy + gxGpuVertexY(xy2), color2, ditherEnabled);
		if (gxGpuCommandQuadPolygon(opcode)) {
			const color3 = commandBuffer.words[wordStart + 6];
			const xy3 = commandBuffer.words[wordStart + 7];
			drawGxGpuSoftwareTriangle(commandBuffer, commandIndex, dx + gxGpuSigned11(xy2), dy + gxGpuVertexY(xy2), color2, dx + gxGpuSigned11(xy1), dy + gxGpuVertexY(xy1), color1, dx + gxGpuSigned11(xy3), dy + gxGpuVertexY(xy3), color3, ditherEnabled);
		}
		return;
	}

	const color = commandBuffer.words[wordStart];
	const xy0 = commandBuffer.words[wordStart + 1];
	const xy1 = commandBuffer.words[wordStart + 2];
	const xy2 = commandBuffer.words[wordStart + 3];
	drawGxGpuSoftwareTriangle(commandBuffer, commandIndex, dx + gxGpuSigned11(xy0), dy + gxGpuVertexY(xy0), color, dx + gxGpuSigned11(xy1), dy + gxGpuVertexY(xy1), color, dx + gxGpuSigned11(xy2), dy + gxGpuVertexY(xy2), color, ditherEnabled);
	if (gxGpuCommandQuadPolygon(opcode)) {
		const xy3 = commandBuffer.words[wordStart + 4];
		drawGxGpuSoftwareTriangle(commandBuffer, commandIndex, dx + gxGpuSigned11(xy2), dy + gxGpuVertexY(xy2), color, dx + gxGpuSigned11(xy1), dy + gxGpuVertexY(xy1), color, dx + gxGpuSigned11(xy3), dy + gxGpuVertexY(xy3), color, ditherEnabled);
	}
}

function executeDrawRectangle(commandBuffer: GxGpuCommandBufferView, commandIndex: number): void {
	const opcode = commandBuffer.commandOpcode[commandIndex];
	const drawModeWord = commandBuffer.commandDrawModeWord[commandIndex];
	const wordStart = commandBuffer.commandWordStart[commandIndex];
	const colorWord = commandBuffer.words[wordStart];
	const xyWord = commandBuffer.words[wordStart + 1];
	const sizeWord = commandBuffer.words[wordStart + commandBuffer.commandWordCount[commandIndex] - 1];
	const width = gxGpuCommandRectangleWidth(opcode, sizeWord);
	const height = gxGpuCommandRectangleHeight(opcode, sizeWord);
	const drawingOffsetWord = commandBuffer.commandDrawingOffsetWord[commandIndex];
	const x = gxGpuSigned11(drawingOffsetWord) + gxGpuSigned11(xyWord);
	const y = gxGpuDrawingOffsetY(drawingOffsetWord) + gxGpuVertexY(xyWord);
	if (gxGpuCommandDrawsTexture(opcode, drawModeWord)) {
		drawGxGpuSoftwareTexturedRectangle(commandBuffer, commandIndex, x, y, width, height, colorWord, commandBuffer.words[wordStart + 2]);
		return;
	}
	drawGxGpuSoftwareRectangle(commandBuffer, commandIndex, x, y, width, height, colorWord);
}

function executeDrawLine(commandBuffer: GxGpuCommandBufferView, commandIndex: number): void {
	const opcode = commandBuffer.commandOpcode[commandIndex];
	const wordStart = commandBuffer.commandWordStart[commandIndex];
	const drawingOffsetWord = commandBuffer.commandDrawingOffsetWord[commandIndex];
	const dx = gxGpuSigned11(drawingOffsetWord);
	const dy = gxGpuDrawingOffsetY(drawingOffsetWord);
	const color0 = commandBuffer.words[wordStart];
	const xy0 = commandBuffer.words[wordStart + 1];
	if (gxGpuCommandGouraud(opcode)) {
		const color1 = commandBuffer.words[wordStart + 2];
		const xy1 = commandBuffer.words[wordStart + 3];
		drawGxGpuSoftwareLineSegment(commandBuffer, commandIndex, dx + gxGpuSigned11(xy0), dy + gxGpuVertexY(xy0), color0, dx + gxGpuSigned11(xy1), dy + gxGpuVertexY(xy1), color1);
		return;
	}
	const xy1 = commandBuffer.words[wordStart + 2];
	drawGxGpuSoftwareLineSegment(commandBuffer, commandIndex, dx + gxGpuSigned11(xy0), dy + gxGpuVertexY(xy0), color0, dx + gxGpuSigned11(xy1), dy + gxGpuVertexY(xy1), color0);
}

function executeDrawPolyline(commandBuffer: GxGpuCommandBufferView, commandIndex: number): void {
	const opcode = commandBuffer.commandOpcode[commandIndex];
	const wordStart = commandBuffer.commandWordStart[commandIndex];
	const wordEnd = wordStart + commandBuffer.commandWordCount[commandIndex];
	const drawingOffsetWord = commandBuffer.commandDrawingOffsetWord[commandIndex];
	const dx = gxGpuSigned11(drawingOffsetWord);
	const dy = gxGpuDrawingOffsetY(drawingOffsetWord);
	if (gxGpuCommandGouraud(opcode)) {
		let color0 = commandBuffer.words[wordStart];
		let xy0 = commandBuffer.words[wordStart + 1];
		for (let wordIndex = wordStart + 2; wordIndex + 1 < wordEnd; wordIndex += 2) {
			const color1 = commandBuffer.words[wordIndex];
			const xy1 = commandBuffer.words[wordIndex + 1];
			drawGxGpuSoftwareLineSegment(commandBuffer, commandIndex, dx + gxGpuSigned11(xy0), dy + gxGpuVertexY(xy0), color0, dx + gxGpuSigned11(xy1), dy + gxGpuVertexY(xy1), color1);
			color0 = color1;
			xy0 = xy1;
		}
		return;
	}
	const color = commandBuffer.words[wordStart];
	let xy0 = commandBuffer.words[wordStart + 1];
	for (let wordIndex = wordStart + 2; wordIndex < wordEnd; wordIndex += 1) {
		const xy1 = commandBuffer.words[wordIndex];
		drawGxGpuSoftwareLineSegment(commandBuffer, commandIndex, dx + gxGpuSigned11(xy0), dy + gxGpuVertexY(xy0), color, dx + gxGpuSigned11(xy1), dy + gxGpuVertexY(xy1), color);
		xy0 = xy1;
	}
}

export function executeGxGpuSoftwareCommands(commandBuffer: GxGpuCommandBufferView, processedCommandCount: number): number {
	const presentCommandCount = commandBuffer.presentCommandCount;
	for (let commandIndex = processedCommandCount; commandIndex < presentCommandCount; commandIndex += 1) {
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
	return presentCommandCount;
}
