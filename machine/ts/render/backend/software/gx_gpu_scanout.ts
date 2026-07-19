import {
	GX_GPU_PCRTC_COMPOSE_GX16,
	GX_GPU_PCRTC_COMPOSE_GX16_DIRECT_CIRCUIT1,
	GX_GPU_PCRTC_SOURCE_DIVISION_SHIFT,
	type GxGpuPcrtcCircuit,
	type GxGpuPcrtcScanout,
} from '../../../machine/devices/gx/gpu_pcrtc';
import {
	GX_GPU_PSGPU24,
	GX_GPU_PSMCT16,
	GX_GPU_PSMCT16S,
	GX_GPU_PSMCT24,
	GX_GPU_PSMCT32,
	GX_GPU_PSMGX16,
	gxGpuLocalMemoryAddress16,
	gxGpuLocalMemoryAddress16S,
	gxGpuLocalMemoryAddress32,
	gxGpuLocalMemoryAddressGx16,
	gxGpuLocalMemoryByteAddressGpu24,
} from '../../../machine/devices/gx/gpu_local_memory';
import { GX_GPU_VRAM_WORD_COUNT } from '../../../machine/devices/gx/vram_address';
import type { GxGpuPipelineState } from '../backend';
import { gxGpuSoftwareRgb555ChannelTo8, gxGpuSoftwareVram } from './gx_gpu_vram';

let interlacedPixels = new Uint32Array(0);
let interlacedWidth = 0;
let interlacedHeight = 0;
let interlacedValid = false;
let interlacedVramReplacementSerial = 0n;

const GENERIC_CIRCUIT_WRITE_RGBA = 0;
const GENERIC_CIRCUIT_BLEND_ALPHA = 1;
const GENERIC_CIRCUIT_BLEND_PRESERVE_ALPHA = 2;

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

function blendOutputRgba(destination: number, source: number, blendAlpha: number, outputAlpha: number): number {
	const inverseAlpha = 255 - blendAlpha;
	const red = (((source & 0xff) * blendAlpha + (destination & 0xff) * inverseAlpha + 127) / 255) | 0;
	const green = (((source >>> 8 & 0xff) * blendAlpha + (destination >>> 8 & 0xff) * inverseAlpha + 127) / 255) | 0;
	const blue = (((source >>> 16 & 0xff) * blendAlpha + (destination >>> 16 & 0xff) * inverseAlpha + 127) / 255) | 0;
	return (red | (green << 8) | (blue << 16) | outputAlpha) >>> 0;
}

function circuitPixel(circuit: GxGpuPcrtcCircuit, sourceX: number, sourceY: number): number {
	if (circuit.framebufferPsm === GX_GPU_PSMCT32 || circuit.framebufferPsm === GX_GPU_PSMCT24) {
		const address = gxGpuLocalMemoryAddress32(
			circuit.framebufferBaseWord,
			circuit.framebufferPagesPerRow,
			sourceX,
			sourceY,
		);
		const low = rawWordAtAddress(address);
		const high = rawWordAtAddress(address + 1);
		const alpha = circuit.framebufferPsm === GX_GPU_PSMCT32 ? high >>> 8 : 0x80;
		return low | ((high & 0xff) << 16) | (alpha << 24);
	}
	if (circuit.framebufferPsm === GX_GPU_PSMCT16 || circuit.framebufferPsm === GX_GPU_PSMCT16S) {
		const address = circuit.framebufferPsm === GX_GPU_PSMCT16
			? gxGpuLocalMemoryAddress16(circuit.framebufferBaseWord, circuit.framebufferPagesPerRow, sourceX, sourceY)
			: gxGpuLocalMemoryAddress16S(circuit.framebufferBaseWord, circuit.framebufferPagesPerRow, sourceX, sourceY);
		const word = rawWordAtAddress(address);
		return rgb555Color(word) | ((word & 0x8000) !== 0 ? 0x80000000 : 0);
	}
	if (circuit.framebufferPsm === GX_GPU_PSGPU24) {
		return rawByteAtAddress(gxGpuLocalMemoryByteAddressGpu24(circuit.framebufferBaseWord, circuit.framebufferPagesPerRow, sourceX, sourceY, 0))
			| (rawByteAtAddress(gxGpuLocalMemoryByteAddressGpu24(circuit.framebufferBaseWord, circuit.framebufferPagesPerRow, sourceX, sourceY, 1)) << 8)
			| (rawByteAtAddress(gxGpuLocalMemoryByteAddressGpu24(circuit.framebufferBaseWord, circuit.framebufferPagesPerRow, sourceX, sourceY, 2)) << 16)
			| 0x80000000;
	}
	if (circuit.framebufferPsm === GX_GPU_PSMGX16) {
		const word = rawWordAtAddress(gxGpuLocalMemoryAddressGx16(circuit.framebufferBaseWord, circuit.framebufferWidth, sourceX, sourceY));
		return rgb555Color(word) | ((word & 0x8000) !== 0 ? 0x80000000 : 0);
	}
	return 0;
}

