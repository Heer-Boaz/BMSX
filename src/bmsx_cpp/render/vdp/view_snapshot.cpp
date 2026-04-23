#include "render/vdp/view_snapshot.h"

#include "machine/devices/vdp/vdp.h"
#include "render/gameview.h"

namespace bmsx {

void commitVdpViewSnapshot(GameView& view, const VDP& vdp) {
	view.dither_type = static_cast<GameView::DitherType>(vdp.committedDitherType());
	view.primaryAtlasIdInSlot = vdp.committedPrimaryAtlasIdInSlot();
	view.secondaryAtlasIdInSlot = vdp.committedSecondaryAtlasIdInSlot();
	view.skyboxFaceIds = vdp.committedHasSkybox() ? vdp.committedSkyboxFaceIds() : SkyboxImageIds{};
	view.skyboxRenderReady = vdp.committedSkyboxRenderReady();
	if (view.skyboxRenderReady) {
		view.skyboxFaceUvRects = vdp.committedSkyboxFaceUvRects();
		view.skyboxFaceAtlasBindings = vdp.committedSkyboxFaceAtlasBindings();
		view.skyboxFaceSizes = vdp.committedSkyboxFaceSizes();
	} else {
		view.skyboxFaceUvRects = {};
		view.skyboxFaceAtlasBindings = {};
		view.skyboxFaceSizes = {};
	}
}

} // namespace bmsx
