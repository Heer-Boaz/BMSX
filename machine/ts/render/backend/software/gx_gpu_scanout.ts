import {
	GX_GPU_PCRTC_PSGPU24,
	GX_GPU_PCRTC_PSMCT24,
	GX_GPU_PCRTC_PSMCT32,
	type GxGpuPcrtcCircuit,
	type GxGpuPcrtcScanout,
} from '../../../machine/devices/gx/gpu_pcrtc';
import { gxGpuScanoutField, gxGpuScanoutSourceLineStep } from '../../../machine/devices/gx/gpu_display';
import { GX_GPU_VRAM_WORD_COUNT } from '../../../machine/devices/gx/vram_address';
import type { GxGpuPipelineState } from '../backend';
import { gxGpuSoftwareRgb555ChannelTo8, gxGpuSoftwareVram } from './gx_gpu_vram';

let interlacedPixels = new Uint32Array(0);
let interlacedWidth = 0;
let interlacedHeight = 0;
let interlacedVramSnapshotSerial = 0n;
let interlacedValid = false;
let interlacedPcrtcRevision = 0;
let interlacedSourceRowShift = 0;

function rawWordAtAddress(address: number): number {
	return gxGpuSoftwareVram[address & (GX_GPU_VRAM_WORD_COUNT - 1)];
}

function rawByteAtAddress(address: number): number {
	const word = rawWordAtAddress(address >>> 1);
	return (address & 1) === 0 ? word & 0xff : word >>> 8;
}

function rgb555Color(word: number): number {
	return gxGpuSoftwareRgb555ChannelTo8(word & 0x1f)
		| (gxGpuSoftwareRgb555ChannelTo8((word >>> 5) & 0x1f) << 8)
		| (gxGpuSoftwareRgb555ChannelTo8((word >>> 10) & 0x1f) << 16);
}

function outputRgba(pixel: number): number {
	return (pixel | 0xff000000) >>> 0;
}

function blendOutputRgba(destination: number, source: number, alpha: number): number {
	const inverseAlpha = 255 - alpha;
	const red = (((source & 0xff) * alpha + (destination & 0xff) * inverseAlpha + 127) / 255) | 0;
	const green = (((source >>> 8 & 0xff) * alpha + (destination >>> 8 & 0xff) * inverseAlpha + 127) / 255) | 0;
	const blue = (((source >>> 16 & 0xff) * alpha + (destination >>> 16 & 0xff) * inverseAlpha + 127) / 255) | 0;
	return (red | (green << 8) | (blue << 16) | 0xff000000) >>> 0;
}

function circuitContainsOutput(circuit: GxGpuPcrtcCircuit, outputX: number, outputY: number): boolean {
	return outputX >= circuit.displayX
		&& outputY >= circuit.displayY
		&& outputX < circuit.displayRight
		&& outputY < circuit.displayBottom;
}

function circuitPixel(circuit: GxGpuPcrtcCircuit, outputX: number, outputY: number, sourceRowShift: number): number {
	const sourceX = circuit.framebufferX
		+ (((outputX - circuit.displayX) / circuit.magnificationX) | 0);
	const sourceY = circuit.framebufferY
		+ ((((outputY - circuit.displayY) >> sourceRowShift) / circuit.magnificationY) | 0);
	if (circuit.framebufferPsm === GX_GPU_PCRTC_PSMCT32 || circuit.framebufferPsm === GX_GPU_PCRTC_PSMCT24) {
		const address = circuit.framebufferBaseWord + (sourceY * circuit.framebufferWidth + sourceX) * 2;
		const low = rawWordAtAddress(address);
		const high = rawWordAtAddress(address + 1);
		const alpha = circuit.framebufferPsm === GX_GPU_PCRTC_PSMCT32 ? high >>> 8 : 0x80;
		return low | ((high & 0xff) << 16) | (alpha << 24);
	}
	if (circuit.framebufferPsm === GX_GPU_PCRTC_PSGPU24) {
		const address = (circuit.framebufferBaseWord << 1) + (sourceY * circuit.framebufferWidth + sourceX) * 3;
		return rawByteAtAddress(address)
			| (rawByteAtAddress(address + 1) << 8)
			| (rawByteAtAddress(address + 2) << 16)
			| 0x80000000;
	}
	const word = rawWordAtAddress(circuit.framebufferBaseWord + sourceY * circuit.framebufferWidth + sourceX);
	return rgb555Color(word) | ((word & 0x8000) !== 0 ? 0x80000000 : 0);
}

