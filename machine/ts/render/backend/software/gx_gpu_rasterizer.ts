import {
	GX_GPU_TEXTURE_MODE_PALETTE4,
	GX_GPU_TEXTURE_MODE_PALETTE8,
	gxGpuCommandSemiTransparencyEnabled,
	gxGpuCommandRawTextureEnabled,
	gxGpuDrawingAreaBottomExclusive,
	gxGpuDrawingAreaLeft,
	gxGpuDrawingAreaRightExclusive,
	gxGpuDrawingAreaTop,
	gxGpuDrawModeDitherEnabled,
	gxGpuDrawModeTextureMode,
	gxGpuDrawModeTexturePageBaseX,
	gxGpuDrawModeTexturePageBaseY,
	gxGpuDrawModeTextureRectangleXFlip,
	gxGpuDrawModeTextureRectangleYFlip,
	gxGpuDrawModeTransparencyMode,
	gxGpuTextureClutBaseX,
	gxGpuTextureClutBaseY,
	gxGpuTextureModulationChannel5,
	gxGpuSegmentExceedsPrimitiveSize,
	gxGpuTriangleExceedsPrimitiveSize,
	gxGpuTextureRectangleEdge0,
	gxGpuTextureU,
	gxGpuTextureV,
	gxGpuTextureWindowAndX,
	gxGpuTextureWindowAndY,
	gxGpuTextureWindowOrX,
	gxGpuTextureWindowOrY,
	type GxGpuCommandBufferView,
} from '../../../machine/devices/gx/gpu_command_buffer';
import {
	gxGpuSoftwareDitherOffset,
	gxGpuSoftwareInterlacedSkipsLine,
	gxGpuSoftwareVram,
	gxGpuSoftwareVramIndex,
	gxGpuSoftwareWriteRenderVramPixel5,
	gxGpuSoftwareWriteRenderVramPixel,
} from './gx_gpu_vram';

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

function textureWindowCoord(coord: number, andMask: number, orMask: number): number {
	return (coord & andMask) | orMask;
}

function absI32(value: number): number {
	return value < 0 ? -value : value;
}

function roundDivideSigned(numerator: number, denominator: number): number {
	return numerator < 0
		? -integerDivide(-numerator + (denominator >>> 1), denominator)
		: integerDivide(numerator + (denominator >>> 1), denominator);
}

function sampleGxGpuSoftwareTextureWord(
	u: number,
	v: number,
	pageX: number,
	pageY: number,
	textureMode: number,
	textureWindowAndX: number,
	textureWindowAndY: number,
	textureWindowOrX: number,
	textureWindowOrY: number,
	clutBaseX: number,
	clutBaseY: number,
): number {
	const windowedU = textureWindowCoord(u, textureWindowAndX, textureWindowOrX);
	const windowedV = textureWindowCoord(v, textureWindowAndY, textureWindowOrY);
	if (textureMode === GX_GPU_TEXTURE_MODE_PALETTE4) {
		const textureWord = gxGpuSoftwareVram[gxGpuSoftwareVramIndex(pageX + integerDivide(windowedU, 4), pageY + windowedV)];
		const paletteIndex = (textureWord >>> ((windowedU & 3) << 2)) & 0x0f;
		return gxGpuSoftwareVram[gxGpuSoftwareVramIndex(clutBaseX + paletteIndex, clutBaseY)];
	}
	if (textureMode === GX_GPU_TEXTURE_MODE_PALETTE8) {
		const textureWord = gxGpuSoftwareVram[gxGpuSoftwareVramIndex(pageX + integerDivide(windowedU, 2), pageY + windowedV)];
		const paletteIndex = (textureWord >>> ((windowedU & 1) << 3)) & 0xff;
		return gxGpuSoftwareVram[gxGpuSoftwareVramIndex(clutBaseX + paletteIndex, clutBaseY)];
	}
	return gxGpuSoftwareVram[gxGpuSoftwareVramIndex(pageX + windowedU, pageY + windowedV)];
}

