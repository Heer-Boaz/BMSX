import {
	GX_GPU_COMMAND_COPY_VRAM_TO_VRAM,
	GX_GPU_COMMAND_FILL_RECTANGLE,
	GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM,
	GX_GPU_INTERLACED_RENDER_ACTIVE_LINE_LSB,
	GX_GPU_INTERLACED_RENDER_ENABLE,
	GX_GPU_VRAM_HEIGHT,
	GX_GPU_VRAM_WIDTH,
	gxGpuDisplayModeDotClockDivider,
	gxGpuDisplayModeScreenWidth,
	gxGpuDisplayStartX,
	gxGpuDisplayStartY,
	gxGpuFillHeight,
	gxGpuFillWidth,
	gxGpuFillX,
	gxGpuHorizontalDisplayRangeEnd,
	gxGpuHorizontalDisplayRangeStart,
	gxGpuMaskBitCheckBeforeDraw,
	gxGpuMaskBitSetWhileDrawing,
	gxGpuTransferEmittedPixelCount,
	gxGpuTransferHeight,
	gxGpuTransferPixelWord,
	gxGpuTransferWidth,
	gxGpuTransferX,
	gxGpuTransferY,
	type GxGpuCommandBufferView,
} from '../../../machine/devices/gx/gpu_command_buffer';
import { GX_GPU_STATUS_DISPLAY_DISABLE } from '../../../machine/devices/gx/gpu';
import type { GxGpuPipelineState } from '../backend';

const GX_GPU_SOFTWARE_VRAM_WORDS = GX_GPU_VRAM_WIDTH * GX_GPU_VRAM_HEIGHT;
const GX_GPU_DISPLAY_MODE_RGB24_BIT = 0x10;
const GX_GPU_DISPLAY_MODE_PAL_BIT = 0x08;
const GX_GPU_DISPLAY_MODE_VERTICAL_RESOLUTION_BIT = 0x04;
const GX_GPU_DISPLAY_MODE_VERTICAL_INTERLACE_BIT = 0x20;
const GX_GPU_SCANOUT_NTSC_OVERSCAN_LEFT = 608;
const GX_GPU_SCANOUT_PAL_OVERSCAN_LEFT = 638;
const GX_GPU_SCANOUT_NTSC_OVERSCAN_TOP = 16;
const GX_GPU_SCANOUT_PAL_OVERSCAN_TOP = 35;

const gxGpuSoftwareVram = new Uint16Array(GX_GPU_SOFTWARE_VRAM_WORDS);
const gxGpuSoftwareCopyScratch = new Uint16Array(GX_GPU_SOFTWARE_VRAM_WORDS);
let gxGpuSoftwareProcessedCommandCount = 0;
let gxGpuSoftwareProcessedCommandSerial = 0;

function integerDivide(numerator: number, denominator: number): number {
	return (numerator - (numerator % denominator)) / denominator;
}

function truncateDivide(numerator: number, denominator: number): number {
	return numerator < 0 ? -integerDivide(-numerator, denominator) : integerDivide(numerator, denominator);
}

function vramIndex(x: number, y: number): number {
	return ((y & (GX_GPU_VRAM_HEIGHT - 1)) * GX_GPU_VRAM_WIDTH) + (x & (GX_GPU_VRAM_WIDTH - 1));
}

function rgb888WordToRgb555(word: number): number {
	return ((word & 0xff) >>> 3)
		| ((((word >>> 8) & 0xff) >>> 3) << 5)
		| ((((word >>> 16) & 0xff) >>> 3) << 10);
}

function rgb555ChannelTo8(channel: number): number {
	return (channel << 3) | (channel >>> 2);
}

function writeMaskedVramWord(index: number, word: number, maskBitModeWord: number): void {
	const dstWord = gxGpuSoftwareVram[index];
	if (gxGpuMaskBitCheckBeforeDraw(maskBitModeWord) && (dstWord & 0x8000) !== 0) {
		return;
	}
	const maskBit = gxGpuMaskBitSetWhileDrawing(maskBitModeWord) ? 0x8000 : word & 0x8000;
	gxGpuSoftwareVram[index] = (word & 0x7fff) | maskBit;
}

function interlacedFillSkipsLine(y: number, interlacedRenderWord: number): boolean {
	return (interlacedRenderWord & GX_GPU_INTERLACED_RENDER_ENABLE) !== 0
		&& (y & 1) === ((interlacedRenderWord & GX_GPU_INTERLACED_RENDER_ACTIVE_LINE_LSB) >>> 1);
}