function mergedPixel(scanout: GxGpuPcrtcScanout, outputX: number, outputY: number, sourceRowShift: number): number {
	let under = scanout.backgroundColor;
	if (scanout.circuit2UnderlayEnabled && circuitContainsOutput(scanout.circuits[1], outputX, outputY)) {
		under = circuitPixel(scanout.circuits[1], outputX, outputY, sourceRowShift);
	}
	if (!scanout.circuits[0].enabled || !circuitContainsOutput(scanout.circuits[0], outputX, outputY)) {
		return under;
	}
	const circuit1 = circuitPixel(scanout.circuits[0], outputX, outputY, sourceRowShift);
	let alpha = scanout.constantAlphaEnabled
		? scanout.constantAlpha
		: circuit1 >>> 24 << 1;
	if (alpha > 255) {
		alpha = 255;
	}
	const inverseAlpha = 255 - alpha;
	const red = (((circuit1 & 0xff) * alpha + (under & 0xff) * inverseAlpha + 127) / 255) | 0;
	const green = (((circuit1 >>> 8 & 0xff) * alpha + (under >>> 8 & 0xff) * inverseAlpha + 127) / 255) | 0;
	const blue = (((circuit1 >>> 16 & 0xff) * alpha + (under >>> 16 & 0xff) * inverseAlpha + 127) / 255) | 0;
	return red | (green << 8) | (blue << 16);
}

function circuitUsesRgb555(circuit: GxGpuPcrtcCircuit): boolean {
	return circuit.framebufferPsm !== GX_GPU_PCRTC_PSMCT32
		&& circuit.framebufferPsm !== GX_GPU_PCRTC_PSMCT24
		&& circuit.framebufferPsm !== GX_GPU_PCRTC_PSGPU24;
}

function canComposeRgb555(scanout: GxGpuPcrtcScanout): boolean {
	const circuit1 = scanout.circuits[0];
	const circuit2 = scanout.circuits[1];
	return (!circuit1.enabled || (circuitUsesRgb555(circuit1) && circuit1.magnificationX === 1 && circuit1.magnificationY === 1))
		&& (!scanout.circuit2UnderlayEnabled || (circuitUsesRgb555(circuit2) && circuit2.magnificationX === 1 && circuit2.magnificationY === 1));
}

function circuitCoversOutput(state: GxGpuPipelineState, circuit: GxGpuPcrtcCircuit): boolean {
	return circuit.displayX === 0
		&& circuit.displayY === 0
		&& circuit.displayRight >= state.width
		&& circuit.displayBottom >= state.height;
}

function fillBackgroundRows(state: GxGpuPipelineState, target: Uint32Array, firstRow: number, rowStep: number): void {
	const background = outputRgba(state.pcrtcScanout.backgroundColor);
	for (let outputY = firstRow; outputY < state.height; outputY += rowStep) {
		const rowStart = outputY * state.width;
		target.fill(background, rowStart, rowStart + state.width);
	}
}

function writeRgb555OpaqueRows(
	state: GxGpuPipelineState,
	target: Uint32Array,
	circuit: GxGpuPcrtcCircuit,
	firstRow: number,
	rowStep: number,
	sourceRowShift: number,
): void {
	const left = circuit.displayX < state.width ? circuit.displayX : state.width;
	const right = circuit.displayRight < state.width ? circuit.displayRight : state.width;
	if (left >= right) return;
	for (let outputY = firstRow; outputY < state.height; outputY += rowStep) {
		if (outputY < circuit.displayY || outputY >= circuit.displayBottom) continue;
		let address = circuit.framebufferBaseWord
			+ (circuit.framebufferY + ((outputY - circuit.displayY) >> sourceRowShift)) * circuit.framebufferWidth
			+ circuit.framebufferX + left - circuit.displayX;
		let output = outputY * state.width + left;
		for (let outputX = left; outputX < right; outputX += 1) {
			target[output] = outputRgba(rgb555Color(rawWordAtAddress(address)));
			address += 1;
			output += 1;
		}
	}
}

function writeRgb555MaskedRows(
	state: GxGpuPipelineState,
	target: Uint32Array,
	circuit: GxGpuPcrtcCircuit,
	firstRow: number,
	rowStep: number,
	sourceRowShift: number,
): void {
	const left = circuit.displayX < state.width ? circuit.displayX : state.width;
	const right = circuit.displayRight < state.width ? circuit.displayRight : state.width;
	if (left >= right) return;
	for (let outputY = firstRow; outputY < state.height; outputY += rowStep) {
		if (outputY < circuit.displayY || outputY >= circuit.displayBottom) continue;
		let address = circuit.framebufferBaseWord
			+ (circuit.framebufferY + ((outputY - circuit.displayY) >> sourceRowShift)) * circuit.framebufferWidth
			+ circuit.framebufferX + left - circuit.displayX;
		let output = outputY * state.width + left;
		for (let outputX = left; outputX < right; outputX += 1) {
			const word = rawWordAtAddress(address);
			const sourceMask = -(word >>> 15);
			const source = outputRgba(rgb555Color(word));
			target[output] = ((source & sourceMask) | (target[output] & ~sourceMask)) >>> 0;
			address += 1;
			output += 1;
		}
	}
}

