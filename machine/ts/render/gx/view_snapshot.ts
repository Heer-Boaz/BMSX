import type { GxGpuDeviceOutput } from '../../machine/devices/gx/device_output';
import type { GameView } from '../gameview';

export function commitGxGpuViewSnapshot(view: GameView, output: GxGpuDeviceOutput): void {
	view.gxGpuCommandBuffer = output.commandBuffer;
	view.gxGpuReadbackPort = output.readbackPort;
	view.gxGpuStatusWord = output.statusWord;
	view.gxGpuDisplayModeWord = output.displayModeWord;
	view.gxGpuDisplayStartWord = output.displayStartWord;
	view.gxGpuVramYAddressExtensionWord = output.vramYAddressExtensionWord;
	view.gxGpuHorizontalDisplayRangeWord = output.horizontalDisplayRangeWord;
	view.gxGpuVerticalDisplayRangeWord = output.verticalDisplayRangeWord;
	view.gxGpuPcrtcScanout = output.pcrtcScanout;
	view.gxGpuPcrtcScanoutRevision = output.pcrtcScanout.revision;
	view.gxGpuVramSnapshotBytes = output.vramSnapshotBytes;
	view.gxGpuVramSnapshotSerial = output.vramSnapshotSerial;
	view.gxGpuVramReplacementSerial = output.vramReplacementSerial;
}
