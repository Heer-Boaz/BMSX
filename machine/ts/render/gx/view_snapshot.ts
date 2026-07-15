import type { GxGpuDeviceOutput } from '../../machine/devices/gx/device_output';
import type { GameView } from '../gameview';

export function commitGxGpuViewSnapshot(view: GameView, output: GxGpuDeviceOutput): void {
	view.gxGpuCommandBuffer = output.commandBuffer;
	view.gxGpuSystemVram = output.systemVramPort;
	view.gxGpuReadbackPort = output.readbackPort;
	view.gxGpuStatusWord = output.statusWord;
	view.gxGpuDisplayModeWord = output.displayModeWord;
	view.gxGpuDisplayStartWord = output.displayStartWord;
	view.gxGpuHorizontalDisplayRangeWord = output.horizontalDisplayRangeWord;
	view.gxGpuVerticalDisplayRangeWord = output.verticalDisplayRangeWord;
	view.gxGpuDisplay2StartWord = output.display2StartWord;
	view.gxGpuDisplay2SizeWord = output.display2SizeWord;
	view.gxGpuCompositorControlWord = output.compositorControlWord;
	view.gxGpuVramSnapshotBytes = output.vramSnapshotBytes;
	view.gxGpuVramSnapshotSerial = output.vramSnapshotSerial;
}
