#include "render/gx/view_snapshot.h"

#include "machine/devices/gx/device_output.h"
#include "render/gameview.h"

namespace bmsx {

void commitGxGpuViewSnapshot(GameView& view, const GxGpuDeviceOutput& output) {
	view.gxGpuCommandBuffer = output.commandBuffer;
	view.gxGpuDisplayModeWord = output.displayModeWord;
	view.gxGpuDisplayStartWord = output.displayStartWord;
	view.gxGpuHorizontalDisplayRangeWord = output.horizontalDisplayRangeWord;
	view.gxGpuVerticalDisplayRangeWord = output.verticalDisplayRangeWord;
}

} // namespace bmsx
