import {
	GX_GPU_GP0_DRAW_MODE,
	GX_GPU_GP0_TEXTURE_WINDOW,
	GX_GPU_GP0_DRAWING_AREA_TOP_LEFT,
	GX_GPU_GP0_DRAWING_AREA_BOTTOM_RIGHT,
	GX_GPU_GP0_DRAWING_OFFSET,
	GX_GPU_GP0_MASK_BIT,
	GX_GPU_GP0_FILL_RECTANGLE,
	GX_GPU_GP0_POLYGON_FIRST,
	GX_GPU_GP0_POLYGON_LAST,
	GX_GPU_GP0_LINE_FIRST,
	GX_GPU_GP0_LINE_LAST,
	GX_GPU_GP0_RECTANGLE_FIRST,
	GX_GPU_GP0_RECTANGLE_LAST,
	GX_GPU_GP0_VRAM_TO_VRAM_FIRST,
	GX_GPU_GP0_VRAM_TO_VRAM_LAST,
	GX_GPU_GP0_CPU_TO_VRAM_FIRST,
	GX_GPU_GP0_CPU_TO_VRAM_LAST,
	GX_GPU_GP0_VRAM_TO_CPU_FIRST,
	GX_GPU_GP0_VRAM_TO_CPU_LAST,
	GX_GPU_DRAW_MODE_DRAW_TO_DISPLAYED_FIELD,
	gxGpuPolygonTexturePageWordIndex,
	gxGpuPolygonDrawModeWord,
	gxGpuTextureAttribute,
	GX_GPU_TEXTURE_MODE_DIRECT16,
	GX_GPU_TEXTURE_MODE_PALETTE4,
	GX_GPU_TEXTURE_MODE_PALETTE8,
	gxGpuDrawingAreaBottomExclusive,
	gxGpuDrawingAreaLeft,
	gxGpuDrawingAreaRightExclusive,
	gxGpuDrawingAreaTop,
	gxGpuSigned11,
} from '../../../spec/gx/gp0';
import {
	GX_GPU_COMMAND_COPY_VRAM_TO_VRAM,
	GX_GPU_COMMAND_DRAW_LINE,
	GX_GPU_COMMAND_DRAW_POLYGON,
	GX_GPU_COMMAND_DRAW_POLYLINE,
	GX_GPU_COMMAND_DRAW_RECTANGLE,
	GX_GPU_COMMAND_FILL_RECTANGLE,
	GX_GPU_COMMAND_READ_VRAM_TO_CPU,
	GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM,
	GX_GPU_SKIPPED_LINE_NONE,
	type GxGpuDrawState,
	type GxGpuPacket,
	GX_GPU_DRAW_MODE_MASK,
	GX_GPU_TEXTURE_WINDOW_MASK,
	GX_GPU_DRAWING_AREA_MASK,
	GX_GPU_DRAWING_OFFSET_MASK,
	GX_GPU_MASK_BIT_MODE_MASK,
} from './gpu_packet';

export const GX_GPU_COMMAND_TICKS_PER_CPU_CYCLE = 2;

function lineTicks(
	x0: number,
	y0: number,
	x1: number,
	y1: number,
	drawingAreaTopLeftWord: number,
	drawingAreaBottomRightWord: number,
	vramYAddressExtensionWord: number,
	skippedLineParity: number,
): number {
	const sourceLeft = x0 < x1 ? x0 : x1;
	const sourceRight = x0 > x1 ? x0 : x1;
	const sourceTop = y0 < y1 ? y0 : y1;
	const sourceBottom = y0 > y1 ? y0 : y1;
	if (sourceRight - sourceLeft + 1 > 1024 || sourceBottom - sourceTop + 1 > 512) return 0;
	const areaLeft = gxGpuDrawingAreaLeft(drawingAreaTopLeftWord, drawingAreaBottomRightWord);
	const areaTop = gxGpuDrawingAreaTop(drawingAreaTopLeftWord, drawingAreaBottomRightWord, vramYAddressExtensionWord);
	const areaRight = gxGpuDrawingAreaRightExclusive(drawingAreaTopLeftWord, drawingAreaBottomRightWord);
	const areaBottom = gxGpuDrawingAreaBottomExclusive(drawingAreaTopLeftWord, drawingAreaBottomRightWord, vramYAddressExtensionWord);
	const left = sourceLeft > areaLeft ? sourceLeft : areaLeft;
	const top = sourceTop > areaTop ? sourceTop : areaTop;
	const right = sourceRight + 1 < areaRight ? sourceRight + 1 : areaRight;
	const bottom = sourceBottom + 1 < areaBottom ? sourceBottom + 1 : areaBottom;
	if (left >= right || top >= bottom) return 0;
	const width = right - left;
	let height = bottom - top;
	if (skippedLineParity !== GX_GPU_SKIPPED_LINE_NONE) {
		height >>= 1;
		if (height === 0) height = 1;
	}
	return width > height ? width : height;
}

