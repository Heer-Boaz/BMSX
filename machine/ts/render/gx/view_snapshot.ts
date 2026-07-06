import type { GxGpuDeviceOutput } from '../../machine/devices/gx/device_output';
import type { GameView } from '../gameview';

export function commitGxGpuViewSnapshot(view: GameView, output: GxGpuDeviceOutput): void {
	view.gxGpuCommandBuffer = output.commandBuffer;
}