function fillBackgroundRows(state: GxGpuPipelineState, target: Uint32Array, firstRow: number, rowStep: number): void {
	const scanout = state.pcrtcScanout;
	const background = scanout.backgroundColor;
	for (let outputY = firstRow; outputY < state.height; outputY += rowStep) {
		const rowStart = outputY * state.width;
		target.fill(background, rowStart, rowStart + state.width);
	}
}

function gx16SourceY(circuit: GxGpuPcrtcCircuit, scanout: GxGpuPcrtcScanout, outputY: number): number {
	const relativeY = outputY - circuit.displayY;
	return circuit.framebufferY + (scanout.interlaced
		? (relativeY >> 1) * circuit.fieldSourceStride + circuit.fieldSourcePhase
		: relativeY);
}

function writeGx16CircuitRows(
	state: GxGpuPipelineState,
	target: Uint32Array,
	circuit: GxGpuPcrtcCircuit,
	firstRow: number,
	rowStep: number,
): void {
	const left = circuit.displayX < state.width ? circuit.displayX : state.width;
	const right = circuit.displayRight < state.width ? circuit.displayRight : state.width;
	if (left >= right) return;
	for (let outputY = firstRow; outputY < state.height; outputY += rowStep) {
		if (outputY < circuit.displayY || outputY >= circuit.displayBottom) continue;
		let address = circuit.framebufferBaseWord
			+ gx16SourceY(circuit, state.pcrtcScanout, outputY) * circuit.framebufferWidth
			+ circuit.framebufferX + left - circuit.displayX;
		let output = outputY * state.width + left;
		for (let outputX = left; outputX < right; outputX += 1) {
			const word = rawWordAtAddress(address);
			target[output] = (rgb555Color(word) | ((word & 0x8000) !== 0 ? 0x80000000 : 0)) >>> 0;
			address += 1;
			output += 1;
		}
	}
}

function writeGx16RgbRows(
	state: GxGpuPipelineState,
	target: Uint32Array,
	circuit: GxGpuPcrtcCircuit,
	firstRow: number,
	rowStep: number,
	outputAlphaMask: number,
	constantOutputAlpha: number,
): void {
	const left = circuit.displayX < state.width ? circuit.displayX : state.width;
	const right = circuit.displayRight < state.width ? circuit.displayRight : state.width;
	if (left >= right) return;
	for (let outputY = firstRow; outputY < state.height; outputY += rowStep) {
		if (outputY < circuit.displayY || outputY >= circuit.displayBottom) continue;
		let address = circuit.framebufferBaseWord
			+ gx16SourceY(circuit, state.pcrtcScanout, outputY) * circuit.framebufferWidth
			+ circuit.framebufferX + left - circuit.displayX;
		let output = outputY * state.width + left;
		for (let outputX = left; outputX < right; outputX += 1) {
			const word = rawWordAtAddress(address);
			const alpha = (target[output] & outputAlphaMask) | constantOutputAlpha;
			target[output] = (rgb555Color(word) | alpha) >>> 0;
			address += 1;
			output += 1;
		}
	}
}

