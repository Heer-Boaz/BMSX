import {
	gxGpuTransferHeight,
	gxGpuTransferWidth,
	gxGpuSigned11,
} from '../../../spec/gx/gp0';
import {
	GX_GPU_COMMAND_COPY_VRAM_TO_VRAM,
	GX_GPU_COMMAND_DRAW_LINE,
	GX_GPU_COMMAND_DRAW_POLYGON,
	GX_GPU_COMMAND_DRAW_POLYLINE,
	GX_GPU_COMMAND_DRAW_RECTANGLE,
	GX_GPU_COMMAND_FILL_RECTANGLE,
	GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM,
	type GxGpuCommandBufferView,
} from '../../../machine/devices/gx/gpu_command_buffer';
import {
	gxGpuCommandRectangleHeight,
	gxGpuCommandRectangleWidth,
	gxGpuCommandTextureEnabled,
	gxGpuDitheredPolygon,
	gxGpuDrawingOffsetY,
	gxGpuFillHeight,
	gxGpuFillWidth,
	gxGpuFillX,
	gxGpuMaskBitCheckBeforeDraw,
	gxGpuMaskBitSetWhileDrawing,
	gxGpuTransferEmittedPixelCount,
	gxGpuTransferPixelWord,
	gxGpuTransferX,
	gxGpuTransferY,
	gxGpuTextureU,
	gxGpuTextureV,
	gxGpuVertexY,
} from '../gx_gpu_render_rules';
import { GX_GPU_VRAM_X_ADDRESS_PERIOD, gxGpuVramYAddress } from '../../../spec/gx/vram';
import {
	gxGpuSoftwareRgb888WordToRgb555,
	gxGpuSoftwareVramIndex,
	gxGpuSoftwareWriteMaskedVramWord,
} from './gx_gpu_vram';
import type { GxGpuSoftwareState } from './gx_gpu_state';

import {
	drawGxGpuSoftwareLineSegment,
	drawGxGpuSoftwareRectangle,
	drawGxGpuSoftwareTexturedRectangle,
	drawGxGpuSoftwareTexturedTriangle,
	drawGxGpuSoftwareTriangle,
} from './gx_gpu_rasterizer';

function executeFillRectangle(software: GxGpuSoftwareState, commandBuffer: GxGpuCommandBufferView, commandIndex: number): void {
	const wordStart = commandBuffer.commandWordStart[commandIndex];
	const colorWord = gxGpuSoftwareRgb888WordToRgb555(commandBuffer.words[wordStart]);
	const xyWord = commandBuffer.words[wordStart + 1];
	const sizeWord = commandBuffer.words[wordStart + 2];
	const vramYAddressExtensionWord = commandBuffer.commandVramYAddressExtensionWord[commandIndex];
	const x = gxGpuFillX(xyWord);
	const y = gxGpuTransferY(xyWord, vramYAddressExtensionWord);
	const width = gxGpuFillWidth(sizeWord);
	const height = gxGpuFillHeight(sizeWord);
	const skippedLineParity = commandBuffer.commandSkippedLineParity[commandIndex];
	for (let row = 0; row < height; row += 1) {
		const targetY = gxGpuVramYAddress(y + row, vramYAddressExtensionWord);
		if ((targetY & 1) === skippedLineParity) {
			continue;
		}
		for (let column = 0; column < width; column += 1) {
			software.vram[gxGpuSoftwareVramIndex(software, x + column, targetY)] = colorWord;
		}
	}
}

