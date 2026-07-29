import type { GxGpuPipelineState } from '../backend';
import type { GxGpu } from '../../../machine/devices/gx/gpu';
import type { GxGpuDeviceOutput } from '../../../machine/devices/gx/device_output';
import type { GxGpuCommandBufferView, GxGpuReadbackPortView } from '../../../machine/devices/gx/gpu_command_buffer';
import { GX_GPU_VRAM_X_ADDRESS_PERIOD, gxGpuVramYAddress } from '../../../spec/gx/vram';
import { executeGxGpuSoftwareCommands } from './gx_gpu_commands';
import { scanoutGxGpuSoftwareVram } from './gx_gpu_scanout';
import type { GxGpuSoftwareState } from './gx_gpu_state';
import { loadGxGpuSoftwareVramBytes } from './gx_gpu_vram';

type GxGpuSoftwareVramSource = {
	commandBuffer: GxGpuCommandBufferView;
	readbackPort: GxGpuReadbackPortView;
	vramSnapshotBytes: Uint8Array;
	vramSnapshotSerial: bigint;
};

export function executeGxGpuSoftwareVramCommands(software: GxGpuSoftwareState, source: GxGpuSoftwareVramSource, commandLimit: number): void {
	const commandBuffer = source.commandBuffer;
	const readback = source.readbackPort;
	const commandSerial = commandBuffer.serial;
	if (software.vramSnapshotSerial !== source.vramSnapshotSerial) {
		loadGxGpuSoftwareVramBytes(software, source.vramSnapshotBytes);
		software.processedCommandCount = 0;
		software.processedCommandSerial = commandSerial;
		software.vramSnapshotSerial = source.vramSnapshotSerial;
	} else if (software.processedCommandSerial !== commandSerial) {
		software.processedCommandCount = 0;
		software.processedCommandSerial = commandSerial;
	}
	software.processedCommandCount = executeGxGpuSoftwareCommands(software, commandBuffer, software.processedCommandCount, commandLimit);
	if (readback.claimReadback(commandLimit)) {
		const readbackToken = readback.token;
		let pixel = 0;
		for (let row = 0; row < readback.height; row += 1) {
			const y = gxGpuVramYAddress(readback.y + row, readback.vramYAddressExtensionWord);
			for (let column = 0; column < readback.width; column += 1) {
				const x = (readback.x + column) & (GX_GPU_VRAM_X_ADDRESS_PERIOD - 1);
				const word = software.vram[(y * GX_GPU_VRAM_X_ADDRESS_PERIOD + x) & software.vramWordMask]!;
				readback.pixelBytes[pixel * 2] = word & 0xff;
				readback.pixelBytes[pixel * 2 + 1] = word >>> 8;
				pixel += 1;
			}
		}
		readback.completeReadback(readbackToken);
	}
}

export function renderGxGpuSoftwareFrame(
	software: GxGpuSoftwareState,
	state: GxGpuPipelineState,
	output: GxGpuDeviceOutput,
	target: Uint32Array,
): void {
	executeGxGpuSoftwareVramCommands(software, output, output.commandBuffer.presentCommandCount);
	scanoutGxGpuSoftwareVram(software, state, output.pcrtcScanout, output.vramReplacementSerial, target);
}

export function captureGxGpuVramSnapshot(software: GxGpuSoftwareState, gxGpu: GxGpu): void {
	const output = gxGpu.readDeviceOutput();
	executeGxGpuSoftwareVramCommands(software, output, output.commandBuffer.executedCommandCount);
	for (let wordIndex = 0; wordIndex < software.vram.length; wordIndex += 1) {
		const byteIndex = wordIndex << 1;
		const word = software.vram[wordIndex];
		software.vramSnapshotScratch[byteIndex] = word & 0xff;
		software.vramSnapshotScratch[byteIndex + 1] = word >>> 8;
	}
	software.vramSnapshotSerial = gxGpu.commitRenderedVramSnapshotBytes(software.vramSnapshotScratch, software.processedCommandCount);
}