function triangleTicks(
	x0: number,
	y0: number,
	x1: number,
	y1: number,
	x2: number,
	y2: number,
	textured: boolean,
	semiTransparent: boolean,
	drawingAreaTopLeftWord: number,
	drawingAreaBottomRightWord: number,
	vramYAddressExtensionWord: number,
	maskBitModeWord: number,
	skippedLineParity: number,
): number {
	const min12X = x1 < x2 ? x1 : x2;
	const max12X = x1 > x2 ? x1 : x2;
	const min12Y = y1 < y2 ? y1 : y2;
	const max12Y = y1 > y2 ? y1 : y2;
	const sourceLeft = x0 < min12X ? x0 : min12X;
	const sourceRight = x0 > max12X ? x0 : max12X;
	const sourceTop = y0 < min12Y ? y0 : min12Y;
	const sourceBottom = y0 > max12Y ? y0 : max12Y;
	if (sourceRight - sourceLeft + 1 > 1024 || sourceBottom - sourceTop + 1 > 512) return 0;
	const left = gxGpuDrawingAreaLeft(drawingAreaTopLeftWord, drawingAreaBottomRightWord);
	const top = gxGpuDrawingAreaTop(drawingAreaTopLeftWord, drawingAreaBottomRightWord, vramYAddressExtensionWord);
	const right = gxGpuDrawingAreaRightExclusive(drawingAreaTopLeftWord, drawingAreaBottomRightWord);
	const bottom = gxGpuDrawingAreaBottomExclusive(drawingAreaTopLeftWord, drawingAreaBottomRightWord, vramYAddressExtensionWord);
	if (left >= right || top >= bottom) return 0;
	const rightEdge = right - 1;
	const bottomEdge = bottom - 1;
	x0 = x0 < left ? left : (x0 > rightEdge ? rightEdge : x0);
	y0 = y0 < top ? top : (y0 > bottomEdge ? bottomEdge : y0);
	x1 = x1 < left ? left : (x1 > rightEdge ? rightEdge : x1);
	y1 = y1 < top ? top : (y1 > bottomEdge ? bottomEdge : y1);
	x2 = x2 < left ? left : (x2 > rightEdge ? rightEdge : x2);
	y2 = y2 < top ? top : (y2 > bottomEdge ? bottomEdge : y2);
	let doubleArea = x0 * y1 + x1 * y2 + x2 * y0 - x0 * y2 - x1 * y0 - x2 * y1;
	if (doubleArea < 0) doubleArea = -doubleArea;
	let pixels = (doubleArea - (doubleArea & 1)) / 2;
	if (textured) pixels += pixels;
	if (semiTransparent || (maskBitModeWord & 0x02) !== 0) pixels += (pixels + 1) >> 1;
	if (skippedLineParity !== GX_GPU_SKIPPED_LINE_NONE) pixels >>= 1;
	return pixels;
}

