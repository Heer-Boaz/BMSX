import {
	GX_GPU_TEXTURE_MODE_PALETTE4,
	GX_GPU_TEXTURE_MODE_PALETTE8,
	gxGpuDrawingAreaBottomExclusive,
	gxGpuDrawingAreaLeft,
	gxGpuDrawingAreaRightExclusive,
	gxGpuDrawingAreaTop,
	gxGpuSigned11,
} from '../../../spec/gx/gp0';
import { type GxGpuCommandBufferView } from '../../../machine/devices/gx/gpu_command_buffer';
import {
	GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_BITS,
	GX_GPU_TRIANGLE_COLOR_COMPONENTS,
	GX_GPU_TRIANGLE_UV_COMPONENTS,
	gxGpuCommandRawTextureEnabled,
	gxGpuCommandSemiTransparencyEnabled,
	gxGpuDrawModeDitherEnabled,
	gxGpuDrawModeTextureMode,
	gxGpuDrawModeTexturePageBaseX,
	gxGpuDrawModeTexturePageBaseY,
	gxGpuDrawModeTextureRectangleXFlip,
	gxGpuDrawModeTextureRectangleYFlip,
	gxGpuDrawModeTransparencyMode,
	gxGpuMaskBitCheckBeforeDraw,
	gxGpuMaskBitSetWhileDrawing,
	gxGpuSegmentExceedsPrimitiveSize,
	gxGpuTextureClutBaseX,
	gxGpuTextureClutBaseY,
	gxGpuTextureU,
	gxGpuTextureV,
	gxGpuTextureWindowAndX,
	gxGpuTextureWindowAndY,
	gxGpuTextureWindowOrX,
	gxGpuTextureWindowOrY,
	gxGpuTriangleEdgeCoverageMinimum,
	gxGpuTriangleExceedsPrimitiveSize,
	gxGpuTriangleRasterShift,
	gxGpuTriangleAttributePlane,
} from '../gx_gpu_render_rules';
import {
	gxGpuSoftwareDitherOffset,
	gxGpuSoftwareVramIndex,
	gxGpuSoftwareTextureModulationChannel5,
	gxGpuSoftwareWriteRenderVramPixel5,
	gxGpuSoftwareWriteRenderVramPixel,
} from './gx_gpu_vram';
import type { GxGpuSoftwareState } from './gx_gpu_state';

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
	software: GxGpuSoftwareState,
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
		const textureWord = software.vram[gxGpuSoftwareVramIndex(software, pageX + integerDivide(windowedU, 4), pageY + windowedV)];
		const paletteIndex = (textureWord >>> ((windowedU & 3) << 2)) & 0x0f;
		return software.vram[gxGpuSoftwareVramIndex(software, clutBaseX + paletteIndex, clutBaseY)];
	}
	if (textureMode === GX_GPU_TEXTURE_MODE_PALETTE8) {
		const textureWord = software.vram[gxGpuSoftwareVramIndex(software, pageX + integerDivide(windowedU, 2), pageY + windowedV)];
		const paletteIndex = (textureWord >>> ((windowedU & 1) << 3)) & 0xff;
		return software.vram[gxGpuSoftwareVramIndex(software, clutBaseX + paletteIndex, clutBaseY)];
	}
	return software.vram[gxGpuSoftwareVramIndex(software, pageX + windowedU, pageY + windowedV)];
}

function writeGxGpuSoftwareTexturedPixel(
	software: GxGpuSoftwareState,
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
	checkMaskBit: boolean,
	setMaskBit: boolean,
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
	gxGpuSoftwareWriteRenderVramPixel5(software, x, y, r5, g5, b5, blendEnabled, blendMode, checkMaskBit, setMaskBit, sampleMaskBit);
}

