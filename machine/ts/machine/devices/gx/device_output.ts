import type { GxGpuCommandBufferView, GxGpuReadbackPortView } from './gpu_command_buffer';

export type GxGpuDeviceOutput = Readonly<{
	commandBuffer: GxGpuCommandBufferView;
	readbackPort: GxGpuReadbackPortView;
	statusWord: number;
	displayModeWord: number;
	displayStartWord: number;
	horizontalDisplayRangeWord: number;
	verticalDisplayRangeWord: number;
	vramSnapshotBytes: Uint8Array;
	vramSnapshotSerial: number;
}>;