function polygonTicks(
	opcode: number,
	words: ArrayLike<number>,
	wordStart: number,
	stride: number,
	vramYAddressExtensionWord: number,
	drawingAreaTopLeftWord: number,
	drawingAreaBottomRightWord: number,
	drawingOffsetWord: number,
	maskBitModeWord: number,
	skippedLineParity: number,
): number {
	const packetTextured = (opcode & 0x04) !== 0;
	const textured = packetTextured;
	const quad = (opcode & 0x08) !== 0;
	const gouraud = (opcode & 0x10) !== 0;
	let ticks = (quad ? 82 : 46) + (gouraud ? 288 : 0) + (textured ? (gouraud ? 162 : 180) : 0);
	const offsetX = gxGpuSigned11(drawingOffsetWord);
	const offsetY = gxGpuSigned11(drawingOffsetWord >>> 11);
	const vertex0 = words[wordStart + 1]!;
	const vertex1 = words[wordStart + 1 + stride]!;
	const vertex2 = words[wordStart + 1 + stride * 2]!;
	const x0 = gxGpuSigned11(vertex0) + offsetX;
	const y0 = gxGpuSigned11(vertex0 >>> 16) + offsetY;
	const x1 = gxGpuSigned11(vertex1) + offsetX;
	const y1 = gxGpuSigned11(vertex1 >>> 16) + offsetY;
	const x2 = gxGpuSigned11(vertex2) + offsetX;
	const y2 = gxGpuSigned11(vertex2 >>> 16) + offsetY;
	const semiTransparent = (opcode & 0x02) !== 0;
	ticks += triangleTicks(x0, y0, x1, y1, x2, y2, textured, semiTransparent, drawingAreaTopLeftWord, drawingAreaBottomRightWord, vramYAddressExtensionWord, maskBitModeWord, skippedLineParity);
	if (quad) {
		const vertex3 = words[wordStart + 1 + stride * 3]!;
		const x3 = gxGpuSigned11(vertex3) + offsetX;
		const y3 = gxGpuSigned11(vertex3 >>> 16) + offsetY;
		ticks += triangleTicks(x2, y2, x1, y1, x3, y3, textured, semiTransparent, drawingAreaTopLeftWord, drawingAreaBottomRightWord, vramYAddressExtensionWord, maskBitModeWord, skippedLineParity);
	}
	return ticks;
}

function rectangleTicks(
	opcode: number,
	words: ArrayLike<number>,
	wordStart: number,
	sizeOffset: number,
	drawModeWord: number,
	vramYAddressExtensionWord: number,
	drawingAreaTopLeftWord: number,
	drawingAreaBottomRightWord: number,
	drawingOffsetWord: number,
	maskBitModeWord: number,
	skippedLineParity: number,
): number {
	let width: number;
	let height: number;
	switch (opcode & 0x18) {
		case 0x08:
			width = 1;
			height = 1;
			break;
		case 0x10:
			width = 8;
			height = 8;
			break;
		case 0x18:
			width = 16;
			height = 16;
			break;
		default: {
			const sizeWord = words[wordStart + sizeOffset]!;
			width = sizeWord & 0x3ff;
			height = (sizeWord >>> 16) & 0x1ff;
			break;
		}
	}
	const positionWord = words[wordStart + 1]!;
	const x = gxGpuSigned11(positionWord) + gxGpuSigned11(drawingOffsetWord);
	const y = gxGpuSigned11(positionWord >>> 16) + gxGpuSigned11(drawingOffsetWord >>> 11);
	const areaLeft = gxGpuDrawingAreaLeft(drawingAreaTopLeftWord, drawingAreaBottomRightWord);
	const areaTop = gxGpuDrawingAreaTop(drawingAreaTopLeftWord, drawingAreaBottomRightWord, vramYAddressExtensionWord);
	const areaRight = gxGpuDrawingAreaRightExclusive(drawingAreaTopLeftWord, drawingAreaBottomRightWord);
	const areaBottom = gxGpuDrawingAreaBottomExclusive(drawingAreaTopLeftWord, drawingAreaBottomRightWord, vramYAddressExtensionWord);
	const left = x > areaLeft ? x : areaLeft;
	const top = y > areaTop ? y : areaTop;
	const right = x + width < areaRight ? x + width : areaRight;
	const bottom = y + height < areaBottom ? y + height : areaBottom;
	if (left >= right || top >= bottom) return 16;
	const drawnWidth = right - left;
	let drawnHeight = bottom - top;
	let ticksPerRow = drawnWidth;
	const textured = (opcode & 0x04) !== 0;
	if (textured) {
		switch ((drawModeWord >>> 7) & 0x3) {
			case GX_GPU_TEXTURE_MODE_PALETTE4:
				ticksPerRow += drawnWidth;
				break;
			case GX_GPU_TEXTURE_MODE_PALETTE8:
				if (drawnWidth > 128) {
					ticksPerRow += (drawnWidth >> 2) * 8;
				} else if (drawnWidth * drawnHeight > 2048) {
					const rowsPerCache = (128 - (128 % drawnWidth)) / drawnWidth;
					ticksPerRow += (drawnWidth >> 2) * (4 * rowsPerCache);
				} else {
					ticksPerRow += drawnWidth;
				}
				break;
			case GX_GPU_TEXTURE_MODE_DIRECT16:
			default:
				if (drawnWidth > 128) {
					ticksPerRow += (drawnWidth >> 1) * 8;
				} else if (drawnWidth * drawnHeight > 1024) {
					const rowsPerCache = (128 - (128 % drawnWidth)) / drawnWidth;
					ticksPerRow += (drawnWidth >> 2) * (8 * rowsPerCache);
				} else {
					ticksPerRow += drawnWidth;
				}
				break;
		}
	}
	if ((opcode & 0x02) !== 0 || (maskBitModeWord & 0x02) !== 0) ticksPerRow += (drawnWidth + 1) >> 1;
	if (skippedLineParity !== GX_GPU_SKIPPED_LINE_NONE) {
		drawnHeight >>= 1;
		if (drawnHeight === 0) drawnHeight = 1;
	}
	return 16 + ticksPerRow * drawnHeight;
}

