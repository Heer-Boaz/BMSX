import {
	GX_GPU_DRAW_MODE_DITHER_ENABLED,
	GX_GPU_DRAW_MODE_TEXTURE_RECTANGLE_X_FLIP,
	GX_GPU_DRAW_MODE_TEXTURE_RECTANGLE_Y_FLIP,
	gxGpuSigned11,
	gxGpuTextureAttribute,
} from '../../machine/devices/gx/gpu_command_buffer';
import {
	GX_GPU_VRAM_WIDTH,
	gxGpuVramYAddress,
	gxGpuVramYAddressMask,
} from '../../machine/devices/gx/vram_address';

export const GX_GPU_MAX_PRIMITIVE_WIDTH = 1024;
export const GX_GPU_MAX_PRIMITIVE_HEIGHT = 512;
export const GX_GPU_VERTEX_COORD_PERIOD = 0x800;
export const GX_GPU_TRIANGLE_ATTRIBUTE_PLANE_PHASES = 3;
export const GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_BITS = 12;
export const GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_SCALE = 1 << GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_BITS;
export const GX_GPU_TRIANGLE_ATTRIBUTE_ACCUMULATOR_MASK = 0xfffff;
export const GX_GPU_TEXTURE_SOURCE_COMMAND_OVERLAP = 1;
export const GX_GPU_TEXTURE_SOURCE_BATCH_OVERLAP = 2;

export const enum GxGpuRasterKind {
	Polygon,
	Rectangle,
	Line,
}

export function gxGpuTriangleRasterShift(coord0: number, coord1: number, coord2: number): number {
	const minimum = coord0 < coord1 ? (coord0 < coord2 ? coord0 : coord2) : (coord1 < coord2 ? coord1 : coord2);
	return minimum < -(GX_GPU_VERTEX_COORD_PERIOD >> 1) ? GX_GPU_VERTEX_COORD_PERIOD : 0;
}

export function gxGpuTriangleAttributePlane(
	out: Float64Array,
	outOffset: number,
	componentCount: number,
	determinant: number,
	x0: number,
	y0: number,
	x1: number,
	y1: number,
	x2: number,
	y2: number,
): void {
	const anchor = x1 <= x0 ? (x2 <= x1 ? 2 : 1) : (x2 < x0 ? 2 : 0);
	const anchorX = anchor === 0 ? x0 : (anchor === 1 ? x1 : x2);
	const anchorY = anchor === 0 ? y0 : (anchor === 1 ? y1 : y2);
	for (let component = 0; component < componentCount; component += 1) {
		const value0 = out[outOffset + component];
		const value1 = out[outOffset + componentCount + component];
		const value2 = out[outOffset + componentCount * 2 + component];
		const stepXScaled = (((value1 - value0) * (y2 - y1)) - ((value2 - value1) * (y1 - y0))) * GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_SCALE;
		const stepYScaled = (((x1 - x0) * (value2 - value1)) - ((x2 - x1) * (value1 - value0))) * GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_SCALE;
		const stepXQuotient = (stepXScaled - (stepXScaled % determinant)) / determinant;
		const stepYQuotient = (stepYScaled - (stepYScaled % determinant)) / determinant;
		const stepXRaw = stepXQuotient & GX_GPU_TRIANGLE_ATTRIBUTE_ACCUMULATOR_MASK;
		const stepYRaw = stepYQuotient & GX_GPU_TRIANGLE_ATTRIBUTE_ACCUMULATOR_MASK;
		const stepX = (stepXRaw & 0x80000) !== 0 ? stepXRaw - 0x100000 : stepXRaw;
		const stepY = (stepYRaw & 0x80000) !== 0 ? stepYRaw - 0x100000 : stepYRaw;
		const anchorValue = anchor === 0 ? value0 : (anchor === 1 ? value1 : value2);
		out[outOffset + component] = ((anchorValue * GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_SCALE) + (GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_SCALE >> 1) - (anchorX * stepX) - (anchorY * stepY)) & GX_GPU_TRIANGLE_ATTRIBUTE_ACCUMULATOR_MASK;
		out[outOffset + componentCount + component] = stepXRaw;
		out[outOffset + componentCount * 2 + component] = stepYRaw;
	}
}

export function gxGpuVertexY(word: number): number {
	return gxGpuSigned11(word >>> 16);
}

export function gxGpuDrawingOffsetY(word: number): number {
	return gxGpuSigned11(word >>> 11);
}

export function gxGpuCommandRawTextureEnabled(opcode: number): boolean {
	return (opcode & 0x01) !== 0;
}

export function gxGpuCommandSemiTransparencyEnabled(opcode: number): boolean {
	return (opcode & 0x02) !== 0;
}

export function gxGpuCommandTextureEnabled(opcode: number): boolean {
	return (opcode & 0x04) !== 0;
}

export function gxGpuCommandQuadPolygon(opcode: number): boolean {
	return (opcode & 0x08) !== 0;
}

export function gxGpuCommandGouraud(opcode: number): boolean {
	return (opcode & 0x10) !== 0;
}

