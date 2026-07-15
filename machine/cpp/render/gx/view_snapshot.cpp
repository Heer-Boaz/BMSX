#include "render/gx/view_snapshot.h"

#include "machine/devices/gx/device_output.h"
#include "render/gameview.h"

namespace bmsx {

void commitGxGpuViewSnapshot(GameView& view, const GxGpuDeviceOutput& output) {
	view.gxGpuCommandBuffer = &output.commandBuffer;
	view.gxGpuSystemVram = &output.systemVramPort;
	view.gxGpuReadbackPort = &output.readbackPort;
	view.gxGpuStatusWord = output.statusWord;
	view.gxGpuDisplayModeWord = output.displayModeWord;
	view.gxGpuDisplayStartWord = output.displayStartWord;
	view.gxGpuHorizontalDisplayRangeWord = output.horizontalDisplayRangeWord;
	view.gxGpuVerticalDisplayRangeWord = output.verticalDisplayRangeWord;
	view.gxGpuDisplay2StartWord = output.display2StartWord;
	view.gxGpuDisplay2SizeWord = output.display2SizeWord;
	view.gxGpuCompositorControlWord = output.compositorControlWord;
	view.gxGpuVramSnapshotBytes = &output.vramSnapshotBytes;
	view.gxGpuVramSnapshotSerial = output.vramSnapshotSerial;
}

} // namespace bmsx