function polylineTicks(
	words: ArrayLike<number>,
	wordStart: number,
	vertexCount: number,
	stride: number,
	drawingAreaTopLeftWord: number,
	drawingAreaBottomRightWord: number,
	vramYAddressExtensionWord: number,
	drawingOffsetWord: number,
	skippedLineParity: number,
): number {
	const offsetX = gxGpuSigned11(drawingOffsetWord);
	const offsetY = gxGpuSigned11(drawingOffsetWord >>> 11);
	let positionIndex = wordStart + 1;
	let positionWord = words[positionIndex]!;
	let x0 = gxGpuSigned11(positionWord) + offsetX;
	let y0 = gxGpuSigned11(positionWord >>> 16) + offsetY;
	let ticks = 16;
	positionIndex += stride;
	for (let vertex = 1; vertex < vertexCount; ++vertex) {
		positionWord = words[positionIndex]!;
		const x1 = gxGpuSigned11(positionWord) + offsetX;
		const y1 = gxGpuSigned11(positionWord >>> 16) + offsetY;
		ticks += lineTicks(x0, y0, x1, y1, drawingAreaTopLeftWord, drawingAreaBottomRightWord, vramYAddressExtensionWord, skippedLineParity);
		x0 = x1;
		y0 = y1;
		positionIndex += stride;
	}
	return ticks;
}

export function gxGpuPacketTicks(
	kind: number, opcode: number, words: ArrayLike<number>, wordStart: number,
	vertexCount: number, positionStride: number, sizeOffset: number,
	state: Readonly<GxGpuDrawState>,
): number {
	const drawModeWord = state.drawModeWord;
	const vramYAddressExtensionWord = state.vramYAddressExtensionWord;
	const drawingAreaTopLeftWord = state.drawingAreaTopLeftWord;
	const drawingAreaBottomRightWord = state.drawingAreaBottomRightWord;
	const drawingOffsetWord = state.drawingOffsetWord;
	const maskBitModeWord = state.maskBitModeWord;
	const skippedLineParity = (drawModeWord & GX_GPU_DRAW_MODE_DRAW_TO_DISPLAYED_FIELD) !== 0
		? GX_GPU_SKIPPED_LINE_NONE : state.skippedLineParity;
	switch (kind) {
		case GX_GPU_COMMAND_DRAW_POLYGON:
			return polygonTicks(opcode, words, wordStart, positionStride, vramYAddressExtensionWord, drawingAreaTopLeftWord, drawingAreaBottomRightWord, drawingOffsetWord, maskBitModeWord, skippedLineParity);
		case GX_GPU_COMMAND_DRAW_LINE: {
			const offsetX = gxGpuSigned11(drawingOffsetWord);
			const offsetY = gxGpuSigned11(drawingOffsetWord >>> 11);
			const first = words[wordStart + 1]!;
			const second = words[wordStart + 1 + positionStride]!;
			return lineTicks(gxGpuSigned11(first) + offsetX, gxGpuSigned11(first >>> 16) + offsetY, gxGpuSigned11(second) + offsetX, gxGpuSigned11(second >>> 16) + offsetY, drawingAreaTopLeftWord, drawingAreaBottomRightWord, vramYAddressExtensionWord, skippedLineParity);
		}
		case GX_GPU_COMMAND_DRAW_POLYLINE:
			return polylineTicks(words, wordStart, vertexCount, positionStride, drawingAreaTopLeftWord, drawingAreaBottomRightWord, vramYAddressExtensionWord, drawingOffsetWord, skippedLineParity);
		case GX_GPU_COMMAND_DRAW_RECTANGLE:
			return rectangleTicks(opcode, words, wordStart, sizeOffset, drawModeWord, vramYAddressExtensionWord, drawingAreaTopLeftWord, drawingAreaBottomRightWord, drawingOffsetWord, maskBitModeWord, skippedLineParity);
		case GX_GPU_COMMAND_FILL_RECTANGLE: {
			const sizeWord = words[wordStart + 2]!;
			const width = ((sizeWord & 0x3ff) + 0x0f) & ~0x0f;
			const height = (sizeWord >>> 16) & 0x1ff;
			return 46 + ((width >> 3) + 9) * height;
		}
		case GX_GPU_COMMAND_COPY_VRAM_TO_VRAM: {
			const sizeWord = words[wordStart + 3]!;
			const width = (((sizeWord & 0xffff) - 1) & 0x3ff) + 1;
			const height = ((((sizeWord >>> 16) & 0xffff) - 1) & 0x1ff) + 1;
			return width * height * 2;
		}
		case GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM:
		case GX_GPU_COMMAND_READ_VRAM_TO_CPU:
			return 1;
		default:
			return 1;
	}
}

