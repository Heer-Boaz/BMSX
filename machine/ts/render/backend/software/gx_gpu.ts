import type { GxGpuPipelineState } from '../backend';
import type { GxGpu } from '../../../machine/devices/gx/gpu';
import { GX_GPU_VRAM_HEIGHT, GX_GPU_VRAM_WIDTH, type GxGpuCommandBufferView, type GxGpuReadbackPortView } from '../../../machine/devices/gx/gpu_command_buffer';
import { executeGxGpuSoftwareCommands } from './gx_gpu_commands';
import { scanoutGxGpuSoftwareVram } from './gx_gpu_scanout';
import { GX_GPU_SOFTWARE_VRAM_WORDS, gxGpuSoftwareVram, loadGxGpuSoftwareVramBytes } from './gx_gpu_vram';

let gxGpuSoftwareProcessedCommandCount = 0;
let gxGpuSoftwareProcessedCommandSerial = 0;
export let gxGpuSoftwareVramSnapshotSerial = 0n;

type GxGpuSoftwareVramSource = {
	commandBuffer: GxGpuCommandBufferView;
	readbackPort: GxGpuReadbackPortView;
	vramSnapshotBytes: Uint8Array;
	vramSnapshotSerial: bigint;
};

export function executeGxGpuSoftwareVramCommands(source: GxGpuSoftwareVramSource): void {
	const commandBuffer = source.commandBuffer;
	const readback = source.readbackPort;
	const commandSerial = commandBuffer.serial;
	if (gxGpuSoftwareVramSnapshotSerial !== source.vramSnapshotSerial) {
		loadGxGpuSoftwareVramBytes(source.vramSnapshotBytes);
		gxGpuSoftwareProcessedCommandCount = 0;
		gxGpuSoftwareProcessedCommandSerial = commandSerial;
		gxGpuSoftwareVramSnapshotSerial = source.vramSnapshotSerial;
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

export function renderGxGpuSoftwareFrame(state: GxGpuPipelineState, target: Uint8Array): void {
	executeGxGpuSoftwareVramCommands(state);
	scanoutGxGpuSoftwareVram(state, target);
}

export function captureGxGpuVramSnapshot(gxGpu: GxGpu, snapshotBytes: Uint8Array): void {
	const output = gxGpu.readDeviceOutput();
	executeGxGpuSoftwareVramCommands(output);
	for (let wordIndex = 0; wordIndex < GX_GPU_SOFTWARE_VRAM_WORDS; wordIndex += 1) {
		const byteIndex = wordIndex << 1;
		const word = gxGpuSoftwareVram[wordIndex];
		snapshotBytes[byteIndex] = word & 0xff;
		snapshotBytes[byteIndex + 1] = word >>> 8;
	}
	gxGpuSoftwareVramSnapshotSerial = gxGpu.commitRenderedVramSnapshotBytes(snapshotBytes);
}
