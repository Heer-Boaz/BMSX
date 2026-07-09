import type { GxGpuPipelineState } from '../backend';
import type { GxGpuCommandBufferView } from '../../../machine/devices/gx/gpu_command_buffer';
import { executeGxGpuSoftwareCommands } from './gx_gpu_commands';
import { scanoutGxGpuSoftwareVram } from './gx_gpu_scanout';
import { gxGpuSoftwareVram, loadGxGpuSoftwareVramBytes } from './gx_gpu_vram';

let gxGpuSoftwareProcessedCommandCount = 0;
let gxGpuSoftwareProcessedCommandSerial = 0;
let gxGpuSoftwareVramClearSerial = 0;
export let gxGpuSoftwareVramSnapshotSerial = 0;

type GxGpuSoftwareVramSource = {
	commandBuffer: GxGpuCommandBufferView;
	vramSnapshotBytes: Uint8Array;
	vramSnapshotSerial: number;
};

export function executeGxGpuSoftwareVramCommands(source: GxGpuSoftwareVramSource): void {
	const commandBuffer = source.commandBuffer;
	const commandSerial = commandBuffer.serial;
	const vramClearSerial = commandBuffer.vramClearSerial;
	if (gxGpuSoftwareVramSnapshotSerial !== source.vramSnapshotSerial) {
		loadGxGpuSoftwareVramBytes(source.vramSnapshotBytes);
		gxGpuSoftwareProcessedCommandCount = 0;
		gxGpuSoftwareProcessedCommandSerial = commandSerial;
		gxGpuSoftwareVramClearSerial = vramClearSerial;
		gxGpuSoftwareVramSnapshotSerial = source.vramSnapshotSerial;
	} else if (gxGpuSoftwareVramClearSerial !== vramClearSerial) {
		gxGpuSoftwareVram.fill(0);
		gxGpuSoftwareProcessedCommandCount = 0;
		gxGpuSoftwareProcessedCommandSerial = commandSerial;
		gxGpuSoftwareVramClearSerial = vramClearSerial;
	} else if (gxGpuSoftwareProcessedCommandSerial !== commandSerial) {
		gxGpuSoftwareProcessedCommandCount = 0;
		gxGpuSoftwareProcessedCommandSerial = commandSerial;
	}
	gxGpuSoftwareProcessedCommandCount = executeGxGpuSoftwareCommands(commandBuffer, gxGpuSoftwareProcessedCommandCount);
}

export function renderGxGpuSoftwareFrame(state: GxGpuPipelineState, target: Uint8Array, targetWidth: number, targetHeight: number): void {
	executeGxGpuSoftwareVramCommands(state);
	scanoutGxGpuSoftwareVram(state, target, targetWidth, targetHeight);
}
