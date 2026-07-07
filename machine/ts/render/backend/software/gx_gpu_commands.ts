import {
	GX_GPU_COMMAND_COPY_VRAM_TO_VRAM,
	GX_GPU_COMMAND_DRAW_LINE,
	GX_GPU_COMMAND_DRAW_POLYGON,
	GX_GPU_COMMAND_DRAW_POLYLINE,
	GX_GPU_COMMAND_DRAW_RECTANGLE,
	GX_GPU_COMMAND_FILL_RECTANGLE,
	GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM,
	GX_GPU_VRAM_HEIGHT,
	gxGpuCommandDrawsTexture,
	gxGpuCommandGouraud,
	gxGpuCommandQuadPolygon,
	gxGpuCommandRectangleHeight,
	gxGpuCommandRectangleWidth,
	gxGpuCommandSemiTransparencyEnabled,
	gxGpuCommandTextureEnabled,
	gxGpuDitheredPolygon,
	gxGpuDrawingAreaBottomExclusive,
	gxGpuDrawingAreaLeft,
	gxGpuDrawingAreaRightExclusive,
	gxGpuDrawingAreaTop,
	gxGpuDrawingOffsetX,
	gxGpuDrawingOffsetY,
	gxGpuDrawModeDitherEnabled,
	gxGpuDrawModeTransparencyMode,
	gxGpuFillHeight,
	gxGpuFillWidth,
	gxGpuFillX,
	gxGpuSegmentExceedsPrimitiveSize,
	gxGpuTransferEmittedPixelCount,
	gxGpuTransferHeight,
	gxGpuTransferPixelWord,
	gxGpuTransferWidth,
	gxGpuTransferX,
	gxGpuTransferY,
	gxGpuTriangleExceedsPrimitiveSize,
	gxGpuVertexX,
	gxGpuVertexY,
	type GxGpuCommandBufferView,
} from '../../../machine/devices/gx/gpu_command_buffer';
import {
	GX_GPU_SOFTWARE_VRAM_WORDS,
	gxGpuSoftwareInterlacedSkipsLine,
	gxGpuSoftwareRgb888WordToRgb555,
	gxGpuSoftwareVram,
	gxGpuSoftwareVramIndex,
	gxGpuSoftwareWriteMaskedVramWord,
	gxGpuSoftwareWriteRenderVramPixel,
} from './gx_gpu_vram';

const gxGpuSoftwareCopyScratch = new Uint16Array(GX_GPU_SOFTWARE_VRAM_WORDS);

function integerDivide(numerator: number, denominator: number): number {
	return (numerator - (numerator % denominator)) / denominator;
}

function edgeValue(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
	return (cx - ax) * (by - ay) - (cy - ay) * (bx - ax);
}

function colorR8(colorWord: number): number {
	return colorWord & 0xff;
}

function colorG8(colorWord: number): number {
	return (colorWord >>> 8) & 0xff;
}

function colorB8(colorWord: number): number {
	return (colorWord >>> 16) & 0xff;
}

function absI32(value: number): number {
	return value < 0 ? -value : value;
}

function roundDivideSigned(numerator: number, denominator: number): number {
	return numerator < 0
		? -integerDivide(-numerator + (denominator >>> 1), denominator)
		: integerDivide(numerator + (denominator >>> 1), denominator);
}

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

function drawSoftwareRectangle(commandBuffer: GxGpuCommandBufferView, commandIndex: number, x0: number, y0: number, width: number, height: number, colorWord: number): void {
	const topLeftWord = commandBuffer.commandDrawingAreaTopLeftWord[commandIndex];
	const bottomRightWord = commandBuffer.commandDrawingAreaBottomRightWord[commandIndex];
	const areaLeft = gxGpuDrawingAreaLeft(topLeftWord, bottomRightWord);
	const areaTop = gxGpuDrawingAreaTop(topLeftWord, bottomRightWord);
	const areaRight = gxGpuDrawingAreaRightExclusive(topLeftWord, bottomRightWord);
	const areaBottom = gxGpuDrawingAreaBottomExclusive(topLeftWord, bottomRightWord);
	const left = x0 > areaLeft ? x0 : areaLeft;
	const top = y0 > areaTop ? y0 : areaTop;
	const rectangleRight = x0 + width;
	const rectangleBottom = y0 + height;
	const right = rectangleRight < areaRight ? rectangleRight : areaRight;
	const bottom = rectangleBottom < areaBottom ? rectangleBottom : areaBottom;
	const opcode = commandBuffer.commandOpcode[commandIndex];
	const drawModeWord = commandBuffer.commandDrawModeWord[commandIndex];
	const blendEnabled = gxGpuCommandSemiTransparencyEnabled(opcode);
	const blendMode = gxGpuDrawModeTransparencyMode(drawModeWord);
	const maskBitModeWord = commandBuffer.commandMaskBitModeWord[commandIndex];
	const interlacedRenderWord = commandBuffer.commandInterlacedRenderWord[commandIndex];
	const r8 = colorR8(colorWord);
	const g8 = colorG8(colorWord);
	const b8 = colorB8(colorWord);
	for (let y = top; y < bottom; y += 1) {
		if (gxGpuSoftwareInterlacedSkipsLine(y, interlacedRenderWord)) {
			continue;
		}
		for (let x = left; x < right; x += 1) {
			gxGpuSoftwareWriteRenderVramPixel(x, y, r8, g8, b8, false, blendEnabled, blendMode, maskBitModeWord);
		}
	}
}

