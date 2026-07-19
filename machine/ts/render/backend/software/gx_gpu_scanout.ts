import {
	GX_GPU_PCRTC_COMPOSE_GX16,
	GX_GPU_PCRTC_COMPOSE_GX16_DIRECT_CIRCUIT1,
	GX_GPU_PCRTC_SOURCE_DIVISION_SHIFT,
	GX_GPU_PCRTC_STORAGE_CT16,
	GX_GPU_PCRTC_STORAGE_CT16S,
	GX_GPU_PCRTC_STORAGE_CT24,
	GX_GPU_PCRTC_STORAGE_CT32,
	GX_GPU_PCRTC_STORAGE_GPU24,
	GX_GPU_PCRTC_STORAGE_GX16,
	type GxGpuPcrtcCircuit,
	type GxGpuPcrtcScanout,
} from '../../../machine/devices/gx/gpu_pcrtc';
import {
	gxGpuLocalMemoryAddress16,
	gxGpuLocalMemoryAddress16S,
	gxGpuLocalMemoryAddress32,
	gxGpuLocalMemoryAddressGpu24,
	gxGpuLocalMemoryAddressGx16,
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
const GENERIC_CIRCUIT_WRITE_RGB = 1;
const GENERIC_CIRCUIT_WRITE_ALPHA = 2;
const GENERIC_CIRCUIT_BLEND_SOURCE_ALPHA = 3;
const GENERIC_CIRCUIT_BLEND_CONSTANT_ALPHA = 4;

function rawWordAtAddress(address: number): number {
	return gxGpuSoftwareVram[address & (GX_GPU_VRAM_WORD_COUNT - 1)];
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
	if (circuit.framebufferStoragePath === GX_GPU_PCRTC_STORAGE_CT32
		|| circuit.framebufferStoragePath === GX_GPU_PCRTC_STORAGE_CT24) {
		const address = gxGpuLocalMemoryAddress32(
			circuit.framebufferBaseWord,
			circuit.framebufferPagesPerRow,
			sourceX,
			sourceY,
		);
		const low = rawWordAtAddress(address);
		const high = rawWordAtAddress(address + 1);
		const alpha = circuit.framebufferStoragePath === GX_GPU_PCRTC_STORAGE_CT32 ? high >>> 8 : 0x80;
		return low | ((high & 0xff) << 16) | (alpha << 24);
	}
	if (circuit.framebufferStoragePath === GX_GPU_PCRTC_STORAGE_CT16
		|| circuit.framebufferStoragePath === GX_GPU_PCRTC_STORAGE_CT16S) {
		const address = circuit.framebufferStoragePath === GX_GPU_PCRTC_STORAGE_CT16
			? gxGpuLocalMemoryAddress16(circuit.framebufferBaseWord, circuit.framebufferPagesPerRow, sourceX, sourceY)
			: gxGpuLocalMemoryAddress16S(circuit.framebufferBaseWord, circuit.framebufferPagesPerRow, sourceX, sourceY);
		const word = rawWordAtAddress(address);
		return rgb555Color(word) | ((word & 0x8000) !== 0 ? 0x80000000 : 0);
	}
	if (circuit.framebufferStoragePath === GX_GPU_PCRTC_STORAGE_GPU24) {
		const first = rawWordAtAddress(gxGpuLocalMemoryAddressGpu24(
			circuit.framebufferBaseWord, circuit.framebufferPagesPerRow, sourceX, sourceY, 0));
		const second = rawWordAtAddress(gxGpuLocalMemoryAddressGpu24(
			circuit.framebufferBaseWord, circuit.framebufferPagesPerRow, sourceX, sourceY, 1));
		const rgb = (sourceX & 1) === 0
			? first | ((second & 0xff) << 16)
			: (first >>> 8) | (second << 8);
		return rgb | 0x80000000;
	}
	if (circuit.framebufferStoragePath === GX_GPU_PCRTC_STORAGE_GX16) {
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

function writeGx16RgbRows(
	state: GxGpuPipelineState,
	target: Uint32Array,
	circuit: GxGpuPcrtcCircuit,
	firstRow: number,
	rowStep: number,
	destinationAlphaMask: number,
	sourceAlphaMask: number,
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
			const alpha = (target[output] & destinationAlphaMask)
				| (((word & 0x8000) << 16) & sourceAlphaMask);
			target[output] = (rgb555Color(word) | alpha) >>> 0;
			address += 1;
			output += 1;
		}
	}
}

function writeGx16AlphaRows(
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
			target[output] = (target[output] & 0x00ffffff) | ((rawWordAtAddress(address) & 0x8000) << 16);
			address += 1;
			output += 1;
		}
	}
}

