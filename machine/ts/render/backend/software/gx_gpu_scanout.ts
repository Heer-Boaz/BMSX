import {
	gxGpuDisplayStartY,
} from '../../../machine/devices/gx/gpu_command_buffer';
import { GX_GPU_STATUS_DISPLAY_DISABLE } from '../../../machine/devices/gx/gpu';
import type { GxGpuPipelineState } from '../backend';
import {
	GX_GPU_DISPLAY_MODE_RGB24_BIT,
	gxGpuDisplayStartX,
	gxGpuHorizontalVisibleColumns,
	gxGpuVerticalVisibleLines,
} from '../gx_gpu_render_rules';
import {
	gxGpuSoftwareRgb555ChannelTo8,
	gxGpuSoftwareVram,
	gxGpuSoftwareVramIndex,
} from './gx_gpu_vram';

function integerDivide(numerator: number, denominator: number): number {
	return (numerator - (numerator % denominator)) / denominator;
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
	const columns = gxGpuHorizontalVisibleColumns(state.horizontalDisplayRangeWord, displayModeWord);
	const lines = gxGpuVerticalVisibleLines(state.verticalDisplayRangeWord, displayModeWord);
	const displayStartX = gxGpuDisplayStartX(state.displayStartWord);
	const displayStartY = gxGpuDisplayStartY(state.displayStartWord);
	const rgb24 = (displayModeWord & GX_GPU_DISPLAY_MODE_RGB24_BIT) !== 0;
	let offset = 0;
	for (let outputY = 0; outputY < targetHeight; outputY += 1) {
		const sourceY = displayStartY + integerDivide(((outputY << 1) + 1) * lines, targetHeight << 1);
		for (let outputX = 0; outputX < targetWidth; outputX += 1) {
			const sourceX = integerDivide(((outputX << 1) + 1) * columns, targetWidth << 1);
			const rgb = rgb24 ? rgb888AtSourcePixel(sourceX, sourceY, displayStartX) : rgb555AtSourcePixel(displayStartX + sourceX, sourceY);
			writeOutputRgb(target, offset, rgb);
			offset += 4;
		}
	}
}
