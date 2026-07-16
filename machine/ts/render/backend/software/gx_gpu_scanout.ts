import { GX_GPU_STATUS_DISPLAY_DISABLE } from '../../../machine/devices/gx/gpu';
import {
	GX_GPU_DISPLAY_MODE_RGB24_BIT,
	GX_GPU_SCANOUT_INTERPRETATION_MASK,
	gxGpuDisplayStartX,
	gxGpuDisplayStartY,
	gxGpuScanoutField,
	gxGpuScanoutSourceLineStep,
} from '../../../machine/devices/gx/gpu_display';
import type { GxGpuPipelineState } from '../backend';
import {
	gxGpuSoftwareRgb555ChannelTo8,
	gxGpuSoftwareVram,
	gxGpuSoftwareVramIndex,
} from './gx_gpu_vram';

let interlacedPixels = new Uint8Array(0);
let interlacedWidth = 0;
let interlacedHeight = 0;
let interlacedDisplayStartWord = 0;
let interlacedInterpretationWord = 0;
let interlacedVramSnapshotSerial = 0n;
let interlacedValid = false;

function rgb888AtSourcePixel(sourceX: number, sourceY: number, displayStartX: number): number {
	const wordX = displayStartX + ((sourceX * 3) >> 1);
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

function writeInterlacedField(
	state: GxGpuPipelineState,
	field: number,
	sourceLineStep: number,
	displayStartX: number,
	displayStartY: number,
	rgb24: boolean,
	displayDisabled: boolean,
): void {
	const width = state.width;
	const fieldHeight = state.height >> 1;
	let sourceY = displayStartY + field * (sourceLineStep - 1);
	let outputOffset = field * width * 4;
	for (let fieldLine = 0; fieldLine < fieldHeight; fieldLine += 1) {
		if (displayDisabled) {
			const rowEnd = outputOffset + width * 4;
			for (let offset = outputOffset; offset < rowEnd; offset += 4) {
				interlacedPixels[offset] = 0;
				interlacedPixels[offset + 1] = 0;
				interlacedPixels[offset + 2] = 0;
				interlacedPixels[offset + 3] = 255;
			}
		} else {
			let offset = outputOffset;
			for (let outputX = 0; outputX < width; outputX += 1) {
				const rgb = rgb24 ? rgb888AtSourcePixel(outputX, sourceY, displayStartX) : rgb555AtSourcePixel(displayStartX + outputX, sourceY);
				writeOutputRgb(interlacedPixels, offset, rgb);
				offset += 4;
			}
		}
		sourceY += sourceLineStep;
		outputOffset += width * 8;
	}
}

function scanoutInterlacedVram(state: GxGpuPipelineState, target: Uint8Array, sourceLineStep: number): void {
	const displayStartWord = state.displayStartWord;
	const displayModeWord = state.displayModeWord;
	const interpretationWord = displayModeWord & GX_GPU_SCANOUT_INTERPRETATION_MASK;
	const width = state.width;
	const height = state.height;
	const byteLength = width * height * 4;
	const invalid = !interlacedValid
		|| interlacedWidth !== width
		|| interlacedHeight !== height
		|| interlacedDisplayStartWord !== displayStartWord
		|| interlacedInterpretationWord !== interpretationWord
		|| interlacedVramSnapshotSerial !== state.vramSnapshotSerial;
	if (interlacedPixels.byteLength !== byteLength) {
		interlacedPixels = new Uint8Array(byteLength);
	}
	const displayStartX = gxGpuDisplayStartX(displayStartWord);
	const displayStartY = gxGpuDisplayStartY(displayStartWord);
	const rgb24 = (displayModeWord & GX_GPU_DISPLAY_MODE_RGB24_BIT) !== 0;
	const displayDisabled = (state.statusWord & GX_GPU_STATUS_DISPLAY_DISABLE) !== 0;
	if (invalid) {
		writeInterlacedField(state, 0, sourceLineStep, displayStartX, displayStartY, rgb24, displayDisabled);
		writeInterlacedField(state, 1, sourceLineStep, displayStartX, displayStartY, rgb24, displayDisabled);
		interlacedWidth = width;
		interlacedHeight = height;
		interlacedDisplayStartWord = displayStartWord;
		interlacedInterpretationWord = interpretationWord;
		interlacedVramSnapshotSerial = state.vramSnapshotSerial;
		interlacedValid = true;
	} else {
		writeInterlacedField(state, gxGpuScanoutField(state.statusWord), sourceLineStep, displayStartX, displayStartY, rgb24, displayDisabled);
	}
	target.set(interlacedPixels);
}

export function scanoutGxGpuSoftwareVram(state: GxGpuPipelineState, target: Uint8Array): void {
	const displayModeWord = state.displayModeWord;
	const sourceLineStep = gxGpuScanoutSourceLineStep(displayModeWord);
	if (sourceLineStep !== 0) {
		scanoutInterlacedVram(state, target, sourceLineStep);
		return;
	}
	interlacedValid = false;
	if ((state.statusWord & GX_GPU_STATUS_DISPLAY_DISABLE) !== 0) {
		target.fill(0);
		for (let offset = 3; offset < target.length; offset += 4) {
			target[offset] = 255;
		}
		return;
	}
	const displayStartX = gxGpuDisplayStartX(state.displayStartWord);
	const displayStartY = gxGpuDisplayStartY(state.displayStartWord);
	const rgb24 = (displayModeWord & GX_GPU_DISPLAY_MODE_RGB24_BIT) !== 0;
	let offset = 0;
	for (let outputY = 0; outputY < state.height; outputY += 1) {
		const sourceY = displayStartY + outputY;
		for (let outputX = 0; outputX < state.width; outputX += 1) {
			const rgb = rgb24 ? rgb888AtSourcePixel(outputX, sourceY, displayStartX) : rgb555AtSourcePixel(displayStartX + outputX, sourceY);
			writeOutputRgb(target, offset, rgb);
			offset += 4;
		}
	}
}