function drawSoftwareTriangle(
	commandBuffer: GxGpuCommandBufferView,
	commandIndex: number,
	x0: number,
	y0: number,
	color0: number,
	x1: number,
	y1: number,
	color1: number,
	x2: number,
	y2: number,
	color2: number,
	ditherEnabled: boolean,
): void {
	if (gxGpuTriangleExceedsPrimitiveSize(x0, y0, x1, y1, x2, y2)) {
		return;
	}
	let area = edgeValue(x0, y0, x1, y1, x2, y2);
	if (area === 0) {
		return;
	}
	const topLeftWord = commandBuffer.commandDrawingAreaTopLeftWord[commandIndex];
	const bottomRightWord = commandBuffer.commandDrawingAreaBottomRightWord[commandIndex];
	const areaLeft = gxGpuDrawingAreaLeft(topLeftWord, bottomRightWord);
	const areaTop = gxGpuDrawingAreaTop(topLeftWord, bottomRightWord);
	const areaRight = gxGpuDrawingAreaRightExclusive(topLeftWord, bottomRightWord);
	const areaBottom = gxGpuDrawingAreaBottomExclusive(topLeftWord, bottomRightWord);
	const min12x = x1 < x2 ? x1 : x2;
	const max12x = x1 > x2 ? x1 : x2;
	const min12y = y1 < y2 ? y1 : y2;
	const max12y = y1 > y2 ? y1 : y2;
	let left = x0 < min12x ? x0 : min12x;
	let right = x0 > max12x ? x0 : max12x;
	let top = y0 < min12y ? y0 : min12y;
	let bottom = y0 > max12y ? y0 : max12y;
	left = left > areaLeft ? left : areaLeft;
	top = top > areaTop ? top : areaTop;
	const areaRightInclusive = areaRight - 1;
	const areaBottomInclusive = areaBottom - 1;
	right = right < areaRightInclusive ? right : areaRightInclusive;
	bottom = bottom < areaBottomInclusive ? bottom : areaBottomInclusive;
	const flip = area < 0;
	if (flip) {
		area = -area;
	}
	const r0 = colorR8(color0);
	const g0 = colorG8(color0);
	const b0 = colorB8(color0);
	const r1 = colorR8(color1);
	const g1 = colorG8(color1);
	const b1 = colorB8(color1);
	const r2 = colorR8(color2);
	const g2 = colorG8(color2);
	const b2 = colorB8(color2);
	const sameColor = color0 === color1 && color0 === color2;
	const opcode = commandBuffer.commandOpcode[commandIndex];
	const drawModeWord = commandBuffer.commandDrawModeWord[commandIndex];
	const blendEnabled = gxGpuCommandSemiTransparencyEnabled(opcode);
	const blendMode = gxGpuDrawModeTransparencyMode(drawModeWord);
	const maskBitModeWord = commandBuffer.commandMaskBitModeWord[commandIndex];
	const interlacedRenderWord = commandBuffer.commandInterlacedRenderWord[commandIndex];
	for (let y = top; y <= bottom; y += 1) {
		if (gxGpuSoftwareInterlacedSkipsLine(y, interlacedRenderWord)) {
			continue;
		}
		for (let x = left; x <= right; x += 1) {
			let w0 = edgeValue(x1, y1, x2, y2, x, y);
			let w1 = edgeValue(x2, y2, x0, y0, x, y);
			let w2 = edgeValue(x0, y0, x1, y1, x, y);
			if (flip) {
				w0 = -w0;
				w1 = -w1;
				w2 = -w2;
			}
			if (w0 >= 0 && w1 >= 0 && w2 >= 0) {
				const r8 = sameColor ? r0 : integerDivide((r0 * w0) + (r1 * w1) + (r2 * w2), area);
				const g8 = sameColor ? g0 : integerDivide((g0 * w0) + (g1 * w1) + (g2 * w2), area);
				const b8 = sameColor ? b0 : integerDivide((b0 * w0) + (b1 * w1) + (b2 * w2), area);
				gxGpuSoftwareWriteRenderVramPixel(x, y, r8, g8, b8, ditherEnabled, blendEnabled, blendMode, maskBitModeWord);
			}
		}
	}
}