function executeCpuToVram(software: GxGpuSoftwareState, commandBuffer: GxGpuCommandBufferView, commandIndex: number): void {
	const wordStart = commandBuffer.commandWordStart[commandIndex];
	const xyWord = commandBuffer.words[wordStart + 1];
	const sizeWord = commandBuffer.words[wordStart + 2];
	const vramYAddressExtensionWord = commandBuffer.commandVramYAddressExtensionWord[commandIndex];
	const x = gxGpuTransferX(xyWord);
	const y = gxGpuTransferY(xyWord, vramYAddressExtensionWord);
	const width = gxGpuTransferWidth(sizeWord);
	const height = gxGpuTransferHeight(sizeWord);
	const emittedPixels = gxGpuTransferEmittedPixelCount(width, height, commandBuffer.commandWordCount[commandIndex]);
	const payloadWordStart = wordStart + 3;
	const maskBitModeWord = commandBuffer.commandMaskBitModeWord[commandIndex];
	const checkMaskBit = gxGpuMaskBitCheckBeforeDraw(maskBitModeWord);
	const setMaskBit = gxGpuMaskBitSetWhileDrawing(maskBitModeWord);
	let emittedPixel = 0;
	for (let row = 0; row < height && emittedPixel < emittedPixels; row += 1) {
		const rowRemaining = emittedPixels - emittedPixel;
		const rowWidth = rowRemaining < width ? rowRemaining : width;
		const targetY = gxGpuVramYAddress(y + row, vramYAddressExtensionWord);
		if (!checkMaskBit && !setMaskBit) {
			// The raw halfwords already have payload order; odd rows do not pad.
			const first = Math.min(rowWidth, GX_GPU_VRAM_X_ADDRESS_PERIOD - x);
			const target = gxGpuSoftwareVramIndex(software, x, targetY);
			const source = (payloadWordStart << 1) + emittedPixel;
			const pixels = commandBuffer.wordHalves;
			const vram = software.vram;
			for (let column = 0; column < first; column += 1) {
				vram[target + column] = pixels[source + column];
			}
			const wrappedTarget = target - x;
			for (let column = first; column < rowWidth; column += 1) {
				vram[wrappedTarget + column - first] = pixels[source + column];
			}
			emittedPixel += rowWidth;
			continue;
		}
		for (let column = 0; column < rowWidth; column += 1) {
			const payloadWord = commandBuffer.words[payloadWordStart + (emittedPixel >>> 1)];
			gxGpuSoftwareWriteMaskedVramWord(software, gxGpuSoftwareVramIndex(software, x + column, targetY), gxGpuTransferPixelWord(payloadWord, emittedPixel), checkMaskBit, setMaskBit);
			emittedPixel += 1;
		}
	}
}

function copyVramArea(software: GxGpuSoftwareState, sourceX: number, sourceY: number, targetX: number, targetY: number, width: number, height: number, maskBitModeWord: number, vramYAddressExtensionWord: number): void {
	const checkMaskBit = gxGpuMaskBitCheckBeforeDraw(maskBitModeWord);
	const setMaskBit = gxGpuMaskBitSetWhileDrawing(maskBitModeWord);
	const xAddressMask = GX_GPU_VRAM_X_ADDRESS_PERIOD - 1;
	const forwardDistance = (targetX - sourceX) & xAddressMask;
	const copyBackwards = forwardDistance !== 0 && forwardDistance < width;
	const firstColumn = copyBackwards ? width - 1 : 0;
	const lastColumn = copyBackwards ? -1 : width;
	const columnStep = copyBackwards ? -1 : 1;
	for (let row = 0; row < height; row += 1) {
		const rowSourceY = gxGpuVramYAddress(sourceY + row, vramYAddressExtensionWord);
		const rowTargetY = gxGpuVramYAddress(targetY + row, vramYAddressExtensionWord);
		for (let column = firstColumn; column !== lastColumn; column += columnStep) {
			const sourceWord = software.vram[gxGpuSoftwareVramIndex(software, sourceX + column, rowSourceY)];
			gxGpuSoftwareWriteMaskedVramWord(software, gxGpuSoftwareVramIndex(software, targetX + column, rowTargetY), sourceWord, checkMaskBit, setMaskBit);
		}
	}
}

function executeVramToVram(software: GxGpuSoftwareState, commandBuffer: GxGpuCommandBufferView, commandIndex: number): void {
	const wordStart = commandBuffer.commandWordStart[commandIndex];
	const sourceWord = commandBuffer.words[wordStart + 1];
	const targetWord = commandBuffer.words[wordStart + 2];
	const sizeWord = commandBuffer.words[wordStart + 3];
	const vramYAddressExtensionWord = commandBuffer.commandVramYAddressExtensionWord[commandIndex];
	copyVramArea(
		software,
		gxGpuTransferX(sourceWord),
		gxGpuTransferY(sourceWord, vramYAddressExtensionWord),
		gxGpuTransferX(targetWord),
		gxGpuTransferY(targetWord, vramYAddressExtensionWord),
		gxGpuTransferWidth(sizeWord),
		gxGpuTransferHeight(sizeWord),
		commandBuffer.commandMaskBitModeWord[commandIndex],
		vramYAddressExtensionWord,
	);
}