function writeGx16ConstantAlphaRows(
	state: GxGpuPipelineState,
	target: Uint32Array,
	circuit: GxGpuPcrtcCircuit,
	outputAlpha: number,
	firstRow: number,
	rowStep: number,
): void {
	const left = circuit.displayX < state.width ? circuit.displayX : state.width;
	const right = circuit.displayRight < state.width ? circuit.displayRight : state.width;
	if (left >= right) return;
	for (let outputY = firstRow; outputY < state.height; outputY += rowStep) {
		if (outputY < circuit.displayY || outputY >= circuit.displayBottom) continue;
		let output = outputY * state.width + left;
		for (let outputX = left; outputX < right; outputX += 1) {
			target[output] = (target[output] & 0x00ffffff) | outputAlpha;
			output += 1;
		}
	}
}

function writeGx16SourceAlphaRows(
	state: GxGpuPipelineState,
	target: Uint32Array,
	circuit: GxGpuPcrtcCircuit,
	preserveOutputAlpha: boolean,
	firstRow: number,
	rowStep: number,
): void {
	const outputAlphaMask = preserveOutputAlpha ? 0xff000000 : 0;
	const left = circuit.displayX < state.width ? circuit.displayX : state.width;
	const right = circuit.displayRight < state.width ? circuit.displayRight : state.width;
	if (left >= right) return;
	for (let outputY = firstRow; outputY < state.height; outputY += rowStep) {
		if (outputY < circuit.displayY || outputY >= circuit.displayBottom) continue;
		let address = circuit.framebufferBaseWord
			+ gx16SourceY(circuit, state.pcrtcScanout, outputY) * circuit.framebufferWidth
			+ circuit.framebufferX + left - circuit.displayX;
		let output = outputY * state.width + left;
		for (let outputX = left; outputX < right; outputX += 1) {
			const word = rawWordAtAddress(address);
			const sourceMask = -(word >>> 15);
			const destination = target[output];
			const rgb = (rgb555Color(word) & sourceMask) | (destination & ~sourceMask & 0x00ffffff);
			const outputAlpha = (destination & outputAlphaMask)
				| (sourceMask & ~outputAlphaMask & 0xff000000);
			target[output] = (rgb | outputAlpha) >>> 0;
			address += 1;
			output += 1;
		}
	}
}

function writeGx16BlendedRows(
	state: GxGpuPipelineState,
	target: Uint32Array,
	circuit: GxGpuPcrtcCircuit,
	alpha: number,
	preserveOutputAlpha: boolean,
	firstRow: number,
	rowStep: number,
): void {
	const outputAlphaMask = preserveOutputAlpha ? 0xff000000 : 0;
	const constantOutputAlpha = preserveOutputAlpha ? 0 : alpha << 24;
	const left = circuit.displayX < state.width ? circuit.displayX : state.width;
	const right = circuit.displayRight < state.width ? circuit.displayRight : state.width;
	if (left >= right) return;
	for (let outputY = firstRow; outputY < state.height; outputY += rowStep) {
		if (outputY < circuit.displayY || outputY >= circuit.displayBottom) continue;
		let address = circuit.framebufferBaseWord
			+ gx16SourceY(circuit, state.pcrtcScanout, outputY) * circuit.framebufferWidth
			+ circuit.framebufferX + left - circuit.displayX;
		let output = outputY * state.width + left;
		for (let outputX = left; outputX < right; outputX += 1) {
			const word = rawWordAtAddress(address);
			const outputAlpha = (target[output] & outputAlphaMask) | constantOutputAlpha;
			target[output] = blendOutputRgba(target[output], rgb555Color(word), alpha, outputAlpha);
			address += 1;
			output += 1;
		}
	}
}

