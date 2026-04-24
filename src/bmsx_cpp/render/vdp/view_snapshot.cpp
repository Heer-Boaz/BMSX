#include "render/vdp/view_snapshot.h"

#include "machine/memory/memory.h"
#include "machine/devices/vdp/vdp.h"
#include "render/gameview.h"
#include "render/vdp/skybox.h"

namespace bmsx {

void commitVdpViewSnapshot(GameView& view, const VDP& vdp, Memory& memory) {
	view.dither_type = static_cast<GameView::DitherType>(vdp.committedDitherType());
	view.primaryAtlasIdInSlot = vdp.committedPrimaryAtlasIdInSlot();
	view.secondaryAtlasIdInSlot = vdp.committedSecondaryAtlasIdInSlot();
	commitVdpSkyboxViewState(view, vdp, memory);
}

} // namespace bmsx
