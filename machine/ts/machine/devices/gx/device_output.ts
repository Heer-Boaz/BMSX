import type { GxGpuCommandBufferView, GxGpuReadbackPortView } from './gpu_command_buffer';
import type { GxGpuPcrtcScanout, GxGpuPcrtcTiming } from './gpu_pcrtc';

export type GxGpuDeviceOutput = Readonly<{
	commandBuffer: GxGpuCommandBufferView;
	readbackPort: GxGpuReadbackPortView;
	statusWord: number;
	displayModeWord: number;
	displayStartWord: number;
	vramYAddressExtensionWord: number;
	horizontalDisplayRangeWord: number;
	verticalDisplayRangeWord: number;
	pcrtcWords: Uint32Array;
	pcrtcTiming: GxGpuPcrtcTiming;
	pcrtcScanout: GxGpuPcrtcScanout;
	vramSnapshotBytes: Uint8Array;
	vramSnapshotSerial: bigint;
}>;
