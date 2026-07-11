#include "render/vdp/view_snapshot.h"

#include "machine/devices/vdp/device_output.h"
#include "render/gameview.h"

namespace bmsx {

void commitVdpViewSnapshot(GameView& view, const VdpDeviceOutput& output) {
	view.dither_type = static_cast<GameView::DitherType>(output.ditherType);
	view.vdpDirectionalLightCount = 0;
	view.vdpPointLightCount = 0;
}

} // namespace bmsx