function executeFillRectangle(commandBuffer: GxGpuCommandBufferView, commandIndex: number): void {
	const wordStart = commandBuffer.commandWordStart[commandIndex];
	const colorWord = rgb888WordToRgb555(commandBuffer.words[wordStart]);
	const xyWord = commandBuffer.words[wordStart + 1];
	const sizeWord = commandBuffer.words[wordStart + 2];
	const x = gxGpuFillX(xyWord);
	const y = gxGpuTransferY(xyWord);
	const width = gxGpuFillWidth(sizeWord);
	const height = gxGpuFillHeight(sizeWord);
	const interlacedRenderWord = commandBuffer.commandInterlacedRenderWord[commandIndex];
	for (let row = 0; row < height; row += 1) {
		const targetY = (y + row) & (GX_GPU_VRAM_HEIGHT - 1);
		if (interlacedFillSkipsLine(targetY, interlacedRenderWord)) {
			continue;
		}
		for (let column = 0; column < width; column += 1) {
			gxGpuSoftwareVram[vramIndex(x + column, targetY)] = colorWord;
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
			writeMaskedVramWord(vramIndex(x + column, targetY), gxGpuTransferPixelWord(payloadWord, emittedPixel), maskBitModeWord);
			emittedPixel += 1;
		}
	}
}

