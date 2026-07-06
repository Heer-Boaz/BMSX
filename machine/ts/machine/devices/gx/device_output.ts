import type { GxGpuCommandBufferView } from './gpu_command_buffer';

export type GxGpuDeviceOutput = Readonly<{
	commandBuffer: GxGpuCommandBufferView;
}>;