function executeDrawPolygon(software: GxGpuSoftwareState, commandBuffer: GxGpuCommandBufferView, commandIndex: number): void {
	const opcode = commandBuffer.commandOpcode[commandIndex];
	const drawModeWord = commandBuffer.commandDrawModeWord[commandIndex];
	const wordStart = commandBuffer.commandWordStart[commandIndex];
	const drawingOffsetWord = commandBuffer.commandDrawingOffsetWord[commandIndex];
	const dx = gxGpuSigned11(drawingOffsetWord);
	const dy = gxGpuDrawingOffsetY(drawingOffsetWord);
	const ditherEnabled = gxGpuDitheredPolygon(drawModeWord, opcode);
	const record = commandBuffer.commandDrawIndex[commandIndex];
	const positionStride = commandBuffer.drawPositionStride[record];
	const colorStride = commandBuffer.drawColorStride[record];
	const xy0 = commandBuffer.words[wordStart + 1];
	const xy1 = commandBuffer.words[wordStart + 1 + positionStride];
	const xy2 = commandBuffer.words[wordStart + 1 + positionStride * 2];
	const color0 = commandBuffer.words[wordStart];
	const color1 = commandBuffer.words[wordStart + colorStride];
	const color2 = commandBuffer.words[wordStart + colorStride * 2];
	if (gxGpuCommandTextureEnabled(opcode)) {
		const texture0 = commandBuffer.words[wordStart + 2];
		const texture1 = commandBuffer.words[wordStart + 2 + positionStride];
		const texture2 = commandBuffer.words[wordStart + 2 + positionStride * 2];
		drawGxGpuSoftwareTexturedTriangle(software, commandBuffer, commandIndex, dx + gxGpuSigned11(xy0), dy + gxGpuVertexY(xy0), color0, gxGpuTextureU(texture0), gxGpuTextureV(texture0), dx + gxGpuSigned11(xy1), dy + gxGpuVertexY(xy1), color1, gxGpuTextureU(texture1), gxGpuTextureV(texture1), dx + gxGpuSigned11(xy2), dy + gxGpuVertexY(xy2), color2, gxGpuTextureU(texture2), gxGpuTextureV(texture2), ditherEnabled);
		if (commandBuffer.drawVertexCount[record] === 4) {
			const xy3 = commandBuffer.words[wordStart + 1 + positionStride * 3];
			const color3 = commandBuffer.words[wordStart + colorStride * 3];
			const texture3 = commandBuffer.words[wordStart + 2 + positionStride * 3];
			drawGxGpuSoftwareTexturedTriangle(software, commandBuffer, commandIndex, dx + gxGpuSigned11(xy2), dy + gxGpuVertexY(xy2), color2, gxGpuTextureU(texture2), gxGpuTextureV(texture2), dx + gxGpuSigned11(xy1), dy + gxGpuVertexY(xy1), color1, gxGpuTextureU(texture1), gxGpuTextureV(texture1), dx + gxGpuSigned11(xy3), dy + gxGpuVertexY(xy3), color3, gxGpuTextureU(texture3), gxGpuTextureV(texture3), ditherEnabled);
		}
		return;
	}
	drawGxGpuSoftwareTriangle(software, commandBuffer, commandIndex, dx + gxGpuSigned11(xy0), dy + gxGpuVertexY(xy0), color0, dx + gxGpuSigned11(xy1), dy + gxGpuVertexY(xy1), color1, dx + gxGpuSigned11(xy2), dy + gxGpuVertexY(xy2), color2, ditherEnabled);
	if (commandBuffer.drawVertexCount[record] === 4) {
		const xy3 = commandBuffer.words[wordStart + 1 + positionStride * 3];
		const color3 = commandBuffer.words[wordStart + colorStride * 3];
		drawGxGpuSoftwareTriangle(software, commandBuffer, commandIndex, dx + gxGpuSigned11(xy2), dy + gxGpuVertexY(xy2), color2, dx + gxGpuSigned11(xy1), dy + gxGpuVertexY(xy1), color1, dx + gxGpuSigned11(xy3), dy + gxGpuVertexY(xy3), color3, ditherEnabled);
	}
}

function executeDrawRectangle(software: GxGpuSoftwareState, commandBuffer: GxGpuCommandBufferView, commandIndex: number): void {
	const opcode = commandBuffer.commandOpcode[commandIndex];
	const wordStart = commandBuffer.commandWordStart[commandIndex];
	const colorWord = commandBuffer.words[wordStart];
	const xyWord = commandBuffer.words[wordStart + 1];
	const sizeWord = commandBuffer.words[wordStart + commandBuffer.drawSizeOffset[commandBuffer.commandDrawIndex[commandIndex]]];
	const width = gxGpuCommandRectangleWidth(opcode, sizeWord);
	const height = gxGpuCommandRectangleHeight(opcode, sizeWord);
	const drawingOffsetWord = commandBuffer.commandDrawingOffsetWord[commandIndex];
	const x = gxGpuSigned11(gxGpuSigned11(drawingOffsetWord) + gxGpuSigned11(xyWord));
	const y = gxGpuSigned11(gxGpuDrawingOffsetY(drawingOffsetWord) + gxGpuVertexY(xyWord));
	if (gxGpuCommandTextureEnabled(opcode)) {
		drawGxGpuSoftwareTexturedRectangle(software, commandBuffer, commandIndex, x, y, width, height, colorWord, commandBuffer.words[wordStart + 2]);
		return;
	}
	drawGxGpuSoftwareRectangle(software, commandBuffer, commandIndex, x, y, width, height, colorWord);
}