function writeRgb555BlendedRows(
	state: GxGpuPipelineState,
	target: Uint32Array,
	circuit: GxGpuPcrtcCircuit,
	alpha: number,
	firstRow: number,
	rowStep: number,
	sourceRowShift: number,
): void {
	const left = circuit.displayX < state.width ? circuit.displayX : state.width;
	const right = circuit.displayRight < state.width ? circuit.displayRight : state.width;
	if (left >= right) return;
	for (let outputY = firstRow; outputY < state.height; outputY += rowStep) {
		if (outputY < circuit.displayY || outputY >= circuit.displayBottom) continue;
		let address = circuit.framebufferBaseWord
			+ (circuit.framebufferY + ((outputY - circuit.displayY) >> sourceRowShift)) * circuit.framebufferWidth
			+ circuit.framebufferX + left - circuit.displayX;
		let output = outputY * state.width + left;
		for (let outputX = left; outputX < right; outputX += 1) {
			target[output] = blendOutputRgba(target[output], rgb555Color(rawWordAtAddress(address)), alpha);
			address += 1;
			output += 1;
		}
	}
}

function writeRgb555OutputRows(
	state: GxGpuPipelineState,
	target: Uint32Array,
	firstRow: number,
	rowStep: number,
	sourceRowShift: number,
): void {
	const scanout = state.pcrtcScanout;
	const circuit1 = scanout.circuits[0];
	if (circuit1.enabled
		&& scanout.constantAlphaEnabled
		&& scanout.constantAlpha === 255
		&& circuitCoversOutput(state, circuit1)) {
		writeRgb555OpaqueRows(state, target, circuit1, firstRow, rowStep, sourceRowShift);
		return;
	}
	const circuit2 = scanout.circuits[1];
	if (scanout.circuit2UnderlayEnabled && circuitCoversOutput(state, circuit2)) {
		writeRgb555OpaqueRows(state, target, circuit2, firstRow, rowStep, sourceRowShift);
	} else {
		fillBackgroundRows(state, target, firstRow, rowStep);
		if (scanout.circuit2UnderlayEnabled) {
			writeRgb555OpaqueRows(state, target, circuit2, firstRow, rowStep, sourceRowShift);
		}
	}
	if (!circuit1.enabled) return;
	if (!scanout.constantAlphaEnabled) {
		writeRgb555MaskedRows(state, target, circuit1, firstRow, rowStep, sourceRowShift);
		return;
	}
	if (scanout.constantAlpha === 0) return;
	if (scanout.constantAlpha === 255) {
		writeRgb555OpaqueRows(state, target, circuit1, firstRow, rowStep, sourceRowShift);
		return;
	}
	writeRgb555BlendedRows(state, target, circuit1, scanout.constantAlpha, firstRow, rowStep, sourceRowShift);
}

function writeGenericOutputRows(
	state: GxGpuPipelineState,
	target: Uint32Array,
	firstRow: number,
	rowStep: number,
	sourceRowShift: number,
): void {
	const scanout = state.pcrtcScanout;
	for (let outputY = firstRow; outputY < state.height; outputY += rowStep) {
		let offset = outputY * state.width;
		for (let outputX = 0; outputX < state.width; outputX += 1) {
			target[offset] = outputRgba(mergedPixel(scanout, outputX, outputY, sourceRowShift));
			offset += 1;
		}
	}
}

function writeOutputRows(
	state: GxGpuPipelineState,
	target: Uint32Array,
	firstRow: number,
	rowStep: number,
	sourceRowShift: number,
): void {
	if (canComposeRgb555(state.pcrtcScanout)) {
		writeRgb555OutputRows(state, target, firstRow, rowStep, sourceRowShift);
		return;
	}
	writeGenericOutputRows(state, target, firstRow, rowStep, sourceRowShift);
}

function scanoutInterlacedVram(state: GxGpuPipelineState, target: Uint32Array, sourceRowShift: number): void {
	const pixelCount = state.width * state.height;
	const invalid = !interlacedValid
		|| interlacedWidth !== state.width
		|| interlacedHeight !== state.height
		|| interlacedVramSnapshotSerial !== state.vramSnapshotSerial
		|| interlacedPcrtcRevision !== state.pcrtcScanout.revision
		|| interlacedSourceRowShift !== sourceRowShift;
	if (interlacedPixels.length !== pixelCount) {
		interlacedPixels = new Uint32Array(pixelCount);
	}
	if (invalid) {
		writeOutputRows(state, interlacedPixels, 0, 1, sourceRowShift);
		interlacedWidth = state.width;
		interlacedHeight = state.height;
		interlacedVramSnapshotSerial = state.vramSnapshotSerial;
		interlacedPcrtcRevision = state.pcrtcScanout.revision;
		interlacedSourceRowShift = sourceRowShift;
		interlacedValid = true;
	} else {
		writeOutputRows(state, interlacedPixels, gxGpuScanoutField(state.statusWord), 2, sourceRowShift);
	}
	target.set(interlacedPixels);
}

export function scanoutGxGpuSoftwareVram(state: GxGpuPipelineState, target: Uint32Array): void {
	const sourceLineStep = gxGpuScanoutSourceLineStep(state.displayModeWord);
	if (sourceLineStep !== 0) {
		scanoutInterlacedVram(state, target, sourceLineStep === 1 ? 1 : 0);
		return;
	}
	interlacedValid = false;
	writeOutputRows(state, target, 0, 1, 0);
}