export function drawGxGpuSoftwareRectangle(software: GxGpuSoftwareState, commandBuffer: GxGpuCommandBufferView, commandIndex: number, x0: number, y0: number, width: number, height: number, colorWord: number): void {
	const topLeftWord = commandBuffer.commandDrawingAreaTopLeftWord[commandIndex];
	const bottomRightWord = commandBuffer.commandDrawingAreaBottomRightWord[commandIndex];
	const vramYAddressExtensionWord = commandBuffer.commandVramYAddressExtensionWord[commandIndex];
	const areaLeft = gxGpuDrawingAreaLeft(topLeftWord, bottomRightWord);
	const areaTop = gxGpuDrawingAreaTop(topLeftWord, bottomRightWord, vramYAddressExtensionWord);
	const areaRight = gxGpuDrawingAreaRightExclusive(topLeftWord, bottomRightWord);
	const areaBottom = gxGpuDrawingAreaBottomExclusive(topLeftWord, bottomRightWord, vramYAddressExtensionWord);
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
	const checkMaskBit = gxGpuMaskBitCheckBeforeDraw(maskBitModeWord);
	const setMaskBit = gxGpuMaskBitSetWhileDrawing(maskBitModeWord);
	const skippedLineParity = commandBuffer.commandSkippedLineParity[commandIndex];
	const r8 = colorR8(colorWord);
	const g8 = colorG8(colorWord);
	const b8 = colorB8(colorWord);
	for (let y = top; y < bottom; y += 1) {
		if ((y & 1) === skippedLineParity) {
			continue;
		}
		for (let x = left; x < right; x += 1) {
			gxGpuSoftwareWriteRenderVramPixel(software, x, y, r8, g8, b8, false, blendEnabled, blendMode, checkMaskBit, setMaskBit);
		}
	}
}