export function prepareGpuPacket(
	packet: GxGpuPacket, wordCount: number,
	projectedState: GxGpuDrawState, kindOverride = 0, opcodeOverride = 0,
): void {
	const opcode = kindOverride !== 0 ? opcodeOverride : packet.words[0] >>> 24;
	packet.opcode = opcode;
	packet.wordCount = wordCount;
	let kind = 0;
	if (opcode === GX_GPU_GP0_FILL_RECTANGLE) kind = GX_GPU_COMMAND_FILL_RECTANGLE;
	else if (opcode >= GX_GPU_GP0_POLYGON_FIRST && opcode <= GX_GPU_GP0_POLYGON_LAST) kind = GX_GPU_COMMAND_DRAW_POLYGON;
	else if (opcode >= GX_GPU_GP0_LINE_FIRST && opcode <= GX_GPU_GP0_LINE_LAST) kind = (opcode & 0x08) !== 0 ? GX_GPU_COMMAND_DRAW_POLYLINE : GX_GPU_COMMAND_DRAW_LINE;
	else if (opcode >= GX_GPU_GP0_RECTANGLE_FIRST && opcode <= GX_GPU_GP0_RECTANGLE_LAST) kind = GX_GPU_COMMAND_DRAW_RECTANGLE;
	else if (opcode >= GX_GPU_GP0_VRAM_TO_VRAM_FIRST && opcode <= GX_GPU_GP0_VRAM_TO_VRAM_LAST) kind = GX_GPU_COMMAND_COPY_VRAM_TO_VRAM;
	else if (opcode >= GX_GPU_GP0_CPU_TO_VRAM_FIRST && opcode <= GX_GPU_GP0_CPU_TO_VRAM_LAST) kind = GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM;
	else if (opcode >= GX_GPU_GP0_VRAM_TO_CPU_FIRST && opcode <= GX_GPU_GP0_VRAM_TO_CPU_LAST) kind = GX_GPU_COMMAND_READ_VRAM_TO_CPU;
	packet.kind = kind = kindOverride !== 0 ? kindOverride : kind;
	const gouraud = (opcode >>> 4) & 1;
	packet.positionStride = 1;
	packet.vertexCount = 0;
	packet.colorStride = 0;
	packet.sizeOffset = 0;
	packet.controlWord = 0;
	packet.textureAttribute = 0;
	if (kind === GX_GPU_COMMAND_DRAW_POLYGON) {
		packet.positionStride += ((opcode >>> 2) & 1) + gouraud;
		packet.vertexCount = 3 + ((opcode >>> 3) & 1);
		if ((opcode & 0x04) !== 0) packet.textureAttribute = gxGpuTextureAttribute(packet.words[gxGpuPolygonTexturePageWordIndex(opcode)]);
	} else if (kind === GX_GPU_COMMAND_DRAW_LINE || kind === GX_GPU_COMMAND_DRAW_POLYLINE) {
		packet.positionStride += gouraud;
		packet.vertexCount = kind === GX_GPU_COMMAND_DRAW_LINE ? 2 : 1 + (((wordCount - 2) / packet.positionStride) | 0);
	} else if (kind === GX_GPU_COMMAND_DRAW_RECTANGLE) {
		packet.vertexCount = 1;
		packet.sizeOffset = wordCount - 1;
	}
	if (kind >= GX_GPU_COMMAND_DRAW_POLYGON && kind <= GX_GPU_COMMAND_DRAW_POLYLINE && gouraud !== 0) packet.colorStride = packet.positionStride;
	switch (opcode) {
		case GX_GPU_GP0_DRAW_MODE: packet.controlWord = packet.words[0] & GX_GPU_DRAW_MODE_MASK; break;
		case GX_GPU_GP0_TEXTURE_WINDOW: packet.controlWord = packet.words[0] & GX_GPU_TEXTURE_WINDOW_MASK; break;
		case GX_GPU_GP0_DRAWING_AREA_TOP_LEFT:
		case GX_GPU_GP0_DRAWING_AREA_BOTTOM_RIGHT: packet.controlWord = packet.words[0] & GX_GPU_DRAWING_AREA_MASK; break;
		case GX_GPU_GP0_DRAWING_OFFSET: packet.controlWord = packet.words[0] & GX_GPU_DRAWING_OFFSET_MASK; break;
		case GX_GPU_GP0_MASK_BIT: packet.controlWord = packet.words[0] & GX_GPU_MASK_BIT_MODE_MASK; break;
	}
	retimeGpuPacket(packet, projectedState);
}

