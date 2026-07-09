import {
	GX_GPU_TEXTURE_MODE_PALETTE4,
	GX_GPU_TEXTURE_MODE_PALETTE8,
	type GxGpuCommandBufferView,
} from '../../../machine/devices/gx/gpu_command_buffer';
import {
	gxGpuCommandRawTextureEnabled,
	gxGpuCommandSemiTransparencyEnabled,
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
	gxGpuSegmentExceedsPrimitiveSize,
	gxGpuTextureClutBaseX,
	gxGpuTextureClutBaseY,
	gxGpuTextureRectangleEdge0,
	gxGpuTextureU,
	gxGpuTextureV,
	gxGpuTextureWindowAndX,
	gxGpuTextureWindowAndY,
	gxGpuTextureWindowOrX,
	gxGpuTextureWindowOrY,
	gxGpuTriangleExceedsPrimitiveSize,
} from '../gx_gpu_render_rules';
import {
	gxGpuSoftwareDitherOffset,
	gxGpuSoftwareInterlacedSkipsLine,
	gxGpuSoftwareVram,
	gxGpuSoftwareVramIndex,
	gxGpuSoftwareTextureModulationChannel5,
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

const GX_GPU_SOFTWARE_LINE_XY_SCALE = 0x100000000;
const GX_GPU_SOFTWARE_LINE_XY_HALF = 0x80000000;
const GX_GPU_SOFTWARE_LINE_SUBPIXEL_BIAS = 1024;
const GX_GPU_SOFTWARE_LINE_RGB_SCALE = 0x1000;
const GX_GPU_SOFTWARE_LINE_RGB_HALF = 0x800;

function lineMakeFixedXY(value: number): number {
	return value * GX_GPU_SOFTWARE_LINE_XY_SCALE + GX_GPU_SOFTWARE_LINE_XY_HALF;
}

function lineDivideFixedXYDelta(delta: number, steps: number): number {
	return integerDivide(
		delta * GX_GPU_SOFTWARE_LINE_XY_SCALE
			- (delta < 0 ? steps - 1 : 0)
			+ (delta > 0 ? steps - 1 : 0),
		steps,
	);
}

function lineFixedXYToCoord(value: number): number {
	const quotient = integerDivide(value, GX_GPU_SOFTWARE_LINE_XY_SCALE);
	return value < 0 && value % GX_GPU_SOFTWARE_LINE_XY_SCALE !== 0 ? quotient - 1 : quotient;
}

function lineMakeFixedRgb(value: number): number {
	return value * GX_GPU_SOFTWARE_LINE_RGB_SCALE + GX_GPU_SOFTWARE_LINE_RGB_HALF;
}

function lineDivideFixedRgbDelta(value1: number, value0: number, steps: number): number {
	return integerDivide((value1 - value0) * GX_GPU_SOFTWARE_LINE_RGB_SCALE, steps);
}

function lineFixedRgbToByte(value: number): number {
	return integerDivide(value, GX_GPU_SOFTWARE_LINE_RGB_SCALE);
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
	colorR: number,
	colorG: number,
	colorB: number,
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
		r5 = gxGpuSoftwareTextureModulationChannel5(r5, colorR, ditherOffset);
		g5 = gxGpuSoftwareTextureModulationChannel5(g5, colorG, ditherOffset);
		b5 = gxGpuSoftwareTextureModulationChannel5(b5, colorB, ditherOffset);
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
	const edgeSign = flip ? -1 : 1;
	const edge0StepX = (y2 - y1) * edgeSign;
	const edge1StepX = (y0 - y2) * edgeSign;
	const edge2StepX = (y1 - y0) * edgeSign;
	const edge0StepY = -(x2 - x1) * edgeSign;
	const edge1StepY = -(x0 - x2) * edgeSign;
	const edge2StepY = -(x1 - x0) * edgeSign;
	let rowW0 = edgeValue(x1, y1, x2, y2, left, top) * edgeSign;
	let rowW1 = edgeValue(x2, y2, x0, y0, left, top) * edgeSign;
	let rowW2 = edgeValue(x0, y0, x1, y1, left, top) * edgeSign;
	const rStepX = sameColor ? 0 : (r0 * edge0StepX) + (r1 * edge1StepX) + (r2 * edge2StepX);
	const gStepX = sameColor ? 0 : (g0 * edge0StepX) + (g1 * edge1StepX) + (g2 * edge2StepX);
	const bStepX = sameColor ? 0 : (b0 * edge0StepX) + (b1 * edge1StepX) + (b2 * edge2StepX);
	const rStepY = sameColor ? 0 : (r0 * edge0StepY) + (r1 * edge1StepY) + (r2 * edge2StepY);
	const gStepY = sameColor ? 0 : (g0 * edge0StepY) + (g1 * edge1StepY) + (g2 * edge2StepY);
	const bStepY = sameColor ? 0 : (b0 * edge0StepY) + (b1 * edge1StepY) + (b2 * edge2StepY);
	let rowR = sameColor ? 0 : (r0 * rowW0) + (r1 * rowW1) + (r2 * rowW2);
	let rowG = sameColor ? 0 : (g0 * rowW0) + (g1 * rowW1) + (g2 * rowW2);
	let rowB = sameColor ? 0 : (b0 * rowW0) + (b1 * rowW1) + (b2 * rowW2);
	for (let y = top; y <= bottom; y += 1) {
		if (gxGpuSoftwareInterlacedSkipsLine(y, interlacedRenderWord)) {
			rowW0 += edge0StepY;
			rowW1 += edge1StepY;
			rowW2 += edge2StepY;
			if (!sameColor) {
				rowR += rStepY;
				rowG += gStepY;
				rowB += bStepY;
			}
			continue;
		}
		let w0 = rowW0;
		let w1 = rowW1;
		let w2 = rowW2;
		let r = rowR;
		let g = rowG;
		let b = rowB;
		for (let x = left; x <= right; x += 1) {
			if (w0 >= 0 && w1 >= 0 && w2 >= 0) {
				const r8 = sameColor ? r0 : integerDivide(r, area);
				const g8 = sameColor ? g0 : integerDivide(g, area);
				const b8 = sameColor ? b0 : integerDivide(b, area);
				gxGpuSoftwareWriteRenderVramPixel(x, y, r8, g8, b8, ditherEnabled, blendEnabled, blendMode, maskBitModeWord);
			}
			w0 += edge0StepX;
			w1 += edge1StepX;
			w2 += edge2StepX;
			if (!sameColor) {
				r += rStepX;
				g += gStepX;
				b += bStepX;
			}
		}
		rowW0 += edge0StepY;
		rowW1 += edge1StepY;
		rowW2 += edge2StepY;
		if (!sameColor) {
			rowR += rStepY;
			rowG += gStepY;
			rowB += bStepY;
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
	const edgeSign = flip ? -1 : 1;
	const edge0StepX = (y2 - y1) * edgeSign;
	const edge1StepX = (y0 - y2) * edgeSign;
	const edge2StepX = (y1 - y0) * edgeSign;
	const edge0StepY = -(x2 - x1) * edgeSign;
	const edge1StepY = -(x0 - x2) * edgeSign;
	const edge2StepY = -(x1 - x0) * edgeSign;
	let rowW0 = edgeValue(x1, y1, x2, y2, left, top) * edgeSign;
	let rowW1 = edgeValue(x2, y2, x0, y0, left, top) * edgeSign;
	let rowW2 = edgeValue(x0, y0, x1, y1, left, top) * edgeSign;
	const rStepX = sameColor ? 0 : (r0 * edge0StepX) + (r1 * edge1StepX) + (r2 * edge2StepX);
	const gStepX = sameColor ? 0 : (g0 * edge0StepX) + (g1 * edge1StepX) + (g2 * edge2StepX);
	const bStepX = sameColor ? 0 : (b0 * edge0StepX) + (b1 * edge1StepX) + (b2 * edge2StepX);
	const uStepX = (u0 * edge0StepX) + (u1 * edge1StepX) + (u2 * edge2StepX);
	const vStepX = (v0 * edge0StepX) + (v1 * edge1StepX) + (v2 * edge2StepX);
	const rStepY = sameColor ? 0 : (r0 * edge0StepY) + (r1 * edge1StepY) + (r2 * edge2StepY);
	const gStepY = sameColor ? 0 : (g0 * edge0StepY) + (g1 * edge1StepY) + (g2 * edge2StepY);
	const bStepY = sameColor ? 0 : (b0 * edge0StepY) + (b1 * edge1StepY) + (b2 * edge2StepY);
	const uStepY = (u0 * edge0StepY) + (u1 * edge1StepY) + (u2 * edge2StepY);
	const vStepY = (v0 * edge0StepY) + (v1 * edge1StepY) + (v2 * edge2StepY);
	let rowR = sameColor ? 0 : (r0 * rowW0) + (r1 * rowW1) + (r2 * rowW2);
	let rowG = sameColor ? 0 : (g0 * rowW0) + (g1 * rowW1) + (g2 * rowW2);
	let rowB = sameColor ? 0 : (b0 * rowW0) + (b1 * rowW1) + (b2 * rowW2);
	let rowU = (u0 * rowW0) + (u1 * rowW1) + (u2 * rowW2);
	let rowV = (v0 * rowW0) + (v1 * rowW1) + (v2 * rowW2);
	for (let y = top; y <= bottom; y += 1) {
		if (gxGpuSoftwareInterlacedSkipsLine(y, interlacedRenderWord)) {
			rowW0 += edge0StepY;
			rowW1 += edge1StepY;
			rowW2 += edge2StepY;
			if (!sameColor) {
				rowR += rStepY;
				rowG += gStepY;
				rowB += bStepY;
			}
			rowU += uStepY;
			rowV += vStepY;
			continue;
		}
		let w0 = rowW0;
		let w1 = rowW1;
		let w2 = rowW2;
		let r = rowR;
		let g = rowG;
		let b = rowB;
		let uNumerator = rowU;
		let vNumerator = rowV;
		for (let x = left; x <= right; x += 1) {
			if (w0 >= 0 && w1 >= 0 && w2 >= 0) {
				const r8 = sameColor ? r0 : integerDivide(r, area);
				const g8 = sameColor ? g0 : integerDivide(g, area);
				const b8 = sameColor ? b0 : integerDivide(b, area);
				const u = integerDivide(uNumerator, area);
				const v = integerDivide(vNumerator, area);
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
					r8,
					g8,
					b8,
					sampleWord,
					ditherEnabled,
					rawTextureEnabled,
					semiTransparencyEnabled,
					blendMode,
					maskBitModeWord,
				);
			}
			w0 += edge0StepX;
			w1 += edge1StepX;
			w2 += edge2StepX;
			if (!sameColor) {
				r += rStepX;
				g += gStepX;
				b += bStepX;
			}
			uNumerator += uStepX;
			vNumerator += vStepX;
		}
		rowW0 += edge0StepY;
		rowW1 += edge1StepY;
		rowW2 += edge2StepY;
		if (!sameColor) {
			rowR += rStepY;
			rowG += gStepY;
			rowB += bStepY;
		}
		rowU += uStepY;
		rowV += vStepY;
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
	const r8 = colorR8(colorWord);
	const g8 = colorG8(colorWord);
	const b8 = colorB8(colorWord);
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
				r8,
				g8,
				b8,
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
	const absDx = absI32(x1 - x0);
	const absDy = absI32(y1 - y0);
	const steps = absDx >= absDy ? absDx : absDy;
	if (x0 >= x1 && steps > 0) {
		const swapX = x0;
		const swapY = y0;
		const swapColor = color0;
		x0 = x1;
		y0 = y1;
		color0 = color1;
		x1 = swapX;
		y1 = swapY;
		color1 = swapColor;
	}
	const opcode = commandBuffer.commandOpcode[commandIndex];
	const drawModeWord = commandBuffer.commandDrawModeWord[commandIndex];
	const blendEnabled = gxGpuCommandSemiTransparencyEnabled(opcode);
	const blendMode = gxGpuDrawModeTransparencyMode(drawModeWord);
	const ditherEnabled = gxGpuDrawModeDitherEnabled(drawModeWord);
	const maskBitModeWord = commandBuffer.commandMaskBitModeWord[commandIndex];
	const interlacedRenderWord = commandBuffer.commandInterlacedRenderWord[commandIndex];
	let xStep = 0;
	let yStep = 0;
	let rStep = 0;
	let gStep = 0;
	let bStep = 0;
	const r0 = colorR8(color0);
	const g0 = colorG8(color0);
	const b0 = colorB8(color0);
	if (steps !== 0) {
		xStep = lineDivideFixedXYDelta(x1 - x0, steps);
		yStep = lineDivideFixedXYDelta(y1 - y0, steps);
		rStep = lineDivideFixedRgbDelta(colorR8(color1), r0, steps);
		gStep = lineDivideFixedRgbDelta(colorG8(color1), g0, steps);
		bStep = lineDivideFixedRgbDelta(colorB8(color1), b0, steps);
	}
	let currentX = lineMakeFixedXY(x0) - GX_GPU_SOFTWARE_LINE_SUBPIXEL_BIAS;
	let currentY = lineMakeFixedXY(y0) - (yStep < 0 ? GX_GPU_SOFTWARE_LINE_SUBPIXEL_BIAS : 0);
	let currentR = lineMakeFixedRgb(r0);
	let currentG = lineMakeFixedRgb(g0);
	let currentB = lineMakeFixedRgb(b0);
	for (let step = 0; step <= steps; step += 1) {
		const x = lineFixedXYToCoord(currentX);
		const y = lineFixedXYToCoord(currentY);
		if (x >= areaLeft && y >= areaTop && x < areaRight && y < areaBottom && !gxGpuSoftwareInterlacedSkipsLine(y, interlacedRenderWord)) {
			gxGpuSoftwareWriteRenderVramPixel(
				x,
				y,
				lineFixedRgbToByte(currentR),
				lineFixedRgbToByte(currentG),
				lineFixedRgbToByte(currentB),
				ditherEnabled,
				blendEnabled,
				blendMode,
				maskBitModeWord,
			);
		}
		currentX += xStep;
		currentY += yStep;
		currentR += rStep;
		currentG += gStep;
		currentB += bStep;
	}
}