function executeDrawLine(software: GxGpuSoftwareState, commandBuffer: GxGpuCommandBufferView, commandIndex: number): void {
	const wordStart = commandBuffer.commandWordStart[commandIndex];
	const record = commandBuffer.commandDrawIndex[commandIndex];
	const positionStride = commandBuffer.drawPositionStride[record];
	const colorStride = commandBuffer.drawColorStride[record];
	const drawingOffsetWord = commandBuffer.commandDrawingOffsetWord[commandIndex];
	const dx = gxGpuSigned11(drawingOffsetWord);
	const dy = gxGpuDrawingOffsetY(drawingOffsetWord);
	const color0 = commandBuffer.words[wordStart];
	const xy0 = commandBuffer.words[wordStart + 1];
	const color1 = commandBuffer.words[wordStart + colorStride];
	const xy1 = commandBuffer.words[wordStart + 1 + positionStride];
	drawGxGpuSoftwareLineSegment(software, commandBuffer, commandIndex, dx + gxGpuSigned11(xy0), dy + gxGpuVertexY(xy0), color0, dx + gxGpuSigned11(xy1), dy + gxGpuVertexY(xy1), color1);
}

function executeDrawPolyline(software: GxGpuSoftwareState, commandBuffer: GxGpuCommandBufferView, commandIndex: number): void {
	const wordStart = commandBuffer.commandWordStart[commandIndex];
	const record = commandBuffer.commandDrawIndex[commandIndex];
	const positionStride = commandBuffer.drawPositionStride[record];
	const colorStride = commandBuffer.drawColorStride[record];
	const drawingOffsetWord = commandBuffer.commandDrawingOffsetWord[commandIndex];
	const dx = gxGpuSigned11(drawingOffsetWord);
	const dy = gxGpuDrawingOffsetY(drawingOffsetWord);
	let color0 = commandBuffer.words[wordStart];
	let xy0 = commandBuffer.words[wordStart + 1];
	for (let vertex = 1; vertex < commandBuffer.drawVertexCount[record]; vertex += 1) {
		const color1 = commandBuffer.words[wordStart + vertex * colorStride];
		const xy1 = commandBuffer.words[wordStart + 1 + vertex * positionStride];
		drawGxGpuSoftwareLineSegment(software, commandBuffer, commandIndex, dx + gxGpuSigned11(xy0), dy + gxGpuVertexY(xy0), color0, dx + gxGpuSigned11(xy1), dy + gxGpuVertexY(xy1), color1);
		color0 = color1;
		xy0 = xy1;
	}
}

export function executeGxGpuSoftwareCommands(software: GxGpuSoftwareState, commandBuffer: GxGpuCommandBufferView, processedCommandCount: number, commandLimit: number): number {
	for (let commandIndex = processedCommandCount; commandIndex < commandLimit; commandIndex += 1) {
		switch (commandBuffer.commandKind[commandIndex]) {
			case GX_GPU_COMMAND_DRAW_POLYGON:
				executeDrawPolygon(software, commandBuffer, commandIndex);
				break;
			case GX_GPU_COMMAND_DRAW_LINE:
				executeDrawLine(software, commandBuffer, commandIndex);
				break;
			case GX_GPU_COMMAND_DRAW_POLYLINE:
				executeDrawPolyline(software, commandBuffer, commandIndex);
				break;
			case GX_GPU_COMMAND_DRAW_RECTANGLE:
				executeDrawRectangle(software, commandBuffer, commandIndex);
				break;
			case GX_GPU_COMMAND_FILL_RECTANGLE:
				executeFillRectangle(software, commandBuffer, commandIndex);
				break;
			case GX_GPU_COMMAND_COPY_VRAM_TO_VRAM:
				executeVramToVram(software, commandBuffer, commandIndex);
				break;
			case GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM:
				executeCpuToVram(software, commandBuffer, commandIndex);
				break;
		}
	}
	return processedCommandCount < commandLimit ? commandLimit : processedCommandCount;
}
