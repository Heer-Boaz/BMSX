import type { GxGpuPipelineState } from '../backend';
import type { GxGpu } from '../../../machine/devices/gx/gpu';
import type { GxGpuDeviceOutput } from '../../../machine/devices/gx/device_output';
import type { GxGpuCommandBufferView, GxGpuReadbackPortView } from '../../../machine/devices/gx/gpu_command_buffer';
import { GX_GPU_VRAM_WIDTH, gxGpuVramYAddress } from '../../../spec/gx/vram';
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

export function executeGxGpuSoftwareVramCommands(source: GxGpuSoftwareVramSource, commandLimit: number): void {
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
	gxGpuSoftwareProcessedCommandCount = executeGxGpuSoftwareCommands(commandBuffer, gxGpuSoftwareProcessedCommandCount, commandLimit);
	if (readback.claimReadback(commandLimit)) {
		const readbackToken = readback.token;
		let pixel = 0;
		for (let row = 0; row < readback.height; row += 1) {
			const y = gxGpuVramYAddress(readback.y + row, readback.vramYAddressExtensionWord);
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

export function renderGxGpuSoftwareFrame(
	state: GxGpuPipelineState,
	output: GxGpuDeviceOutput,
	target: Uint32Array,
): void {
	executeGxGpuSoftwareVramCommands(output, output.commandBuffer.presentCommandCount);
	scanoutGxGpuSoftwareVram(state, output.pcrtcScanout, output.vramReplacementSerial, target);
}

export function captureGxGpuVramSnapshot(gxGpu: GxGpu, snapshotBytes: Uint8Array): void {
	const output = gxGpu.readDeviceOutput();
	executeGxGpuSoftwareVramCommands(output, output.commandBuffer.executedCommandCount);
	for (let wordIndex = 0; wordIndex < GX_GPU_SOFTWARE_VRAM_WORDS; wordIndex += 1) {
		const byteIndex = wordIndex << 1;
		const word = gxGpuSoftwareVram[wordIndex];
		snapshotBytes[byteIndex] = word & 0xff;
		snapshotBytes[byteIndex + 1] = word >>> 8;
	}
	gxGpuSoftwareVramSnapshotSerial = gxGpu.commitRenderedVramSnapshotBytes(snapshotBytes, gxGpuSoftwareProcessedCommandCount);
}