export function drawGxGpuSoftwareTriangle(software: GxGpuSoftwareState,
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
	const xShift = gxGpuTriangleRasterShift(x0, x1, x2);
	const yShift = gxGpuTriangleRasterShift(y0, y1, y2);
	x0 += xShift;
	y0 += yShift;
	x1 += xShift;
	y1 += yShift;
	x2 += xShift;
	y2 += yShift;
	let area = edgeValue(x0, y0, x1, y1, x2, y2);
	if (area === 0) {
		return;
	}
	const topLeftWord = commandBuffer.commandDrawingAreaTopLeftWord[commandIndex];
	const bottomRightWord = commandBuffer.commandDrawingAreaBottomRightWord[commandIndex];
	const vramYAddressExtensionWord = commandBuffer.commandVramYAddressExtensionWord[commandIndex];
	const areaLeft = gxGpuDrawingAreaLeft(topLeftWord, bottomRightWord);
	const areaTop = gxGpuDrawingAreaTop(topLeftWord, bottomRightWord, vramYAddressExtensionWord);
	const areaRight = gxGpuDrawingAreaRightExclusive(topLeftWord, bottomRightWord);
	const areaBottom = gxGpuDrawingAreaBottomExclusive(topLeftWord, bottomRightWord, vramYAddressExtensionWord);
	const min12x = x1 < x2 ? x1 : x2;
	const max12x = x1 > x2 ? x1 : x2;
	const min12y = y1 < y2 ? y1 : y2;
	const max12y = y1 > y2 ? y1 : y2;
	let left = x0 < min12x ? x0 : min12x;
	let rightExclusive = x0 > max12x ? x0 : max12x;
	let top = y0 < min12y ? y0 : min12y;
	let bottomExclusive = y0 > max12y ? y0 : max12y;
	left = left > areaLeft ? left : areaLeft;
	top = top > areaTop ? top : areaTop;
	rightExclusive = rightExclusive < areaRight ? rightExclusive : areaRight;
	bottomExclusive = bottomExclusive < areaBottom ? bottomExclusive : areaBottom;
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
	const checkMaskBit = gxGpuMaskBitCheckBeforeDraw(maskBitModeWord);
	const setMaskBit = gxGpuMaskBitSetWhileDrawing(maskBitModeWord);
	const skippedLineParity = commandBuffer.commandSkippedLineParity[commandIndex];
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
	let rStepX = 0;
	let gStepX = 0;
	let bStepX = 0;
	let rStepY = 0;
	let gStepY = 0;
	let bStepY = 0;
	let rowR = 0;
	let rowG = 0;
	let rowB = 0;
	const triangleColorPlaneScratch = software.triangleColorPlaneScratch;
	const triangleEdge0 = software.triangleEdge0;
	const triangleEdge1 = software.triangleEdge1;
	const triangleEdge2 = software.triangleEdge2;
	const triangleSpanBounds = software.triangleSpanBounds;
	if (!sameColor) {
		triangleColorPlaneScratch[0] = r0;
		triangleColorPlaneScratch[1] = g0;
		triangleColorPlaneScratch[2] = b0;
		triangleColorPlaneScratch[3] = r1;
		triangleColorPlaneScratch[4] = g1;
		triangleColorPlaneScratch[5] = b1;
		triangleColorPlaneScratch[6] = r2;
		triangleColorPlaneScratch[7] = g2;
		triangleColorPlaneScratch[8] = b2;
		const determinant = -area * edgeSign;
		gxGpuTriangleAttributePlane(triangleColorPlaneScratch, 0, GX_GPU_TRIANGLE_COLOR_COMPONENTS, determinant, x0, y0, x1, y1, x2, y2);
		rStepX = triangleColorPlaneScratch[3];
		gStepX = triangleColorPlaneScratch[4];
		bStepX = triangleColorPlaneScratch[5];
		rStepY = triangleColorPlaneScratch[6];
		gStepY = triangleColorPlaneScratch[7];
		bStepY = triangleColorPlaneScratch[8];
		rowR = triangleColorPlaneScratch[0] + (left * rStepX) + (top * rStepY);
		rowG = triangleColorPlaneScratch[1] + (left * gStepX) + (top * gStepY);
		rowB = triangleColorPlaneScratch[2] + (left * bStepX) + (top * bStepY);
	}
	rowW0 -= gxGpuTriangleEdgeCoverageMinimum(edge0StepX, edge0StepY);
	rowW1 -= gxGpuTriangleEdgeCoverageMinimum(edge1StepX, edge1StepY);
	rowW2 -= gxGpuTriangleEdgeCoverageMinimum(edge2StepX, edge2StepY);
	triangleEdge0.initialize(rowW0, edge0StepX, edge0StepY);
	triangleEdge1.initialize(rowW1, edge1StepX, edge1StepY);
	triangleEdge2.initialize(rowW2, edge2StepX, edge2StepY);
	for (let y = top; y < bottomExclusive; y += 1) {
		if ((y & 1) !== skippedLineParity) {
			triangleSpanBounds[0] = 0;
			triangleSpanBounds[1] = rightExclusive - left - 1;
			if (triangleEdge0.intersect(triangleSpanBounds)
				&& triangleEdge1.intersect(triangleSpanBounds)
				&& triangleEdge2.intersect(triangleSpanBounds)) {
				const firstOffset = triangleSpanBounds[0];
				let rFixed = rowR + (firstOffset * rStepX);
				let gFixed = rowG + (firstOffset * gStepX);
				let bFixed = rowB + (firstOffset * bStepX);
				const spanEnd = left + triangleSpanBounds[1];
				for (let x = left + firstOffset; x <= spanEnd; x += 1) {
					const r8 = sameColor ? r0 : (rFixed >>> GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_BITS) & 0xff;
					const g8 = sameColor ? g0 : (gFixed >>> GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_BITS) & 0xff;
					const b8 = sameColor ? b0 : (bFixed >>> GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_BITS) & 0xff;
					gxGpuSoftwareWriteRenderVramPixel(software, x, y, r8, g8, b8, ditherEnabled, blendEnabled, blendMode, checkMaskBit, setMaskBit);
					if (!sameColor) {
						rFixed += rStepX;
						gFixed += gStepX;
						bFixed += bStepX;
					}
				}
			}
		}
		triangleEdge0.advance();
		triangleEdge1.advance();
		triangleEdge2.advance();
		if (!sameColor) {
			rowR += rStepY;
			rowG += gStepY;
			rowB += bStepY;
		}
	}
}

