import {
	gxGpuCommandSemiTransparencyEnabled,
	gxGpuDrawingAreaBottomExclusive,
	gxGpuDrawingAreaLeft,
	gxGpuDrawingAreaRightExclusive,
	gxGpuDrawingAreaTop,
	gxGpuDrawModeDitherEnabled,
	gxGpuDrawModeTransparencyMode,
	gxGpuSegmentExceedsPrimitiveSize,
	gxGpuTriangleExceedsPrimitiveSize,
	type GxGpuCommandBufferView,
} from '../../../machine/devices/gx/gpu_command_buffer';
import {
	gxGpuSoftwareInterlacedSkipsLine,
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

function absI32(value: number): number {
	return value < 0 ? -value : value;
}

function roundDivideSigned(numerator: number, denominator: number): number {
	return numerator < 0
		? -integerDivide(-numerator + (denominator >>> 1), denominator)
		: integerDivide(numerator + (denominator >>> 1), denominator);
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