function drawSoftwareLineSegment(commandBuffer: GxGpuCommandBufferView, commandIndex: number, x0: number, y0: number, color0: number, x1: number, y1: number, color1: number): void {
	if (gxGpuSegmentExceedsPrimitiveSize(x0, y0, x1, y1)) {
		return;
	}
	const topLeftWord = commandBuffer.commandDrawingAreaTopLeftWord[commandIndex];
	const bottomRightWord = commandBuffer.commandDrawingAreaBottomRightWord[commandIndex];
	const areaLeft = gxGpuDrawingAreaLeft(topLeftWord, bottomRightWord);
	const areaTop = gxGpuDrawingAreaTop(topLeftWord, bottomRightWord);
	const areaRight = gxGpuDrawingAreaRightExclusive(topLeftWord, bottomRightWord);
	const areaBottom = gxGpuDrawingAreaBottomExclusive(topLeftWord, bottomRightWord);
	const dx = x1 - x0;
	const dy = y1 - y0;
	const absDx = absI32(dx);
	const absDy = absI32(dy);
	const steps = absDx >= absDy ? absDx : absDy;
	const opcode = commandBuffer.commandOpcode[commandIndex];
	const drawModeWord = commandBuffer.commandDrawModeWord[commandIndex];
	const blendEnabled = gxGpuCommandSemiTransparencyEnabled(opcode);
	const blendMode = gxGpuDrawModeTransparencyMode(drawModeWord);
	const ditherEnabled = gxGpuDrawModeDitherEnabled(drawModeWord);
	const maskBitModeWord = commandBuffer.commandMaskBitModeWord[commandIndex];
	const interlacedRenderWord = commandBuffer.commandInterlacedRenderWord[commandIndex];
	const r0 = colorR8(color0);
	const g0 = colorG8(color0);
	const b0 = colorB8(color0);
	const dr = colorR8(color1) - r0;
	const dg = colorG8(color1) - g0;
	const db = colorB8(color1) - b0;
	if (steps === 0) {
		if (x0 >= areaLeft && y0 >= areaTop && x0 < areaRight && y0 < areaBottom && !gxGpuSoftwareInterlacedSkipsLine(y0, interlacedRenderWord)) {
			gxGpuSoftwareWriteRenderVramPixel(x0, y0, r0, g0, b0, ditherEnabled, blendEnabled, blendMode, maskBitModeWord);
		}
		return;
	}
	for (let step = 0; step <= steps; step += 1) {
		const x = x0 + roundDivideSigned(dx * step, steps);
		const y = y0 + roundDivideSigned(dy * step, steps);
		if (x >= areaLeft && y >= areaTop && x < areaRight && y < areaBottom && !gxGpuSoftwareInterlacedSkipsLine(y, interlacedRenderWord)) {
			const r8 = r0 + roundDivideSigned(dr * step, steps);
			const g8 = g0 + roundDivideSigned(dg * step, steps);
			const b8 = b0 + roundDivideSigned(db * step, steps);
			gxGpuSoftwareWriteRenderVramPixel(x, y, r8, g8, b8, ditherEnabled, blendEnabled, blendMode, maskBitModeWord);
		}
	}
}

