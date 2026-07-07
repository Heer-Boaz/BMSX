import type { GxGpuPipelineState } from '../backend';
import { executeGxGpuSoftwareCommands } from './gx_gpu_commands';
import { scanoutGxGpuSoftwareVram } from './gx_gpu_scanout';
import { resetGxGpuSoftwareVram } from './gx_gpu_vram';

let gxGpuSoftwareProcessedCommandCount = 0;
let gxGpuSoftwareProcessedCommandSerial = 0;

export function renderGxGpuSoftwareFrame(state: GxGpuPipelineState, target: Uint8Array, targetWidth: number, targetHeight: number): void {
	if (gxGpuSoftwareProcessedCommandSerial !== state.commandBuffer.serial) {
		resetGxGpuSoftwareVram();
		gxGpuSoftwareProcessedCommandCount = 0;
		gxGpuSoftwareProcessedCommandSerial = state.commandBuffer.serial;
	}
	gxGpuSoftwareProcessedCommandCount = executeGxGpuSoftwareCommands(state.commandBuffer, gxGpuSoftwareProcessedCommandCount);
	scanoutGxGpuSoftwareVram(state, target, targetWidth, targetHeight);
}