export function gxGpuCommandRectangleWidth(opcode: number, sizeWord: number): number {
	switch (opcode & 0x18) {
		case 0x08:
			return 1;
		case 0x10:
			return 8;
		case 0x18:
			return 16;
		default:
			return sizeWord & 0x3ff;
	}
}

export function gxGpuCommandRectangleHeight(opcode: number, sizeWord: number): number {
	switch (opcode & 0x18) {
		case 0x08:
			return 1;
		case 0x10:
			return 8;
		case 0x18:
			return 16;
		default:
			return (sizeWord >>> 16) & 0x1ff;
	}
}

export function gxGpuFillX(xyWord: number): number {
	return xyWord & 0x3f0;
}

export function gxGpuFillWidth(sizeWord: number): number {
	return ((sizeWord & 0x3ff) + 0x0f) & ~0x0f;
}

export function gxGpuFillHeight(sizeWord: number): number {
	return (sizeWord >>> 16) & 0x1ff;
}

export function gxGpuVramWrappedWidth(x: number, width: number): number {
	const edgeWidth = GX_GPU_VRAM_WIDTH - x;
	return width <= edgeWidth ? width : edgeWidth;
}

export function gxGpuVramWrappedHeight(y: number, height: number, vramYAddressExtensionWord: number): number {
	const logicalY = gxGpuVramYAddress(y, vramYAddressExtensionWord);
	const edgeHeight = gxGpuVramYAddressMask(vramYAddressExtensionWord) + 1 - logicalY;
	return height <= edgeHeight ? height : edgeHeight;
}

export function gxGpuVramLogicalAreaOverlapsBounds(x: number, y: number, width: number, height: number, left: number, top: number, right: number, bottom: number, vramYAddressExtensionWord: number): boolean {
	if (right <= left || bottom <= top) return false;
	const yAddressMask = gxGpuVramYAddressMask(vramYAddressExtensionWord);
	let boundsY = top & yAddressMask;
	let remainingBoundsHeight = bottom - top;
	while (remainingBoundsHeight !== 0) {
		const boundsRunHeight = gxGpuVramWrappedHeight(boundsY, remainingBoundsHeight, vramYAddressExtensionWord);
		let rowY = y & yAddressMask;
		let remainingHeight = height;
		while (remainingHeight !== 0) {
			const runHeight = gxGpuVramWrappedHeight(rowY, remainingHeight, vramYAddressExtensionWord);
			let columnX = x & (GX_GPU_VRAM_WIDTH - 1);
			let remainingWidth = width;
			while (remainingWidth !== 0) {
				const runWidth = gxGpuVramWrappedWidth(columnX, remainingWidth);
				if (columnX < right && left < columnX + runWidth && rowY < boundsY + boundsRunHeight && boundsY < rowY + runHeight) return true;
				columnX = (columnX + runWidth) & (GX_GPU_VRAM_WIDTH - 1);
				remainingWidth -= runWidth;
			}
			rowY = (rowY + runHeight) & yAddressMask;
			remainingHeight -= runHeight;
		}
		boundsY = (boundsY + boundsRunHeight) & yAddressMask;
		remainingBoundsHeight -= boundsRunHeight;
	}
	return false;
}

export function gxGpuSpansOverlap(startA: number, endA: number, startB: number, endB: number): boolean {
	return startA < endB && startB < endA;
}

export function gxGpuVramCopyNeedsChunking(sourceX: number, sourceY: number, targetX: number, targetY: number, width: number, height: number): boolean {
	return sourceX !== targetX
		&& sourceY !== targetY
		&& gxGpuSpansOverlap(sourceX, sourceX + width, targetX, targetX + width)
		&& gxGpuSpansOverlap(sourceY, sourceY + height, targetY, targetY + height);
}

export function gxGpuVramCopyChunkHeight(sourceY: number, targetY: number, height: number): number {
	const rowDistance = sourceY > targetY ? sourceY - targetY : targetY - sourceY;
	return rowDistance < height ? rowDistance : height;
}

export function gxGpuTransferX(xyWord: number): number {
	return xyWord & 0x3ff;
}

export function gxGpuTransferY(xyWord: number, vramYAddressExtensionWord: number): number {
	return gxGpuVramYAddress(xyWord >>> 16, vramYAddressExtensionWord);
}

export function gxGpuTransferPixelWord(payloadWord: number, pixelIndex: number): number {
	return (pixelIndex & 1) === 0 ? payloadWord & 0xffff : payloadWord >>> 16;
}

export function gxGpuTransferPayloadPixelCount(commandWordCount: number): number {
	return (commandWordCount - 3) << 1;
}

export function gxGpuTransferEmittedPixelCount(width: number, height: number, commandWordCount: number): number {
	const areaPixels = width * height;
	const payloadPixels = gxGpuTransferPayloadPixelCount(commandWordCount);
	return payloadPixels < areaPixels ? payloadPixels : areaPixels;
}

export function gxGpuTextureU(textureWord: number): number {
	return textureWord & 0xff;
}