function executeDrawPolygon(commandBuffer: GxGpuCommandBufferView, commandIndex: number): void {
	const opcode = commandBuffer.commandOpcode[commandIndex];
	const drawModeWord = commandBuffer.commandDrawModeWord[commandIndex];
	if (gxGpuCommandDrawsTexture(opcode, drawModeWord)) {
		return;
	}
	const wordStart = commandBuffer.commandWordStart[commandIndex];
	const drawingOffsetWord = commandBuffer.commandDrawingOffsetWord[commandIndex];
	const dx = gxGpuDrawingOffsetX(drawingOffsetWord);
	const dy = gxGpuDrawingOffsetY(drawingOffsetWord);
	const ditherEnabled = gxGpuDitheredPolygon(drawModeWord, opcode);
	const gouraud = gxGpuCommandGouraud(opcode);
	if (gxGpuCommandTextureEnabled(opcode)) {
		if (gouraud) {
			const color0 = commandBuffer.words[wordStart];
			const xy0 = commandBuffer.words[wordStart + 1];
			const color1 = commandBuffer.words[wordStart + 3];
			const xy1 = commandBuffer.words[wordStart + 4];
			const color2 = commandBuffer.words[wordStart + 6];
			const xy2 = commandBuffer.words[wordStart + 7];
			drawSoftwareTriangle(commandBuffer, commandIndex, dx + gxGpuVertexX(xy0), dy + gxGpuVertexY(xy0), color0, dx + gxGpuVertexX(xy1), dy + gxGpuVertexY(xy1), color1, dx + gxGpuVertexX(xy2), dy + gxGpuVertexY(xy2), color2, ditherEnabled);
			if (gxGpuCommandQuadPolygon(opcode)) {
				const color3 = commandBuffer.words[wordStart + 9];
				const xy3 = commandBuffer.words[wordStart + 10];
				drawSoftwareTriangle(commandBuffer, commandIndex, dx + gxGpuVertexX(xy2), dy + gxGpuVertexY(xy2), color2, dx + gxGpuVertexX(xy1), dy + gxGpuVertexY(xy1), color1, dx + gxGpuVertexX(xy3), dy + gxGpuVertexY(xy3), color3, ditherEnabled);
			}
			return;
		}

		const color = commandBuffer.words[wordStart];
		const xy0 = commandBuffer.words[wordStart + 1];
		const xy1 = commandBuffer.words[wordStart + 3];
		const xy2 = commandBuffer.words[wordStart + 5];
		drawSoftwareTriangle(commandBuffer, commandIndex, dx + gxGpuVertexX(xy0), dy + gxGpuVertexY(xy0), color, dx + gxGpuVertexX(xy1), dy + gxGpuVertexY(xy1), color, dx + gxGpuVertexX(xy2), dy + gxGpuVertexY(xy2), color, ditherEnabled);
		if (gxGpuCommandQuadPolygon(opcode)) {
			const xy3 = commandBuffer.words[wordStart + 7];
			drawSoftwareTriangle(commandBuffer, commandIndex, dx + gxGpuVertexX(xy2), dy + gxGpuVertexY(xy2), color, dx + gxGpuVertexX(xy1), dy + gxGpuVertexY(xy1), color, dx + gxGpuVertexX(xy3), dy + gxGpuVertexY(xy3), color, ditherEnabled);
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
		drawSoftwareTriangle(commandBuffer, commandIndex, dx + gxGpuVertexX(xy0), dy + gxGpuVertexY(xy0), color0, dx + gxGpuVertexX(xy1), dy + gxGpuVertexY(xy1), color1, dx + gxGpuVertexX(xy2), dy + gxGpuVertexY(xy2), color2, ditherEnabled);
		if (gxGpuCommandQuadPolygon(opcode)) {
			const color3 = commandBuffer.words[wordStart + 6];
			const xy3 = commandBuffer.words[wordStart + 7];
			drawSoftwareTriangle(commandBuffer, commandIndex, dx + gxGpuVertexX(xy2), dy + gxGpuVertexY(xy2), color2, dx + gxGpuVertexX(xy1), dy + gxGpuVertexY(xy1), color1, dx + gxGpuVertexX(xy3), dy + gxGpuVertexY(xy3), color3, ditherEnabled);
		}
		return;
	}

	const color = commandBuffer.words[wordStart];
	const xy0 = commandBuffer.words[wordStart + 1];
	const xy1 = commandBuffer.words[wordStart + 2];
	const xy2 = commandBuffer.words[wordStart + 3];
	drawSoftwareTriangle(commandBuffer, commandIndex, dx + gxGpuVertexX(xy0), dy + gxGpuVertexY(xy0), color, dx + gxGpuVertexX(xy1), dy + gxGpuVertexY(xy1), color, dx + gxGpuVertexX(xy2), dy + gxGpuVertexY(xy2), color, ditherEnabled);
	if (gxGpuCommandQuadPolygon(opcode)) {
		const xy3 = commandBuffer.words[wordStart + 4];
		drawSoftwareTriangle(commandBuffer, commandIndex, dx + gxGpuVertexX(xy2), dy + gxGpuVertexY(xy2), color, dx + gxGpuVertexX(xy1), dy + gxGpuVertexY(xy1), color, dx + gxGpuVertexX(xy3), dy + gxGpuVertexY(xy3), color, ditherEnabled);
	}
}

function executeDrawRectangle(commandBuffer: GxGpuCommandBufferView, commandIndex: number): void {
	const opcode = commandBuffer.commandOpcode[commandIndex];
	const drawModeWord = commandBuffer.commandDrawModeWord[commandIndex];
	if (gxGpuCommandDrawsTexture(opcode, drawModeWord)) {
		return;
	}
	const wordStart = commandBuffer.commandWordStart[commandIndex];
	const colorWord = commandBuffer.words[wordStart];
	const xyWord = commandBuffer.words[wordStart + 1];
	const sizeWord = commandBuffer.words[wordStart + commandBuffer.commandWordCount[commandIndex] - 1];
	const width = gxGpuCommandRectangleWidth(opcode, sizeWord);
	const height = gxGpuCommandRectangleHeight(opcode, sizeWord);
	const drawingOffsetWord = commandBuffer.commandDrawingOffsetWord[commandIndex];
	const x = gxGpuDrawingOffsetX(drawingOffsetWord) + gxGpuVertexX(xyWord);
	const y = gxGpuDrawingOffsetY(drawingOffsetWord) + gxGpuVertexY(xyWord);
	drawSoftwareRectangle(commandBuffer, commandIndex, x, y, width, height, colorWord);
}

function executeDrawLine(commandBuffer: GxGpuCommandBufferView, commandIndex: number): void {
	const opcode = commandBuffer.commandOpcode[commandIndex];
	const wordStart = commandBuffer.commandWordStart[commandIndex];
	const drawingOffsetWord = commandBuffer.commandDrawingOffsetWord[commandIndex];
	const dx = gxGpuDrawingOffsetX(drawingOffsetWord);
	const dy = gxGpuDrawingOffsetY(drawingOffsetWord);
	const color0 = commandBuffer.words[wordStart];
	const xy0 = commandBuffer.words[wordStart + 1];
	if (gxGpuCommandGouraud(opcode)) {
		const color1 = commandBuffer.words[wordStart + 2];
		const xy1 = commandBuffer.words[wordStart + 3];
		drawSoftwareLineSegment(commandBuffer, commandIndex, dx + gxGpuVertexX(xy0), dy + gxGpuVertexY(xy0), color0, dx + gxGpuVertexX(xy1), dy + gxGpuVertexY(xy1), color1);
		return;
	}
	const xy1 = commandBuffer.words[wordStart + 2];
	drawSoftwareLineSegment(commandBuffer, commandIndex, dx + gxGpuVertexX(xy0), dy + gxGpuVertexY(xy0), color0, dx + gxGpuVertexX(xy1), dy + gxGpuVertexY(xy1), color0);
}

function executeDrawPolyline(commandBuffer: GxGpuCommandBufferView, commandIndex: number): void {
	const opcode = commandBuffer.commandOpcode[commandIndex];
	const wordStart = commandBuffer.commandWordStart[commandIndex];
	const wordEnd = wordStart + commandBuffer.commandWordCount[commandIndex];
	const drawingOffsetWord = commandBuffer.commandDrawingOffsetWord[commandIndex];
	const dx = gxGpuDrawingOffsetX(drawingOffsetWord);
	const dy = gxGpuDrawingOffsetY(drawingOffsetWord);
	if (gxGpuCommandGouraud(opcode)) {
		let color0 = commandBuffer.words[wordStart];
		let xy0 = commandBuffer.words[wordStart + 1];
		for (let wordIndex = wordStart + 2; wordIndex + 1 < wordEnd; wordIndex += 2) {
			const color1 = commandBuffer.words[wordIndex];
			const xy1 = commandBuffer.words[wordIndex + 1];
			drawSoftwareLineSegment(commandBuffer, commandIndex, dx + gxGpuVertexX(xy0), dy + gxGpuVertexY(xy0), color0, dx + gxGpuVertexX(xy1), dy + gxGpuVertexY(xy1), color1);
			color0 = color1;
			xy0 = xy1;
		}
		return;
	}
	const color = commandBuffer.words[wordStart];
	let xy0 = commandBuffer.words[wordStart + 1];
	for (let wordIndex = wordStart + 2; wordIndex < wordEnd; wordIndex += 1) {
		const xy1 = commandBuffer.words[wordIndex];
		drawSoftwareLineSegment(commandBuffer, commandIndex, dx + gxGpuVertexX(xy0), dy + gxGpuVertexY(xy0), color, dx + gxGpuVertexX(xy1), dy + gxGpuVertexY(xy1), color);
		xy0 = xy1;
	}
}

export function executeGxGpuSoftwareCommands(commandBuffer: GxGpuCommandBufferView, processedCommandCount: number): number {
	for (let commandIndex = processedCommandCount; commandIndex < commandBuffer.commandCount; commandIndex += 1) {
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
