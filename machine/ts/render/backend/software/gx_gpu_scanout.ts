import {
	gxGpuDisplayStartY,
} from '../../../machine/devices/gx/gpu_command_buffer';
import { GX_GPU_STATUS_DISPLAY_DISABLE } from '../../../machine/devices/gx/gpu';
import type { GxGpuPipelineState } from '../backend';
import {
	gxGpuDisplayModeDotClockDivider,
	gxGpuDisplayModeScreenWidth,
	gxGpuDisplayStartX,
	gxGpuHorizontalDisplayRangeEnd,
	gxGpuHorizontalDisplayRangeStart,
} from '../gx_gpu_render_rules';
import {
	gxGpuSoftwareRgb555ChannelTo8,
	gxGpuSoftwareVram,
	gxGpuSoftwareVramIndex,
} from './gx_gpu_vram';

const GX_GPU_DISPLAY_MODE_RGB24_BIT = 0x10;
const GX_GPU_DISPLAY_MODE_PAL_BIT = 0x08;
const GX_GPU_DISPLAY_MODE_VERTICAL_RESOLUTION_BIT = 0x04;
const GX_GPU_DISPLAY_MODE_VERTICAL_INTERLACE_BIT = 0x20;
const GX_GPU_SCANOUT_NTSC_OVERSCAN_LEFT = 608;
const GX_GPU_SCANOUT_PAL_OVERSCAN_LEFT = 638;
const GX_GPU_SCANOUT_NTSC_OVERSCAN_TOP = 16;
const GX_GPU_SCANOUT_PAL_OVERSCAN_TOP = 35;

function integerDivide(numerator: number, denominator: number): number {
	return (numerator - (numerator % denominator)) / denominator;
}

function truncateDivide(numerator: number, denominator: number): number {
	return numerator < 0 ? -integerDivide(-numerator, denominator) : integerDivide(numerator, denominator);
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
	const word0 = gxGpuSoftwareVram[gxGpuSoftwareVramIndex(wordX, sourceY)];
	const word1 = gxGpuSoftwareVram[gxGpuSoftwareVramIndex(wordX + 1, sourceY)];
	if ((sourceX & 1) === 0) {
		return (word0 & 0xff) | ((word0 >>> 8) << 8) | ((word1 & 0xff) << 16);
	}
	return (word0 >>> 8) | ((word1 & 0xff) << 8) | (((word1 >>> 8) & 0xff) << 16);
}

function rgb555AtSourcePixel(sourceX: number, sourceY: number): number {
	const word = gxGpuSoftwareVram[gxGpuSoftwareVramIndex(sourceX, sourceY)];
	return gxGpuSoftwareRgb555ChannelTo8(word & 0x1f)
		| (gxGpuSoftwareRgb555ChannelTo8((word >>> 5) & 0x1f) << 8)
		| (gxGpuSoftwareRgb555ChannelTo8((word >>> 10) & 0x1f) << 16);
}

function writeOutputRgb(target: Uint8Array, offset: number, rgb: number): void {
	target[offset] = rgb & 0xff;
	target[offset + 1] = (rgb >>> 8) & 0xff;
	target[offset + 2] = (rgb >>> 16) & 0xff;
	target[offset + 3] = 255;
}

export function scanoutGxGpuSoftwareVram(state: GxGpuPipelineState, target: Uint8Array, targetWidth: number, targetHeight: number): void {
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
