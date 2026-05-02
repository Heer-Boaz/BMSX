#include "render/vdp/view_snapshot.h"

#include "machine/devices/vdp/vdp.h"
#include "render/gameview.h"
#include "render/vdp/billboards.h"
#include "render/vdp/skybox.h"

namespace bmsx {

void commitVdpViewSnapshot(GameView& view, const VDP& vdp) {
	view.dither_type = static_cast<GameView::DitherType>(vdp.committedDitherType());
	view.vdpCamera = vdp.committedCameraBank0();
	commitVdpSkyboxViewState(view, vdp);
	commitVdpBillboardViewState(view, vdp);
}

} // namespace bmsx
