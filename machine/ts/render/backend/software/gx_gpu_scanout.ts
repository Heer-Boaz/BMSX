import {
	GX_GPU_PCRTC_COMPOSE_GX16,
	GX_GPU_PCRTC_COMPOSE_GX16_DIRECT_CIRCUIT1,
	GX_GPU_PCRTC_SCANOUT_DRAW_BLEND_CONSTANT_RGB,
	GX_GPU_PCRTC_SCANOUT_DRAW_BLEND_SOURCE_RGB,
	GX_GPU_PCRTC_SCANOUT_DRAW_NONE,
	GX_GPU_PCRTC_SCANOUT_DRAW_RAW_ALPHA,
	GX_GPU_PCRTC_SCANOUT_DRAW_RAW_RGBA,
	GX_GPU_PCRTC_SCANOUT_DRAW_RAW_RGB,
	GX_GPU_PCRTC_SOURCE_DIVISION_SHIFT,
	type GxGpuPcrtcCircuit,
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

type CircuitPixelReader = (circuit: GxGpuPcrtcCircuit, sourceX: number, sourceY: number) => number;

function circuitPixelCt32(circuit: GxGpuPcrtcCircuit, sourceX: number, sourceY: number): number {
	const address = gxGpuLocalMemoryAddress32(
		circuit.framebufferBaseWord,
		circuit.framebufferPagesPerRow,
		sourceX,
		sourceY,
	);
	const low = rawWordAtAddress(address);
	const high = rawWordAtAddress(address + 1);
	return low | ((high & 0xff) << 16) | ((high >>> 8) << 24);
}

function circuitPixelCt24(circuit: GxGpuPcrtcCircuit, sourceX: number, sourceY: number): number {
	const address = gxGpuLocalMemoryAddress32(
		circuit.framebufferBaseWord,
		circuit.framebufferPagesPerRow,
		sourceX,
		sourceY,
	);
	const low = rawWordAtAddress(address);
	return low | ((rawWordAtAddress(address + 1) & 0xff) << 16) | 0x80000000;
}

function circuitPixelCt16(circuit: GxGpuPcrtcCircuit, sourceX: number, sourceY: number): number {
	const word = rawWordAtAddress(gxGpuLocalMemoryAddress16(
		circuit.framebufferBaseWord, circuit.framebufferPagesPerRow, sourceX, sourceY));
	return rgb555Color(word) | ((word & 0x8000) << 16);
}

function circuitPixelCt16S(circuit: GxGpuPcrtcCircuit, sourceX: number, sourceY: number): number {
	const word = rawWordAtAddress(gxGpuLocalMemoryAddress16S(
		circuit.framebufferBaseWord, circuit.framebufferPagesPerRow, sourceX, sourceY));
	return rgb555Color(word) | ((word & 0x8000) << 16);
}

function circuitPixelGpu24(circuit: GxGpuPcrtcCircuit, sourceX: number, sourceY: number): number {
	const first = rawWordAtAddress(gxGpuLocalMemoryAddressGpu24(
		circuit.framebufferBaseWord, circuit.framebufferPagesPerRow, sourceX, sourceY, 0));
	const second = rawWordAtAddress(gxGpuLocalMemoryAddressGpu24(
		circuit.framebufferBaseWord, circuit.framebufferPagesPerRow, sourceX, sourceY, 1));
	const rgb = (sourceX & 1) === 0
		? first | ((second & 0xff) << 16)
		: (first >>> 8) | (second << 8);
	return rgb | 0x80000000;
}

function circuitPixelGx16(circuit: GxGpuPcrtcCircuit, sourceX: number, sourceY: number): number {
	const word = rawWordAtAddress(gxGpuLocalMemoryAddressGx16(
		circuit.framebufferBaseWord, circuit.framebufferWidth, sourceX, sourceY));
	return rgb555Color(word) | ((word & 0x8000) << 16);
}

function circuitPixelZero(_circuit: GxGpuPcrtcCircuit, _sourceX: number, _sourceY: number): number {
	return 0;
}

const circuitPixelReaders: readonly CircuitPixelReader[] = [
	circuitPixelCt32,
	circuitPixelCt24,
	circuitPixelCt16,
	circuitPixelCt16S,
	circuitPixelGpu24,
	circuitPixelGx16,
	circuitPixelZero,
];

function fillBackgroundRows(state: GxGpuPipelineState, target: Uint32Array, firstRow: number, rowStep: number): void {
	const scanout = state.pcrtcScanout;
	const background = scanout.backgroundColor;
	for (let outputY = firstRow; outputY < state.height; outputY += rowStep) {
		const rowStart = outputY * state.width;
		target.fill(background, rowStart, rowStart + state.width);
	}
}

function writeGx16RgbRows(
	state: GxGpuPipelineState,
	target: Uint32Array,
	circuit: GxGpuPcrtcCircuit,
): void {
	const left = circuit.displayX;
	const right = circuit.displayRight;
	let sourceY = circuit.linearFieldSourceY;
	let outputY = circuit.fieldDisplayY;
	for (let line = 0; line < circuit.fieldDisplayLineCount; line += 1) {
		let address = circuit.framebufferBaseWord
			+ sourceY * circuit.framebufferWidth
			+ circuit.framebufferX + left - circuit.displayX;
		let output = outputY * state.width + left;
		for (let outputX = left; outputX < right; outputX += 1) {
			const word = rawWordAtAddress(address);
			target[output] = (rgb555Color(word) | (target[output] & 0xff000000)) >>> 0;
			address += 1;
			output += 1;
		}
		outputY += state.pcrtcScanout.outputRowStep;
		sourceY += circuit.linearFieldSourceRowStep;
	}
}

function writeGx16RgbaRows(
	state: GxGpuPipelineState,
	target: Uint32Array,
	circuit: GxGpuPcrtcCircuit,
): void {
	const left = circuit.displayX;
	const right = circuit.displayRight;
	let sourceY = circuit.linearFieldSourceY;
	let outputY = circuit.fieldDisplayY;
	for (let line = 0; line < circuit.fieldDisplayLineCount; line += 1) {
		let address = circuit.framebufferBaseWord
			+ sourceY * circuit.framebufferWidth
			+ circuit.framebufferX + left - circuit.displayX;
		let output = outputY * state.width + left;
		for (let outputX = left; outputX < right; outputX += 1) {
			const word = rawWordAtAddress(address);
			target[output] = (rgb555Color(word) | ((word & 0x8000) << 16)) >>> 0;
			address += 1;
			output += 1;
		}
		outputY += state.pcrtcScanout.outputRowStep;
		sourceY += circuit.linearFieldSourceRowStep;
	}
}

function writeGx16AlphaRows(
	state: GxGpuPipelineState,
	target: Uint32Array,
	circuit: GxGpuPcrtcCircuit,
): void {
	const left = circuit.displayX;
	const right = circuit.displayRight;
	let sourceY = circuit.linearFieldSourceY;
	let outputY = circuit.fieldDisplayY;
	for (let line = 0; line < circuit.fieldDisplayLineCount; line += 1) {
		let address = circuit.framebufferBaseWord
			+ sourceY * circuit.framebufferWidth
			+ circuit.framebufferX + left - circuit.displayX;
		let output = outputY * state.width + left;
		for (let outputX = left; outputX < right; outputX += 1) {
			target[output] = (target[output] & 0x00ffffff) | ((rawWordAtAddress(address) & 0x8000) << 16);
			address += 1;
			output += 1;
		}
		outputY += state.pcrtcScanout.outputRowStep;
		sourceY += circuit.linearFieldSourceRowStep;
	}
}

function writeGx16SourceAlphaRows(
	state: GxGpuPipelineState,
	target: Uint32Array,
	circuit: GxGpuPcrtcCircuit,
): void {
	const left = circuit.displayX;
	const right = circuit.displayRight;
	let sourceY = circuit.linearFieldSourceY;
	let outputY = circuit.fieldDisplayY;
	for (let line = 0; line < circuit.fieldDisplayLineCount; line += 1) {
		let address = circuit.framebufferBaseWord
			+ sourceY * circuit.framebufferWidth
			+ circuit.framebufferX + left - circuit.displayX;
		let output = outputY * state.width + left;
		for (let outputX = left; outputX < right; outputX += 1) {
			const word = rawWordAtAddress(address);
			const sourceMask = -(word >>> 15);
			const destination = target[output];
			const rgb = (rgb555Color(word) & sourceMask) | (destination & ~sourceMask & 0x00ffffff);
			target[output] = (rgb | (destination & 0xff000000)) >>> 0;
			address += 1;
			output += 1;
		}
		outputY += state.pcrtcScanout.outputRowStep;
		sourceY += circuit.linearFieldSourceRowStep;
	}
}

function writeGx16BlendedRows(
	state: GxGpuPipelineState,
	target: Uint32Array,
	circuit: GxGpuPcrtcCircuit,
	alpha: number,
): void {
	const left = circuit.displayX;
	const right = circuit.displayRight;
	let sourceY = circuit.linearFieldSourceY;
	let outputY = circuit.fieldDisplayY;
	for (let line = 0; line < circuit.fieldDisplayLineCount; line += 1) {
		let address = circuit.framebufferBaseWord
			+ sourceY * circuit.framebufferWidth
			+ circuit.framebufferX + left - circuit.displayX;
		let output = outputY * state.width + left;
		for (let outputX = left; outputX < right; outputX += 1) {
			const word = rawWordAtAddress(address);
			const destination = target[output];
			target[output] = blendOutputRgba(destination, rgb555Color(word), alpha, destination & 0xff000000);
			address += 1;
			output += 1;
		}
		outputY += state.pcrtcScanout.outputRowStep;
		sourceY += circuit.linearFieldSourceRowStep;
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
	if (scanout.backgroundRequired) fillBackgroundRows(state, target, firstRow, rowStep);
	if (scanout.circuit2OutputPath === GX_GPU_PCRTC_SCANOUT_DRAW_RAW_RGB) {
		writeGx16RgbRows(state, target, circuit2);
	} else if (scanout.circuit2OutputPath === GX_GPU_PCRTC_SCANOUT_DRAW_RAW_RGBA) {
		writeGx16RgbaRows(state, target, circuit2);
	} else if (scanout.circuit2OutputPath === GX_GPU_PCRTC_SCANOUT_DRAW_RAW_ALPHA) {
		writeGx16AlphaRows(state, target, circuit2);
	}
	if (scanout.circuit1ColorPath === GX_GPU_PCRTC_SCANOUT_DRAW_RAW_RGB) {
		writeGx16RgbRows(state, target, circuit1);
	} else if (scanout.circuit1ColorPath === GX_GPU_PCRTC_SCANOUT_DRAW_RAW_RGBA) {
		writeGx16RgbaRows(state, target, circuit1);
	} else if (scanout.circuit1ColorPath === GX_GPU_PCRTC_SCANOUT_DRAW_BLEND_SOURCE_RGB) {
		writeGx16SourceAlphaRows(state, target, circuit1);
	} else if (scanout.circuit1ColorPath === GX_GPU_PCRTC_SCANOUT_DRAW_BLEND_CONSTANT_RGB) {
		writeGx16BlendedRows(state, target, circuit1, scanout.blendAlpha);
	}
	if (scanout.circuit1AlphaPath !== GX_GPU_PCRTC_SCANOUT_DRAW_NONE) {
		writeGx16AlphaRows(state, target, circuit1);
	}
}

function writeGenericRgbaRows(
	state: GxGpuPipelineState,
	target: Uint32Array,
	circuit: GxGpuPcrtcCircuit,
	readPixel: CircuitPixelReader,
): void {
	const left = circuit.displayX;
	const right = circuit.displayRight;
	const sourceXStart = circuit.framebufferX
		+ (circuit.sourcePhaseX * circuit.sourceDivisionMultiplierX >>> GX_GPU_PCRTC_SOURCE_DIVISION_SHIFT);
	const sourceRemainderStart = circuit.sourcePhaseX % circuit.magnificationX;
	let sourceYNumerator = circuit.fieldSourceNumeratorY;
	let outputY = circuit.fieldDisplayY;
	for (let line = 0; line < circuit.fieldDisplayLineCount; line += 1) {
		const sourceY = circuit.framebufferY
			+ (sourceYNumerator * circuit.fieldSourceDivisionMultiplierY >>> GX_GPU_PCRTC_SOURCE_DIVISION_SHIFT)
				* circuit.fieldSourceStride
			+ circuit.fieldSourcePhase;
		let sourceX = sourceXStart;
		let sourceRemainder = sourceRemainderStart;
		let output = outputY * state.width + left;
		for (let outputX = left; outputX < right; outputX += 1) {
			target[output] = readPixel(circuit, sourceX, sourceY) >>> 0;
			sourceX += circuit.sourceAdvanceX;
			sourceRemainder += circuit.sourceRemainderStepX;
			if (sourceRemainder >= circuit.magnificationX) {
				sourceRemainder -= circuit.magnificationX;
				sourceX += 1;
			}
			output += 1;
		}
		outputY += state.pcrtcScanout.outputRowStep;
		sourceYNumerator += circuit.fieldSourceNumeratorStepY;
	}
}

function writeGenericRgbRows(
	state: GxGpuPipelineState,
	target: Uint32Array,
	circuit: GxGpuPcrtcCircuit,
	readPixel: CircuitPixelReader,
): void {
	const left = circuit.displayX;
	const right = circuit.displayRight;
	const sourceXStart = circuit.framebufferX
		+ (circuit.sourcePhaseX * circuit.sourceDivisionMultiplierX >>> GX_GPU_PCRTC_SOURCE_DIVISION_SHIFT);
	const sourceRemainderStart = circuit.sourcePhaseX % circuit.magnificationX;
	let sourceYNumerator = circuit.fieldSourceNumeratorY;
	let outputY = circuit.fieldDisplayY;
	for (let line = 0; line < circuit.fieldDisplayLineCount; line += 1) {
		const sourceY = circuit.framebufferY
			+ (sourceYNumerator * circuit.fieldSourceDivisionMultiplierY >>> GX_GPU_PCRTC_SOURCE_DIVISION_SHIFT)
				* circuit.fieldSourceStride
			+ circuit.fieldSourcePhase;
		let sourceX = sourceXStart;
		let sourceRemainder = sourceRemainderStart;
		let output = outputY * state.width + left;
		for (let outputX = left; outputX < right; outputX += 1) {
			const source = readPixel(circuit, sourceX, sourceY);
			target[output] = (source & 0x00ffffff) | (target[output] & 0xff000000);
			sourceX += circuit.sourceAdvanceX;
			sourceRemainder += circuit.sourceRemainderStepX;
			if (sourceRemainder >= circuit.magnificationX) {
				sourceRemainder -= circuit.magnificationX;
				sourceX += 1;
			}
			output += 1;
		}
		outputY += state.pcrtcScanout.outputRowStep;
		sourceYNumerator += circuit.fieldSourceNumeratorStepY;
	}
}

function writeGenericAlphaRows(
	state: GxGpuPipelineState,
	target: Uint32Array,
	circuit: GxGpuPcrtcCircuit,
	readPixel: CircuitPixelReader,
): void {
	const left = circuit.displayX;
	const right = circuit.displayRight;
	const sourceXStart = circuit.framebufferX
		+ (circuit.sourcePhaseX * circuit.sourceDivisionMultiplierX >>> GX_GPU_PCRTC_SOURCE_DIVISION_SHIFT);
	const sourceRemainderStart = circuit.sourcePhaseX % circuit.magnificationX;
	let sourceYNumerator = circuit.fieldSourceNumeratorY;
	let outputY = circuit.fieldDisplayY;
	for (let line = 0; line < circuit.fieldDisplayLineCount; line += 1) {
		const sourceY = circuit.framebufferY
			+ (sourceYNumerator * circuit.fieldSourceDivisionMultiplierY >>> GX_GPU_PCRTC_SOURCE_DIVISION_SHIFT)
				* circuit.fieldSourceStride
			+ circuit.fieldSourcePhase;
		let sourceX = sourceXStart;
		let sourceRemainder = sourceRemainderStart;
		let output = outputY * state.width + left;
		for (let outputX = left; outputX < right; outputX += 1) {
			const source = readPixel(circuit, sourceX, sourceY);
			target[output] = (target[output] & 0x00ffffff) | (source & 0xff000000);
			sourceX += circuit.sourceAdvanceX;
			sourceRemainder += circuit.sourceRemainderStepX;
			if (sourceRemainder >= circuit.magnificationX) {
				sourceRemainder -= circuit.magnificationX;
				sourceX += 1;
			}
			output += 1;
		}
		outputY += state.pcrtcScanout.outputRowStep;
		sourceYNumerator += circuit.fieldSourceNumeratorStepY;
	}
}

function writeGenericSourceBlendRows(
	state: GxGpuPipelineState,
	target: Uint32Array,
	circuit: GxGpuPcrtcCircuit,
	readPixel: CircuitPixelReader,
): void {
	const left = circuit.displayX;
	const right = circuit.displayRight;
	const sourceXStart = circuit.framebufferX
		+ (circuit.sourcePhaseX * circuit.sourceDivisionMultiplierX >>> GX_GPU_PCRTC_SOURCE_DIVISION_SHIFT);
	const sourceRemainderStart = circuit.sourcePhaseX % circuit.magnificationX;
	let sourceYNumerator = circuit.fieldSourceNumeratorY;
	let outputY = circuit.fieldDisplayY;
	for (let line = 0; line < circuit.fieldDisplayLineCount; line += 1) {
		const sourceY = circuit.framebufferY
			+ (sourceYNumerator * circuit.fieldSourceDivisionMultiplierY >>> GX_GPU_PCRTC_SOURCE_DIVISION_SHIFT)
				* circuit.fieldSourceStride
			+ circuit.fieldSourcePhase;
		let sourceX = sourceXStart;
		let sourceRemainder = sourceRemainderStart;
		let output = outputY * state.width + left;
		for (let outputX = left; outputX < right; outputX += 1) {
			const source = readPixel(circuit, sourceX, sourceY);
			const doubledAlpha = source >>> 23 & 0x1fe;
			const blendAlpha = (doubledAlpha | -(doubledAlpha >>> 8)) & 0xff;
			const destination = target[output];
			target[output] = blendOutputRgba(destination, source, blendAlpha, destination & 0xff000000);
			sourceX += circuit.sourceAdvanceX;
			sourceRemainder += circuit.sourceRemainderStepX;
			if (sourceRemainder >= circuit.magnificationX) {
				sourceRemainder -= circuit.magnificationX;
				sourceX += 1;
			}
			output += 1;
		}
		outputY += state.pcrtcScanout.outputRowStep;
		sourceYNumerator += circuit.fieldSourceNumeratorStepY;
	}
}

function writeGenericConstantBlendRows(
	state: GxGpuPipelineState,
	target: Uint32Array,
	circuit: GxGpuPcrtcCircuit,
	readPixel: CircuitPixelReader,
): void {
	const left = circuit.displayX;
	const right = circuit.displayRight;
	const sourceXStart = circuit.framebufferX
		+ (circuit.sourcePhaseX * circuit.sourceDivisionMultiplierX >>> GX_GPU_PCRTC_SOURCE_DIVISION_SHIFT);
	const sourceRemainderStart = circuit.sourcePhaseX % circuit.magnificationX;
	const blendAlpha = state.pcrtcScanout.blendAlpha;
	let sourceYNumerator = circuit.fieldSourceNumeratorY;
	let outputY = circuit.fieldDisplayY;
	for (let line = 0; line < circuit.fieldDisplayLineCount; line += 1) {
		const sourceY = circuit.framebufferY
			+ (sourceYNumerator * circuit.fieldSourceDivisionMultiplierY >>> GX_GPU_PCRTC_SOURCE_DIVISION_SHIFT)
				* circuit.fieldSourceStride
			+ circuit.fieldSourcePhase;
		let sourceX = sourceXStart;
		let sourceRemainder = sourceRemainderStart;
		let output = outputY * state.width + left;
		for (let outputX = left; outputX < right; outputX += 1) {
			const source = readPixel(circuit, sourceX, sourceY);
			const destination = target[output];
			target[output] = blendOutputRgba(destination, source, blendAlpha, destination & 0xff000000);
			sourceX += circuit.sourceAdvanceX;
			sourceRemainder += circuit.sourceRemainderStepX;
			if (sourceRemainder >= circuit.magnificationX) {
				sourceRemainder -= circuit.magnificationX;
				sourceX += 1;
			}
			output += 1;
		}
		outputY += state.pcrtcScanout.outputRowStep;
		sourceYNumerator += circuit.fieldSourceNumeratorStepY;
	}
}

function writeGenericCircuitRows(
	state: GxGpuPipelineState,
	target: Uint32Array,
	circuit: GxGpuPcrtcCircuit,
	operation: number,
): void {
	const readPixel = circuitPixelReaders[circuit.framebufferStoragePath]!;
	if (operation === GENERIC_CIRCUIT_WRITE_RGBA) {
		writeGenericRgbaRows(state, target, circuit, readPixel);
	} else if (operation === GENERIC_CIRCUIT_WRITE_RGB) {
		writeGenericRgbRows(state, target, circuit, readPixel);
	} else if (operation === GENERIC_CIRCUIT_WRITE_ALPHA) {
		writeGenericAlphaRows(state, target, circuit, readPixel);
	} else if (operation === GENERIC_CIRCUIT_BLEND_SOURCE_ALPHA) {
		writeGenericSourceBlendRows(state, target, circuit, readPixel);
	} else {
		writeGenericConstantBlendRows(state, target, circuit, readPixel);
	}
}

function writeGenericOutputRows(
	state: GxGpuPipelineState,
	target: Uint32Array,
	firstRow: number,
	rowStep: number,
): void {
	const scanout = state.pcrtcScanout;
	if (scanout.backgroundRequired) fillBackgroundRows(state, target, firstRow, rowStep);
	const circuit2 = scanout.circuits[1];
	if (scanout.circuit2OutputPath === GX_GPU_PCRTC_SCANOUT_DRAW_RAW_RGB) {
		writeGenericCircuitRows(state, target, circuit2, GENERIC_CIRCUIT_WRITE_RGB);
	} else if (scanout.circuit2OutputPath === GX_GPU_PCRTC_SCANOUT_DRAW_RAW_RGBA) {
		writeGenericCircuitRows(state, target, circuit2, GENERIC_CIRCUIT_WRITE_RGBA);
	} else if (scanout.circuit2OutputPath === GX_GPU_PCRTC_SCANOUT_DRAW_RAW_ALPHA) {
		writeGenericCircuitRows(state, target, circuit2, GENERIC_CIRCUIT_WRITE_ALPHA);
	}
	const circuit1 = scanout.circuits[0];
	if (scanout.circuit1ColorPath === GX_GPU_PCRTC_SCANOUT_DRAW_RAW_RGB) {
		writeGenericCircuitRows(state, target, circuit1, GENERIC_CIRCUIT_WRITE_RGB);
	} else if (scanout.circuit1ColorPath === GX_GPU_PCRTC_SCANOUT_DRAW_RAW_RGBA) {
		writeGenericCircuitRows(state, target, circuit1, GENERIC_CIRCUIT_WRITE_RGBA);
	} else if (scanout.circuit1ColorPath === GX_GPU_PCRTC_SCANOUT_DRAW_BLEND_SOURCE_RGB) {
		writeGenericCircuitRows(state, target, circuit1, GENERIC_CIRCUIT_BLEND_SOURCE_ALPHA);
	} else if (scanout.circuit1ColorPath === GX_GPU_PCRTC_SCANOUT_DRAW_BLEND_CONSTANT_RGB) {
		writeGenericCircuitRows(state, target, circuit1, GENERIC_CIRCUIT_BLEND_CONSTANT_ALPHA);
	}
	if (scanout.circuit1AlphaPath !== GX_GPU_PCRTC_SCANOUT_DRAW_NONE) {
		writeGenericCircuitRows(state, target, circuit1, GENERIC_CIRCUIT_WRITE_ALPHA);
	}
}

function writeOutputRows(
	state: GxGpuPipelineState,
	target: Uint32Array,
	firstRow: number,
	rowStep: number,
): void {
	if (state.pcrtcScanout.compositionPath === GX_GPU_PCRTC_COMPOSE_GX16_DIRECT_CIRCUIT1) {
		writeGx16RgbaRows(state, target, state.pcrtcScanout.circuits[0]);
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