export function drawGxGpuSoftwareTexturedTriangle(software: GxGpuSoftwareState,
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
	const xShift = gxGpuTriangleRasterShift(x0, x1, x2);
	const yShift = gxGpuTriangleRasterShift(y0, y1, y2);
	x0 += xShift;
	y0 += yShift;
	x1 += xShift;
	y1 += yShift;
	x2 += xShift;
	y2 += yShift;
	let area = edgeValue(x0, y0, x1, y1, x2, y2);
	if (area === 0) {
		return;
	}
	const topLeftWord = commandBuffer.commandDrawingAreaTopLeftWord[commandIndex];
	const bottomRightWord = commandBuffer.commandDrawingAreaBottomRightWord[commandIndex];
	const vramYAddressExtensionWord = commandBuffer.commandVramYAddressExtensionWord[commandIndex];
	const areaLeft = gxGpuDrawingAreaLeft(topLeftWord, bottomRightWord);
	const areaTop = gxGpuDrawingAreaTop(topLeftWord, bottomRightWord, vramYAddressExtensionWord);
	const areaRight = gxGpuDrawingAreaRightExclusive(topLeftWord, bottomRightWord);
	const areaBottom = gxGpuDrawingAreaBottomExclusive(topLeftWord, bottomRightWord, vramYAddressExtensionWord);
	const min12x = x1 < x2 ? x1 : x2;
	const max12x = x1 > x2 ? x1 : x2;
	const min12y = y1 < y2 ? y1 : y2;
	const max12y = y1 > y2 ? y1 : y2;
	let left = x0 < min12x ? x0 : min12x;
	let rightExclusive = x0 > max12x ? x0 : max12x;
	let top = y0 < min12y ? y0 : min12y;
	let bottomExclusive = y0 > max12y ? y0 : max12y;
	left = left > areaLeft ? left : areaLeft;
	top = top > areaTop ? top : areaTop;
	rightExclusive = rightExclusive < areaRight ? rightExclusive : areaRight;
	bottomExclusive = bottomExclusive < areaBottom ? bottomExclusive : areaBottom;
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
	const pageY = gxGpuDrawModeTexturePageBaseY(drawModeWord, vramYAddressExtensionWord);
	const textureMode = gxGpuDrawModeTextureMode(drawModeWord);
	const textureWindowAndX = gxGpuTextureWindowAndX(textureWindowWord);
	const textureWindowAndY = gxGpuTextureWindowAndY(textureWindowWord);
	const textureWindowOrX = gxGpuTextureWindowOrX(textureWindowWord);
	const textureWindowOrY = gxGpuTextureWindowOrY(textureWindowWord);
	const clutBaseX = gxGpuTextureClutBaseX(textureWord0);
	const clutBaseY = gxGpuTextureClutBaseY(textureWord0, vramYAddressExtensionWord);
	const rawTextureEnabled = gxGpuCommandRawTextureEnabled(opcode);
	const interpolatesColor = !sameColor && !rawTextureEnabled;
	const semiTransparencyEnabled = gxGpuCommandSemiTransparencyEnabled(opcode);
	const blendMode = gxGpuDrawModeTransparencyMode(drawModeWord);
	const maskBitModeWord = commandBuffer.commandMaskBitModeWord[commandIndex];
	const checkMaskBit = gxGpuMaskBitCheckBeforeDraw(maskBitModeWord);
	const setMaskBit = gxGpuMaskBitSetWhileDrawing(maskBitModeWord);
	const skippedLineParity = commandBuffer.commandSkippedLineParity[commandIndex];
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
	let rStepX = 0;
	let gStepX = 0;
	let bStepX = 0;
	let rStepY = 0;
	let gStepY = 0;
	let bStepY = 0;
	let rowR = 0;
	let rowG = 0;
	let rowB = 0;
	const triangleColorPlaneScratch = software.triangleColorPlaneScratch;
	const triangleUvPlaneScratch = software.triangleUvPlaneScratch;
	const triangleEdge0 = software.triangleEdge0;
	const triangleEdge1 = software.triangleEdge1;
	const triangleEdge2 = software.triangleEdge2;
	const triangleSpanBounds = software.triangleSpanBounds;
	const determinant = -area * edgeSign;
	if (interpolatesColor) {
		triangleColorPlaneScratch[0] = r0;
		triangleColorPlaneScratch[1] = g0;
		triangleColorPlaneScratch[2] = b0;
		triangleColorPlaneScratch[3] = r1;
		triangleColorPlaneScratch[4] = g1;
		triangleColorPlaneScratch[5] = b1;
		triangleColorPlaneScratch[6] = r2;
		triangleColorPlaneScratch[7] = g2;
		triangleColorPlaneScratch[8] = b2;
		gxGpuTriangleAttributePlane(triangleColorPlaneScratch, 0, GX_GPU_TRIANGLE_COLOR_COMPONENTS, determinant, x0, y0, x1, y1, x2, y2);
		rStepX = triangleColorPlaneScratch[3];
		gStepX = triangleColorPlaneScratch[4];
		bStepX = triangleColorPlaneScratch[5];
		rStepY = triangleColorPlaneScratch[6];
		gStepY = triangleColorPlaneScratch[7];
		bStepY = triangleColorPlaneScratch[8];
		rowR = triangleColorPlaneScratch[0] + (left * rStepX) + (top * rStepY);
		rowG = triangleColorPlaneScratch[1] + (left * gStepX) + (top * gStepY);
		rowB = triangleColorPlaneScratch[2] + (left * bStepX) + (top * bStepY);
	}
	triangleUvPlaneScratch[0] = u0;
	triangleUvPlaneScratch[1] = v0;
	triangleUvPlaneScratch[2] = u1;
	triangleUvPlaneScratch[3] = v1;
	triangleUvPlaneScratch[4] = u2;
	triangleUvPlaneScratch[5] = v2;
	gxGpuTriangleAttributePlane(triangleUvPlaneScratch, 0, GX_GPU_TRIANGLE_UV_COMPONENTS, determinant, x0, y0, x1, y1, x2, y2);
	const uStepX = triangleUvPlaneScratch[2];
	const vStepX = triangleUvPlaneScratch[3];
	const uStepY = triangleUvPlaneScratch[4];
	const vStepY = triangleUvPlaneScratch[5];
	let rowU = triangleUvPlaneScratch[0] + (left * uStepX) + (top * uStepY);
	let rowV = triangleUvPlaneScratch[1] + (left * vStepX) + (top * vStepY);
	rowW0 -= gxGpuTriangleEdgeCoverageMinimum(edge0StepX, edge0StepY);
	rowW1 -= gxGpuTriangleEdgeCoverageMinimum(edge1StepX, edge1StepY);
	rowW2 -= gxGpuTriangleEdgeCoverageMinimum(edge2StepX, edge2StepY);
	triangleEdge0.initialize(rowW0, edge0StepX, edge0StepY);
	triangleEdge1.initialize(rowW1, edge1StepX, edge1StepY);
	triangleEdge2.initialize(rowW2, edge2StepX, edge2StepY);
	for (let y = top; y < bottomExclusive; y += 1) {
		if ((y & 1) !== skippedLineParity) {
			triangleSpanBounds[0] = 0;
			triangleSpanBounds[1] = rightExclusive - left - 1;
			if (triangleEdge0.intersect(triangleSpanBounds)
				&& triangleEdge1.intersect(triangleSpanBounds)
				&& triangleEdge2.intersect(triangleSpanBounds)) {
				const firstOffset = triangleSpanBounds[0];
				let rFixed = rowR + (firstOffset * rStepX);
				let gFixed = rowG + (firstOffset * gStepX);
				let bFixed = rowB + (firstOffset * bStepX);
				let uFixed = rowU + (firstOffset * uStepX);
				let vFixed = rowV + (firstOffset * vStepX);
				const spanEnd = left + triangleSpanBounds[1];
				for (let x = left + firstOffset; x <= spanEnd; x += 1) {
					const r8 = interpolatesColor ? (rFixed >>> GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_BITS) & 0xff : r0;
					const g8 = interpolatesColor ? (gFixed >>> GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_BITS) & 0xff : g0;
					const b8 = interpolatesColor ? (bFixed >>> GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_BITS) & 0xff : b0;
					const u = (uFixed >>> GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_BITS) & 0xff;
					const v = (vFixed >>> GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_BITS) & 0xff;
					const sampleWord = sampleGxGpuSoftwareTextureWord(software,
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
					writeGxGpuSoftwareTexturedPixel(software,
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
						checkMaskBit,
						setMaskBit,
					);
					if (interpolatesColor) {
						rFixed += rStepX;
						gFixed += gStepX;
						bFixed += bStepX;
					}
					uFixed += uStepX;
					vFixed += vStepX;
				}
			}
		}
		triangleEdge0.advance();
		triangleEdge1.advance();
		triangleEdge2.advance();
		if (interpolatesColor) {
			rowR += rStepY;
			rowG += gStepY;
			rowB += bStepY;
		}
		rowU += uStepY;
		rowV += vStepY;
	}
}

export function drawGxGpuSoftwareTexturedRectangle(software: GxGpuSoftwareState, commandBuffer: GxGpuCommandBufferView, commandIndex: number, x0: number, y0: number, width: number, height: number, colorWord: number, textureWord: number): void {
	const topLeftWord = commandBuffer.commandDrawingAreaTopLeftWord[commandIndex];
	const bottomRightWord = commandBuffer.commandDrawingAreaBottomRightWord[commandIndex];
	const vramYAddressExtensionWord = commandBuffer.commandVramYAddressExtensionWord[commandIndex];
	const areaLeft = gxGpuDrawingAreaLeft(topLeftWord, bottomRightWord);
	const areaTop = gxGpuDrawingAreaTop(topLeftWord, bottomRightWord, vramYAddressExtensionWord);
	const areaRight = gxGpuDrawingAreaRightExclusive(topLeftWord, bottomRightWord);
	const areaBottom = gxGpuDrawingAreaBottomExclusive(topLeftWord, bottomRightWord, vramYAddressExtensionWord);
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
	const opcode = commandBuffer.commandOpcode[commandIndex];
	const textureWindowWord = commandBuffer.commandTextureWindowWord[commandIndex];
	const pageX = gxGpuDrawModeTexturePageBaseX(drawModeWord);
	const pageY = gxGpuDrawModeTexturePageBaseY(drawModeWord, vramYAddressExtensionWord);
	const textureMode = gxGpuDrawModeTextureMode(drawModeWord);
	const textureWindowAndX = gxGpuTextureWindowAndX(textureWindowWord);
	const textureWindowAndY = gxGpuTextureWindowAndY(textureWindowWord);
	const textureWindowOrX = gxGpuTextureWindowOrX(textureWindowWord);
	const textureWindowOrY = gxGpuTextureWindowOrY(textureWindowWord);
	const clutBaseX = gxGpuTextureClutBaseX(textureWord);
	const clutBaseY = gxGpuTextureClutBaseY(textureWord, vramYAddressExtensionWord);
	const rawTextureEnabled = gxGpuCommandRawTextureEnabled(opcode);
	const semiTransparencyEnabled = gxGpuCommandSemiTransparencyEnabled(opcode);
	const blendMode = gxGpuDrawModeTransparencyMode(drawModeWord);
	const maskBitModeWord = commandBuffer.commandMaskBitModeWord[commandIndex];
	const checkMaskBit = gxGpuMaskBitCheckBeforeDraw(maskBitModeWord);
	const setMaskBit = gxGpuMaskBitSetWhileDrawing(maskBitModeWord);
	const skippedLineParity = commandBuffer.commandSkippedLineParity[commandIndex];
	const r8 = colorR8(colorWord);
	const g8 = colorG8(colorWord);
	const b8 = colorB8(colorWord);
	const uStep = xFlip ? -1 : 1;
	const vStep = yFlip ? -1 : 1;
	const firstU = baseU + ((left - x0) * uStep);
	let v = baseV + ((top - y0) * vStep);
	for (let y = top; y < bottom; y += 1, v += vStep) {
		if ((y & 1) === skippedLineParity) {
			continue;
		}
		let u = firstU;
		for (let x = left; x < right; x += 1, u += uStep) {
			const sampleWord = sampleGxGpuSoftwareTextureWord(software,
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
			writeGxGpuSoftwareTexturedPixel(software,
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
				checkMaskBit,
				setMaskBit,
			);
		}
	}
}

export function drawGxGpuSoftwareLineSegment(software: GxGpuSoftwareState, commandBuffer: GxGpuCommandBufferView, commandIndex: number, x0: number, y0: number, color0: number, x1: number, y1: number, color1: number): void {
	if (gxGpuSegmentExceedsPrimitiveSize(x0, y0, x1, y1)) {
		return;
	}
	const topLeftWord = commandBuffer.commandDrawingAreaTopLeftWord[commandIndex];
	const bottomRightWord = commandBuffer.commandDrawingAreaBottomRightWord[commandIndex];
	const vramYAddressExtensionWord = commandBuffer.commandVramYAddressExtensionWord[commandIndex];
	const areaLeft = gxGpuDrawingAreaLeft(topLeftWord, bottomRightWord);
	const areaTop = gxGpuDrawingAreaTop(topLeftWord, bottomRightWord, vramYAddressExtensionWord);
	const areaRight = gxGpuDrawingAreaRightExclusive(topLeftWord, bottomRightWord);
	const areaBottom = gxGpuDrawingAreaBottomExclusive(topLeftWord, bottomRightWord, vramYAddressExtensionWord);
	const absDx = absI32(x1 - x0);
	const absDy = absI32(y1 - y0);
	const steps = absDx >= absDy ? absDx : absDy;
	if (x0 > x1) {
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
	const checkMaskBit = gxGpuMaskBitCheckBeforeDraw(maskBitModeWord);
	const setMaskBit = gxGpuMaskBitSetWhileDrawing(maskBitModeWord);
	const skippedLineParity = commandBuffer.commandSkippedLineParity[commandIndex];
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
		const x = gxGpuSigned11(lineFixedXYToCoord(currentX));
		const y = gxGpuSigned11(lineFixedXYToCoord(currentY));
		if (x >= areaLeft && y >= areaTop && x < areaRight && y < areaBottom && (y & 1) !== skippedLineParity) {
			gxGpuSoftwareWriteRenderVramPixel(software,
				x,
				y,
				lineFixedRgbToByte(currentR),
				lineFixedRgbToByte(currentG),
				lineFixedRgbToByte(currentB),
				ditherEnabled,
				blendEnabled,
				blendMode,
				checkMaskBit,
				setMaskBit,
			);
		}
		currentX += xStep;
		currentY += yStep;
		currentR += rStep;
		currentG += gStep;
		currentB += bStep;
	}
}
