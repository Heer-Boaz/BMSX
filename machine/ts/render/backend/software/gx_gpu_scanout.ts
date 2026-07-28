import {
	GX_GPU_PCRTC_COMPOSE_GX16,
	GX_GPU_PCRTC_COMPOSE_GX16_DIRECT_CIRCUIT1,
	type GxGpuPcrtcScanout,
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

function fillBackgroundRows(
	state: GxGpuPipelineState,
	target: Uint32Array,
	scanout: GxGpuPcrtcScanout,
	firstRow: number,
	rowStep: number,
): void {
	const background = scanout.backgroundColor;
	for (let outputY = firstRow; outputY < state.height; outputY += rowStep) {
		const rowStart = outputY * state.width;
		target.fill(background, rowStart, rowStart + state.width);
	}
}

function writeOutputRows(
	state: GxGpuPipelineState,
	target: Uint32Array,
	scanout: GxGpuPcrtcScanout,
	firstRow: number,
	rowStep: number,
): void {
	if (scanout.compositionPath === GX_GPU_PCRTC_COMPOSE_GX16_DIRECT_CIRCUIT1) {
		writeGx16CircuitRows(state, target, scanout, scanout.circuits[0], scanout.circuit1OutputPath);
		return;
	}
	if (scanout.backgroundRequired) fillBackgroundRows(state, target, scanout, firstRow, rowStep);
	const writeCircuitRows = scanout.compositionPath === GX_GPU_PCRTC_COMPOSE_GX16
		? writeGx16CircuitRows
		: writeGenericCircuitRows;
	writeCircuitRows(state, target, scanout, scanout.circuits[1], scanout.circuit2OutputPath);
	writeCircuitRows(state, target, scanout, scanout.circuits[0], scanout.circuit1OutputPath);
}

function scanoutInterlacedVram(
	state: GxGpuPipelineState,
	target: Uint32Array,
	scanout: GxGpuPcrtcScanout,
	vramReplacementSerial: bigint,
): void {
	const pixelCount = state.width * state.height;
	const geometryChanged = !interlacedValid
		|| interlacedWidth !== state.width
		|| interlacedHeight !== state.height
		|| interlacedVramReplacementSerial !== vramReplacementSerial;
	if (interlacedPixels.length !== pixelCount) {
		interlacedPixels = new Uint32Array(pixelCount);
	}
	if (geometryChanged) {
		interlacedPixels.fill(scanout.backgroundColor);
		interlacedWidth = state.width;
		interlacedHeight = state.height;
		interlacedValid = true;
		interlacedVramReplacementSerial = vramReplacementSerial;
	}
	writeOutputRows(state, interlacedPixels, scanout, scanout.field, 2);
	target.set(interlacedPixels);
}

export function scanoutGxGpuSoftwareVram(
	state: GxGpuPipelineState,
	scanout: GxGpuPcrtcScanout,
	vramReplacementSerial: bigint,
	target: Uint32Array,
): void {
	if (scanout.interlaced) {
		scanoutInterlacedVram(state, target, scanout, vramReplacementSerial);
		return;
	}
	interlacedValid = false;
	writeOutputRows(state, target, scanout, 0, 1);
}