function copyVramArea(sourceX: number, sourceY: number, targetX: number, targetY: number, width: number, height: number, maskBitModeWord: number): void {
	let scratchIndex = 0;
	for (let row = 0; row < height; row += 1) {
		const rowSourceY = sourceY + row;
		for (let column = 0; column < width; column += 1) {
			gxGpuSoftwareCopyScratch[scratchIndex] = gxGpuSoftwareVram[vramIndex(sourceX + column, rowSourceY)];
			scratchIndex += 1;
		}
	}
	scratchIndex = 0;
	for (let row = 0; row < height; row += 1) {
		const rowTargetY = targetY + row;
		for (let column = 0; column < width; column += 1) {
			writeMaskedVramWord(vramIndex(targetX + column, rowTargetY), gxGpuSoftwareCopyScratch[scratchIndex], maskBitModeWord);
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

function executeGxGpuSoftwareCommands(commandBuffer: GxGpuCommandBufferView): void {
	for (let commandIndex = gxGpuSoftwareProcessedCommandCount; commandIndex < commandBuffer.commandCount; commandIndex += 1) {
		switch (commandBuffer.commandKind[commandIndex]) {
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
	gxGpuSoftwareProcessedCommandCount = commandBuffer.commandCount;
}

function displayModeScreenHeight(displayModeWord: number): number {
	const highVerticalResolution = (displayModeWord & GX_GPU_DISPLAY_MODE_VERTICAL_RESOLUTION_BIT) !== 0;
	if ((displayModeWord & GX_GPU_DISPLAY_MODE_PAL_BIT) !== 0) {
		return highVerticalResolution ? 512 : 256;
	}
	return highVerticalResolution ? 480 : 240;
}

function screenXForOutputPixel(outputX: number, targetWidth: number, screenWidth: number): number {
	return integerDivide(((outputX << 1) + 1) * screenWidth, targetWidth << 1);
}

function screenYForOutputPixel(outputY: number, targetHeight: number, screenHeight: number): number {
	return integerDivide(((outputY << 1) + 1) * screenHeight, targetHeight << 1);
}

function visibleColumns(horizontalDisplayRangeWord: number, dotClockDivider: number): number {
	const columns = truncateDivide(gxGpuHorizontalDisplayRangeEnd(horizontalDisplayRangeWord) - gxGpuHorizontalDisplayRangeStart(horizontalDisplayRangeWord), dotClockDivider) + 2;
	return columns & ~0x03;
}

function rgb888AtSourcePixel(sourceX: number, sourceY: number, displayStartX: number): number {
	const wordX = displayStartX + integerDivide(sourceX * 3, 2);
	const word0 = gxGpuSoftwareVram[vramIndex(wordX, sourceY)];
	const word1 = gxGpuSoftwareVram[vramIndex(wordX + 1, sourceY)];
	if ((sourceX & 1) === 0) {
		return (word0 & 0xff) | ((word0 >>> 8) << 8) | ((word1 & 0xff) << 16);
	}
	return (word0 >>> 8) | ((word1 & 0xff) << 8) | (((word1 >>> 8) & 0xff) << 16);
}

function rgb555AtSourcePixel(sourceX: number, sourceY: number): number {
	const word = gxGpuSoftwareVram[vramIndex(sourceX, sourceY)];
	return rgb555ChannelTo8(word & 0x1f)
		| (rgb555ChannelTo8((word >>> 5) & 0x1f) << 8)
		| (rgb555ChannelTo8((word >>> 10) & 0x1f) << 16);
}

function writeOutputRgb(target: Uint8Array, offset: number, rgb: number): void {
	target[offset] = rgb & 0xff;
	target[offset + 1] = (rgb >>> 8) & 0xff;
	target[offset + 2] = (rgb >>> 16) & 0xff;
	target[offset + 3] = 255;
}

function scanoutGxGpuSoftwareVram(state: GxGpuPipelineState, target: Uint8Array, targetWidth: number, targetHeight: number): void {
	if ((state.statusWord & GX_GPU_STATUS_DISPLAY_DISABLE) !== 0) {
		target.fill(0);
		for (let offset = 3; offset < target.length; offset += 4) {
			target[offset] = 255;
		}
		return;
	}
	const displayModeWord = state.displayModeWord;
	const screenWidth = gxGpuDisplayModeScreenWidth(displayModeWord);
	const screenHeight = displayModeScreenHeight(displayModeWord);
	const dotClockDivider = gxGpuDisplayModeDotClockDivider(displayModeWord);
	const horizontalStart = gxGpuHorizontalDisplayRangeStart(state.horizontalDisplayRangeWord);
	const verticalStart = state.verticalDisplayRangeWord & 0x3ff;
	const verticalEnd = (state.verticalDisplayRangeWord >>> 10) & 0x3ff;
	const overscanLeft = (displayModeWord & GX_GPU_DISPLAY_MODE_PAL_BIT) !== 0 ? GX_GPU_SCANOUT_PAL_OVERSCAN_LEFT : GX_GPU_SCANOUT_NTSC_OVERSCAN_LEFT;
	const overscanTop = (displayModeWord & GX_GPU_DISPLAY_MODE_PAL_BIT) !== 0 ? GX_GPU_SCANOUT_PAL_OVERSCAN_TOP : GX_GPU_SCANOUT_NTSC_OVERSCAN_TOP;
	let originLeft = truncateDivide(horizontalStart - overscanLeft, dotClockDivider);
	let sourceSkipX = 0;
	let columns = visibleColumns(state.horizontalDisplayRangeWord, dotClockDivider);
	if (originLeft < 0) {
		sourceSkipX = -originLeft;
		columns += originLeft;
		originLeft = 0;
	}
	const maxColumns = screenWidth - originLeft;
	if (columns > maxColumns) {
		columns = maxColumns;
	}
	let originTop = verticalStart - overscanTop;
	let sourceSkipY = 0;
	let lines = verticalEnd - verticalStart;
	if (originTop < 0) {
		sourceSkipY = -originTop;
		lines += originTop;
		originTop = 0;
	}
	if ((displayModeWord & GX_GPU_DISPLAY_MODE_VERTICAL_INTERLACE_BIT) !== 0) {
		lines <<= 1;
	}
	const maxLines = screenHeight - originTop;
	if (lines > maxLines) {
		lines = maxLines;
	}
	const displayStartX = gxGpuDisplayStartX(state.displayStartWord);
	const displayStartY = gxGpuDisplayStartY(state.displayStartWord);
	const rgb24 = (displayModeWord & GX_GPU_DISPLAY_MODE_RGB24_BIT) !== 0;
	let offset = 0;
	for (let outputY = 0; outputY < targetHeight; outputY += 1) {
		const screenY = screenYForOutputPixel(outputY, targetHeight, screenHeight);
		for (let outputX = 0; outputX < targetWidth; outputX += 1) {
			const screenX = screenXForOutputPixel(outputX, targetWidth, screenWidth);
			let rgb = 0;
			if (screenX >= originLeft && screenY >= originTop && screenX < originLeft + columns && screenY < originTop + lines) {
				const sourceX = sourceSkipX + screenX - originLeft;
				const sourceY = displayStartY + sourceSkipY + screenY - originTop;
				rgb = rgb24 ? rgb888AtSourcePixel(sourceX, sourceY, displayStartX) : rgb555AtSourcePixel(displayStartX + sourceX, sourceY);
			}
			writeOutputRgb(target, offset, rgb);
			offset += 4;
		}
	}
}

export function renderGxGpuSoftwareFrame(state: GxGpuPipelineState, target: Uint8Array, targetWidth: number, targetHeight: number): void {
	if (gxGpuSoftwareProcessedCommandSerial !== state.commandBuffer.serial) {
		gxGpuSoftwareVram.fill(0);
		gxGpuSoftwareProcessedCommandCount = 0;
		gxGpuSoftwareProcessedCommandSerial = state.commandBuffer.serial;
	}
	executeGxGpuSoftwareCommands(state.commandBuffer);
	scanoutGxGpuSoftwareVram(state, target, targetWidth, targetHeight);
}