function writeGxGpuSoftwareTexturedPixel(
	x: number,
	y: number,
	colorWord: number,
	sampleWord: number,
	ditherEnabled: boolean,
	rawTextureEnabled: boolean,
	semiTransparencyEnabled: boolean,
	blendMode: number,
	maskBitModeWord: number,
): void {
	if (sampleWord === 0) {
		return;
	}
	let r5 = sampleWord & 0x1f;
	let g5 = (sampleWord >>> 5) & 0x1f;
	let b5 = (sampleWord >>> 10) & 0x1f;
	if (!rawTextureEnabled) {
		const ditherOffset = ditherEnabled ? gxGpuSoftwareDitherOffset(x, y) : 0;
		r5 = gxGpuTextureModulationChannel5(r5, colorR8(colorWord), ditherOffset);
		g5 = gxGpuTextureModulationChannel5(g5, colorG8(colorWord), ditherOffset);
		b5 = gxGpuTextureModulationChannel5(b5, colorB8(colorWord), ditherOffset);
	}
	const sampleMaskBit = sampleWord & 0x8000;
	const blendEnabled = semiTransparencyEnabled && sampleMaskBit !== 0;
	gxGpuSoftwareWriteRenderVramPixel5(x, y, r5, g5, b5, blendEnabled, blendMode, maskBitModeWord, sampleMaskBit);
}

export function drawGxGpuSoftwareRectangle(commandBuffer: GxGpuCommandBufferView, commandIndex: number, x0: number, y0: number, width: number, height: number, colorWord: number): void {
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

export function drawGxGpuSoftwareTriangle(
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

export function drawGxGpuSoftwareTexturedTriangle(
	commandBuffer: GxGpuCommandBufferView,
	commandIndex: number,
	x0: number,
	y0: number,
	color0: number,
	u0: number,
	v0: number,
	x1: number,
	y1: number,
	color1: number,
	u1: number,
	v1: number,
	x2: number,
	y2: number,
	color2: number,
	u2: number,
	v2: number,
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
	const textureWindowWord = commandBuffer.commandTextureWindowWord[commandIndex];
	const textureWord0 = commandBuffer.words[commandBuffer.commandWordStart[commandIndex] + 2];
	const pageX = gxGpuDrawModeTexturePageBaseX(drawModeWord);
	const pageY = gxGpuDrawModeTexturePageBaseY(drawModeWord);
	const textureMode = gxGpuDrawModeTextureMode(drawModeWord);
	const textureWindowAndX = gxGpuTextureWindowAndX(textureWindowWord);
	const textureWindowAndY = gxGpuTextureWindowAndY(textureWindowWord);
	const textureWindowOrX = gxGpuTextureWindowOrX(textureWindowWord);
	const textureWindowOrY = gxGpuTextureWindowOrY(textureWindowWord);
	const clutBaseX = gxGpuTextureClutBaseX(textureWord0);
	const clutBaseY = gxGpuTextureClutBaseY(textureWord0);
	const rawTextureEnabled = gxGpuCommandRawTextureEnabled(opcode);
	const semiTransparencyEnabled = gxGpuCommandSemiTransparencyEnabled(opcode);
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
				const colorWord = sameColor ? color0 : (
					integerDivide((r0 * w0) + (r1 * w1) + (r2 * w2), area)
					| (integerDivide((g0 * w0) + (g1 * w1) + (g2 * w2), area) << 8)
					| (integerDivide((b0 * w0) + (b1 * w1) + (b2 * w2), area) << 16)
				);
				const u = integerDivide((u0 * w0) + (u1 * w1) + (u2 * w2), area);
				const v = integerDivide((v0 * w0) + (v1 * w1) + (v2 * w2), area);
				const sampleWord = sampleGxGpuSoftwareTextureWord(
					u,
					v,
					pageX,
					pageY,
					textureMode,
					textureWindowAndX,
					textureWindowAndY,
					textureWindowOrX,
					textureWindowOrY,
					clutBaseX,
					clutBaseY,
				);
				writeGxGpuSoftwareTexturedPixel(
					x,
					y,
					colorWord,
					sampleWord,
					ditherEnabled,
					rawTextureEnabled,
					semiTransparencyEnabled,
					blendMode,
					maskBitModeWord,
				);
			}
		}
	}
}

