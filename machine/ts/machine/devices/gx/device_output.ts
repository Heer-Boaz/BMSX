import type { GxGpuCommandBufferView, GxGpuReadbackPortView } from './gpu_command_buffer';
import type { GxGpuSystemVramPortView } from './system_vram_port';

export type GxGpuDeviceOutput = Readonly<{
	commandBuffer: GxGpuCommandBufferView;
	systemVramPort: GxGpuSystemVramPortView;
	readbackPort: GxGpuReadbackPortView;
	statusWord: number;
	displayModeWord: number;
	displayStartWord: number;
	horizontalDisplayRangeWord: number;
	verticalDisplayRangeWord: number;
	display2StartWord: number;
	display2SizeWord: number;
	compositorControlWord: number;
	vramSnapshotBytes: Uint8Array;
	vramSnapshotSerial: bigint;
}>;