export function retimeGpuPacket(packet: GxGpuPacket, projectedState: GxGpuDrawState): void {
	switch (packet.opcode) {
		case GX_GPU_GP0_DRAW_MODE: projectedState.drawModeWord = packet.controlWord; break;
		case GX_GPU_GP0_TEXTURE_WINDOW: projectedState.textureWindowWord = packet.controlWord; break;
		case GX_GPU_GP0_DRAWING_AREA_TOP_LEFT: projectedState.drawingAreaTopLeftWord = packet.controlWord; break;
		case GX_GPU_GP0_DRAWING_AREA_BOTTOM_RIGHT: projectedState.drawingAreaBottomRightWord = packet.controlWord; break;
		case GX_GPU_GP0_DRAWING_OFFSET: projectedState.drawingOffsetWord = packet.controlWord; break;
		case GX_GPU_GP0_MASK_BIT: projectedState.maskBitModeWord = packet.controlWord; break;
	}
	if (packet.kind === GX_GPU_COMMAND_DRAW_POLYGON && (packet.opcode & 0x04) !== 0) {
		projectedState.drawModeWord = gxGpuPolygonDrawModeWord(projectedState.drawModeWord, packet.textureAttribute) & GX_GPU_DRAW_MODE_MASK;
	}
	const drawState = packet.drawState;
	drawState.drawModeWord = projectedState.drawModeWord;
	drawState.vramYAddressExtensionWord = projectedState.vramYAddressExtensionWord;
	drawState.textureWindowWord = projectedState.textureWindowWord;
	drawState.drawingAreaTopLeftWord = projectedState.drawingAreaTopLeftWord;
	drawState.drawingAreaBottomRightWord = projectedState.drawingAreaBottomRightWord;
	drawState.drawingOffsetWord = projectedState.drawingOffsetWord;
	drawState.maskBitModeWord = projectedState.maskBitModeWord;
	drawState.skippedLineParity = (projectedState.drawModeWord & GX_GPU_DRAW_MODE_DRAW_TO_DISPLAYED_FIELD) !== 0
		? GX_GPU_SKIPPED_LINE_NONE : projectedState.skippedLineParity;
	packet.ticks = gxGpuPacketTicks(packet.kind, packet.opcode, packet.words, 0,
		packet.vertexCount, packet.positionStride, packet.sizeOffset, projectedState);
}