export function drawGxGpuSoftwareTexturedRectangle(commandBuffer: GxGpuCommandBufferView, commandIndex: number, x0: number, y0: number, width: number, height: number, colorWord: number, textureWord: number): void {
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
	const drawModeWord = commandBuffer.commandDrawModeWord[commandIndex];
	const xFlip = gxGpuDrawModeTextureRectangleXFlip(drawModeWord);
	const yFlip = gxGpuDrawModeTextureRectangleYFlip(drawModeWord);
	const baseU = gxGpuTextureU(textureWord);
	const baseV = gxGpuTextureV(textureWord);
	const edgeU = gxGpuTextureRectangleEdge0(baseU, xFlip);
	const edgeV = gxGpuTextureRectangleEdge0(baseV, yFlip);
	const opcode = commandBuffer.commandOpcode[commandIndex];
	const textureWindowWord = commandBuffer.commandTextureWindowWord[commandIndex];
	const pageX = gxGpuDrawModeTexturePageBaseX(drawModeWord);
	const pageY = gxGpuDrawModeTexturePageBaseY(drawModeWord);
	const textureMode = gxGpuDrawModeTextureMode(drawModeWord);
	const textureWindowAndX = gxGpuTextureWindowAndX(textureWindowWord);
	const textureWindowAndY = gxGpuTextureWindowAndY(textureWindowWord);
	const textureWindowOrX = gxGpuTextureWindowOrX(textureWindowWord);
	const textureWindowOrY = gxGpuTextureWindowOrY(textureWindowWord);
	const clutBaseX = gxGpuTextureClutBaseX(textureWord);
	const clutBaseY = gxGpuTextureClutBaseY(textureWord);
	const rawTextureEnabled = gxGpuCommandRawTextureEnabled(opcode);
	const semiTransparencyEnabled = gxGpuCommandSemiTransparencyEnabled(opcode);
	const blendMode = gxGpuDrawModeTransparencyMode(drawModeWord);
	const maskBitModeWord = commandBuffer.commandMaskBitModeWord[commandIndex];
	const interlacedRenderWord = commandBuffer.commandInterlacedRenderWord[commandIndex];
	for (let y = top; y < bottom; y += 1) {
		if (gxGpuSoftwareInterlacedSkipsLine(y, interlacedRenderWord)) {
			continue;
		}
		const textureY = y - y0;
		const v = yFlip ? edgeV - textureY - 1 : edgeV + textureY;
		for (let x = left; x < right; x += 1) {
			const textureX = x - x0;
			const u = xFlip ? edgeU - textureX - 1 : edgeU + textureX;
			const sampleWord = sampleGxGpuSoftwareTextureWord(
				u,
				v,
				pageX,
				pageY,
				textureMode,
				textureWindowAndX,
				textureWindowAndY,
				textureWindowOrX,
				textureWindowOrY,
				clutBaseX,
				clutBaseY,
			);
			writeGxGpuSoftwareTexturedPixel(
				x,
				y,
				colorWord,
				sampleWord,
				false,
				rawTextureEnabled,
				semiTransparencyEnabled,
				blendMode,
				maskBitModeWord,
			);
		}
	}
}

export function drawGxGpuSoftwareLineSegment(commandBuffer: GxGpuCommandBufferView, commandIndex: number, x0: number, y0: number, color0: number, x1: number, y1: number, color1: number): void {
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
