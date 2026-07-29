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
import type { GxGpuSoftwareState } from './gx_gpu_state';

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
	software: GxGpuSoftwareState,
	state: GxGpuPipelineState,
	target: Uint32Array,
	scanout: GxGpuPcrtcScanout,
	firstRow: number,
	rowStep: number,
): void {
	if (scanout.compositionPath === GX_GPU_PCRTC_COMPOSE_GX16_DIRECT_CIRCUIT1) {
		writeGx16CircuitRows(software, state, target, scanout, scanout.circuits[0], scanout.circuit1OutputPath);
		return;
	}
	if (scanout.backgroundRequired) fillBackgroundRows(state, target, scanout, firstRow, rowStep);
	const writeCircuitRows = scanout.compositionPath === GX_GPU_PCRTC_COMPOSE_GX16
		? writeGx16CircuitRows
		: writeGenericCircuitRows;
	writeCircuitRows(software, state, target, scanout, scanout.circuits[1], scanout.circuit2OutputPath);
	writeCircuitRows(software, state, target, scanout, scanout.circuits[0], scanout.circuit1OutputPath);
}

function scanoutInterlacedVram(
	software: GxGpuSoftwareState,
	state: GxGpuPipelineState,
	target: Uint32Array,
	scanout: GxGpuPcrtcScanout,
	vramReplacementSerial: bigint,
): void {
	const geometryChanged = !software.interlacedValid
		|| software.interlacedVramReplacementSerial !== vramReplacementSerial;
	if (geometryChanged) {
		software.interlacedPixels.fill(scanout.backgroundColor);
		software.interlacedValid = true;
		software.interlacedVramReplacementSerial = vramReplacementSerial;
	}
	writeOutputRows(software, state, software.interlacedPixels, scanout, scanout.field, 2);
	target.set(software.interlacedPixels);
}

export function scanoutGxGpuSoftwareVram(
	software: GxGpuSoftwareState,
	state: GxGpuPipelineState,
	scanout: GxGpuPcrtcScanout,
	vramReplacementSerial: bigint,
	target: Uint32Array,
): void {
	if (scanout.interlaced) {
		scanoutInterlacedVram(software, state, target, scanout, vramReplacementSerial);
		return;
	}
	software.interlacedValid = false;
	writeOutputRows(software, state, target, scanout, 0, 1);
}