function writeGx16SourceAlphaRows(
	state: GxGpuPipelineState,
	target: Uint32Array,
	circuit: GxGpuPcrtcCircuit,
	destinationAlphaMask: number,
	sourceAlphaMask: number,
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
			const sourceMask = -(word >>> 15);
			const destination = target[output];
			const rgb = (rgb555Color(word) & sourceMask) | (destination & ~sourceMask & 0x00ffffff);
			const outputAlpha = (destination & destinationAlphaMask)
				| (((word & 0x8000) << 16) & sourceAlphaMask);
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
	destinationAlphaMask: number,
	sourceAlphaMask: number,
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
			const outputAlpha = (target[output] & destinationAlphaMask)
				| (((word & 0x8000) << 16) & sourceAlphaMask);
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
	if (scanout.rgbUnderlayFromCircuit2 && scanout.circuit2CoversOutput) {
		writeGx16RgbRows(
			state, target, circuit2, firstRow, rowStep, 0,
			scanout.outputCircuit2AlphaMask,
		);
	} else {
		fillBackgroundRows(state, target, firstRow, rowStep);
		if (scanout.rgbUnderlayFromCircuit2) {
			writeGx16RgbRows(
				state, target, circuit2, firstRow, rowStep, 0,
				scanout.outputCircuit2AlphaMask,
			);
		} else if (scanout.outputAlphaFromCircuit2 && circuit2.enabled) {
			writeGx16AlphaRows(state, target, circuit2, firstRow, rowStep);
		}
	}
	if (!circuit1.enabled) return;
	if (!scanout.blendAlphaFromRegister) {
		writeGx16SourceAlphaRows(
			state, target, circuit1,
			scanout.outputCircuit2AlphaMask, scanout.outputCircuit1AlphaMask,
			firstRow, rowStep,
		);
		return;
	}
	if (scanout.blendAlpha === 0) {
		if (!scanout.outputAlphaFromCircuit2) writeGx16AlphaRows(state, target, circuit1, firstRow, rowStep);
		return;
	}
	if (scanout.blendAlpha === 255) {
		writeGx16RgbRows(
			state,
			target,
			circuit1,
			firstRow,
			rowStep,
			scanout.outputCircuit2AlphaMask,
			scanout.outputCircuit1AlphaMask,
		);
		return;
	}
	writeGx16BlendedRows(
		state, target, circuit1, scanout.blendAlpha,
		scanout.outputCircuit2AlphaMask, scanout.outputCircuit1AlphaMask,
		firstRow, rowStep,
	);
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
		if (operation === GENERIC_CIRCUIT_BLEND_SOURCE_ALPHA) {
			for (let outputX = left; outputX < right; outputX += 1) {
				const source = circuitPixel(circuit, sourceX, sourceY);
				let blendAlpha = source >>> 23 & 0x1fe;
				if (blendAlpha > 255) blendAlpha = 255;
				const outputAlpha = (target[output] & scanout.outputCircuit2AlphaMask)
					| (source & scanout.outputCircuit1AlphaMask);
				target[output] = blendOutputRgba(target[output], source, blendAlpha, outputAlpha);
				sourceX += circuit.sourceAdvanceX;
				sourceRemainder += circuit.sourceRemainderStepX;
				if (sourceRemainder >= circuit.magnificationX) {
					sourceRemainder -= circuit.magnificationX;
					sourceX += 1;
				}
				output += 1;
			}
		} else if (operation === GENERIC_CIRCUIT_BLEND_CONSTANT_ALPHA) {
			for (let outputX = left; outputX < right; outputX += 1) {
				const source = circuitPixel(circuit, sourceX, sourceY);
				const outputAlpha = (target[output] & scanout.outputCircuit2AlphaMask)
					| (source & scanout.outputCircuit1AlphaMask);
				target[output] = blendOutputRgba(target[output], source, scanout.blendAlpha, outputAlpha);
				sourceX += circuit.sourceAdvanceX;
				sourceRemainder += circuit.sourceRemainderStepX;
				if (sourceRemainder >= circuit.magnificationX) {
					sourceRemainder -= circuit.magnificationX;
					sourceX += 1;
				}
				output += 1;
			}
		} else if (operation === GENERIC_CIRCUIT_WRITE_RGBA) {
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
		} else if (operation === GENERIC_CIRCUIT_WRITE_RGB) {
			for (let outputX = left; outputX < right; outputX += 1) {
				const source = circuitPixel(circuit, sourceX, sourceY);
				target[output] = (source & 0x00ffffff) | (target[output] & 0xff000000);
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
				const source = circuitPixel(circuit, sourceX, sourceY);
				target[output] = (target[output] & 0x00ffffff) | (source & 0xff000000);
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
	if (scanout.rgbUnderlayFromCircuit2) {
		if (scanout.outputAlphaFromCircuit2) {
			writeGenericCircuitRows(
				state, target, scanout.circuits[1], GENERIC_CIRCUIT_WRITE_RGBA, firstRow, rowStep,
			);
		} else {
			writeGenericCircuitRows(
				state, target, scanout.circuits[1], GENERIC_CIRCUIT_WRITE_RGB, firstRow, rowStep,
			);
		}
	} else if (scanout.outputAlphaFromCircuit2 && scanout.circuits[1].enabled) {
		writeGenericCircuitRows(state, target, scanout.circuits[1], GENERIC_CIRCUIT_WRITE_ALPHA, firstRow, rowStep);
	}
	if (scanout.circuits[0].enabled) {
		if (scanout.blendAlphaFromRegister) {
			writeGenericCircuitRows(
				state, target, scanout.circuits[0], GENERIC_CIRCUIT_BLEND_CONSTANT_ALPHA, firstRow, rowStep,
			);
		} else {
			writeGenericCircuitRows(
				state, target, scanout.circuits[0], GENERIC_CIRCUIT_BLEND_SOURCE_ALPHA, firstRow, rowStep,
			);
		}
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
