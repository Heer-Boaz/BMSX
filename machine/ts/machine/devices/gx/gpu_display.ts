export const GX_GPU_RESET_DISPLAY_MODE_WORD = 0x00000009;
export const GX_GPU_RESET_HORIZONTAL_DISPLAY_RANGE_WORD = 0x00c60260;
export const GX_GPU_RESET_VERTICAL_DISPLAY_RANGE_WORD = 0x00044c23;
export const GX_GPU_DISPLAY_MODE_VERTICAL_RESOLUTION_BIT = 0x04;
export const GX_GPU_DISPLAY_MODE_RGB24_BIT = 0x10;
export const GX_GPU_DISPLAY_MODE_VERTICAL_INTERLACE_BIT = 0x20;
export const GX_GPU_SCANOUT_INTERPRETATION_MASK = GX_GPU_DISPLAY_MODE_VERTICAL_RESOLUTION_BIT
	| GX_GPU_DISPLAY_MODE_RGB24_BIT
	| GX_GPU_DISPLAY_MODE_VERTICAL_INTERLACE_BIT;

export function gxGpuDisplayStartX(word: number): number {
	return word & 0x3ff;
}

export function gxGpuDisplayStartY(word: number): number {
	return (word >>> 10) & 0x1ff;
}

export function gxGpuScanoutField(statusWord: number): number {
	return ((statusWord >>> 13) ^ 1) & 1;
}

export function gxGpuScanoutSourceLineStep(displayModeWord: number): number {
	if ((displayModeWord & GX_GPU_DISPLAY_MODE_VERTICAL_INTERLACE_BIT) === 0) {
		return 0;
	}
	return (displayModeWord & GX_GPU_DISPLAY_MODE_VERTICAL_RESOLUTION_BIT) !== 0 ? 2 : 1;
}

export function gxGpuDisplayModeScreenWidth(displayModeWord: number): number {
	if ((displayModeWord & 0x40) !== 0) {
		return 368;
	}
	const horizontalResolution1 = displayModeWord & 0x03;
	if (horizontalResolution1 === 0) {
		return 256;
	}
	if (horizontalResolution1 === 1) {
		return 320;
	}
	if (horizontalResolution1 === 2) {
		return 512;
	}
	return 640;
}

export function gxGpuVerticalDisplayRangeStart(verticalDisplayRangeWord: number): number {
	return verticalDisplayRangeWord & 0x3ff;
}

export function gxGpuVerticalDisplayRangeEnd(verticalDisplayRangeWord: number): number {
	return (verticalDisplayRangeWord >>> 10) & 0x3ff;
}

export function gxGpuVerticalVisibleLines(verticalDisplayRangeWord: number, displayModeWord: number): number {
	const lines = gxGpuVerticalDisplayRangeEnd(verticalDisplayRangeWord) - gxGpuVerticalDisplayRangeStart(verticalDisplayRangeWord);
	return (displayModeWord & GX_GPU_DISPLAY_MODE_VERTICAL_INTERLACE_BIT) !== 0 ? lines * 2 : lines;
}
