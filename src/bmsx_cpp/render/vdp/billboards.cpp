#include "render/vdp/billboards.h"

#include "machine/devices/vdp/vdp.h"
#include "render/gameview.h"

namespace bmsx {

void commitVdpBillboardViewState(GameView& view, const VDP& vdp) {
	const auto& billboards = vdp.committedBillboards();
	view.vdpBillboardCount = billboards.size();
	for (size_t index = 0; index < billboards.size(); ++index) {
		const VdpBbuBillboardEntry& entry = billboards[index];
		GameView::VdpBillboardRenderEntry& target = view.vdpBillboards[index];
		target.position = {entry.positionX, entry.positionY, entry.positionZ};
		target.size = entry.size;
		target.color = entry.color;
		target.slot = entry.slot;
		target.u = entry.source.srcX;
		target.v = entry.source.srcY;
		target.w = entry.source.width;
		target.h = entry.source.height;
		target.uv0 = {
			static_cast<f32>(entry.source.srcX) / static_cast<f32>(entry.surfaceWidth),
			static_cast<f32>(entry.source.srcY) / static_cast<f32>(entry.surfaceHeight),
		};
		target.uv1 = {
			static_cast<f32>(entry.source.srcX + entry.source.width) / static_cast<f32>(entry.surfaceWidth),
			static_cast<f32>(entry.source.srcY + entry.source.height) / static_cast<f32>(entry.surfaceHeight),
		};
	}
}

} // namespace bmsx