function writeGx16OutputRows(
	state: GxGpuPipelineState,
	target: Uint32Array,
	firstRow: number,
	rowStep: number,
): void {
	const scanout = state.pcrtcScanout;
	const circuit1 = scanout.circuits[0];
	const circuit2 = scanout.circuits[1];
	if (scanout.circuit2SampleRequired && scanout.circuit2CoversOutput) {
		writeGx16CircuitRows(state, target, circuit2, firstRow, rowStep);
	} else {
		fillBackgroundRows(state, target, firstRow, rowStep);
		if (scanout.circuit2SampleRequired) writeGx16CircuitRows(state, target, circuit2, firstRow, rowStep);
	}
	if (!circuit1.enabled) return;
	if (!scanout.blendAlphaFromRegister) {
		writeGx16SourceAlphaRows(state, target, circuit1, scanout.preserveUnderlayAlpha, firstRow, rowStep);
		return;
	}
	if (scanout.blendAlpha === 0) {
		if (!scanout.preserveUnderlayAlpha) writeGx16ConstantAlphaRows(state, target, circuit1, 0, firstRow, rowStep);
		return;
	}
	if (scanout.blendAlpha === 255) {
		writeGx16RgbRows(
			state,
			target,
			circuit1,
			firstRow,
			rowStep,
			scanout.preserveUnderlayAlpha ? 0xff000000 : 0,
			scanout.preserveUnderlayAlpha ? 0 : 0xff000000,
		);
		return;
	}
	writeGx16BlendedRows(state, target, circuit1, scanout.blendAlpha, scanout.preserveUnderlayAlpha, firstRow, rowStep);
}

function writeGenericCircuitRows(
	state: GxGpuPipelineState,
	target: Uint32Array,
	circuit: GxGpuPcrtcCircuit,
	operation: number,
	firstRow: number,
	rowStep: number,
): void {
	const left = circuit.displayX < state.width ? circuit.displayX : state.width;
	const right = circuit.displayRight < state.width ? circuit.displayRight : state.width;
	if (left >= right) return;
	const firstSourceNumerator = circuit.sourcePhaseX + (left - circuit.displayX) * circuit.sourceStepX;
	const sourceXStart = circuit.framebufferX
		+ (firstSourceNumerator * circuit.sourceDivisionMultiplierX >>> GX_GPU_PCRTC_SOURCE_DIVISION_SHIFT);
	const sourceRemainderStart = firstSourceNumerator % circuit.magnificationX;
	const scanout = state.pcrtcScanout;
	const sourceDivisionMultiplierY = scanout.interlaced
		? circuit.interlacedSourceDivisionMultiplierY
		: circuit.sourceDivisionMultiplierY;
	for (let outputY = firstRow; outputY < state.height; outputY += rowStep) {
		if (outputY < circuit.displayY || outputY >= circuit.displayBottom) continue;
		const sourceYNumerator = circuit.sourcePhaseY + (outputY - circuit.displayY) * circuit.sourceStepY;
		const sourceY = circuit.framebufferY
			+ (sourceYNumerator * sourceDivisionMultiplierY >>> GX_GPU_PCRTC_SOURCE_DIVISION_SHIFT)
				* circuit.fieldSourceStride
			+ circuit.fieldSourcePhase;
		let sourceX = sourceXStart;
		let sourceRemainder = sourceRemainderStart;
		let output = outputY * state.width + left;
		if (operation !== GENERIC_CIRCUIT_WRITE_RGBA) {
			const outputAlphaMask = operation === GENERIC_CIRCUIT_BLEND_PRESERVE_ALPHA ? 0xff000000 : 0;
			for (let outputX = left; outputX < right; outputX += 1) {
				const source = circuitPixel(circuit, sourceX, sourceY);
				let blendAlpha = scanout.blendAlphaFromRegister ? scanout.blendAlpha : source >>> 23 & 0x1fe;
				if (blendAlpha > 255) blendAlpha = 255;
				const outputAlpha = (target[output] & outputAlphaMask)
					| ((blendAlpha << 24) & ~outputAlphaMask);
				target[output] = blendOutputRgba(target[output], source, blendAlpha, outputAlpha);
				sourceX += circuit.sourceAdvanceX;
				sourceRemainder += circuit.sourceRemainderStepX;
				if (sourceRemainder >= circuit.magnificationX) {
					sourceRemainder -= circuit.magnificationX;
					sourceX += 1;
				}
				output += 1;
			}
		} else {
			for (let outputX = left; outputX < right; outputX += 1) {
				target[output] = circuitPixel(circuit, sourceX, sourceY) >>> 0;
				sourceX += circuit.sourceAdvanceX;
				sourceRemainder += circuit.sourceRemainderStepX;
				if (sourceRemainder >= circuit.magnificationX) {
					sourceRemainder -= circuit.magnificationX;
					sourceX += 1;
				}
				output += 1;
			}
		}
	}
}

