#include "render/vdp/view_snapshot.h"

#include "machine/devices/vdp/vdp.h"
#include "render/gameview.h"
#include "render/vdp/skybox.h"
#include "rompack/assets.h"

namespace bmsx {

void commitVdpViewSnapshot(GameView& view, const VDP& vdp, const RuntimeAssets& assets, const Memory& memory) {
	view.dither_type = static_cast<GameView::DitherType>(vdp.committedDitherType());
	commitVdpSkyboxViewState(view, vdp, assets, memory);
}

} // namespace bmsx
