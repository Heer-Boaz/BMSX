import {
	GX_GPU_INTERLACED_RENDER_ACTIVE_LINE_LSB,
	GX_GPU_INTERLACED_RENDER_ENABLE,
	GX_GPU_VRAM_HEIGHT,
	GX_GPU_VRAM_WIDTH,
	gxGpuMaskBitCheckBeforeDraw,
	gxGpuMaskBitSetWhileDrawing,
} from '../../../machine/devices/gx/gpu_command_buffer';

export const GX_GPU_SOFTWARE_VRAM_WORDS = GX_GPU_VRAM_WIDTH * GX_GPU_VRAM_HEIGHT;
export const gxGpuSoftwareVram = new Uint16Array(GX_GPU_SOFTWARE_VRAM_WORDS);

export function resetGxGpuSoftwareVram(): void {
	gxGpuSoftwareVram.fill(0);
}

export function gxGpuSoftwareVramIndex(x: number, y: number): number {
	return ((y & (GX_GPU_VRAM_HEIGHT - 1)) * GX_GPU_VRAM_WIDTH) + (x & (GX_GPU_VRAM_WIDTH - 1));
}

export function gxGpuSoftwareRgb888WordToRgb555(word: number): number {
	return ((word & 0xff) >>> 3)
		| ((((word >>> 8) & 0xff) >>> 3) << 5)
		| ((((word >>> 16) & 0xff) >>> 3) << 10);
}

export function gxGpuSoftwareRgb555ChannelTo8(channel: number): number {
	return (channel << 3) | (channel >>> 2);
}

export function gxGpuSoftwareWriteMaskedVramWord(index: number, word: number, maskBitModeWord: number): void {
	const dstWord = gxGpuSoftwareVram[index];
	if (gxGpuMaskBitCheckBeforeDraw(maskBitModeWord) && (dstWord & 0x8000) !== 0) {
		return;
	}
	const maskBit = gxGpuMaskBitSetWhileDrawing(maskBitModeWord) ? 0x8000 : word & 0x8000;
	gxGpuSoftwareVram[index] = (word & 0x7fff) | maskBit;
}

function ditherOffset(x: number, y: number): number {
	switch (((y & 3) << 2) | (x & 3)) {
		case 0: return -4;
		case 1: return 0;
		case 2: return -3;
		case 3: return 1;
		case 4: return 2;
		case 5: return -2;
		case 6: return 3;
		case 7: return -1;
		case 8: return -3;
		case 9: return 1;
		case 10: return -4;
		case 11: return 0;
		case 12: return 3;
		case 13: return -1;
		case 14: return 2;
		default: return -2;
	}
}

function ditheredByte(byte: number, offset: number): number {
	const value = byte + offset;
	if (value < 0) {
		return 0;
	}
	if (value > 255) {
		return 255;
	}
	return value;
}

function blendChannel5(src: number, dst: number, blendMode: number): number {
	switch (blendMode) {
		case 0:
			return (src + dst) >>> 1;
		case 1: {
			const sum = src + dst;
			return sum < 31 ? sum : 31;
		}
		case 2:
			return dst > src ? dst - src : 0;
		default: {
			const sum = dst + (src >>> 2);
			return sum < 31 ? sum : 31;
		}
	}
}

export function gxGpuSoftwareWriteRenderVramPixel(x: number, y: number, r8: number, g8: number, b8: number, ditherEnabled: boolean, blendEnabled: boolean, blendMode: number, maskBitModeWord: number): void {
	const index = gxGpuSoftwareVramIndex(x, y);
	const dstWord = gxGpuSoftwareVram[index];
	if (gxGpuMaskBitCheckBeforeDraw(maskBitModeWord) && (dstWord & 0x8000) !== 0) {
		return;
	}
	let r = r8;
	let g = g8;
	let b = b8;
	if (ditherEnabled) {
		const offset = ditherOffset(x, y);
		r = ditheredByte(r, offset);
		g = ditheredByte(g, offset);
		b = ditheredByte(b, offset);
	}
	let r5 = r >>> 3;
	let g5 = g >>> 3;
	let b5 = b >>> 3;
	if (blendEnabled) {
		r5 = blendChannel5(r5, dstWord & 0x1f, blendMode);
		g5 = blendChannel5(g5, (dstWord >>> 5) & 0x1f, blendMode);
		b5 = blendChannel5(b5, (dstWord >>> 10) & 0x1f, blendMode);
	}
	const maskBit = gxGpuMaskBitSetWhileDrawing(maskBitModeWord) ? 0x8000 : 0;
	gxGpuSoftwareVram[index] = r5 | (g5 << 5) | (b5 << 10) | maskBit;
}

export function gxGpuSoftwareInterlacedSkipsLine(y: number, interlacedRenderWord: number): boolean {
	return (interlacedRenderWord & GX_GPU_INTERLACED_RENDER_ENABLE) !== 0
		&& (y & 1) === ((interlacedRenderWord & GX_GPU_INTERLACED_RENDER_ACTIVE_LINE_LSB) >>> 1);
}
