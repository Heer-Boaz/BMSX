import type { GxGpuPipelineState } from '../backend';
import { GX_GPU_VRAM_HEIGHT, GX_GPU_VRAM_WIDTH, type GxGpuCommandBufferView, type GxGpuReadbackPortView } from '../../../machine/devices/gx/gpu_command_buffer';
import { executeGxGpuSoftwareCommands } from './gx_gpu_commands';
import { scanoutGxGpuSoftwareVram } from './gx_gpu_scanout';
import { gxGpuSoftwareVram, loadGxGpuSoftwareVramBytes } from './gx_gpu_vram';

let gxGpuSoftwareProcessedCommandCount = 0;
let gxGpuSoftwareProcessedCommandSerial = 0;
let gxGpuSoftwareVramClearSerial = 0;
export let gxGpuSoftwareVramSnapshotSerial = 0;

type GxGpuSoftwareVramSource = {
	commandBuffer: GxGpuCommandBufferView;
	readbackPort: GxGpuReadbackPortView;
	vramSnapshotBytes: Uint8Array;
	vramSnapshotSerial: number;
};

export function executeGxGpuSoftwareVramCommands(source: GxGpuSoftwareVramSource): void {
	const commandBuffer = source.commandBuffer;
	const readback = source.readbackPort;
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
	if (readback.claimReadback(commandBuffer.presentCommandCount)) {
		const readbackToken = readback.token;
		let pixel = 0;
		for (let row = 0; row < readback.height; row += 1) {
			const y = (readback.y + row) & (GX_GPU_VRAM_HEIGHT - 1);
			for (let column = 0; column < readback.width; column += 1) {
				const x = (readback.x + column) & (GX_GPU_VRAM_WIDTH - 1);
				const word = gxGpuSoftwareVram[y * GX_GPU_VRAM_WIDTH + x]!;
				readback.pixelBytes[pixel * 2] = word & 0xff;
				readback.pixelBytes[pixel * 2 + 1] = word >>> 8;
				pixel += 1;
			}
		}
		readback.completeReadback(readbackToken);
	}
}

export function renderGxGpuSoftwareFrame(state: GxGpuPipelineState, target: Uint8Array, targetWidth: number, targetHeight: number): void {
	executeGxGpuSoftwareVramCommands(state);
	scanoutGxGpuSoftwareVram(state, target, targetWidth, targetHeight);
}
