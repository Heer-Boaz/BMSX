import { GX_GPU_VRAM_X_ADDRESS_PERIOD } from '../../../spec/gx/vram';
import type { GxGpuSoftwareState } from './gx_gpu_state';

export function loadGxGpuSoftwareVramBytes(software: GxGpuSoftwareState, source: Uint8Array): void {
	for (let wordIndex = 0; wordIndex < software.vram.length; wordIndex += 1) {
		const byteIndex = wordIndex << 1;
		software.vram[wordIndex] = source[byteIndex] | (source[byteIndex + 1] << 8);
	}
}

export function gxGpuSoftwareVramIndex(software: GxGpuSoftwareState, x: number, y: number): number {
	return (y * GX_GPU_VRAM_X_ADDRESS_PERIOD + (x & (GX_GPU_VRAM_X_ADDRESS_PERIOD - 1))) & software.vramWordMask;
}

export function gxGpuSoftwareRgb888WordToRgb555(word: number): number {
	return ((word & 0xff) >>> 3)
		| ((((word >>> 8) & 0xff) >>> 3) << 5)
		| ((((word >>> 16) & 0xff) >>> 3) << 10);
}

export function gxGpuSoftwareRgb555ChannelTo8(channel: number): number {
	return (channel << 3) | (channel >>> 2);
}

export function gxGpuSoftwareTextureModulationPreDither(texture5: number, vertex8: number): number {
	return (texture5 * vertex8) >>> 4;
}

export function gxGpuSoftwareTextureModulationChannel5(texture5: number, vertex8: number, ditherOffset: number): number {
	const dithered = gxGpuSoftwareTextureModulationPreDither(texture5, vertex8) + ditherOffset;
	if (dithered < 0) {
		return 0;
	}
	const channel5 = dithered >> 3;
	return channel5 < 31 ? channel5 : 31;
}

export function gxGpuSoftwareWriteMaskedVramWord(software: GxGpuSoftwareState, index: number, word: number, checkMaskBit: boolean, setMaskBit: boolean): void {
	const dstWord = software.vram[index];
	if (checkMaskBit && (dstWord & 0x8000) !== 0) {
		return;
	}
	const maskBit = setMaskBit ? 0x8000 : word & 0x8000;
	software.vram[index] = (word & 0x7fff) | maskBit;
}

export function gxGpuSoftwareBlendRgb555(sourceWord: number, destinationWord: number, blendMode: number): number {
	let source = sourceWord | 0x8000;
	let destination = destinationWord;
	let color: number;
	switch (blendMode) {
		case 0:
			destination |= 0x8000;
			color = ((source + destination) - ((source ^ destination) & 0x0421)) >>> 1;
			break;
		case 1: {
			destination &= 0x7fff;
			const sum = source + destination;
			const carry = (sum - ((source ^ destination) & 0x8421)) & 0x8420;
			color = (sum - carry) | (carry - (carry >>> 5));
			break;
		}
		case 2: {
			destination |= 0x8000;
			source &= 0x7fff;
			const difference = destination - source + 0x108420;
			const borrow = (difference - ((destination ^ source) & 0x108420)) & 0x108420;
			color = (difference - borrow) & (borrow - (borrow >>> 5));
			break;
		}
		default: {
			destination &= 0x7fff;
			source = ((source >>> 2) & 0x1ce7) | 0x8000;
			const sum = source + destination;
			const carry = (sum - ((source ^ destination) & 0x8421)) & 0x8420;
			color = (sum - carry) | (carry - (carry >>> 5));
			break;
		}
	}
	return color & 0x7fff;
}

export function gxGpuSoftwareDitherOffset(x: number, y: number): number {
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

export function gxGpuSoftwareWriteRenderVramPixel5(software: GxGpuSoftwareState, x: number, y: number, r5: number, g5: number, b5: number, blendEnabled: boolean, blendMode: number, checkMaskBit: boolean, setMaskBit: boolean, outputMaskBit: number): void {
	const index = gxGpuSoftwareVramIndex(software, x, y);
	const dstWord = software.vram[index];
	if (checkMaskBit && (dstWord & 0x8000) !== 0) {
		return;
	}
	let color = r5 | (g5 << 5) | (b5 << 10);
	if (blendEnabled) {
		color = gxGpuSoftwareBlendRgb555(color, dstWord, blendMode);
	}
	const maskBit = setMaskBit ? 0x8000 : outputMaskBit & 0x8000;
	software.vram[index] = color | maskBit;
}

export function gxGpuSoftwareWriteRenderVramPixel(software: GxGpuSoftwareState, x: number, y: number, r8: number, g8: number, b8: number, ditherEnabled: boolean, blendEnabled: boolean, blendMode: number, checkMaskBit: boolean, setMaskBit: boolean): void {
	let r = r8;
	let g = g8;
	let b = b8;
	if (ditherEnabled) {
		const offset = gxGpuSoftwareDitherOffset(x, y);
		r = ditheredByte(r, offset);
		g = ditheredByte(g, offset);
		b = ditheredByte(b, offset);
	}
	gxGpuSoftwareWriteRenderVramPixel5(software, x, y, r >>> 3, g >>> 3, b >>> 3, blendEnabled, blendMode, checkMaskBit, setMaskBit, 0);
}