function writeGenericOutputRows(
	state: GxGpuPipelineState,
	target: Uint32Array,
	firstRow: number,
	rowStep: number,
): void {
	const scanout = state.pcrtcScanout;
	fillBackgroundRows(state, target, firstRow, rowStep);
	if (scanout.circuit2SampleRequired) {
		writeGenericCircuitRows(
			state,
			target,
			scanout.circuits[1],
			GENERIC_CIRCUIT_WRITE_RGBA,
			firstRow,
			rowStep,
		);
	}
	if (scanout.circuits[0].enabled) {
		writeGenericCircuitRows(
			state,
			target,
			scanout.circuits[0],
			scanout.preserveUnderlayAlpha
				? GENERIC_CIRCUIT_BLEND_PRESERVE_ALPHA
				: GENERIC_CIRCUIT_BLEND_ALPHA,
			firstRow,
			rowStep,
		);
	}
}

function writeOutputRows(
	state: GxGpuPipelineState,
	target: Uint32Array,
	firstRow: number,
	rowStep: number,
): void {
	if (state.pcrtcScanout.compositionPath === GX_GPU_PCRTC_COMPOSE_GX16_DIRECT_CIRCUIT1) {
		writeGx16RgbRows(
			state,
			target,
			state.pcrtcScanout.circuits[0],
			firstRow,
			rowStep,
			0,
			0xff000000,
		);
		return;
	}
	if (state.pcrtcScanout.compositionPath === GX_GPU_PCRTC_COMPOSE_GX16) {
		writeGx16OutputRows(state, target, firstRow, rowStep);
		return;
	}
	writeGenericOutputRows(state, target, firstRow, rowStep);
}

function scanoutInterlacedVram(state: GxGpuPipelineState, target: Uint32Array): void {
	const pixelCount = state.width * state.height;
	const geometryChanged = !interlacedValid
		|| interlacedWidth !== state.width
		|| interlacedHeight !== state.height
		|| interlacedVramReplacementSerial !== state.vramReplacementSerial;
	if (interlacedPixels.length !== pixelCount) {
		interlacedPixels = new Uint32Array(pixelCount);
	}
	if (geometryChanged) {
		interlacedPixels.fill(state.pcrtcScanout.backgroundColor);
		interlacedWidth = state.width;
		interlacedHeight = state.height;
		interlacedValid = true;
		interlacedVramReplacementSerial = state.vramReplacementSerial;
	}
	writeOutputRows(state, interlacedPixels, state.pcrtcScanout.field, 2);
	target.set(interlacedPixels);
}

export function scanoutGxGpuSoftwareVram(state: GxGpuPipelineState, target: Uint32Array): void {
	if (state.pcrtcScanout.interlaced) {
		scanoutInterlacedVram(state, target);
		return;
	}
	interlacedValid = false;
	writeOutputRows(state, target, 0, 1);
}