export function gxGpuTextureV(textureWord: number): number {
	return (textureWord >>> 8) & 0xff;
}

export function gxGpuTextureClutBaseX(textureWord: number): number {
	return (gxGpuTextureAttribute(textureWord) & 0x3f) << 4;
}

export function gxGpuTextureClutBaseY(textureWord: number, vramYAddressExtensionWord: number): number {
	return gxGpuVramYAddress(gxGpuTextureAttribute(textureWord) >>> 6, vramYAddressExtensionWord);
}

export function gxGpuDrawModeDitherEnabled(drawModeWord: number): boolean {
	return (drawModeWord & GX_GPU_DRAW_MODE_DITHER_ENABLED) !== 0;
}

export function gxGpuDrawModeTextureRectangleXFlip(drawModeWord: number): boolean {
	return (drawModeWord & GX_GPU_DRAW_MODE_TEXTURE_RECTANGLE_X_FLIP) !== 0;
}

export function gxGpuDrawModeTextureRectangleYFlip(drawModeWord: number): boolean {
	return (drawModeWord & GX_GPU_DRAW_MODE_TEXTURE_RECTANGLE_Y_FLIP) !== 0;
}

export function gxGpuSegmentExceedsPrimitiveSize(x0: number, y0: number, x1: number, y1: number): boolean {
	const left = x0 < x1 ? x0 : x1;
	const right = x0 > x1 ? x0 : x1;
	const top = y0 < y1 ? y0 : y1;
	const bottom = y0 > y1 ? y0 : y1;
	return right - left + 1 > GX_GPU_MAX_PRIMITIVE_WIDTH || bottom - top + 1 > GX_GPU_MAX_PRIMITIVE_HEIGHT;
}

export function gxGpuTriangleExceedsPrimitiveSize(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number): boolean {
	const min12x = x1 < x2 ? x1 : x2;
	const max12x = x1 > x2 ? x1 : x2;
	const min12y = y1 < y2 ? y1 : y2;
	const max12y = y1 > y2 ? y1 : y2;
	const left = x0 < min12x ? x0 : min12x;
	const right = x0 > max12x ? x0 : max12x;
	const top = y0 < min12y ? y0 : min12y;
	const bottom = y0 > max12y ? y0 : max12y;
	return right - left + 1 > GX_GPU_MAX_PRIMITIVE_WIDTH || bottom - top + 1 > GX_GPU_MAX_PRIMITIVE_HEIGHT;
}

export function gxGpuTriangleEdgeCoverageMinimum(stepX: number, stepY: number): number {
	return stepX > 0 || (stepX === 0 && stepY > 0) ? 0 : 1;
}

export function gxGpuDitheredPolygon(drawModeWord: number, opcode: number): boolean {
	return gxGpuDrawModeDitherEnabled(drawModeWord)
		&& (gxGpuCommandTextureEnabled(opcode)
			? !gxGpuCommandRawTextureEnabled(opcode)
			: gxGpuCommandGouraud(opcode));
}

export function gxGpuDrawModeTexturePageBaseX(drawModeWord: number): number {
	return (drawModeWord & 0x0f) << 6;
}

export function gxGpuDrawModeTexturePageBaseY(drawModeWord: number, vramYAddressExtensionWord: number): number {
	return gxGpuVramYAddress((((drawModeWord >>> 4) & 0x01) << 8) | (((drawModeWord >>> 11) & 0x01) << 9), vramYAddressExtensionWord);
}

export function gxGpuDrawModeTextureMode(drawModeWord: number): number {
	return (drawModeWord >>> 7) & 0x03;
}

export function gxGpuDrawModeTransparencyMode(drawModeWord: number): number {
	return (drawModeWord >>> 5) & 0x03;
}

export function gxGpuTextureWindowAndX(textureWindowWord: number): number {
	return (~((textureWindowWord & 0x1f) << 3)) & 0xff;
}

export function gxGpuTextureWindowAndY(textureWindowWord: number): number {
	return (~(((textureWindowWord >>> 5) & 0x1f) << 3)) & 0xff;
}

export function gxGpuTextureWindowOrX(textureWindowWord: number): number {
	return (((textureWindowWord >>> 10) & 0x1f) & (textureWindowWord & 0x1f)) << 3;
}

export function gxGpuTextureWindowOrY(textureWindowWord: number): number {
	return (((textureWindowWord >>> 15) & 0x1f) & ((textureWindowWord >>> 5) & 0x1f)) << 3;
}

export function gxGpuMaskBitSetWhileDrawing(maskBitModeWord: number): boolean {
	return (maskBitModeWord & 0x01) !== 0;
}

export function gxGpuMaskBitCheckBeforeDraw(maskBitModeWord: number): boolean {
	return (maskBitModeWord & 0x02) !== 0;
}

export function gxGpuDrawingAreaX(word: number): number {
	return word & 0x3ff;
}

export function gxGpuDrawingAreaY(word: number): number {
	return (word >>> 10) & 0x3ff;
}
