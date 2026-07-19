import {
	GX_GPU_PCRTC_COMPOSE_GX16,
	GX_GPU_PCRTC_COMPOSE_GX16_DIRECT_CIRCUIT1,
} from '../../../machine/devices/gx/gpu_pcrtc';
import type { GxGpuPipelineState } from '../backend';
import {
	writeGenericCircuitRows,
	writeGx16CircuitRows,
} from './gx_gpu_scanout_specialized.generated';

let interlacedPixels = new Uint32Array(0);
let interlacedWidth = 0;
let interlacedHeight = 0;
let interlacedValid = false;
let interlacedVramReplacementSerial = 0n;

function fillBackgroundRows(state: GxGpuPipelineState, target: Uint32Array, firstRow: number, rowStep: number): void {
	const background = state.pcrtcScanout.backgroundColor;
	for (let outputY = firstRow; outputY < state.height; outputY += rowStep) {
		const rowStart = outputY * state.width;
		target.fill(background, rowStart, rowStart + state.width);
	}
}

function writeOutputRows(
	state: GxGpuPipelineState,
	target: Uint32Array,
	firstRow: number,
	rowStep: number,
): void {
	const scanout = state.pcrtcScanout;
	if (scanout.compositionPath === GX_GPU_PCRTC_COMPOSE_GX16_DIRECT_CIRCUIT1) {
		writeGx16CircuitRows(state, target, scanout.circuits[0], scanout.circuit1OutputPath);
		return;
	}
	if (scanout.backgroundRequired) fillBackgroundRows(state, target, firstRow, rowStep);
	const writeCircuitRows = scanout.compositionPath === GX_GPU_PCRTC_COMPOSE_GX16
		? writeGx16CircuitRows
		: writeGenericCircuitRows;
	writeCircuitRows(state, target, scanout.circuits[1], scanout.circuit2OutputPath);
	writeCircuitRows(state, target, scanout.circuits[0], scanout.circuit1OutputPath);
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
